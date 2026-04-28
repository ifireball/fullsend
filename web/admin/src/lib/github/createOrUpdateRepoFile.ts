import type { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";
import { utf8ToBase64 } from "./utf8Base64";

const RETRY_MS = [150, 300, 600, 1200, 2000, 3000, 4000, 5000];

/**
 * Create or update a single UTF-8 file on the repo default branch.
 * Retries on 404/409 to mirror Go forge behaviour after `auto_init` repo creation.
 */
export async function createOrUpdateRepoFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  message: string,
  utf8Body: string,
  signal?: AbortSignal,
): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < RETRY_MS.length; i++) {
    signal?.throwIfAborted();
    try {
      await writeOnce(octokit, owner, repo, path, message, utf8Body);
      return;
    } catch (e) {
      lastErr = e;
      if (e instanceof RequestError && (e.status === 404 || e.status === 409)) {
        await sleep(RETRY_MS[i] ?? 500);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function writeOnce(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  message: string,
  utf8Body: string,
): Promise<void> {
  let sha: string | undefined;
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
    if (!Array.isArray(data) && data.type === "file" && "sha" in data && typeof data.sha === "string") {
      sha = data.sha;
    }
  } catch (e) {
    if (!(e instanceof RequestError && e.status === 404)) {
      throw e;
    }
  }

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: utf8ToBase64(utf8Body),
    ...(sha ? { sha } : {}),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
