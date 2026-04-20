import type { OrgRow } from "./filter";

let memoryCache: { token: string; orgs: OrgRow[] } | null = null;

/** Clears the in-memory org list cache (call on sign-out or when switching accounts). */
export function clearOrgListMemoryCache(): void {
  memoryCache = null;
}

export class FetchOrgsError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "FetchOrgsError";
    this.status = status;
  }
}

/**
 * Fetches org memberships via same-origin Worker (GitHub REST is not browser-callable).
 * Results are cached in memory for the session until `force` or `clearOrgListMemoryCache`.
 */
export async function fetchOrgs(
  accessToken: string,
  options?: { force?: boolean },
): Promise<OrgRow[]> {
  if (!options?.force && memoryCache?.token === accessToken) {
    return memoryCache.orgs;
  }

  const res = await fetch("/api/github/user/memberships/orgs", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new FetchOrgsError(
      res.status,
      `GitHub org memberships failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new FetchOrgsError(502, "Invalid JSON from org memberships proxy.");
  }

  const rec = data as Record<string, unknown>;
  const rawOrgs = rec.organizations;
  if (!Array.isArray(rawOrgs)) {
    throw new FetchOrgsError(502, "Unexpected org memberships response shape.");
  }

  const orgs: OrgRow[] = [];
  for (const item of rawOrgs) {
    if (!item || typeof item !== "object") continue;
    const login = (item as Record<string, unknown>).login;
    if (typeof login === "string" && login.trim() !== "") {
      orgs.push({ login });
    }
  }

  memoryCache = { token: accessToken, orgs };
  return orgs;
}
