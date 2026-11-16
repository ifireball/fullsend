# Forgejo API and webhook coverage for Fullsend

Research for [Map Forgejo API and webhook coverage for Fullsend](https://github.com/fullsend-ai/fullsend/issues/9539), as of 2026-11-16. This report supports design decisions; it does not assert that Forgejo is currently supported.

## Finding

Forgejo exposes APIs for most resource operations Fullsend needs, but the checkout has no Forgejo client or event adapter. The API surface alone does not establish compatibility with the stronger behavioral guarantees in [`internal/forge/forge.go`](../internal/forge/forge.go).

## Version and API baseline

Forgejo documents compatibility within the same major version and warns that breaking API changes may occur across major versions. The version endpoint reports Forgejo version and, from v7 onward, Gitea compatibility metadata. This does not establish Fullsend's minimum version; no implementation or version floor exists yet. Compare v15 LTS and v17 OpenAPI specs for required endpoints, then declare and test a floor. [Versioning](https://forgejo.org/docs/v17.0/user/api/versions/), [API usage and per-instance OpenAPI](https://forgejo.org/docs/v17.0/user/api/usage/)

## Coverage against Fullsend's contract

| Area | Coverage and compatibility issue |
|---|---|
| Repositories | Forgejo exposes repository APIs, but `forge.DetectForge` recognizes only GitHub and GitLab. `GetOrgPlan` and GitHub App/installation operations have no obvious Forgejo equivalent; callers need an explicit unsupported path or a narrower Forgejo surface. An instance administrator can disable the API. [API usage](https://forgejo.org/docs/v17.0/user/api/usage/) |
| Issues and comments | Token scopes cover issue, label, and milestone operations. Fullsend needs issue reads/writes, labels, comments, and comment lookup/update/delete. Verify the exact endpoint scopes using the target instance's OpenAPI spec. [Token scopes](https://forgejo.org/docs/v17.0/user/authentication/token-scope/) |
| Pull requests and reviews | Forgejo exposes pull request APIs. Fullsend needs create/list/close/merge, head/base repository and ref/SHA metadata, review submission/history, inline comments, and review-thread data. The [entity snapshot contract](../docs/normative/entity-context-snapshot/v1/README.md) defines intended Forgejo review normalization, but does not prove each target API exposes all required history or thread fields. Verify against per-instance OpenAPI and representative payloads. [API usage](https://forgejo.org/docs/v17.0/user/api/usage/) |
| Cross-repository proposals | `CreateCrossRepoChangeProposal` needs an unambiguous source repository. Verify that the create-PR API identifies the head repository separately from its branch; combined owner/branch syntax may be ambiguous for same-owner forks. |
| Refs and file writes | Branch/ref, content, and Git-data operations must meet Fullsend's stronger semantics: atomic multi-file commits, idempotency, conditional writes, expected conflict/not-found errors, and signed commits where required. Operation existence alone does not prove these semantics. [Per-instance OpenAPI](https://forgejo.org/docs/v17.0/user/api/usage/) |
| Secrets and variables | Forgejo Actions supports repository, organization, and user secrets and variables. Secrets are encrypted and workflow-consumable; variables are editable and have naming and precedence rules. Fullsend's `SecretProtection` contract includes masking and protected-branch controls, which the reviewed Forgejo docs do not establish. Treat those controls as unsupported unless verified. [Actions concepts](https://forgejo.org/docs/v17.0/user/actions/basic-concepts/), [API usage](https://forgejo.org/docs/v17.0/user/api/usage/) |
| Webhooks and Actions events | Webhooks include a delivery ID, event header, HMAC-SHA256 signature, and configurable secret. Docs reviewed do not enumerate the full issue/label/review event matrix, so payloads and actor attribution still need fixture verification. Forgejo Actions provides an event payload file and GitHub-compatible context names; `FORGEJO_*` variables require Runner v7+. Fork PR runs have no repository secrets and a read-only automatic token. [Webhooks](https://forgejo.org/docs/v17.0/user/repository/webhooks/), [Actions concepts](https://forgejo.org/docs/v17.0/user/actions/basic-concepts/), [Actions reference](https://forgejo.org/docs/v17.0/user/actions/reference/) |
| Actors and roles | Collaborator levels are Read, Write, Administrator, and Owner; teams can separately grant Code, Issues, and Pull Requests permissions. This does not directly map to Fullsend's `maintain` and `triage`. Define how unit-specific permissions map—or fail closed—to an effective Fullsend role. Bot detection alone is insufficient; Fullsend also needs trusted `bot_role` resolution. [Repository permissions](https://forgejo.org/docs/v17.0/user/collaboration/repo-permissions/) |
| Pagination and errors | Forgejo documents page/limit, Link pagination, x-total-count, and per-instance limits; do not assume one page. Its Actions automatic token returns 404 against another repository. Translate failures into Fullsend's `ErrNotFound`, `ErrForbidden`, `ErrConflict`, and `ErrNotSupported` semantics where possible. [API usage](https://forgejo.org/docs/v17.0/user/api/usage/), [Actions concepts](https://forgejo.org/docs/v17.0/user/actions/basic-concepts/) |

## Event mapping target

The normalized-event vocabulary includes `opened`, `reopened`, `edited`, `synchronized`, `closed`, `merged`, `marked_ready`, `label_changed`, `comment_added`, and `review_submitted`. A Forgejo adapter would map verified native issue and pull-request actions to these transitions, distinguish merged from closed, and populate actor, labels, and change-proposal state from trusted reads. Verify event-time evidence for label changes; a current issue snapshot alone cannot prove who performed an action or that it occurred. Decide whether dispatch consumes Actions event files or a remote webhook: current `fullsend dispatch` inputs are `gha-event` and `json`, and no Forgejo adapter emits events. See [`internal/cli/dispatch.go`](../internal/cli/dispatch.go) and [`internal/poll/convert.go`](../internal/poll/convert.go).

If workflow-run notifications are in scope, Forgejo v17 deprecates older action-run webhook events in favor of workflow-run events; headers and payload `action` changed, and completion notifications wait for all jobs to terminate. [Forgejo v17 release notes](https://forgejo.org/2026-10-release-v17-0/)

## Questions for dependent decisions

1. Which major versions are supported, and which endpoints establish the floor?
2. Is dispatch based on Actions event files or an external webhook? What runner version and event-file trust boundary are needed?
3. Can issue/PR webhook events be independently verified by API re-fetch, including label occurrence, time, and actor attribution? What happens when evidence is unavailable?
4. How do team/unit permissions map to `triage`, `maintain`, and write authorization? How do unknown roles and unregistered bots fail closed?
5. Can the API identify cross-repository PR heads unambiguously and provide required review/thread, conflict, atomicity, and signing semantics?
6. Are secret masking/protection properties sufficient, and what install/converge behavior is possible when secret values cannot be read back?

## Local evidence

`internal/forge/forge.go` contains the broad forge-neutral interface and error sentinels; `internal/normevent/event.go` has no `SystemForgejo` or Forgejo role mapper; `internal/forge/detect.go` recognizes only GitHub.com and GitLab.com; `internal/cli/prepareartifacts.go` accepts `forgejo` as a source name but notes that no adapter emits events.
