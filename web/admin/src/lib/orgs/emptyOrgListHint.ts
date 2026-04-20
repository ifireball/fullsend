/**
 * Copy when the org picker is empty after deriving orgs from **`GET /user/repos`**.
 *
 * GitHub lists repositories the user may access (owner, collaborator, organization_member);
 * we surface unique **organization** owners as the next step toward choosing repositories.
 */

export function headersToRecord(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  if (typeof headers === "object") {
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      if (typeof v === "string") out[k.toLowerCase()] = v;
    }
  }
  return out;
}

function parseOAuthScopes(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[, ]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function hasClassicRepoScope(scopes: string[]): boolean {
  return scopes.some((s) => s === "repo" || s === "public_repo");
}

/**
 * Explains an empty org list after scanning repositories from `GET /user/repos`.
 */
export function buildEmptyOrgsFromReposHint(
  repoTotal: number,
  distinctOrgOwners: number,
  firstPageStatus: number,
  headers: Record<string, string>,
): string | null {
  if (firstPageStatus !== 200) {
    return `GitHub returned HTTP ${firstPageStatus} while listing repositories (GET /user/repos). Check the token and GitHub App repository permissions.`;
  }

  if (repoTotal === 0) {
    const scopes = parseOAuthScopes(headers["x-oauth-scopes"]);
    if (scopes.length > 0 && !hasClassicRepoScope(scopes)) {
      return `Your token’s OAuth scopes (${scopes.join(", ")}) may be insufficient to list private repositories; classic tokens usually need the repo (or public_repo) scope for GET /user/repos. Re-authorize or widen GitHub App repository access.`;
    }
    return (
      "No repositories were returned for this token on GET /user/repos. " +
      "Grant the GitHub App repository access (for example Contents read) for the repos you care about, or sign in again."
    );
  }

  if (distinctOrgOwners === 0) {
    return (
      "Repositories are visible under your personal account only—none are owned by a GitHub organization in this result set. " +
      "This screen lists organizations inferred from org-owned repos as a path toward choosing repositories."
    );
  }

  return null;
}
