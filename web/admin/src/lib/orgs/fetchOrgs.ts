import { createUserOctokit } from "../github/client";
import { buildEmptyOrgsFromReposHint, headersToRecord } from "./emptyOrgListHint";
import type { OrgRow } from "./filter";

/** Cap pages when paginating GET /user/repos (100 repos per page). */
const MAX_REPO_LIST_PAGES = 50;

export type FetchOrgsResult = {
  orgs: OrgRow[];
  /**
   * When `orgs` is empty, explains likely causes from the repository scan
   * (`GET /user/repos`).
   */
  emptyHint: string | null;
};

let memoryCache: {
  token: string;
  orgs: OrgRow[];
  emptyHint: string | null;
} | null = null;

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

function friendlyReposListHttpError(status: number, githubMessage: string): string {
  if (status === 403) {
    return "GitHub refused to list repositories (403). For classic OAuth, you may need the repo scope for private repositories. For a GitHub App, check repository permissions on the installation.";
  }
  if (status === 401) {
    return "Could not load repositories — sign in again if your token expired.";
  }
  return githubMessage;
}

function isOrganizationOwner(owner: unknown): owner is { login: string } {
  if (!owner || typeof owner !== "object") return false;
  const o = owner as Record<string, unknown>;
  return (
    o.type === "Organization" &&
    typeof o.login === "string" &&
    o.login.trim() !== ""
  );
}

/**
 * Builds the org picker from **`GET /user/repos`**: unique GitHub **Organization** owners among
 * repositories the user may access (owner, collaborator, organization_member). This matches a
 * “choose org → choose repo” flow without calling org-membership or org-list endpoints.
 */
export async function fetchOrgs(
  accessToken: string,
  options?: { force?: boolean },
): Promise<FetchOrgsResult> {
  if (!options?.force && memoryCache?.token === accessToken) {
    return {
      orgs: memoryCache.orgs,
      emptyHint: memoryCache.emptyHint,
    };
  }

  const octokit = createUserOctokit(accessToken);

  try {
    const iterator = octokit.paginate.iterator(
      octokit.rest.repos.listForAuthenticatedUser,
      {
        per_page: 100,
        affiliation: "owner,collaborator,organization_member",
        sort: "full_name",
      },
    );

    let firstStatus = 200;
    let firstHeaders: Record<string, string> = {};
    const orgLogins = new Map<string, string>();
    let repoTotal = 0;
    let pages = 0;

    for await (const page of iterator) {
      pages += 1;
      if (pages > MAX_REPO_LIST_PAGES) break;

      if (Object.keys(firstHeaders).length === 0) {
        firstStatus = page.status;
        firstHeaders = headersToRecord(page.headers);
      }

      const chunk = page.data;
      if (!Array.isArray(chunk)) continue;

      for (const repo of chunk) {
        repoTotal += 1;
        const owner = (repo as { owner?: unknown }).owner;
        if (isOrganizationOwner(owner)) {
          const login = owner.login.trim();
          orgLogins.set(login.toLowerCase(), login);
        }
      }
    }

    const orgs = [...orgLogins.values()]
      .sort((a, b) => a.localeCompare(b))
      .map((login) => ({ login }));

    const emptyHint =
      orgs.length === 0
        ? buildEmptyOrgsFromReposHint(
            repoTotal,
            orgLogins.size,
            firstStatus,
            firstHeaders,
          )
        : null;

    memoryCache = { token: accessToken, orgs, emptyHint };
    return { orgs, emptyHint };
  } catch (e) {
    const status = octokitErrorStatus(e);
    const msg = e instanceof Error ? e.message : "GitHub repository listing failed.";
    throw new FetchOrgsError(status, friendlyReposListHttpError(status, msg));
  }
}
