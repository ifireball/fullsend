export type OrgRow = { login: string };

export function filterOrgsByPrefix(orgs: OrgRow[], q: string): OrgRow[] {
  const p = q.trim().toLowerCase();
  if (!p) return [...orgs].sort((a, b) => a.login.localeCompare(b.login));
  return orgs
    .filter((o) => o.login.toLowerCase().startsWith(p))
    .sort((a, b) => a.login.localeCompare(b.login));
}
