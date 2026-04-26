import type { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";
import { analyzeOrgLayers } from "../layers/analyzeOrg";
import {
  forbidden403HintsFromRequestError,
  isLikelyGitHubRateLimit403,
  userGitHubRestRateLimitShortMessage,
} from "./githubPermissionHints";
import { configRepoIsGreenfieldDeploy } from "../layers/configRepo";
import { CONFIG_FILE_PATH, CONFIG_REPO_NAME } from "../layers/constants";
import { createLayerGithub } from "../layers/githubClient";
import {
  agentsFromConfig,
  enabledReposFromConfig,
  parseOrgConfigYaml,
  validateOrgConfig,
} from "../layers/orgConfigParse";
import {
  computePreflight,
  preflightOk,
  type PreflightResult,
} from "../layers/preflight";
import type { LayerReport, LayerStatus } from "../status/types";
import { deployRequiredOAuthScopes } from "./deployOAuthScopes";

/** Per-org signals from `GET /user/repos` and `GET /user/memberships/orgs` (see {@link OrgRow}). */
export type OrgListDeployRowContext = {
  hasWritePathInOrg: boolean;
  membershipCanCreateRepository: boolean | null;
};

export type OrgListAnalysisOk = {
  kind: "ok";
  rollup: LayerStatus;
  reports: LayerReport[];
};

export type OrgListAnalysisErr = {
  kind: "error";
  message: string;
  /** True when GitHub returned 403 (token cannot read this org’s installation state). */
  forbidden: boolean;
  /** Human lines derived from `X-Accepted-GitHub-Permissions` / OAuth scope headers when present. */
  missingPermissionLines?: string[];
  /** GitHub JSON `message` on the failing response, when available. */
  githubApiMessage?: string;
};

/**
 * Runs the same read-only layer stack as the org dashboard **analyze** path
 * (`analyzeOrgLayers`) so permission failures on workflows, Actions, enrollment, or
 * org secrets surface as errors with GitHub hint headers — not only the config repo.
 *
 * `orgListRowFromAnalysis` uses **config-repo** plus OAuth preflight for Deploy vs
 * Configure; other reports stay available for future row UX and debugging.
 */
export type AnalyzeOrgForOrgListOptions = {
  /**
   * When not `null`/`undefined`, skips REST `GET /repos/{org}/.fullsend` and uses this
   * as the config-repo existence hint (from GraphQL batching on the org list).
   */
  fullsendRepoExistsHint?: boolean | null;
};

export async function analyzeOrgForOrgList(
  org: string,
  octokit: Octokit,
  options?: AnalyzeOrgForOrgListOptions,
): Promise<OrgListAnalysisOk | OrgListAnalysisErr> {
  const gh = createLayerGithub(octokit);
  try {
    let exists: boolean;
    const hint = options?.fullsendRepoExistsHint;
    if (hint === true) {
      exists = true;
    } else if (hint === false) {
      exists = false;
    } else {
      exists = await gh.getRepoExists(org, CONFIG_REPO_NAME);
    }
    let agents: { role: string }[] = [];
    let enabledRepos: string[] = [];
    if (exists) {
      const raw = await gh.getRepoFileUtf8(org, CONFIG_REPO_NAME, CONFIG_FILE_PATH);
      if (raw) {
        try {
          const cfg = parseOrgConfigYaml(raw);
          if (validateOrgConfig(cfg) === null) {
            agents = agentsFromConfig(cfg);
            enabledRepos = enabledReposFromConfig(cfg);
          }
        } catch {
          /* invalid YAML — still analyze other layers with empty agents/repos */
        }
      }
    }
    const { reports, rollup } = await analyzeOrgLayers({
      org,
      gh,
      agents,
      enabledRepos,
    });
    return { kind: "ok", reports, rollup };
  } catch (e) {
    if (e instanceof RequestError && e.status === 403) {
      if (isLikelyGitHubRateLimit403(e)) {
        return {
          kind: "error",
          message: userGitHubRestRateLimitShortMessage(e),
          forbidden: false,
        };
      }
      const hints = forbidden403HintsFromRequestError(e);
      const lines =
        hints.missingPermissionLines.length > 0
          ? hints.missingPermissionLines
          : [
              "GitHub did not include permission hints on this response. Org owners may still need to: approve updated GitHub App permissions, authorize SAML SSO for this app, allow third-party GitHub App access for the organisation, or grant the app access to the repositories Fullsend inspects (including the `.fullsend` config repo and any enrolled repos).",
            ];
      return {
        kind: "error",
        message:
          "Insufficient permissions to evaluate Fullsend state for this organisation.",
        forbidden: true,
        missingPermissionLines: lines,
        githubApiMessage: hints.githubApiMessage,
      };
    }
    return {
      kind: "error",
      message: e instanceof Error ? e.message : String(e),
      forbidden: false,
    };
  }
}

export type OrgListRowCluster =
  | { kind: "checking" }
  | { kind: "configure" }
  | { kind: "deploy" }
  | {
      kind: "cannot_deploy";
      reason: string;
      /** GitHub 403 diagnostic lines (headers / accepted permissions) from a failed API call. */
      missingPermissionLines?: string[];
      githubApiMessage?: string;
      /** Short, actionable next steps for people (not raw API diagnostics). */
      helpBullets?: string[];
    }
  | { kind: "error"; message: string };

function cannotDeployClusterForMissingOAuthScopes(): OrgListRowCluster {
  return {
    kind: "cannot_deploy",
    reason:
      "Your current sign-in does not include all of the GitHub access Fullsend needs to install in this organisation.",
    helpBullets: [
      "Ask whoever manages this GitHub organisation (or the Fullsend admin app) to approve any pending app permissions, including organisation-level access if prompted.",
      "Sign out of this app, complete the updated authorisation on GitHub, then sign in again.",
    ],
  };
}

function cannotDeployWhenOAuthPreflightSkippedReadOnlyOrg(): OrgListRowCluster {
  return {
    kind: "cannot_deploy",
    reason:
      "With your current access we cannot confirm that you can add or update the Fullsend configuration in this organisation.",
    helpBullets: [
      "If you should be able to install here, ask an organisation owner to confirm you can create repositories in this organisation or to grant you write access to an organisation repository.",
      "Try Refresh, or sign out and sign in again after your administrator updates access for this app.",
    ],
  };
}

function cannotDeployOrgMembershipCannotCreateRepo(): OrgListRowCluster {
  return {
    kind: "cannot_deploy",
    reason:
      "Your role in this organisation does not include creating new repositories, which Fullsend needs to add its configuration repository.",
    helpBullets: [
      "Ask an organisation owner to change who may create repositories, or to run the install using an account that is allowed to create repositories here.",
    ],
  };
}

/**
 * Maps layer analysis to the org list trailing cluster.
 * - **403 / rate limits / network** from `analyzeOrgForOrgList` (any layer) → `cannot_deploy` or `error` before this mapper inspects reports.
 * - **Deploy vs Configure** (when analysis succeeds): uses **config-repo**, `deployPreflight`, and {@link OrgListDeployRowContext.membershipCanCreateRepository} from `GET /user/memberships/orgs` (`permissions.can_create_repository`). When that flag is `false`, Deploy is never offered. When it is `null` (outside collaborator / unknown), OAuth-skipped sessions still require {@link OrgListDeployRowContext.hasWritePathInOrg}.
 * Other layer reports remain on `result` for future UI (e.g. row hints) without changing the primary actions yet.
 */
export function orgListRowFromAnalysis(
  result: OrgListAnalysisOk | OrgListAnalysisErr,
  deployPreflight: PreflightResult,
  rowContext: OrgListDeployRowContext,
): OrgListRowCluster {
  if (result.kind === "error") {
    if (result.forbidden) {
      return {
        kind: "cannot_deploy",
        reason: result.message,
        ...(result.missingPermissionLines?.length
          ? { missingPermissionLines: result.missingPermissionLines }
          : {}),
        ...(result.githubApiMessage
          ? { githubApiMessage: result.githubApiMessage }
          : {}),
      };
    }
    return { kind: "error", message: result.message };
  }

  const configReport = result.reports.find((r: LayerReport) => r.name === "config-repo");
  if (!configReport) {
    return { kind: "error", message: "Missing config-repo layer report." };
  }

  if (configRepoIsGreenfieldDeploy(configReport)) {
    if (rowContext.membershipCanCreateRepository === false) {
      return cannotDeployOrgMembershipCannotCreateRepo();
    }
    if (!preflightOk(deployPreflight) && !deployPreflight.skipped) {
      return cannotDeployClusterForMissingOAuthScopes();
    }
    if (deployPreflight.skipped) {
      const canTry =
        rowContext.membershipCanCreateRepository === true ||
        (rowContext.membershipCanCreateRepository === null && rowContext.hasWritePathInOrg);
      if (!canTry) {
        return cannotDeployWhenOAuthPreflightSkippedReadOnlyOrg();
      }
    }
    return { kind: "deploy" };
  }

  return { kind: "configure" };
}

export function buildDeployPreflight(granted: string[] | null): PreflightResult {
  return computePreflight([...deployRequiredOAuthScopes()], granted);
}
