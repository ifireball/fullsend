import { derived, writable } from "svelte/store";
import { clearOAuthScopeHeaderCache } from "../layers/preflight";
import { clearOrgListMemoryCache } from "../orgs/fetchOrgs";
import { clearOrgListAnalysisCache } from "../orgs/orgListAnalysisCache";
import { clearSession, loadToken } from "./tokenStore";
import {
  fetchGitHubUser,
  GitHubUserRequestError,
  type GitHubUser,
} from "../github/user";

/** Cached GitHub profile from `refreshSession()` (single `/api/github/user` source). */
export const githubUser = writable<GitHubUser | null>(null);

/** GitHub login for signed-in user, or null (derived from `githubUser`). */
export const githubLogin = derived(githubUser, ($u) => $u?.login ?? null);

/** True until initial auth boot (OAuth handoff or `refreshSession`) finishes. */
export const authBootPending = writable(true);

/** Set after 401 so the shell can show Re-authenticate (admin SPA UX spec: global banners). */
export const reauthenticateSuggested = writable(false);

/**
 * Token exists but `/api/github/user` failed (non-401). Shell shows recovery banner + Retry.
 */
export const profileLoadFailed = writable<{ message: string } | null>(null);

export type SignOutOptions = {
  /** When true, show re-auth banner after clearing session (invalid/expired token). */
  suggestReauth?: boolean;
};

export type RefreshSessionResult =
  | { ok: true; user: GitHubUser }
  | { ok: false; kind: "no_token" }
  | { ok: false; kind: "unauthorized" }
  | { ok: false; kind: "profile_error"; message: string };

function profileErrorMessage(e: unknown): string {
  if (e instanceof GitHubUserRequestError) {
    return e.message;
  }
  if (e instanceof Error) {
    return e.message;
  }
  return "Could not load your GitHub profile.";
}

export async function refreshSession(): Promise<RefreshSessionResult> {
  const t = loadToken();
  if (!t?.accessToken) {
    githubUser.set(null);
    profileLoadFailed.set(null);
    return { ok: false, kind: "no_token" };
  }

  profileLoadFailed.set(null);

  try {
    const u = await fetchGitHubUser(t.accessToken);
    githubUser.set(u);
    reauthenticateSuggested.set(false);
    return { ok: true, user: u };
  } catch (e) {
    if (e instanceof GitHubUserRequestError && e.status === 401) {
      profileLoadFailed.set(null);
      signOut({ suggestReauth: true });
      return { ok: false, kind: "unauthorized" };
    }
    const message = profileErrorMessage(e);
    githubUser.set(null);
    profileLoadFailed.set({ message });
    return { ok: false, kind: "profile_error", message };
  }
}

export function signOut(options?: SignOutOptions): void {
  clearSession();
  clearOrgListMemoryCache();
  clearOrgListAnalysisCache();
  clearOAuthScopeHeaderCache();
  githubUser.set(null);
  profileLoadFailed.set(null);
  reauthenticateSuggested.set(Boolean(options?.suggestReauth));
}
