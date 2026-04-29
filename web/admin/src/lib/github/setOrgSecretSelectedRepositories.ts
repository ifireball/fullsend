import type { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";

/**
 * Merge `repoId` into the org Actions secret’s selected-repository list
 * (GitHub REST: list then PUT …/secrets/{name}/repositories). Does not upload a new secret value.
 */
export async function mergeRepoIntoOrgSecretSelectedRepositories(
  octokit: Octokit,
  org: string,
  secretName: string,
  repoId: number,
  signal?: AbortSignal,
): Promise<{ updated: boolean }> {
  const existing = new Set<number>();
  let page = 1;
  while (true) {
    signal?.throwIfAborted();
    const { data } = await octokit.request("GET /orgs/{org}/actions/secrets/{secret_name}/repositories", {
      org,
      secret_name: secretName,
      per_page: 100,
      page,
    });
    const rows = data.repositories ?? [];
    for (const r of rows) {
      if (typeof r.id === "number" && Number.isFinite(r.id)) {
        existing.add(r.id);
      }
    }
    if (rows.length < 100) break;
    page += 1;
  }

  if (existing.has(repoId)) {
    return { updated: false };
  }

  const merged = [...existing, repoId].sort((a, b) => a - b);
  await octokit.request("PUT /orgs/{org}/actions/secrets/{secret_name}/repositories", {
    org,
    secret_name: secretName,
    selected_repository_ids: merged,
  });
  return { updated: true };
}

/** True if the org secret exists (GET …/secrets/{name} returns 200). */
export async function orgSecretExistsForActions(
  octokit: Octokit,
  org: string,
  secretName: string,
): Promise<boolean> {
  try {
    await octokit.request("GET /orgs/{org}/actions/secrets/{secret_name}", {
      org,
      secret_name: secretName,
    });
    return true;
  } catch (e) {
    if (e instanceof RequestError && e.status === 404) return false;
    throw e;
  }
}
