/**
 * Classic OAuth scopes required for `fullsend admin install` (Go `Stack.CollectRequiredScopes(OpInstall)`).
 * Deduped order: config + secrets + enrollment read paths use `repo`; workflows + enrollment install use `workflow`; dispatch uses `admin:org`.
 * @see internal/layers/configrepo.go, workflows.go, secrets.go, enrollment.go, dispatch.go — RequiredScopes(OpInstall)
 */
export function deployRequiredOAuthScopes(): readonly string[] {
  return ["repo", "workflow", "admin:org"] as const;
}
