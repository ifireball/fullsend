# Forgejo credentials, role identity, and actor verification

Research for [Assess Forgejo credentials, role identity, and actor verification](https://github.com/fullsend-ai/fullsend/issues/9541), as of 2026-11-16. This report supports design decisions; it does not authorize a credential implementation.

## Finding

Separate Forgejo role identities look viable, but Fullsend should keep role-based human admission fail-closed until it verifies an effective-permission lookup and defines how Forgejo's per-unit permissions map to Fullsend roles. Forgejo Actions OIDC provides a short-lived credential path on supported versions, but Fullsend has not implemented a trusted Forgejo issuer/claim contract.

## Credentials and role separation

Forgejo access tokens support route-family scopes such as `read/write:repository` and `read/write:issue`. From v15, tokens can also be restricted to specific repositories; that restriction permits only those four scopes and blocks some repository-admin operations. These scopes are broad API route groups, not role-level capabilities. [Token scopes](https://forgejo.org/docs/v17.0/user/authentication/token-scope/), [v15 release](https://forgejo.org/2026-04-release-v15-0/)

Repository collaborators have Read, Write, Administrator, and Owner permissions. Teams can receive separate access for repository units such as Code, Issues, and Pull Requests. Dedicated role accounts or teams combined with repository-restricted tokens could separate Coder from Analyst, but endpoint-level testing is needed, especially for Poller state writes and dispatch. [Repository and team permissions](https://forgejo.org/docs/v17.0/user/collaboration/repo-permissions/)

Forgejo OAuth2 application tokens are a poor fit for Fullsend role credentials: the docs state that OAuth2 scopes are not implemented and third-party tokens receive administrative rights. [OAuth2 provider](https://forgejo.org/docs/v17.0/user/authentication/oauth2-provider/)

## Human actors and effective roles

Webhook payloads include the sender's numeric ID and login. Forgejo documents `X-Forgejo-Signature` as HMAC-SHA256 over the raw body and `X-Forgejo-Delivery` as a UUID. The signature proves payload integrity/source, not the sender's repository role. No signed timestamp is documented; a receiver should deduplicate delivery IDs and re-fetch event and actor data against a pinned repository, with freshness and idempotency checks. [Forgejo webhooks](https://forgejo.org/docs/v17.0/user/repository/webhooks/)

Forgejo's Read/Write/Admin/Owner levels and per-unit team permissions do not directly map to Fullsend's `read`, `triage`, `write`, `maintain`, and `admin`. One aggregate permission can be ambiguous when a person has Code read but Issues or Pull Requests write. Forgejo docs say repository administrators can query other users' repository permissions; a separate permission-verifier identity may be needed. Verify the exact endpoint, response, and access requirements in the target instance's generated [Swagger reference](https://forgejo.org/docs/v17.0/user/api/usage/) before relying on it. Unknown or unverifiable access must not become a stronger Fullsend role.

## OIDC and trust

Forgejo Actions can issue OIDC tokens from v15. v16 added Authorized Integrations for constrained JWT-based API/Git access, but v16 is end-of-life as of this research date; v17 is current stable and v15 is LTS. Forgejo documents stable `actor_id` and `repository_id` claims. The `sub` format differs depending on whether Actions was enabled before v16, so a trust policy should prefer stable IDs and bind issuer, audience, repository, and workflow. [v16 release notes and support dates](https://forgejo.org/2026-07-release-v16-0/), [OIDC claims](https://forgejo.org/docs/v17.0/user/actions/security-openid-connect/), [Authorized Integrations](https://forgejo.org/docs/v17.0/user/api/authorized-integrations/)

Fullsend currently has no trusted Forgejo job-token plumbing. ADR 0155 uses native Forgejo secrets by default and fails closed on explicit Vault selection until a trusted Forgejo OIDC integration exists. Keep that behavior until an issuer, audience, claims, and trust policy are explicitly implemented and validated. [ADR 0155](../docs/ADRs/0155-configure-vault-backed-runner-secrets.md)

## Fullsend contract fit

ADR 0007 expects a Forgejo-equivalent least-privilege mechanism for role credentials. ADR 0151 requires verified Forgejo human roles or denial. The existing GitLab role contract is a useful precedent: distinct Poller, Analyst, and Coder credentials, no shared-token fallback, and fail-closed routing. Fullsend currently has GitHub collaborator-role and GitLab project-member-role lookups, normalized roles, but no Forgejo client, role adapter, or webhook poller. See [ADR 0007](../docs/ADRs/0007-per-role-github-apps.md), [ADR 0151](../docs/ADRs/0151-harness-human-role-minimums.md), [GitLab role-credential contract](../docs/contributing/gitlab-role-credentials.md), [`forge.go`](../internal/forge/forge.go), [`detect.go`](../internal/forge/detect.go), and [`event.go`](../internal/normevent/event.go).

## Questions for dependent decisions

1. Will v1 use separate Forgejo role accounts/tokens, constrained OIDC-backed credentials, or both?
2. What permissions are required for Poller, Analyst, Coder, and custom roles, and can each stay inside repository/unit restrictions?
3. Which verified Forgejo permission lookup maps to each Fullsend human role? How are unit-specific grants handled?
4. What evidence identifies bots as a registered Fullsend role, and how are webhook delivery IDs and stale/replayed events handled?
5. Which stable OIDC claims and issuer/audience constraints are required before Vault or mint trust is allowed?
