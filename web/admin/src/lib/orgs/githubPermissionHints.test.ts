import { describe, expect, it } from "vitest";
import { RequestError } from "@octokit/request-error";
import {
  forbidden403HintsFromRequestError,
  humanLinesFromAcceptedGitHubPermissions,
  isLikelyGitHubRateLimit403,
  userGitHubRestRateLimitShortMessage,
} from "./githubPermissionHints";

describe("humanLinesFromAcceptedGitHubPermissions", () => {
  it("formats a single permission", () => {
    expect(humanLinesFromAcceptedGitHubPermissions("contents=read")).toEqual([
      "GitHub App needs: Repository permissions → Contents: Read-only",
    ]);
  });

  it("formats AND within one alternative", () => {
    expect(
      humanLinesFromAcceptedGitHubPermissions("pull_requests=write,contents=read"),
    ).toEqual([
      "GitHub App needs: Repository permissions → Pull requests: Read and write + Repository permissions → Contents: Read-only",
    ]);
  });

  it("formats OR alternatives", () => {
    expect(
      humanLinesFromAcceptedGitHubPermissions(
        "pull_requests=read,contents=read; issues=read,contents=read",
      ),
    ).toEqual([
      "Alternative 1 (all of): Repository permissions → Pull requests: Read-only + Repository permissions → Contents: Read-only",
      "Alternative 2 (all of): Repository permissions → Issues: Read-only + Repository permissions → Contents: Read-only",
    ]);
  });
});

describe("forbidden403HintsFromRequestError", () => {
  it("collects GitHub + OAuth hint headers and API message", () => {
    const err = new RequestError("Forbidden", 403, {
      request: { method: "GET", url: "https://api.github.com/test", headers: {} },
      response: {
        status: 403,
        url: "https://api.github.com/test",
        headers: {
          "x-accepted-github-permissions": "secrets=read",
          "x-accepted-oauth-scopes": "repo",
        },
        data: { message: "Resource not accessible by integration" },
      },
    });
    expect(forbidden403HintsFromRequestError(err)).toEqual({
      missingPermissionLines: [
        "GitHub App needs: Repository permissions → Secrets (Actions): Read-only",
        "OAuth scopes GitHub accepted for this endpoint: repo",
      ],
      githubApiMessage: "Resource not accessible by integration",
      rawAcceptedGitHubPermissions: "secrets=read",
      rawAcceptedOAuthScopes: "repo",
    });
  });
});

describe("isLikelyGitHubRateLimit403", () => {
  it("detects x-ratelimit-remaining: 0 when the JSON body is not a permission denial", () => {
    const err = new RequestError("Forbidden", 403, {
      request: { method: "GET", url: "https://api.github.com/test", headers: {} },
      response: {
        status: 403,
        url: "https://api.github.com/test",
        headers: { "x-ratelimit-remaining": "0" },
        data: {},
      },
    });
    expect(isLikelyGitHubRateLimit403(err)).toBe(true);
  });

  it("returns false for normal permission 403", () => {
    const err = new RequestError("Forbidden", 403, {
      request: { method: "GET", url: "https://api.github.com/test", headers: {} },
      response: {
        status: 403,
        url: "https://api.github.com/test",
        headers: { "x-ratelimit-remaining": "4999" },
        data: { message: "Resource not accessible by integration" },
      },
    });
    expect(isLikelyGitHubRateLimit403(err)).toBe(false);
  });

  it("does not treat exhausted quota + permission JSON message as rate limit", () => {
    const err = new RequestError("Forbidden", 403, {
      request: { method: "GET", url: "https://api.github.com/test", headers: {} },
      response: {
        status: 403,
        url: "https://api.github.com/test",
        headers: { "x-ratelimit-remaining": "0" },
        data: { message: "Resource not accessible by personal access token" },
      },
    });
    expect(isLikelyGitHubRateLimit403(err)).toBe(false);
  });

  it("detects primary rate limit from JSON message even when quota header is not zero", () => {
    const err = new RequestError("Forbidden", 403, {
      request: { method: "GET", url: "https://api.github.com/test", headers: {} },
      response: {
        status: 403,
        url: "https://api.github.com/test",
        headers: { "x-ratelimit-remaining": "1" },
        data: { message: "API rate limit exceeded for user ID 123" },
      },
    });
    expect(isLikelyGitHubRateLimit403(err)).toBe(true);
  });

  it("ignores Octokit error.message text (documentation_url) for heuristics", () => {
    const err = new RequestError(
      "Resource not accessible - https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api",
      403,
      {
        request: { method: "GET", url: "https://api.github.com/test", headers: {} },
        response: {
          status: 403,
          url: "https://api.github.com/test",
          headers: { "x-ratelimit-remaining": "4999" },
          data: { message: "Resource not accessible by personal access token" },
        },
      },
    );
    expect(isLikelyGitHubRateLimit403(err)).toBe(false);
  });
});

describe("userGitHubRestRateLimitShortMessage", () => {
  it("includes reset time and limit from GitHub headers", () => {
    const err = new RequestError("API rate limit exceeded", 403, {
      request: { method: "GET", url: "https://api.github.com/test", headers: {} },
      response: {
        status: 403,
        url: "https://api.github.com/test",
        headers: {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1776944389",
          "x-ratelimit-resource": "core",
        },
        data: { message: "API rate limit exceeded for user ID 1" },
      },
    });
    const msg = userGitHubRestRateLimitShortMessage(err);
    expect(msg).toContain("5000");
    expect(msg).toContain("core");
    expect(msg).toContain("Thu, 23 Apr 2026 11:39:49 GMT");
  });

  it("falls back when reset header is missing", () => {
    const err = new RequestError("API rate limit exceeded", 403, {
      request: { method: "GET", url: "https://api.github.com/test", headers: {} },
      response: {
        status: 403,
        url: "https://api.github.com/test",
        headers: { "x-ratelimit-limit": "60" },
        data: { message: "API rate limit exceeded" },
      },
    });
    const msg = userGitHubRestRateLimitShortMessage(err);
    expect(msg).toContain("60");
    expect(msg).toContain("Wait up to an hour");
  });
});
