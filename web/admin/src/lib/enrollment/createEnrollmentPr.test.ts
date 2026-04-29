import { describe, it, expect, vi } from "vitest";
import { RequestError } from "@octokit/request-error";
import type { Octokit } from "@octokit/rest";
import { createEnrollmentPr, findOpenEnrollmentPull } from "./createEnrollmentPr";
import {
  ENROLLMENT_BRANCH,
  ENROLLMENT_PR_BODY,
  ENROLLMENT_PR_TITLE,
  shimWorkflowUtf8,
} from "./shimWorkflow";
import { SHIM_WORKFLOW_PATH } from "../layers/constants";

function req404(): RequestError {
  return new RequestError("Not Found", 404, {
    request: { method: "GET", url: "u", headers: {} },
    response: { status: 404, url: "", headers: {}, data: {} },
  });
}

function octokitWithPullsList(): { octokit: Octokit; pullsList: ReturnType<typeof vi.fn> } {
  const pullsList = vi.fn();
  const octokit = {
    paginate: vi.fn(),
    rest: { pulls: { list: pullsList } },
  } as unknown as Octokit;
  return { octokit, pullsList };
}

describe("findOpenEnrollmentPull", () => {
  it("returns first open PR with enrollment title", async () => {
    const { octokit } = octokitWithPullsList();
    vi.mocked(octokit.paginate).mockResolvedValue([
      { title: "Other", number: 1, html_url: "https://github.com/o/r/pull/1" },
      { title: ENROLLMENT_PR_TITLE, number: 7, html_url: "https://github.com/o/r/pull/7" },
    ]);

    const r = await findOpenEnrollmentPull(octokit, "o", "r");
    expect(r).toEqual({ number: 7, html_url: "https://github.com/o/r/pull/7" });
  });

  it("returns null when no matching PR", async () => {
    const { octokit } = octokitWithPullsList();
    vi.mocked(octokit.paginate).mockResolvedValue([{ title: "Other", number: 1, html_url: "u" }]);
    expect(await findOpenEnrollmentPull(octokit, "o", "r")).toBeNull();
  });
});

describe("createEnrollmentPr", () => {
  it("updates shim on branch when enrollment PR already open", async () => {
    const createOrUpdateFileContents = vi.fn().mockResolvedValue({ data: {} });
    const pullsList = vi.fn();
    const octokit = {
      paginate: vi.fn().mockResolvedValue([
        { title: ENROLLMENT_PR_TITLE, number: 3, html_url: "https://github.com/acme/my/pull/3" },
      ]),
      rest: {
        repos: {
          get: vi.fn(),
          getContent: vi.fn().mockRejectedValue(req404()),
          createOrUpdateFileContents,
        },
        git: { getRef: vi.fn(), createRef: vi.fn() },
        pulls: { create: vi.fn(), list: pullsList },
      },
    } as unknown as Octokit;

    const out = await createEnrollmentPr(octokit, "acme", "my");
    expect(out).toEqual({
      number: 3,
      html_url: "https://github.com/acme/my/pull/3",
      updated: true,
    });
    expect(octokit.rest.repos.get).not.toHaveBeenCalled();
    expect(createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "my",
        path: SHIM_WORKFLOW_PATH,
        branch: ENROLLMENT_BRANCH,
        content: expect.any(String),
        message: "chore: update fullsend shim workflow",
      }),
    );
    expect(shimWorkflowUtf8().length).toBeGreaterThan(50);
  });

  it("creates ref, file, and PR when no enrollment PR exists", async () => {
    const createOrUpdateFileContents = vi.fn().mockResolvedValue({ data: {} });
    const pullsCreate = vi.fn().mockResolvedValue({
      data: { number: 99, html_url: "https://github.com/acme/my/pull/99" },
    });
    const pullsList = vi.fn();
    const octokit = {
      paginate: vi.fn().mockResolvedValue([]),
      rest: {
        repos: {
          get: vi.fn().mockResolvedValue({ data: { default_branch: "develop" } }),
          getContent: vi.fn().mockRejectedValue(req404()),
          createOrUpdateFileContents,
        },
        git: {
          getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "abc123" } } }),
          createRef: vi.fn().mockResolvedValue({ data: {} }),
        },
        pulls: { create: pullsCreate, list: pullsList },
      },
    } as unknown as Octokit;

    const out = await createEnrollmentPr(octokit, "acme", "my");
    expect(out).toEqual({
      number: 99,
      html_url: "https://github.com/acme/my/pull/99",
      updated: false,
    });
    expect(octokit.rest.git.createRef).toHaveBeenCalledWith({
      owner: "acme",
      repo: "my",
      ref: `refs/heads/${ENROLLMENT_BRANCH}`,
      sha: "abc123",
    });
    expect(createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: ENROLLMENT_BRANCH,
        message: "chore: add fullsend shim workflow",
      }),
    );
    expect(pullsCreate).toHaveBeenCalledWith({
      owner: "acme",
      repo: "my",
      title: ENROLLMENT_PR_TITLE,
      body: ENROLLMENT_PR_BODY,
      head: ENROLLMENT_BRANCH,
      base: "develop",
    });
  });
});
