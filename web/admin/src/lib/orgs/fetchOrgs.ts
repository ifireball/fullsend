import { createUserOctokit } from "../github/client";
import { buildEmptyOrgsFromReposHint, headersToRecord } from "./emptyOrgListHint";
import type { OrgRow } from "./filter";
import { fetchMembershipCreateRepoSignals } from "./orgMembershipCreateRepo";

/** Smaller GitHub pages so the UI can paint orgs sooner than 100-repo chunks. */
const REPOS_PER_PAGE = 25;

/** Cap pages when paginating GET /user/repos. */
const MAX_REPO_LIST_PAGES = 50;

export type FetchOrgsResult = {
  orgs: OrgRow[];
  /**
   * When `orgs` is empty, explains likely causes from the repository scan
   * (`GET /user/repos`).
   */
  emptyHint: string | null;
};

export type FetchOrgsProgressMeta = {
  done: boolean;
  /** Number of GitHub repo list pages processed so far. */
  repoPagesFetched: number;
};

const ORG_LIST_MEMORY_CACHE_VERSION = 3 as const;

let memoryCache: {
  token: string;
  orgs: OrgRow[];
  emptyHint: string | null;
  version: typeof ORG_LIST_MEMORY_CACHE_VERSION;
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

type OrgAgg = { login: string; hasWritePathInOrg: boolean };

/** When GitHub omits `permissions`, do not treat the repo as read-only (avoid false blocks). */
function repoHasWritePathInOrg(repo: unknown): boolean {
  if (!repo || typeof repo !== "object") return true;
  const p = (repo as { permissions?: unknown }).permissions;
  if (!p || typeof p !== "object") return true;
  const perms = p as Record<string, unknown>;
  return perms.admin === true || perms.maintain === true || perms.push === true;
}

function sortedOrgAggsFromMap(orgsByKey: Map<string, OrgAgg>): OrgAgg[] {
  return [...orgsByKey.values()].sort((a, b) => a.login.localeCompare(b.login));
}

function orgRowsFromAggs(
  aggs: OrgAgg[],
  membershipSignals: Map<string, boolean | null>,
): OrgRow[] {
  return aggs.map((a) => ({
    login: a.login,
    hasWritePathInOrg: a.hasWritePathInOrg,
    membershipCanCreateRepository: membershipSignals.has(a.login.toLowerCase())
      ? (membershipSignals.get(a.login.toLowerCase()) ?? null)
      : null,
  }));
}

/**
 * Scans **`GET /user/repos`** page-by-page (`per_page` {@link REPOS_PER_PAGE}), calling
 * `onProgress` after each page with the cumulative unique organisation list so the UI can
 * paint early.
 */
export async function fetchOrgsWithProgress(
  accessToken: string,
  options: {
    force?: boolean;
    signal?: AbortSignal;
    onProgress: (orgs: OrgRow[], meta: FetchOrgsProgressMeta) => void;
  },
): Promise<FetchOrgsResult> {
  if (
    !options.force &&
    memoryCache?.token === accessToken &&
    memoryCache.version === ORG_LIST_MEMORY_CACHE_VERSION
  ) {
    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const { orgs, emptyHint } = memoryCache;
    options.onProgress(orgs, { done: true, repoPagesFetched: 0 });
    return { orgs, emptyHint };
  }

  const octokit = createUserOctokit(accessToken);

  try {
    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const iterator = octokit.paginate.iterator(
      octokit.rest.repos.listForAuthenticatedUser,
      {
        per_page: REPOS_PER_PAGE,
        affiliation: "owner,collaborator,organization_member",
        sort: "full_name",
      },
    );

    let firstStatus = 200;
    let firstHeaders: Record<string, string> = {};
    const orgsByKey = new Map<string, OrgAgg>();
    let repoTotal = 0;
    let pages = 0;

    for await (const page of iterator) {
      if (options.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
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
          const key = login.toLowerCase();
          const write = repoHasWritePathInOrg(repo);
          const prev = orgsByKey.get(key);
          if (!prev) {
            orgsByKey.set(key, { login, hasWritePathInOrg: write });
          } else {
            orgsByKey.set(key, {
              login: prev.login,
              hasWritePathInOrg: prev.hasWritePathInOrg || write,
            });
          }
        }
      }

      const aggs = sortedOrgAggsFromMap(orgsByKey);
      options.onProgress(orgRowsFromAggs(aggs, new Map()), {
        done: false,
        repoPagesFetched: pages,
      });
    }

    const aggs = sortedOrgAggsFromMap(orgsByKey);
    const membershipSignals = await fetchMembershipCreateRepoSignals(octokit, {
      signal: options.signal,
    });
    const orgs = orgRowsFromAggs(aggs, membershipSignals);
    const emptyHint =
      orgs.length === 0
        ? buildEmptyOrgsFromReposHint(
            repoTotal,
            orgsByKey.size,
            firstStatus,
            firstHeaders,
          )
        : null;

    memoryCache = {
      token: accessToken,
      orgs,
      emptyHint,
      version: ORG_LIST_MEMORY_CACHE_VERSION,
    };
    options.onProgress(orgs, { done: true, repoPagesFetched: pages });
    return { orgs, emptyHint };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw e;
    }
    const status = octokitErrorStatus(e);
    const msg = e instanceof Error ? e.message : "GitHub repository listing failed.";
    throw new FetchOrgsError(status, friendlyReposListHttpError(status, msg));
  }
}

/**
 * Builds the org picker from **`GET /user/repos`**: unique GitHub **Organization** owners among
 * repositories the user may access (owner, collaborator, organization_member).
 */
export async function fetchOrgs(
  accessToken: string,
  options?: { force?: boolean; signal?: AbortSignal },
): Promise<FetchOrgsResult> {
  return fetchOrgsWithProgress(accessToken, {
    force: options?.force,
    signal: options?.signal,
    onProgress: () => {},
  });
}
