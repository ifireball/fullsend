export type OrgRow = {
  login: string;
  /**
   * True when `GET /user/repos` listed at least one repository under this organisation
   * with `permissions.admin`, `maintain`, or `push` (used when OAuth scope preflight is skipped).
   */
  hasWritePathInOrg: boolean;
  /**
   * From `GET /user/memberships/orgs`: `permissions.can_create_repository` when GitHub returns it.
   * `null` when the user is not returned as an org member (e.g. outside collaborator only) or membership fetch failed.
   */
  membershipCanCreateRepository: boolean | null;
};

/**
 * Case-insensitive **substring** search over organisation logins (matches UX spec),
 * then alphabetical sort.
 */
export function filterOrgsBySearch(orgs: OrgRow[], q: string): OrgRow[] {
  const p = q.trim().toLowerCase();
  const sorted = [...orgs].sort((a, b) => a.login.localeCompare(b.login));
  if (!p) return sorted;
  return sorted.filter((o) => o.login.toLowerCase().includes(p));
}
