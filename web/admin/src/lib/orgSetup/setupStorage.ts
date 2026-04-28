/**
 * Browser staging keys for org setup (FSM spec 2026-04-27).
 * Prefix: product + SCM host + GitHub actor login + org login + artifact path.
 * Material may persist across sign-out until written to GitHub or cleared.
 */

const PRODUCT_PREFIX = "fullsend:setup:";

/** Default SCM API host for github.com installs. */
const DEFAULT_SCM_HOST = "github.com";

export function setupStorageScope(
  scmHost: string,
  actorLogin: string,
  orgLogin: string,
): string {
  const h = scmHost.trim() || DEFAULT_SCM_HOST;
  const a = actorLogin.trim();
  const o = orgLogin.trim();
  return `${PRODUCT_PREFIX}${h}:${a}:${o}:`;
}

export function stagedAppPemKey(
  scmHost: string,
  actorLogin: string,
  orgLogin: string,
  role: string,
): string {
  return `${setupStorageScope(scmHost, actorLogin, orgLogin)}app:${role}:pem`;
}

export function stagedAppMetaKey(
  scmHost: string,
  actorLogin: string,
  orgLogin: string,
  role: string,
): string {
  return `${setupStorageScope(scmHost, actorLogin, orgLogin)}app:${role}:meta`;
}

export function stagedDispatchPatKey(
  scmHost: string,
  actorLogin: string,
  orgLogin: string,
): string {
  return `${setupStorageScope(scmHost, actorLogin, orgLogin)}dispatch_pat`;
}

export function readLocalString(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    if (v == null || v.trim() === "") return null;
    return v;
  } catch {
    return null;
  }
}

export type StagedAppMeta = { slug?: string; displayName?: string };

export function readStagedAppMeta(
  scmHost: string,
  actorLogin: string,
  orgLogin: string,
  role: string,
): StagedAppMeta | null {
  const raw = readLocalString(stagedAppMetaKey(scmHost, actorLogin, orgLogin, role));
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    return o as StagedAppMeta;
  } catch {
    return null;
  }
}

export function readStagedAppPemPresent(
  scmHost: string,
  actorLogin: string,
  orgLogin: string,
  role: string,
): boolean {
  const pem = readLocalString(stagedAppPemKey(scmHost, actorLogin, orgLogin, role));
  return Boolean(pem);
}

export function readStagedDispatchPatPresent(
  scmHost: string,
  actorLogin: string,
  orgLogin: string,
): boolean {
  return Boolean(readLocalString(stagedDispatchPatKey(scmHost, actorLogin, orgLogin)));
}

export function writeStagedDispatchPat(
  scmHost: string,
  actorLogin: string,
  orgLogin: string,
  token: string,
): void {
  const v = token.trim();
  if (!v) return;
  try {
    localStorage.setItem(stagedDispatchPatKey(scmHost, actorLogin, orgLogin), v);
  } catch {
    /* ignore */
  }
}

export function clearStagedDispatchPat(
  scmHost: string,
  actorLogin: string,
  orgLogin: string,
): void {
  try {
    localStorage.removeItem(stagedDispatchPatKey(scmHost, actorLogin, orgLogin));
  } catch {
    /* ignore */
  }
}

export function writeStagedAppPem(
  scmHost: string,
  actorLogin: string,
  orgLogin: string,
  role: string,
  pem: string,
): void {
  try {
    localStorage.setItem(stagedAppPemKey(scmHost, actorLogin, orgLogin, role), pem);
  } catch {
    /* ignore */
  }
}

export function writeStagedAppMeta(
  scmHost: string,
  actorLogin: string,
  orgLogin: string,
  role: string,
  meta: StagedAppMeta,
): void {
  try {
    localStorage.setItem(
      stagedAppMetaKey(scmHost, actorLogin, orgLogin, role),
      JSON.stringify(meta),
    );
  } catch {
    /* ignore */
  }
}
