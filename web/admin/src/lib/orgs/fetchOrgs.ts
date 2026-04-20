import { createUserOctokit } from "../github/client";
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

function octokitErrorStatus(e: unknown): number {
  if (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    typeof (e as { status: unknown }).status === "number"
  ) {
    return (e as { status: number }).status;
  }
  return 502;
}

/**
 * Lists org memberships from GitHub REST in the browser (`api.github.com` allows CORS for this route).
 * Results are cached in memory for the session until `force` or `clearOrgListMemoryCache`.
 */
export async function fetchOrgs(
  accessToken: string,
  options?: { force?: boolean },
): Promise<OrgRow[]> {
  if (!options?.force && memoryCache?.token === accessToken) {
    return memoryCache.orgs;
  }

  const octokit = createUserOctokit(accessToken);

  let memberships: {
    organization?: { login?: string } | null;
  }[];

  try {
    memberships = await octokit.paginate(
      octokit.rest.orgs.listMembershipsForAuthenticatedUser,
      { per_page: 100 },
    );
  } catch (e) {
    const status = octokitErrorStatus(e);
    const msg = e instanceof Error ? e.message : "GitHub org memberships failed.";
    throw new FetchOrgsError(status, msg);
  }

  const logins = new Map<string, string>();
  for (const m of memberships) {
    const login = m.organization?.login?.trim();
    if (login) logins.set(login.toLowerCase(), login);
  }

  const orgs = [...logins.values()]
    .sort((a, b) => a.localeCompare(b))
    .map((login) => ({ login }));

  memoryCache = { token: accessToken, orgs };
  return orgs;
}
