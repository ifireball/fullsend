import type { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";
import { SHIM_WORKFLOW_PATH } from "../layers/constants";
import { createOrUpdateFileOnBranch } from "../github/createOrUpdateFileOnBranch";
import {
  ENROLLMENT_BRANCH,
  ENROLLMENT_COMMIT_MESSAGE_ADD,
  ENROLLMENT_COMMIT_MESSAGE_UPDATE,
  ENROLLMENT_PR_BODY,
  ENROLLMENT_PR_TITLE,
  shimWorkflowUtf8,
} from "./shimWorkflow";

export type EnrollmentPrResult = {
  number: number;
  html_url: string;
  /** True when an existing open enrollment PR was updated instead of creating a new PR. */
  updated: boolean;
};

export async function findOpenEnrollmentPull(
  octokit: Octokit,
  org: string,
  repo: string,
  signal?: AbortSignal,
): Promise<{ number: number; html_url: string } | null> {
  const openPrs = await octokit.paginate(octokit.rest.pulls.list, {
    owner: org,
    repo,
    state: "open",
    per_page: 100,
  });
  signal?.throwIfAborted();
  for (const pr of openPrs) {
    if (pr.title === ENROLLMENT_PR_TITLE && typeof pr.number === "number" && pr.html_url) {
      return { number: pr.number, html_url: pr.html_url };
    }
  }
  return null;
}

function isRefAlreadyExists(err: unknown): boolean {
  if (!(err instanceof RequestError) || err.status !== 422) return false;
  const msg = String(err.message ?? "").toLowerCase();
  if (msg.includes("already exists")) return true;
  const errors = (err.response?.data as { errors?: unknown } | undefined)?.errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((e) => {
    if (typeof e === "string") return e.toLowerCase().includes("already exists");
    if (e && typeof e === "object" && "message" in e) {
      return String((e as { message: string }).message).toLowerCase().includes("already exists");
    }
    return false;
  });
}

/**
 * Idempotent enrollment PR flow (SPEC §6 / Go EnrollmentLayer.enrollRepo).
 */
export async function createEnrollmentPr(
  octokit: Octokit,
  org: string,
  repo: string,
  signal?: AbortSignal,
): Promise<EnrollmentPrResult> {
  const existing = await findOpenEnrollmentPull(octokit, org, repo, signal);
  if (existing) {
    await createOrUpdateFileOnBranch(
      octokit,
      org,
      repo,
      ENROLLMENT_BRANCH,
      SHIM_WORKFLOW_PATH,
      ENROLLMENT_COMMIT_MESSAGE_UPDATE,
      shimWorkflowUtf8(),
      signal,
    );
    return { number: existing.number, html_url: existing.html_url, updated: true };
  }

  const { data: repoInfo } = await octokit.rest.repos.get({ owner: org, repo });
  signal?.throwIfAborted();
  const defaultBranch =
    typeof repoInfo.default_branch === "string" && repoInfo.default_branch.length > 0
      ? repoInfo.default_branch
      : "main";

  const { data: refData } = await octokit.rest.git.getRef({
    owner: org,
    repo,
    ref: `heads/${defaultBranch}`,
  });
  signal?.throwIfAborted();
  const baseSha = refData.object.sha;

  try {
    await octokit.rest.git.createRef({
      owner: org,
      repo,
      ref: `refs/heads/${ENROLLMENT_BRANCH}`,
      sha: baseSha,
    });
  } catch (e) {
    if (!isRefAlreadyExists(e)) {
      throw e;
    }
  }

  await createOrUpdateFileOnBranch(
    octokit,
    org,
    repo,
    ENROLLMENT_BRANCH,
    SHIM_WORKFLOW_PATH,
    ENROLLMENT_COMMIT_MESSAGE_ADD,
    shimWorkflowUtf8(),
    signal,
  );

  const { data: created } = await octokit.rest.pulls.create({
    owner: org,
    repo,
    title: ENROLLMENT_PR_TITLE,
    body: ENROLLMENT_PR_BODY,
    head: ENROLLMENT_BRANCH,
    base: defaultBranch,
  });

  if (typeof created.number !== "number" || !created.html_url) {
    throw new Error("GitHub did not return a pull request number or URL.");
  }

  return { number: created.number, html_url: created.html_url, updated: false };
}
