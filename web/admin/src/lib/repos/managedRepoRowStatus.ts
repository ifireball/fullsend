import type { Octokit } from "@octokit/rest";
import { findOpenEnrollmentPull } from "../enrollment/createEnrollmentPr";
import { SHIM_WORKFLOW_PATH } from "../layers/constants";
import type { LayerGithub } from "../layers/githubClient";

export type ManagedRepoRowResolved =
  | { kind: "R1" }
  | { kind: "R2"; prNumber: number; prUrl: string }
  | { kind: "R4" }
  | { kind: "row_error"; message: string };

/**
 * For a managed repo (in union as both GitHub + config, enabled): shim on default vs open enrollment PR.
 */
export async function evaluateManagedRepoRowStatus(
  orgName: string,
  repoName: string,
  gh: LayerGithub,
  octokit: Octokit,
  signal: AbortSignal,
): Promise<ManagedRepoRowResolved> {
  try {
    const body = await gh.getRepoFileUtf8(orgName, repoName, SHIM_WORKFLOW_PATH);
    if (signal.aborted) {
      return { kind: "row_error", message: "Aborted." };
    }
    if (body !== null) {
      return { kind: "R4" };
    }
    const open = await findOpenEnrollmentPull(octokit, orgName, repoName, signal);
    if (signal.aborted) {
      return { kind: "row_error", message: "Aborted." };
    }
    if (open) {
      return { kind: "R2", prNumber: open.number, prUrl: open.html_url };
    }
    return { kind: "R1" };
  } catch (e) {
    return {
      kind: "row_error",
      message: e instanceof Error ? e.message : "Failed to evaluate repository.",
    };
  }
}
