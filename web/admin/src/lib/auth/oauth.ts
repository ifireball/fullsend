import { challengeS256, randomVerifier } from "./pkce";
import { refreshSession } from "./session";
import { obtainTurnstileToken } from "./turnstile";
import { clearSession, saveToken } from "./tokenStore";

const PKCE_VERIFIER_KEY = "fullsend_admin_pkce_verifier";
const OAUTH_STATE_KEY = "fullsend_admin_oauth_state";
const OAUTH_DOC_HANDOFF_KEY = "fullsend_admin_oauth_doc_handoff";
/** One-shot manifest `code` after `consumeManifestParamsFromDocumentUrl` (same pattern as OAuth doc handoff). */
const MANIFEST_DOC_HANDOFF_KEY = "fullsend_admin_manifest_doc_handoff";
/** Stashed before navigating away to POST the GitHub App manifest (same-window flow). */
const MANIFEST_RETURN_CONTEXT_KEY = "fullsend_admin_manifest_return_ctx";
/** Read by org setup after manifest exchange (`agentAppManifest.completeManifestHandoffFromDoc`). */
export const MANIFEST_POST_RESULT_KEY = "fullsend_admin_manifest_post_result";
/** Query flag on the admin entry URL so manifest return is not mistaken for OAuth (`code` + `state`). */
export const GITHUB_APP_MANIFEST_RETURN_PARAM = "fullsend_app_manifest";
/** Hash route to restore after successful OAuth (e.g. `#/orgs`). */
const INTENDED_HASH_KEY = "fullsend_admin_intended_hash";

/** Returned when `AbortSignal` aborts during `completeGithubOAuthFromHandoff` (user chose another account). */
export const SIGNING_IN_CANCELLED_MESSAGE =
  "Signing in was cancelled." as const;

/** Clears OAuth-related `sessionStorage` so a cancelled sign-in can restart cleanly. */
export function clearSigningInBrowserState(): void {
  clearOAuthState();
  clearIntendedHashStash();
  try {
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    sessionStorage.removeItem(OAUTH_DOC_HANDOFF_KEY);
    sessionStorage.removeItem(MANIFEST_DOC_HANDOFF_KEY);
    sessionStorage.removeItem(MANIFEST_RETURN_CONTEXT_KEY);
    sessionStorage.removeItem(MANIFEST_POST_RESULT_KEY);
  } catch {
    /* ignore */
  }
}

export type ManifestReturnContext = {
  org: string;
  role: string;
  actorLogin: string;
  returnHash: string;
};

export function stashManifestReturnContext(ctx: ManifestReturnContext): void {
  try {
    sessionStorage.setItem(MANIFEST_RETURN_CONTEXT_KEY, JSON.stringify(ctx));
  } catch {
    /* ignore */
  }
}

/** Hash to restore after manifest return URL cleanup (does not consume context). */
export function peekManifestReturnHash(): string {
  try {
    const raw = sessionStorage.getItem(MANIFEST_RETURN_CONTEXT_KEY);
    if (!raw) return "#/";
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return "#/";
    const h = (o as { returnHash?: unknown }).returnHash;
    if (typeof h !== "string") return "#/";
    const t = h.trim();
    return t.startsWith("#") && t.length > 0 ? t : "#/";
  } catch {
    return "#/";
  }
}

export function takeManifestReturnContext(): ManifestReturnContext | null {
  try {
    const raw = sessionStorage.getItem(MANIFEST_RETURN_CONTEXT_KEY);
    sessionStorage.removeItem(MANIFEST_RETURN_CONTEXT_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const rec = o as Record<string, unknown>;
    const org = typeof rec.org === "string" ? rec.org.trim() : "";
    const role = typeof rec.role === "string" ? rec.role.trim() : "";
    const actorLogin =
      typeof rec.actorLogin === "string" ? rec.actorLogin.trim() : "";
    const returnHash =
      typeof rec.returnHash === "string" ? rec.returnHash.trim() : "";
    if (!org || !role) return null;
    return {
      org,
      role,
      actorLogin: actorLogin || "unknown",
      returnHash: returnHash.startsWith("#") ? returnHash : "#/",
    };
  } catch {
    return null;
  }
}

const DEFAULT_ADMIN_BASE = "/admin/";

/**
 * Vite injects `import.meta.env.BASE` from root `vite.config.ts` `base`. If it is missing
 * (mis-transformed bundle, odd tooling), `new URL(undefined, origin)` becomes the path
 * literal `"undefined"` — avoid that and match `base: "/admin/"`.
 */
function adminAppBasePath(): string {
  const b = import.meta.env.BASE;
  if (typeof b !== "string" || b.length === 0) {
    return DEFAULT_ADMIN_BASE;
  }
  return b.endsWith("/") ? b : `${b}/`;
}

/**
 * Canonical SPA entry (Vite `base: '/admin/'`). GitHub redirects here with
 * `?code=&state=`; the app strips query via `history.replaceState` after stashing.
 */
export function getOAuthRedirectUri(): string {
  return new URL(adminAppBasePath(), window.location.origin).href;
}

/**
 * Same admin document entry as OAuth, plus a query marker so GitHub App manifest
 * redirects are handled separately from OAuth returns (both use `code=`).
 */
export function getGithubAppManifestRedirectUri(): string {
  const u = new URL(getOAuthRedirectUri());
  u.searchParams.set(GITHUB_APP_MANIFEST_RETURN_PARAM, "1");
  return u.href;
}

/**
 * If the document URL is a GitHub App manifest return (`fullsend_app_manifest=1` + `code`),
 * stash `{ code }` and strip query (like OAuth). Run **before** {@link consumeOAuthParamsFromDocumentUrl}.
 */
export function consumeManifestParamsFromDocumentUrl(): boolean {
  const sp = new URLSearchParams(window.location.search);
  if (sp.get(GITHUB_APP_MANIFEST_RETURN_PARAM) !== "1" || !sp.has("code")) {
    return false;
  }
  const code = sp.get("code")?.trim() ?? "";
  if (!code) return false;

  sessionStorage.setItem(MANIFEST_DOC_HANDOFF_KEY, JSON.stringify({ code }));

  const clean = new URL(adminAppBasePath(), window.location.origin);
  clean.search = "";
  clean.hash = peekManifestReturnHash();
  history.replaceState(null, "", clean.href);
  return true;
}

export function takeManifestDocHandoff(): { code: string } | null {
  const raw = sessionStorage.getItem(MANIFEST_DOC_HANDOFF_KEY);
  sessionStorage.removeItem(MANIFEST_DOC_HANDOFF_KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const rec = o as Record<string, unknown>;
    const code = typeof rec.code === "string" ? rec.code.trim() : "";
    if (!code) return null;
    return { code };
  } catch {
    return null;
  }
}

type WorkerExpandedOauthState = { v: 1; n: string; k: string };

function base64UrlToUtf8(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Parses Worker-built OAuth `state` (base64url JSON `{ v, n, k }`). Returns `null` for malformed
 * values or payloads that are not Worker-expanded state.
 */
export function tryParseWorkerExpandedOauthState(
  stateParam: string,
): WorkerExpandedOauthState | null {
  const t = stateParam.trim();
  if (!t || t.length > 4096) return null;
  if (!t.startsWith("eyJ")) return null;
  try {
    const json = base64UrlToUtf8(t);
    const o = JSON.parse(json) as unknown;
    if (!o || typeof o !== "object") return null;
    const r = o as Record<string, unknown>;
    if (r.v !== 1) return null;
    const n = typeof r.n === "string" ? r.n : "";
    const k = typeof r.k === "string" ? r.k : "";
    if (!n || !k) return null;
    return { v: 1, n, k };
  } catch {
    return null;
  }
}

/** Stash current `location.hash` so we can restore after OAuth (companion UX: anonymous deep link). */
export function stashIntendedHashBeforeGithubOAuth(): void {
  const h = window.location.hash?.trim();
  sessionStorage.setItem(INTENDED_HASH_KEY, h && h.length > 0 ? h : "#/");
}

/** Remove stashed hash (e.g. after a failed exchange). */
export function clearIntendedHashStash(): void {
  sessionStorage.removeItem(INTENDED_HASH_KEY);
}

/**
 * Returns the stashed hash (with `#`) and removes it. Returns `null` if none.
 */
export function consumeIntendedHashAfterGithubOAuth(): string | null {
  const raw = sessionStorage.getItem(INTENDED_HASH_KEY);
  sessionStorage.removeItem(INTENDED_HASH_KEY);
  if (raw == null || raw === "") return null;
  return raw.startsWith("#") ? raw : `#/${raw}`;
}

/**
 * Starts GitHub OAuth: stores PKCE + state, then navigates to the site Worker
 * `/api/oauth/authorize`, which redirects to GitHub with `client_id` (never embedded in the SPA bundle).
 */
export async function startGithubSignIn(): Promise<void> {
  stashIntendedHashBeforeGithubOAuth();
  const redirectUri = getOAuthRedirectUri();
  const verifier = randomVerifier();
  const challenge = await challengeS256(verifier);
  const state = crypto.randomUUID();

  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(OAUTH_STATE_KEY, state);

  const u = new URL("/api/oauth/authorize", window.location.origin);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");

  window.location.assign(u.toString());
}

export function takePkceVerifier(): string | null {
  const v = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  return v;
}

export function peekOAuthState(): string | null {
  return sessionStorage.getItem(OAUTH_STATE_KEY);
}

export function clearOAuthState(): void {
  sessionStorage.removeItem(OAUTH_STATE_KEY);
}

/**
 * If the document URL contains an OAuth `code`, stash `{ code, state }` for one-shot
 * consumption and replace the URL with `/admin/#/` (no query, no `code` visible).
 */
export function consumeOAuthParamsFromDocumentUrl(): boolean {
  const sp = new URLSearchParams(window.location.search);
  if (!sp.has("code")) return false;
  /** Manifest return uses `code` without OAuth `state`; never stash as OAuth. */
  if (sp.get(GITHUB_APP_MANIFEST_RETURN_PARAM) === "1") return false;

  const code = sp.get("code")?.trim() ?? "";
  const state = sp.get("state") ?? "";
  sessionStorage.setItem(
    OAUTH_DOC_HANDOFF_KEY,
    JSON.stringify({ code, state }),
  );

  const clean = new URL(adminAppBasePath(), window.location.origin);
  clean.search = "";
  clean.hash = "#/";
  history.replaceState(null, "", clean.href);
  return true;
}

type OAuthHandoff = { code: string; state: string };

function takeDocHandoff(): OAuthHandoff | null {
  const raw = sessionStorage.getItem(OAUTH_DOC_HANDOFF_KEY);
  sessionStorage.removeItem(OAUTH_DOC_HANDOFF_KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const rec = o as Record<string, unknown>;
    const code = typeof rec.code === "string" ? rec.code.trim() : "";
    const state = typeof rec.state === "string" ? rec.state : "";
    if (!code) return null;
    return { code, state };
  } catch {
    return null;
  }
}

export type OAuthCompleteResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      /** `/api/github/user` failed after token was stored — banner Retry calls `refreshSession`. */
      profileLoadFailed?: boolean;
      /** Transient token-exchange failure — Retry starts a new GitHub sign-in round. */
      oauthRoundRetry?: boolean;
    };

export type CompleteGithubOAuthOptions = {
  /** When aborted (e.g. user picks “different account”), token exchange is skipped. */
  signal?: AbortSignal;
};

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/** True when starting a new OAuth round may recover (network blip or overloaded Worker). */
function tokenExchangeAllowsOAuthRoundRetry(res: Response): boolean {
  return res.status >= 500 || res.status === 429;
}

/**
 * Reads JSON from a `fetch` `Response` while honoring `AbortSignal` (unlike `res.json()` alone).
 * Malformed JSON yields `{}` unless the read was aborted.
 */
async function readJsonBodyWithSignal(
  res: Response,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (!signal) {
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  let rejectAbort!: (e: DOMException) => void;
  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () =>
    rejectAbort(new DOMException("Aborted", "AbortError"));
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    const raw = await Promise.race([
      res.json().catch(() => ({})),
      abortPromise,
    ]);
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    return raw as Record<string, unknown>;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Completes GitHub OAuth using a one-shot document handoff (see
 * `consumeOAuthParamsFromDocumentUrl`). Call only after URL cleanup.
 */
export async function completeGithubOAuthFromHandoff(
  options?: CompleteGithubOAuthOptions,
): Promise<OAuthCompleteResult> {
  const signal = options?.signal;
  const aborted = () => Boolean(signal?.aborted);

  const handoff = takeDocHandoff();
  if (!handoff) {
    return { ok: false, error: "Missing OAuth handoff — try signing in again." };
  }

  const { code, state } = handoff;
  const expected = peekOAuthState();
  const expanded = tryParseWorkerExpandedOauthState(state);
  if (!expanded) {
    clearOAuthState();
    return {
      ok: false,
      error:
        "OAuth callback state is not Worker-expanded (Turnstile). Ensure the site Worker has TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY set and sign in again.",
    };
  }
  if (!expected || expanded.n !== expected) {
    clearOAuthState();
    return { ok: false, error: "OAuth state mismatch — try signing in again." };
  }

  const verifier = takePkceVerifier();
  if (!verifier) {
    clearOAuthState();
    return {
      ok: false,
      error:
        "Missing PKCE verifier (session expired or this tab did not start sign-in). Open the app from /admin/ and try again.",
    };
  }

  const redirect_uri = getOAuthRedirectUri();

  let turnstile_token: string;
  try {
    turnstile_token = await obtainTurnstileToken(expanded.k, signal);
  } catch (e) {
    clearOAuthState();
    if (isAbortError(e)) {
      return { ok: false, error: SIGNING_IN_CANCELLED_MESSAGE };
    }
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : "Turnstile verification failed — try signing in again.",
    };
  }

  if (aborted()) {
    clearOAuthState();
    return { ok: false, error: SIGNING_IN_CANCELLED_MESSAGE };
  }

  let res: Response;
  try {
    res = await fetch("/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        redirect_uri,
        code_verifier: verifier,
        turnstile_token,
      }),
      signal,
    });
  } catch (e) {
    clearOAuthState();
    if (isAbortError(e)) {
      return { ok: false, error: SIGNING_IN_CANCELLED_MESSAGE };
    }
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : "Network error calling token exchange (is `npm run dev` running?)",
      oauthRoundRetry: true,
    };
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBodyWithSignal(res, signal);
  } catch (e) {
    clearOAuthState();
    if (isAbortError(e)) {
      return { ok: false, error: SIGNING_IN_CANCELLED_MESSAGE };
    }
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : "Failed to read token exchange response.",
    };
  }

  if (!res.ok) {
    const desc =
      typeof body.error_description === "string"
        ? body.error_description
        : typeof body.error === "string"
          ? body.error
          : "token_exchange_failed";
    clearOAuthState();
    return {
      ok: false,
      error: `GitHub token exchange failed: ${desc}`,
      ...(tokenExchangeAllowsOAuthRoundRetry(res)
        ? { oauthRoundRetry: true as const }
        : {}),
    };
  }

  const access_token =
    typeof body.access_token === "string" ? body.access_token : "";
  if (!access_token) {
    clearOAuthState();
    return { ok: false, error: "Token response missing access_token." };
  }

  const token_type =
    typeof body.token_type === "string" ? body.token_type : "bearer";
  const expires_in =
    typeof body.expires_in === "number" ? body.expires_in : null;
  const expiresAt =
    expires_in != null ? Date.now() + expires_in * 1000 : null;

  saveToken({
    accessToken: access_token,
    tokenType: token_type,
    expiresAt,
  });
  clearOAuthState();

  if (aborted()) {
    clearSession();
    return { ok: false, error: SIGNING_IN_CANCELLED_MESSAGE };
  }

  const sessionResult = await refreshSession();
  if (!sessionResult.ok) {
    if (sessionResult.kind === "profile_error") {
      return {
        ok: false,
        error: sessionResult.message,
        profileLoadFailed: true,
      };
    }
    if (sessionResult.kind === "unauthorized") {
      return {
        ok: false,
        error: "GitHub rejected this session — sign in again.",
      };
    }
  }

  return { ok: true };
}
