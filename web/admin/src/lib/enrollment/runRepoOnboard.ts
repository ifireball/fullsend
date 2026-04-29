import type { Octokit } from "@octokit/rest";
import { createOrUpdateRepoFile } from "../github/createOrUpdateRepoFile";
import {
  mergeRepoIntoOrgSecretSelectedRepositories,
  orgSecretExistsForActions,
} from "../github/setOrgSecretSelectedRepositories";
import { CONFIG_FILE_PATH, CONFIG_REPO_NAME, DISPATCH_TOKEN_SECRET_NAME } from "../layers/constants";
import type { OrgConfigYaml } from "../layers/orgConfigParse";
import { validateOrgConfig } from "../layers/orgConfigParse";
import { formatOrgConfigYaml } from "../layers/orgConfigYamlWrite";
import { createEnrollmentPr, type EnrollmentPrResult } from "./createEnrollmentPr";

export type OnboardRowKind = "R1" | "R6" | "config_disabled";

/** Deep-clone org config as plain JSON data (Svelte `$state` uses Proxies; `structuredClone` rejects them). */
function cloneOrgConfigYamlPlain(cfg: OrgConfigYaml): OrgConfigYaml {
  return JSON.parse(JSON.stringify(cfg)) as OrgConfigYaml;
}

/**
 * Org-dashboard **Onboard**: optional `config.yaml` write, enrollment PR, then dispatch secret ACL.
 */
export async function runRepoOnboard(input: {
  octokit: Octokit;
  org: string;
  repoName: string;
  parsedConfig: OrgConfigYaml;
  rowKind: OnboardRowKind;
  signal?: AbortSignal;
}): Promise<EnrollmentPrResult> {
  const { octokit, org, repoName, parsedConfig, rowKind, signal } = input;
  const cfg = cloneOrgConfigYamlPlain(parsedConfig);

  if (rowKind === "R6" || rowKind === "config_disabled") {
    if (!cfg.repos) cfg.repos = {};
    const prev = cfg.repos[repoName] ?? {};
    cfg.repos[repoName] = { ...prev, enabled: true };
    const verr = validateOrgConfig(cfg);
    if (verr) {
      throw new Error(`config.yaml would be invalid: ${verr}`);
    }
    const yamlOut = formatOrgConfigYaml(cfg);
    await createOrUpdateRepoFile(
      octokit,
      org,
      CONFIG_REPO_NAME,
      CONFIG_FILE_PATH,
      `chore: enable ${repoName} in Fullsend configuration`,
      yamlOut,
      signal,
    );
  }

  const prResult = await createEnrollmentPr(octokit, org, repoName, signal);

  if (await orgSecretExistsForActions(octokit, org, DISPATCH_TOKEN_SECRET_NAME)) {
    try {
      const { data: repoMeta } = await octokit.rest.repos.get({ owner: org, repo: repoName });
      signal?.throwIfAborted();
      await mergeRepoIntoOrgSecretSelectedRepositories(
        octokit,
        org,
        DISPATCH_TOKEN_SECRET_NAME,
        repoMeta.id,
        signal,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Enrollment pull request was created, but updating organisation dispatch secret access failed: ${msg}`,
      );
    }
  }

  return prResult;
}
