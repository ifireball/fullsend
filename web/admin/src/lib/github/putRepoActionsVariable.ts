import type { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";

/** Create or update a GitHub Actions variable on a repository. */
export async function putRepoActionsVariable(
  octokit: Octokit,
  owner: string,
  repo: string,
  name: string,
  value: string,
): Promise<void> {
  try {
    await octokit.rest.actions.updateRepoVariable({
      owner,
      repo,
      name,
      value,
    });
  } catch (e) {
    if (e instanceof RequestError && e.status === 404) {
      await octokit.rest.actions.createRepoVariable({
        owner,
        repo,
        name,
        value,
      });
      return;
    }
    throw e;
  }
}
