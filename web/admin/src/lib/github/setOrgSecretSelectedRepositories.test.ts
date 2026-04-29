import { describe, it, expect, vi } from "vitest";
import type { Octokit } from "@octokit/rest";
import { mergeRepoIntoOrgSecretSelectedRepositories } from "./setOrgSecretSelectedRepositories";

describe("mergeRepoIntoOrgSecretSelectedRepositories", () => {
  it("PUTs merged ids when repo not in list", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: { total_count: 1, repositories: [{ id: 1, name: "a", full_name: "o/a" }] },
      })
      .mockResolvedValueOnce({ status: 204, data: {} });

    const octokit = { request } as unknown as Octokit;
    const out = await mergeRepoIntoOrgSecretSelectedRepositories(
      octokit,
      "o",
      "FULLSEND_DISPATCH_TOKEN",
      2,
    );
    expect(out.updated).toBe(true);
    expect(request).toHaveBeenLastCalledWith(
      "PUT /orgs/{org}/actions/secrets/{secret_name}/repositories",
      expect.objectContaining({
        org: "o",
        secret_name: "FULLSEND_DISPATCH_TOKEN",
        selected_repository_ids: [1, 2],
      }),
    );
  });

  it("skips PUT when repo id already present", async () => {
    const request = vi.fn().mockResolvedValue({
      data: { repositories: [{ id: 42, name: "x", full_name: "o/x" }] },
    });
    const octokit = { request } as unknown as Octokit;
    const out = await mergeRepoIntoOrgSecretSelectedRepositories(octokit, "o", "S", 42);
    expect(out.updated).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
