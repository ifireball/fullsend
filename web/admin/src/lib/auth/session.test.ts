import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("../github/user", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../github/user")>();
  return { ...mod, fetchGitHubUser: vi.fn() };
});

import { fetchGitHubUser, GitHubUserRequestError } from "../github/user";
import {
  githubLogin,
  githubUser,
  profileLoadFailed,
  reauthenticateSuggested,
  refreshSession,
  signOut,
} from "./session";
import { saveToken } from "./tokenStore";

beforeEach(() => {
  localStorage.clear();
  vi.mocked(fetchGitHubUser).mockReset();
  githubUser.set(null);
  reauthenticateSuggested.set(false);
  profileLoadFailed.set(null);
});

describe("refreshSession", () => {
  it("clears githubUser when there is no stored token", async () => {
    githubUser.set({ login: "ghost", name: null, avatarUrl: null });
    const r = await refreshSession();
    expect(r).toEqual({ ok: false, kind: "no_token" });
    expect(get(githubUser)).toBeNull();
    expect(get(githubLogin)).toBeNull();
    expect(get(profileLoadFailed)).toBeNull();
    expect(fetchGitHubUser).not.toHaveBeenCalled();
  });

  it("sets githubUser from fetchGitHubUser when token exists", async () => {
    saveToken({
      accessToken: "tok",
      tokenType: "bearer",
      expiresAt: Date.now() + 60_000,
    });
    vi.mocked(fetchGitHubUser).mockResolvedValue({
      login: "alice",
      name: "Alice L",
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
    });

    const r = await refreshSession();

    expect(r).toMatchObject({
      ok: true,
      user: {
        login: "alice",
        name: "Alice L",
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      },
    });
    expect(fetchGitHubUser).toHaveBeenCalledWith("tok");
    expect(get(githubUser)).toEqual({
      login: "alice",
      name: "Alice L",
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
    });
    expect(get(githubLogin)).toBe("alice");
    expect(get(reauthenticateSuggested)).toBe(false);
    expect(get(profileLoadFailed)).toBeNull();
  });

  it("clears reauthenticateSuggested after successful refresh", async () => {
    saveToken({
      accessToken: "tok",
      tokenType: "bearer",
      expiresAt: Date.now() + 60_000,
    });
    reauthenticateSuggested.set(true);
    vi.mocked(fetchGitHubUser).mockResolvedValue({
      login: "alice",
      name: null,
      avatarUrl: null,
    });

    await refreshSession();

    expect(get(reauthenticateSuggested)).toBe(false);
    expect(get(profileLoadFailed)).toBeNull();
  });

  it("clears githubUser but keeps stored token when fetchGitHubUser throws generically", async () => {
    saveToken({
      accessToken: "bad",
      tokenType: "bearer",
      expiresAt: Date.now() + 60_000,
    });
    githubUser.set({ login: "stale", name: null, avatarUrl: null });
    vi.mocked(fetchGitHubUser).mockRejectedValue(new Error("network"));

    const r = await refreshSession();

    expect(r).toMatchObject({ ok: false, kind: "profile_error", message: "network" });
    expect(get(githubUser)).toBeNull();
    expect(get(githubLogin)).toBeNull();
    expect(get(profileLoadFailed)).toEqual({ message: "network" });
    expect(localStorage.getItem("fullsend_admin_github_token")).not.toBeNull();
  });

  it("clears stored token and githubUser when fetchGitHubUser rejects with 401", async () => {
    saveToken({
      accessToken: "revoked",
      tokenType: "bearer",
      expiresAt: Date.now() + 60_000,
    });
    githubUser.set({ login: "stale", name: null, avatarUrl: null });
    vi.mocked(fetchGitHubUser).mockRejectedValue(
      new GitHubUserRequestError(401, "GitHub /user failed: 401 "),
    );

    const r = await refreshSession();

    expect(r).toEqual({ ok: false, kind: "unauthorized" });
    expect(localStorage.getItem("fullsend_admin_github_token")).toBeNull();
    expect(get(githubUser)).toBeNull();
    expect(get(githubLogin)).toBeNull();
    expect(get(reauthenticateSuggested)).toBe(true);
    expect(get(profileLoadFailed)).toBeNull();
  });

  it("does not call fetchGitHubUser when stored token is already expired", async () => {
    saveToken({
      accessToken: "tok",
      tokenType: "bearer",
      expiresAt: Date.now() - 1,
    });
    githubUser.set({ login: "stale", name: null, avatarUrl: null });

    const r = await refreshSession();

    expect(r).toEqual({ ok: false, kind: "no_token" });
    expect(fetchGitHubUser).not.toHaveBeenCalled();
    expect(get(githubUser)).toBeNull();
    expect(get(githubLogin)).toBeNull();
    expect(get(profileLoadFailed)).toBeNull();
    expect(localStorage.getItem("fullsend_admin_github_token")).toBeNull();
  });
});

describe("signOut", () => {
  it("clears token and githubUser", () => {
    saveToken({
      accessToken: "x",
      tokenType: "bearer",
      expiresAt: Date.now() + 60_000,
    });
    reauthenticateSuggested.set(true);
    githubUser.set({ login: "bob", name: null, avatarUrl: null });

    signOut();

    expect(localStorage.getItem("fullsend_admin_github_token")).toBeNull();
    expect(get(githubUser)).toBeNull();
    expect(get(githubLogin)).toBeNull();
    expect(get(profileLoadFailed)).toBeNull();
    expect(get(reauthenticateSuggested)).toBe(false);
  });
});
