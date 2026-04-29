# Design: Org dashboard repository **Onboard** (admin SPA)

Date: 2026-04-29  
Status: Accepted (implementation)  
Related: [Organisation dashboard UX](2026-04-21-fullsend-admin-spa-ux-design.md#screen-organisation-dashboard) (Pane B, **R1** / **R2** / **R6**), [Enrollment normative SPEC](../../normative/admin-install/v1/adr-0013-enrollment/SPEC.md), [ADR 0013](../../ADRs/0013-admin-install-repo-enrollment-v1.md) (read-only pointer to SPEC)

## Purpose

Define how the Fullsend **admin SPA** performs **per-repository onboarding** from the organisation dashboard repository list: creating or updating the **enrollment pull request** and keeping **`FULLSEND_DISPATCH_TOKEN`** scoped to the right repositories, using the **signed-in user’s GitHub OAuth token** (Octokit). This does **not** change the normative enrollment contract; it implements the same rules as [`internal/layers/enrollment.go`](../../../internal/layers/enrollment.go) where the browser replaces the Go `forge.Client`.

## Normative alignment

- Branch name, shim path, shim YAML, PR title/body, commit messages, and operation order **MUST** match [adr-0013-enrollment SPEC](../../normative/admin-install/v1/adr-0013-enrollment/SPEC.md) §3–6.
- OAuth scopes: same as org deploy / install bundle — `repo`, `workflow`, `admin:org` (see [`web/admin/src/lib/orgs/deployOAuthScopes.ts`](../../../web/admin/src/lib/orgs/deployOAuthScopes.ts)).

## Row behaviour

| UX row | **Onboard** when | Action |
|--------|------------------|--------|
| **R1** | Repo `enabled: true` in `config.yaml`, no shim on **default** branch | Enrollment SPEC §6 (idempotent). Then merge this repo’s numeric **id** into the org secret **`FULLSEND_DISPATCH_TOKEN`** selected-repository list (GitHub `PUT .../secrets/{name}/repositories`), **without** re-entering the PAT. If the org secret **does not exist**, skip the dispatch step (enrollment PR still opens; operator must complete org setup for the token). |
| **R2** | Open PR titled exactly `Connect to fullsend agent pipeline`, shim not yet on default | **No** primary **Onboard** (user follows PR). Row shows **Onboarding — check PR #nnn** with link. |
| **R6** | GitHub-visible, not listed under `repos:` | Add `repos.<name>: { enabled: true }`, write `config.yaml` on `org/.fullsend` **default branch**, validate, then same as **R1**. **Onboard** is disabled if there is **no** valid parsed `config.yaml` (missing or invalid). |
| **config_disabled** | Listed under `repos:` with `enabled: false` | Set `enabled: true`, write `config.yaml`, then same as **R1**. |

## GitHub API summary (SPA)

1. **Config write** (R6 / `config_disabled` only): Contents API on `org/.fullsend` / `config.yaml` (existing helper).
2. **Enrollment**: default branch → list open PRs by title → either update shim on `fullsend/onboard` or create ref + file + `pulls.create` (parity with Go).
3. **Dispatch ACL**: `GET /orgs/{org}/actions/secrets/{secret_name}/repositories` (paginate), `repos.get` for target id, `PUT .../repositories` with merged `selected_repository_ids`.

## Errors and edge cases

- **Empty target repo** (no default branch / 409 on contents): row **Error** + **Retry** with a clear message.
- **Concurrent `config.yaml` edits**: last write wins; document for operators.
- **`.fullsend` missing or invalid config**: **R6** **Onboard** disabled; repair config outside this flow first.

## Manual QA matrix

1. **R1** — enabled repo, no shim: **Onboard** → row shows **R2** with working PR link; PR body matches SPEC; branch `fullsend/onboard`.
2. **R2** — refresh page: row stays **R2** until PR merged; after merge + refresh → **R4**.
3. **R6** — repo not in config, valid `config.yaml`: **Onboard** → appears under union; **R2**; `config.yaml` lists repo `enabled: true`.
4. **config_disabled** — **Onboard** → **R2**; repo `enabled: true` in file.
5. **R6** with broken/missing config: **Onboard** disabled.
6. **Dispatch secret** exists with selected repos: after **R1**, new repo id appears in GitHub UI for secret access (smoke).
7. **Token** missing `admin:org`: dispatch merge step fails with actionable message (optional narrow test via mock).

## Implementation references

- [`web/admin/src/lib/enrollment/shimWorkflow.ts`](../../../web/admin/src/lib/enrollment/shimWorkflow.ts) — constants + shim body.
- [`web/admin/src/lib/enrollment/createEnrollmentPr.ts`](../../../web/admin/src/lib/enrollment/createEnrollmentPr.ts) — enrollment PR orchestration.
- [`web/admin/src/lib/github/setOrgSecretSelectedRepositories.ts`](../../../web/admin/src/lib/github/setOrgSecretSelectedRepositories.ts) — dispatch ACL merge.
- [`web/admin/src/lib/enrollment/runRepoOnboard.ts`](../../../web/admin/src/lib/enrollment/runRepoOnboard.ts) — dashboard entrypoint.
- [`web/admin/src/routes/OrgDetail.svelte`](../../../web/admin/src/routes/OrgDetail.svelte) — row states **R2**, buttons, loading.
