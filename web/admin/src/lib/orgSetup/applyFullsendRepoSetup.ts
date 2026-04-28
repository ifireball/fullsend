import type { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";
import { expectedAppSlug } from "../actions/agentAppManifest";
import { createOrUpdateRepoFile } from "../github/createOrUpdateRepoFile";
import { putOrgActionsSecret } from "../github/putOrgActionsSecret";
import { putRepoActionsSecret } from "../github/putRepoActionsSecret";
import { putRepoActionsVariable } from "../github/putRepoActionsVariable";
import { CONFIG_FILE_PATH, CONFIG_REPO_NAME, DISPATCH_TOKEN_SECRET_NAME } from "../layers/constants";
import { createLayerGithub } from "../layers/githubClient";
import { formatOrgConfigYaml, newGreenfieldOrgConfigYaml } from "../layers/orgConfigYamlWrite";
import type { OrgConfigYaml } from "../layers/orgConfigParse";
import { validateOrgConfig } from "../layers/orgConfigParse";
import { secretNameForRole, variableNameForRole } from "../layers/secrets";
import {
  CODEOWNERS_PATH,
  MANAGED_WORKFLOW_PATHS,
  workflowFileUtf8,
} from "../layers/workflowTemplates";
import {
  clearStagedAppPem,
  clearStagedDispatchPat,
  readStagedAppMeta,
  readStagedAppPem,
  readStagedDispatchPat,
} from "./setupStorage";

export type ApplyLineState = "queued" | "in_progress" | "done" | "failed";

export type ApplyLineProgress = {
  id: string;
  state: ApplyLineState;
  error?: string;
};

export type ApplyFullsendRepoSetupParams = {
  octokit: Octokit;
  org: string;
  actorLogin: string;
  scmHost: string;
  agents: { role: string }[];
  parsedConfig: OrgConfigYaml | null;
  greenfieldDeploy: boolean;
  signal?: AbortSignal;
  onPhase: (message: string) => void;
  onLine: (ev: ApplyLineProgress) => void;
};

/** Stable row ids for the `.fullsend` setup card (matches {@link fullsendRepoItemLines}). */
export function fullsendApplyLineIds(agentRoles: string[]): string[] {
  return [
    "item_config_repo",
    "item_workflows",
    ...agentRoles.map((r) => `item_secrets_${r}`),
    "item_dispatch_org_secret",
  ];
}

async function listOrgRepos(
  octokit: Octokit,
  org: string,
  signal?: AbortSignal,
): Promise<{ name: string; private: boolean; id: number }[]> {
  const out: { name: string; private: boolean; id: number }[] = [];
  for await (const resp of octokit.paginate.iterator(octokit.rest.repos.listForOrg, {
    org,
    per_page: 100,
  })) {
    signal?.throwIfAborted();
    for (const r of resp.data) {
      out.push({ name: r.name, private: Boolean(r.private), id: r.id });
    }
  }
  return out;
}

async function listOrgInstallationAppIdsBySlug(
  octokit: Octokit,
  org: string,
  signal?: AbortSignal,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let page = 1;
  while (true) {
    signal?.throwIfAborted();
    const { data } = await octokit.rest.orgs.listAppInstallations({
      org,
      per_page: 100,
      page,
    });
    for (const inst of data.installations) {
      const slug =
        typeof inst.app_slug === "string" && inst.app_slug.trim().length > 0
          ? inst.app_slug.trim()
          : "";
      if (!slug) continue;
      const id = typeof inst.app_id === "number" ? inst.app_id : null;
      if (id && Number.isFinite(id) && id > 0) {
        out.set(slug, id);
      }
    }
    if (data.installations.length < 100) break;
    page += 1;
  }
  return out;
}

function resolveAppId(
  org: string,
  role: string,
  scmHost: string,
  actorLogin: string,
  installAppIdsBySlug: Map<string, number>,
): number {
  const meta = readStagedAppMeta(scmHost, actorLogin, org, role);
  if (typeof meta?.appId === "number" && Number.isFinite(meta.appId) && meta.appId > 0) {
    return meta.appId;
  }
  const slug = meta?.slug?.trim() || expectedAppSlug(org, role);
  const fromInstalls = installAppIdsBySlug.get(slug);
  if (typeof fromInstalls === "number" && Number.isFinite(fromInstalls) && fromInstalls > 0) {
    return fromInstalls;
  }
  throw new Error(
    `Could not resolve app id for ${role} (slug: ${slug}) from staged manifest data or org installations. Re-run this role's app setup and refresh install status.`,
  );
}

/**
 * Idempotent **automation bundle** for `.fullsend`: config repo + config.yaml, workflows,
 * repo secrets/variables, org dispatch secret. Excludes enrollment (FSM spec).
 * Order matches `internal/cli/admin.go` stack (without enrollment layer).
 */
export async function applyFullsendRepoSetup(p: ApplyFullsendRepoSetupParams): Promise<void> {
  const {
    octokit,
    org,
    actorLogin,
    scmHost,
    agents,
    parsedConfig,
    greenfieldDeploy,
    signal,
    onPhase,
    onLine,
  } = p;

  const gh = createLayerGithub(octokit);
  const repo = CONFIG_REPO_NAME;
  const failures: string[] = [];

  const mark = (id: string, state: ApplyLineState, error?: string) => {
    onLine({ id, state, error });
  };

  signal?.throwIfAborted();
  onPhase("Listing organisation repositories…");
  const orgRepos = await listOrgRepos(octokit, org, signal);
  const hasPrivate = orgRepos.some((r) => r.private);
  const repoNames = orgRepos.map((r) => r.name).sort((a, b) => a.localeCompare(b));

  // --- config repo + config.yaml ---
  mark("item_config_repo", "in_progress");
  onPhase("Updating configuration repository…");
  signal?.throwIfAborted();

  let yamlDoc: OrgConfigYaml;
  if (parsedConfig) {
    yamlDoc = parsedConfig;
    const verr = validateOrgConfig(yamlDoc);
    if (verr) {
      throw new Error(`config.yaml is invalid: ${verr}`);
    }
  } else if (greenfieldDeploy) {
    yamlDoc = newGreenfieldOrgConfigYaml({
      org,
      repoNames,
      enabledRepoNames: [],
      agentRoles: agents,
      scmHost,
      actorLogin,
    });
    const verr = validateOrgConfig(yamlDoc);
    if (verr) {
      throw new Error(`generated configuration is invalid: ${verr}`);
    }
  } else {
    throw new Error(
      "No valid org configuration is available. Fix config.yaml on GitHub or start from Deploy Fullsend.",
    );
  }

  const configBody = formatOrgConfigYaml(yamlDoc);

  const exists = await gh.getRepoExists(org, repo);
  signal?.throwIfAborted();
  if (!exists) {
    try {
      await octokit.rest.repos.createInOrg({
        org,
        name: repo,
        description: `fullsend configuration for ${org}`,
        private: hasPrivate,
        auto_init: true,
      });
    } catch (e) {
      if (e instanceof RequestError && e.status === 422) {
        const stillMissing = !(await gh.getRepoExists(org, repo));
        if (stillMissing) throw e;
      } else {
        throw e;
      }
    }
  }

  await createOrUpdateRepoFile(
    octokit,
    org,
    repo,
    CONFIG_FILE_PATH,
    "chore: update fullsend configuration",
    configBody,
    signal,
  );
  mark("item_config_repo", "done");

  // --- workflows ---
  mark("item_workflows", "in_progress");
  onPhase("Writing workflow files…");
  for (const path of MANAGED_WORKFLOW_PATHS) {
    signal?.throwIfAborted();
    try {
      const body = workflowFileUtf8(path, actorLogin);
      await createOrUpdateRepoFile(
        octokit,
        org,
        repo,
        path,
        `chore: update ${path}`,
        body,
        signal,
      );
    } catch (e) {
      if (path === CODEOWNERS_PATH) {
        /* Non-fatal: some orgs restrict CODEOWNERS writes (Go WorkflowsLayer). */
        continue;
      }
      throw e;
    }
  }
  mark("item_workflows", "done");

  const installAppIdsBySlug = await listOrgInstallationAppIdsBySlug(octokit, org, signal);

  // --- agent secrets + variables ---
  for (const { role } of agents) {
    const lineId = `item_secrets_${role}`;
    mark(lineId, "in_progress");
    onPhase(`Writing credentials for ${role}…`);

    try {
      signal?.throwIfAborted();

      const sName = secretNameForRole(role);
      const vName = variableNameForRole(role);
      const hasSecret = await gh.repoSecretExists(org, repo, sName);
      const hasVar = await gh.repoVariableExists(org, repo, vName);
      if (hasSecret && hasVar) {
        mark(lineId, "done");
        continue;
      }

      const pem = readStagedAppPem(scmHost, actorLogin, org, role);
      if (!pem) {
        throw new Error(
          `Missing private key for ${role}. Run this role's app setup in this browser first, then retry.`,
        );
      }

      const appId = resolveAppId(org, role, scmHost, actorLogin, installAppIdsBySlug);
      await putRepoActionsSecret(octokit, org, repo, sName, pem);
      await putRepoActionsVariable(octokit, org, repo, vName, String(appId));
      clearStagedAppPem(scmHost, actorLogin, org, role);
      mark(lineId, "done");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      mark(lineId, "failed", message);
      failures.push(`${role}: ${message}`);
    }
  }

  // --- org dispatch secret ---
  mark("item_dispatch_org_secret", "in_progress");
  onPhase("Writing organisation dispatch secret…");
  try {
    signal?.throwIfAborted();

    const dispatchCheck = await gh.orgSecretExists(org, DISPATCH_TOKEN_SECRET_NAME);
    if (dispatchCheck.kind === "ok" && dispatchCheck.exists) {
      mark("item_dispatch_org_secret", "done");
    } else {
      const pat = readStagedDispatchPat(scmHost, actorLogin, org);
      if (!pat?.trim()) {
        throw new Error(
          "Add the dispatch token on the Dispatch token card (fine-grained PAT with Actions access to `.fullsend`), then retry.",
        );
      }
      const enabled =
        yamlDoc.repos != null
          ? Object.entries(yamlDoc.repos)
              .filter(([, v]) => v?.enabled === true)
              .map(([name]) => name)
          : [];
      const want = new Set(enabled);
      const selectedIds = orgRepos.filter((r) => want.has(r.name)).map((r) => r.id);
      await putOrgActionsSecret(octokit, org, DISPATCH_TOKEN_SECRET_NAME, pat, selectedIds);
      clearStagedDispatchPat(scmHost, actorLogin, org);
      mark("item_dispatch_org_secret", "done");
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    mark("item_dispatch_org_secret", "failed", message);
    failures.push(`dispatch token: ${message}`);
  }

  if (failures.length > 0) {
    throw new Error(`Apply completed with failures: ${failures.join(" | ")}`);
  }

  onPhase("Finished applying changes.");
}
