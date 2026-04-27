/**
 * Fine-grained PAT creation URL aligned with `internal/cli/admin.go` `promptDispatchToken`.
 */

export function buildDispatchPatCreationUrl(org: string): string {
  const escapedOrg = encodeURIComponent(org);
  return (
    "https://github.com/settings/personal-access-tokens/new" +
    `?name=fullsend-dispatch-${escapedOrg}` +
    `&description=${encodeURIComponent(
      `Dispatch token for fullsend agent pipeline in ${org}. Scoped to .fullsend repo with Actions write only.`,
    )}` +
    `&target_name=${escapedOrg}` +
    "&actions=write"
  );
}
