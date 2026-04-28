import type { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";
import { expectedAppSlug, githubAppInstallationsNewUrl } from "../actions/agentAppManifest";
import type { OrgConfigYaml } from "../layers/orgConfigParse";
import { CONFIG_REPO_NAME, DISPATCH_TOKEN_SECRET_NAME } from "../layers/constants";
import type { LayerReport } from "../status/types";
import type { LayerStatus } from "../status/types";
import { rollupOrgLayerStatus } from "../status/engine";
import type { LayerGithub } from "../layers/githubClient";
import { secretNameForRole } from "../layers/secrets";
import { buildDispatchPatCreationUrl } from "./dispatchPatUrl";
import {
  readStagedAppMeta,
  readStagedAppPemPresent,
  readStagedDispatchPatPresent,
} from "./setupStorage";
import { prerequisiteHint, type DepEdge } from "./groupOrder";
import type {
  SetupGroupViewModel,
  SetupItemLine,
  SetupItemLineTone,
  SetupPrimaryAction,
  SetupStatusIcon,
} from "./types";

const SCM_HOST = "github.com";

function humanizeRole(role: string): string {
  if (!role) return "Agent";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Card titles in FSM display order (matches {@link buildOrgSetupGroups}).
 * Used while probes run so the board can show real headings under `aria-busy`.
 */
export function setupBoardTitlesFromAgents(agents: { role: string }[]): string[] {
  const roles = [...new Set(agents.map((a) => a.role))].sort();
  return [
    ...roles.map((r) => `${humanizeRole(r)} GitHub App`),
    "Dispatch token",
    ".fullsend repository setup",
  ];
}

function layerShortLabel(s: LayerStatus | undefined): string {
  switch (s) {
    case "installed":
      return "ok";
    case "not_installed":
      return "missing";
    case "degraded":
      return "needs attention";
    case "unknown":
    default:
      return "unknown";
  }
}

function lineToneForLayer(s: LayerStatus | undefined): SetupItemLineTone {
  switch (s) {
    case "installed":
      return "ok";
    case "not_installed":
      return "warn";
    case "degraded":
      return "warn";
    default:
      return "unknown";
  }
}

/** Rollup for `.fullsend` setup card: exclude enrollment (FSM non-goal). */
function rollupFullsendLayers(reports: LayerReport[]): LayerStatus {
  const core = reports.filter((r) => r.name !== "enrollment");
  return rollupOrgLayerStatus(core.length > 0 ? core : reports);
}

/**
 * Dependency edges per FSM spec: `.fullsend` setup waits on all app health gates + dispatch material.
 * `github_app:*` may still wait on `config_ok` in repair mode only.
 */
export function orgSetupDepEdgesFsm(
  agentRoles: string[],
  options: { greenfieldDeploy: boolean },
): DepEdge[] {
  const roles = [...new Set(agentRoles)].sort();
  const edges: DepEdge[] = [];
  for (const role of roles) {
    const gid = `github_app:${role}`;
    if (!options.greenfieldDeploy) {
      edges.push({ group: gid, requiresSatisfied: "config_ok" });
    }
    edges.push({
      group: "fullsend_repo_setup",
      requiresSatisfied: `github_app_healthy:${role}`,
    });
  }
  edges.push({
    group: "fullsend_repo_setup",
    requiresSatisfied: "dispatch_material_ok",
  });
  if (roles.length === 0) {
    edges.push({
      group: "fullsend_repo_setup",
      requiresSatisfied: "config_ok",
    });
  }
  return edges;
}

function reportNamed(
  reports: LayerReport[],
  name: string,
): LayerReport | undefined {
  return reports.find((r) => r.name === name);
}

/** Item rows for the `.fullsend` setup card (shared with org dashboard). */
export function fullsendRepoItemLines(
  reports: LayerReport[],
  roles: string[],
): SetupItemLine[] {
  const lines: SetupItemLine[] = [];
  const cfg = reportNamed(reports, "config-repo");
  if (cfg) {
    lines.push({
      id: "item_config_repo",
      label: `Configuration repository .fullsend — ${layerShortLabel(cfg.status)}`,
      lineTone: lineToneForLayer(cfg.status),
    });
  }
  const wf = reportNamed(reports, "workflows");
  if (wf) {
    const wfFix = wf.wouldFix
      .map((w) => w.trim())
      .filter(Boolean)
      .join("; ");
    lines.push({
      id: "item_workflows",
      label: `Workflow files (agent.yaml, repo-onboard.yaml, CODEOWNERS) — ${layerShortLabel(wf.status)}${
        wfFix ? `. ${wfFix}` : ""
      }`,
      lineTone: lineToneForLayer(wf.status),
    });
  }
  const sec = reportNamed(reports, "secrets");
  if (sec) {
    const t = lineToneForLayer(sec.status);
    for (const role of roles) {
      lines.push({
        id: `item_secrets_${role}`,
        label: `Secrets for ${humanizeRole(role)} agent (private key + app id) — ${layerShortLabel(sec.status)}`,
        lineTone: t,
      });
    }
  }
  const disp = reportNamed(reports, "dispatch-token");
  if (disp) {
    lines.push({
      id: "item_dispatch_org_secret",
      label: `Organisation secret ${DISPATCH_TOKEN_SECRET_NAME} — ${layerShortLabel(disp.status)}`,
      lineTone: lineToneForLayer(disp.status),
    });
  }
  if (lines.length === 0) {
    lines.push({
      label: "No layer data yet.",
      lineTone: "unknown",
    });
  }
  return lines;
}

/**
 * Slug for the GitHub App on an org installation row.
 * REST returns **`app_slug`** on each installation; some callers still nest under `app.slug`.
 */
export function installationRecordAppSlug(inst: {
  app?: { slug?: string | null } | null;
  app_slug?: string | null;
}): string | null {
  const nested = inst.app?.slug?.trim();
  if (nested) return nested;
  const flat = typeof inst.app_slug === "string" ? inst.app_slug.trim() : "";
  return flat.length > 0 ? flat : null;
}

function installationSlugSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const s of a) {
    if (!b.has(s)) return false;
  }
  return true;
}

/**
 * GitHub’s org installation list can briefly disagree with the UI after install/uninstall
 * (read replicas / propagation). Re-read until two consecutive snapshots match.
 */
const INSTALL_LIST_SETTLE_MS = import.meta.env.VITEST ? 0 : 400;
const INSTALL_LIST_MAX_SETTLE_READS = 4;

async function fetchOrgInstallationSlugSet(
  octokit: Octokit,
  org: string,
): Promise<{ slugs: Set<string> } | { forbidden: true }> {
  const slugs = new Set<string>();
  try {
    let page = 1;
    while (true) {
      const { data } = await octokit.rest.orgs.listAppInstallations({
        org,
        per_page: 100,
        page,
        request: {
          cache: "no-store",
          headers: {
            "cache-control": "no-cache",
            pragma: "no-cache",
          },
        },
      });
      const batch = Array.isArray(data)
        ? data
        : ((data as { installations?: unknown[] }).installations ?? []);
      for (const inst of batch) {
        const s = installationRecordAppSlug(
          inst as { app?: { slug?: string | null } | null; app_slug?: string | null },
        );
        if (s) slugs.add(s);
      }
      if (batch.length < 100) break;
      page += 1;
    }
    return { slugs };
  } catch (e) {
    if (e instanceof RequestError && (e.status === 403 || e.status === 404)) {
      return { forbidden: true };
    }
    throw e;
  }
}

async function listOrgAppInstallationSlugs(
  octokit: Octokit,
  org: string,
): Promise<{ slugs: Set<string>; forbidden: boolean }> {
  const first = await fetchOrgInstallationSlugSet(octokit, org);
  if ("forbidden" in first) {
    return { slugs: new Set(), forbidden: true };
  }
  let prev = first.slugs;
  for (let n = 1; n < INSTALL_LIST_MAX_SETTLE_READS; n += 1) {
    const delayMs = n === 1 ? 0 : INSTALL_LIST_SETTLE_MS;
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    const next = await fetchOrgInstallationSlugSet(octokit, org);
    if ("forbidden" in next) {
      return { slugs: new Set(), forbidden: true };
    }
    if (installationSlugSetsEqual(prev, next.slugs)) {
      return { slugs: next.slugs, forbidden: false };
    }
    prev = next.slugs;
  }
  return { slugs: prev, forbidden: false };
}

async function probeAppSlug(
  octokit: Octokit,
  slug: string,
): Promise<"exists" | "missing" | "inconclusive"> {
  try {
    await octokit.rest.apps.getBySlug({ app_slug: slug });
    return "exists";
  } catch (e) {
    if (e instanceof RequestError && e.status === 404) return "missing";
    if (e instanceof RequestError && e.status === 403) return "inconclusive";
    throw e;
  }
}

/**
 * GitHub **web** URL for an organisation-owned GitHub App’s settings (not the REST API).
 * Slug must match the segment in that page’s path.
 */
export function githubOrgAppSettingsUrl(orgLogin: string, appSlug: string): string {
  const o = orgLogin.trim();
  const s = appSlug.trim();
  if (!o || !s) return "https://github.com/";
  return `https://github.com/organizations/${encodeURIComponent(o)}/settings/apps/${encodeURIComponent(s)}`;
}

/** FSM `ga_need_install` (Table A, `github_app:{role}`). */
const GA_NEED_INSTALL_SUBTITLE =
  "App exists but is not installed on this organisation. Install it, then return here.";

function slugFromConfig(cfg: OrgConfigYaml | null, role: string): string | null {
  if (!cfg?.agents) return null;
  const row = cfg.agents.find((a) => a.role === role);
  const s = row?.slug?.trim();
  return s && s.length > 0 ? s : null;
}

function displayNameFromConfig(cfg: OrgConfigYaml | null, role: string): string | null {
  if (!cfg?.agents) return null;
  const row = cfg.agents.find((a) => a.role === role);
  const n = row?.name?.trim();
  return n && n.length > 0 ? n : null;
}

function fullsendBlockedSubtitle(
  roles: string[],
  satisfied: Set<string>,
): string {
  const missingApps = roles.filter((r) => !satisfied.has(`github_app_healthy:${r}`));
  const missingDispatch = !satisfied.has("dispatch_material_ok");
  const parts: string[] = [];
  if (missingApps.length > 0) {
    const labels = missingApps.map((r) => `${humanizeRole(r)} GitHub App`);
    parts.push(`Complete ${labels.join(", ")}`);
  }
  if (missingDispatch) {
    parts.push("finish Dispatch token");
  }
  if (parts.length === 0) {
    return "Complete upstream steps before running setup.";
  }
  return `${parts.join(" and ")} before running .fullsend repository setup.`;
}

export type BuildOrgSetupGroupsInput = {
  org: string;
  actorLogin: string;
  octokit: Octokit;
  gh: LayerGithub;
  reports: LayerReport[];
  agents: { role: string }[];
  parsedConfig: OrgConfigYaml | null;
  greenfieldDeploy: boolean;
};

/**
 * Builds org setup cards per `2026-04-27-admin-spa-org-setup-install-repair-fsm.md`
 * (groups, subtitles, primaries, item rows). Performs GitHub slug / installation probes.
 */
export async function buildOrgSetupGroups(
  input: BuildOrgSetupGroupsInput,
): Promise<SetupGroupViewModel[]> {
  const {
    org,
    actorLogin,
    octokit,
    gh,
    reports,
    agents,
    parsedConfig,
    greenfieldDeploy,
  } = input;

  const roles = [...new Set(agents.map((a) => a.role))].sort();
  const depEdges = orgSetupDepEdgesFsm(roles, { greenfieldDeploy });

  const configReport = reports.find((r) => r.name === "config-repo");
  const satisfied = new Set<string>();
  if (configReport?.status === "installed") {
    satisfied.add("config_ok");
  }

  const dispatchReport = reports.find((r) => r.name === "dispatch-token");
  const dispatchOrgOk = dispatchReport?.status === "installed";
  const dispatchLocalOk = readStagedDispatchPatPresent(SCM_HOST, actorLogin, org);
  if (dispatchOrgOk || dispatchLocalOk) {
    satisfied.add("dispatch_material_ok");
  }

  const { slugs: installedSlugs, forbidden: installsForbidden } =
    await listOrgAppInstallationSlugs(octokit, org);

  const dispatchPatUrl = buildDispatchPatCreationUrl(org);
  const repoExists =
    configReport?.status === "installed" ||
    (await gh.getRepoExists(org, CONFIG_REPO_NAME));

  type AppProbe = {
    role: string;
    resolvedSlug: string;
    slugSource: "config" | "localStorage" | "heuristic";
    probe: "exists" | "missing" | "inconclusive";
    installedOnOrg: boolean;
    pemLocal: boolean;
    pemRepo: boolean;
  };

  const appProbes: AppProbe[] = [];

  for (const role of roles) {
    const fromCfg = slugFromConfig(parsedConfig, role);
    const meta = readStagedAppMeta(SCM_HOST, actorLogin, org, role);
    const fromMeta = meta?.slug?.trim() ? meta.slug.trim() : null;
    const heuristic = expectedAppSlug(org, role);
    let resolvedSlug = fromCfg ?? fromMeta ?? heuristic;
    let slugSource: AppProbe["slugSource"] = fromCfg
      ? "config"
      : fromMeta
        ? "localStorage"
        : "heuristic";

    const pemLocal = readStagedAppPemPresent(SCM_HOST, actorLogin, org, role);
    let pemRepo = false;
    if (repoExists) {
      try {
        pemRepo = await gh.repoSecretExists(
          org,
          CONFIG_REPO_NAME,
          secretNameForRole(role),
        );
      } catch {
        pemRepo = false;
      }
    }

    let probe: AppProbe["probe"] = "missing";
    if (resolvedSlug) {
      probe = await probeAppSlug(octokit, resolvedSlug);
      if (probe === "missing" && slugSource === "heuristic") {
        /* keep heuristic slug for install URL naming */
      } else if (probe === "missing" && (fromCfg || fromMeta)) {
        /* config/local said slug but GitHub 404 — still show as target */
      }
    }

    const installedOnOrg =
      !installsForbidden &&
      resolvedSlug.length > 0 &&
      installedSlugs.has(resolvedSlug);

    appProbes.push({
      role,
      resolvedSlug,
      slugSource,
      probe,
      installedOnOrg,
      pemLocal,
      pemRepo,
    });

    const pemOk = pemLocal || pemRepo;
    const installOk = installedOnOrg;
    const appHealthy = installOk && pemOk;
    if (appHealthy) {
      satisfied.add(`github_app_healthy:${role}`);
    }
  }

  const groups: SetupGroupViewModel[] = [];

  for (const p of appProbes) {
    const { role } = p;
    const id = `github_app:${role}`;
    const configGateHint = prerequisiteHint(id, satisfied, depEdges);
    const displayName =
      displayNameFromConfig(parsedConfig, role) ??
      (p.slugSource === "localStorage"
        ? readStagedAppMeta(SCM_HOST, actorLogin, org, role)?.displayName ?? null
        : null);
    const slugNotVerifiedByPublicApi =
      (p.pemLocal || p.pemRepo) &&
      (p.probe === "missing" || p.probe === "inconclusive");

    /** GET /apps returned 404 and we are not in the PEM-backed “API may be blind” case. */
    const apiMissingWithoutCredOverride =
      p.probe === "missing" && !slugNotVerifiedByPublicApi;

    const nameForRow = (() => {
      if (displayName) {
        if (apiMissingWithoutCredOverride) {
          return `${displayName} (needs to be created on GitHub)`;
        }
        return displayName;
      }
      if (p.probe === "exists" || p.installedOnOrg) {
        return p.resolvedSlug;
      }
      if (apiMissingWithoutCredOverride) {
        return p.slugSource === "heuristic"
          ? `${p.resolvedSlug} (needs to be created on GitHub)`
          : `${p.resolvedSlug} (not found on GitHub — create the app or fix config)`;
      }
      if (p.slugSource === "heuristic") {
        return `${p.resolvedSlug} (unconfirmed)`;
      }
      return p.resolvedSlug;
    })();

    let statusIcon: SetupStatusIcon = "warn";
    let subtitle: string;
    let primary: SetupPrimaryAction = null;
    const itemLines: SetupItemLine[] = [];

    const nameLabelSuffix = slugNotVerifiedByPublicApi ? " (cannot confirm)" : "";
    const nameLabel = `App name: ${nameForRow}${nameLabelSuffix}`;

    const nameRowTone: SetupItemLineTone = slugNotVerifiedByPublicApi
      ? "ok"
      : p.probe === "exists" || p.slugSource !== "heuristic"
        ? "ok"
        : p.probe === "inconclusive"
          ? "unknown"
          : "warn";

    let nameDetail: string | null = null;
    let nameDetailLinkHref: string | null = null;
    let nameDetailLinkLabel: string | null = null;
    if (slugNotVerifiedByPublicApi && !configGateHint) {
      nameDetail =
        "GitHub’s GET /apps/{slug} endpoint often returns no usable result for private organisation apps when using this admin sign-in token, so the UI cannot confirm the slug via the API. The value shown is from your saved create flow—use the link below to open the app in your organisation’s GitHub settings and verify it exists and the slug matches.";
      nameDetailLinkHref = githubOrgAppSettingsUrl(org, p.resolvedSlug);
      nameDetailLinkLabel = "Open app in organisation settings on GitHub";
    } else if (nameRowTone === "warn" && !configGateHint) {
      nameDetail =
        "Name not confirmed until you create the app, confirm the slug on GitHub, or open the configuration repository.";
    }
    itemLines.push({
      id: "item_app_name",
      label: nameLabel,
      lineTone: nameRowTone,
      detail: nameDetail,
      detailLinkHref: nameDetailLinkHref,
      detailLinkLabel: nameDetailLinkLabel,
    });

    let installTone: SetupItemLineTone;
    let installLabel: string;
    let installDetail: string | null = null;
    if (installsForbidden) {
      installTone = "unknown";
      installLabel = `Install status on ${org} — unknown`;
      installDetail =
        "This session cannot list organisation app installations on GitHub (missing API scope or organization permissions). Verify install status on GitHub, or sign in with an organization admin token.";
    } else if (p.installedOnOrg) {
      installTone = "ok";
      installLabel = `Installed on ${org}`;
    } else {
      installTone = "unknown";
      installLabel = `Not installed on ${org}`;
    }
    const installRecheck: { kind: "recheck_org_app_installs"; label: string } | undefined =
      (p.probe !== "missing" || slugNotVerifiedByPublicApi) &&
      (!p.installedOnOrg || installsForbidden)
        ? { kind: "recheck_org_app_installs", label: "Recheck" }
        : undefined;
    itemLines.push({
      id: "item_app_install",
      label: installLabel,
      lineTone: installTone,
      detail: installDetail,
      ...(installRecheck ? { trailingAction: installRecheck } : {}),
    });

    if (configGateHint) {
      statusIcon = "warn";
      subtitle = `${configGateHint} Then continue with this agent’s GitHub App.`;
      primary = null;
    } else if (p.installedOnOrg && (p.pemLocal || p.pemRepo)) {
      statusIcon = "ok";
      subtitle =
        "This agent’s app is created, installed, and credentials are available (in .fullsend or saved on this device until setup completes).";
      primary = null;
    } else if (p.installedOnOrg && !p.pemLocal && !p.pemRepo) {
      statusIcon = "error";
      subtitle =
        "An app is registered on GitHub but credentials are not on this device or in .fullsend. Remove the app or complete a fresh create flow.";
      primary = null;
    } else if (!p.installedOnOrg && p.probe === "exists") {
      statusIcon = "warn";
      subtitle = GA_NEED_INSTALL_SUBTITLE;
      primary = { label: "Install app on Organisation" };
    } else if (!p.installedOnOrg && (p.pemLocal || p.pemRepo)) {
      statusIcon = "warn";
      if (installsForbidden) {
        subtitle =
          "App credentials are available (on this device or in .fullsend). This session cannot confirm install status via the API; install the app on this organisation on GitHub if you have not already, then return here.";
      } else {
        subtitle = GA_NEED_INSTALL_SUBTITLE;
      }
      primary = { label: "Install app on Organisation" };
    } else if (p.probe === "inconclusive" && !p.installedOnOrg) {
      statusIcon = "warn";
      subtitle =
        "Could not confirm app visibility on GitHub; open GitHub or continue from your saved progress.";
      primary = { label: "Create app on GitHub" };
    } else {
      statusIcon = "warn";
      subtitle =
        "No app registered for this agent yet. Create it on GitHub, then return to this screen.";
      primary = { label: "Create app on GitHub" };
    }

    groups.push({
      id,
      kind: "github_app",
      title: `${humanizeRole(role)} GitHub App`,
      statusIcon,
      subtitle,
      itemLines,
      prerequisiteHint: configGateHint,
      primary,
      githubAppSlug: p.resolvedSlug,
      dispatchPatCreationUrl: null,
    });
  }

  /** Dispatch token card */
  let dispatchIcon: SetupStatusIcon = "warn";
  let dispatchSubtitle: string;
  let dispatchPrimary: SetupPrimaryAction = null;
  if (dispatchReport?.status === "unknown") {
    dispatchIcon = "in_progress";
    dispatchSubtitle =
      "Checking whether a dispatch token is already configured…";
    dispatchPrimary = null;
  } else if (dispatchOrgOk) {
    dispatchIcon = "ok";
    dispatchSubtitle = `Organisation dispatch secret ${DISPATCH_TOKEN_SECRET_NAME} is configured on GitHub.`;
    dispatchPrimary = null;
  } else if (dispatchLocalOk) {
    dispatchIcon = "ok";
    dispatchSubtitle =
      "Token saved on this device. It will be written to GitHub when you run .fullsend repository setup.";
    dispatchPrimary = null;
  } else {
    dispatchIcon = "warn";
    dispatchSubtitle =
      "No dispatch token found for this organisation on this device. Create a fine-grained PAT scoped to .fullsend, then save it here.";
    dispatchPrimary = { label: "Create token in GitHub" };
  }

  const dispatchTokenLine: SetupItemLine = {
    id: "item_dispatch_token",
    label: `Dispatch token for workflow triggers — ${
      dispatchOrgOk ? "ok (org)" : dispatchLocalOk ? "ok (this device)" : "missing"
    }`,
    lineTone: dispatchOrgOk || dispatchLocalOk ? "ok" : "warn",
    ...(!dispatchOrgOk
      ? {
          trailingAction: {
            kind: "open_dispatch_token_paste" as const,
            label: "Paste token",
          },
        }
      : {}),
  };
  const dispatchItems: SetupItemLine[] = [dispatchTokenLine];
  if (dispatchReport?.status === "unknown" && dispatchReport.details[0]) {
    dispatchItems[0] = {
      ...dispatchItems[0]!,
      lineTone: "unknown",
      label: `${dispatchItems[0]!.label} (${dispatchReport.details[0]})`,
    };
  }

  groups.push({
    id: "dispatch_pat",
    kind: "dispatch_pat",
    title: "Dispatch token",
    statusIcon: dispatchIcon,
    subtitle: dispatchSubtitle,
    itemLines: dispatchItems,
    prerequisiteHint: null,
    primary: dispatchPrimary,
    githubAppSlug: null,
    dispatchPatCreationUrl: dispatchPatUrl,
  });

  /** `.fullsend` repository setup card */
  const fsHint = prerequisiteHint("fullsend_repo_setup", satisfied, depEdges);
  const orgRollup = rollupFullsendLayers(reports);
  let fsIcon: SetupStatusIcon = "warn";
  let fsSubtitle: string;
  let fsPrimary: SetupPrimaryAction = null;
  let fsItemLines = fullsendRepoItemLines(reports, roles);

  if (fsHint) {
    fsIcon = "warn";
    fsSubtitle = fullsendBlockedSubtitle(roles, satisfied);
  } else if (orgRollup === "installed") {
    fsIcon = "ok";
    fsSubtitle =
      ".fullsend is present and matches Fullsend's required configuration for this organisation.";
    fsPrimary = null;
  } else if (orgRollup === "not_installed") {
    fsIcon = "warn";
    fsSubtitle =
      ".fullsend is missing or incomplete. Apply changes to create or repair it on GitHub.";
    fsPrimary = { label: "Install", disabled: false };
  } else if (orgRollup === "degraded") {
    fsIcon = "warn";
    fsSubtitle = "Some .fullsend settings do not match what Fullsend needs.";
    fsPrimary = { label: "Repair", disabled: false };
  } else {
    fsIcon = "unknown";
    fsSubtitle = "Checking .fullsend and related settings…";
    fsPrimary = null;
  }

  groups.push({
    id: "fullsend_repo_setup",
    kind: "fullsend_repo_setup",
    title: ".fullsend repository setup",
    statusIcon: fsIcon,
    subtitle: fsSubtitle,
    itemLines: fsItemLines,
    prerequisiteHint: null,
    primary: fsPrimary,
    githubAppSlug: null,
    dispatchPatCreationUrl: null,
  });

  /** FSM order: all agent app cards, then dispatch token, then `.fullsend` setup. */
  const apps = groups
    .filter((g) => g.kind === "github_app")
    .sort((a, b) => a.id.localeCompare(b.id));
  const dispatch = groups.find((g) => g.id === "dispatch_pat");
  const fullsend = groups.find((g) => g.id === "fullsend_repo_setup");
  return [...apps, ...(dispatch ? [dispatch] : []), ...(fullsend ? [fullsend] : [])];
}

/** Org dashboard: same copy as setup’s `.fullsend` card, but navigation-only (no Apply). */
export function dashboardFullsendInstallCardViewModel(input: {
  org: string;
  reports: LayerReport[];
  roles: string[];
}): {
  title: string;
  statusIcon: SetupStatusIcon;
  subtitle: string;
  itemLines: SetupItemLine[];
  setupHref: string;
  /** When the install stack is fully healthy, omit the setup CTA on the dashboard. */
  linkLabel: string | null;
  linkPrimary: boolean;
} {
  const { org, reports, roles } = input;
  const orgRollup = rollupOrgLayerStatus(reports);
  const itemLines = fullsendRepoItemLines(reports, roles);
  const setupHref = `#/org/${encodeURIComponent(org)}/setup`;
  const title = ".fullsend repository setup";

  if (orgRollup === "installed") {
    return {
      title,
      statusIcon: "ok",
      subtitle:
        ".fullsend is present and matches Fullsend's required configuration for this organisation.",
      itemLines,
      setupHref,
      linkLabel: null,
      linkPrimary: false,
    };
  }
  if (orgRollup === "not_installed") {
    return {
      title,
      statusIcon: "warn",
      subtitle:
        ".fullsend is missing or incomplete. Use the org setup page to install or repair it on GitHub.",
      itemLines,
      setupHref,
      linkLabel: "Open org setup",
      linkPrimary: true,
    };
  }
  if (orgRollup === "degraded") {
    return {
      title,
      statusIcon: "warn",
      subtitle: "Some .fullsend settings do not match what Fullsend needs. Fix them on the setup page.",
      itemLines,
      setupHref,
      linkLabel: "Open org setup",
      linkPrimary: true,
    };
  }
  return {
    title,
    statusIcon: "unknown",
    subtitle:
      "Could not fully verify .fullsend against GitHub. Open the setup page to review permissions and configuration.",
    itemLines,
    setupHref,
    linkLabel: "Open org setup",
    linkPrimary: true,
  };
}
