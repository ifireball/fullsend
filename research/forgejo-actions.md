# Forgejo Actions and runner compatibility for Fullsend

Research for [Assess Forgejo Actions and runner support for Fullsend workflows](https://github.com/fullsend-ai/fullsend/issues/9540), as of 2026-11-16. This is decision support, not an implementation or support commitment.

## Finding

Forgejo Actions can run a meaningful subset of Fullsend workflows, but the existing GitHub-shaped workflows and behavior-test lifecycle do not transfer as-is. In particular, permission syntax, OIDC claims, event triggers, artifacts, and external test infrastructure need explicit decisions.

## Workflow compatibility

The current per-repo shim uses `issues`, `issue_comment`, `pull_request_target`, and `pull_request_review`; the Jira poll template uses `schedule`, `workflow_dispatch`, reusable workflows, secrets, variables, and concurrency. See [`shim-per-repo.yaml`](../internal/scaffold/fullsend-repo/templates/shim-per-repo.yaml) and [`jira-poll-per-repo.yaml`](../internal/scaffold/fullsend-repo/templates/jira-poll-per-repo.yaml).

Forgejo v17 documents issue, comment, pull-request, pull-request-target, schedule, `workflow_call`, and `workflow_dispatch` triggers. Its reference does not list `pull_request_review`, `workflow_run`, or `merge_group`; treat them as unsupported until checked against the target version. `issue_comment` workflows must be on the default branch. Forgejo prefers `.forgejo/workflows`, and only falls back to `.github/workflows` when the former directory is absent. [Actions reference](https://forgejo.org/docs/v17.0/user/actions/reference/), [overview](https://forgejo.org/docs/v17.0/user/actions/overview/)

Reusable workflows, mapped secrets, `secrets: inherit`, dynamic matrices, and the `github` context alias are documented. Since v15, reusable workflows expand into separate jobs, but cross-instance workflows hosted on another Forgejo or GitHub instance do not expand. Fullsend's reusable-workflow references need a same-instance mirror for full expansion. Matrix `include: []` behavior still needs direct testing. Concurrency cancellation is supported, but queue exclusion is best-effort; `cancel-in-progress: false` does not guarantee strict ordering. [v15 release](https://forgejo.org/2026-04-release-v15-0/), [Actions reference](https://forgejo.org/docs/v17.0/user/actions/reference/)

## Permissions, secrets, and OIDC

Forgejo's documented workflow syntax does not include GitHub's job-level `permissions:` map. Its automatic token has repository write access, is limited to that repository, and does not trigger workflows from changes it authors. Fork PR workflows have reduced access. v16 Authorized Integrations offer cross-repository API access but are not an equivalent to GitHub's per-job permission model. [Basic concepts](https://forgejo.org/docs/v17.0/user/actions/basic-concepts/), [v16 release](https://forgejo.org/2026-07-release-v16-0/)

Repository, organization, and user secrets/variables plus reusable-workflow secret mappings are documented. The reviewed docs do not establish GitHub Environment protection and secret semantics, which the current e2e workflow uses for `dev` and `stage`. [Basic concepts](https://forgejo.org/docs/v17.0/user/actions/basic-concepts/), [Actions reference](https://forgejo.org/docs/v17.0/user/actions/reference/)

Actions OIDC needs Forgejo v15 and Forgejo Runner newer than v12.5.0. The issuer is `<instance>/api/actions`; documented claims include `workflow_ref`. Fullsend's current mint checks the GitHub issuer and `job_workflow_ref`, so Forgejo jobs cannot use that contract unchanged. See [OIDC claims](https://forgejo.org/docs/v17.0/user/actions/security-openid-connect/), [Fullsend claim requirements](../internal/mintcore/claims.go), and [issuer checks](../internal/mintcore/sts_verifier.go).

## Run discovery, logs, artifacts, and runner

Forgejo v12 added repository workflow-run list/get APIs; v16 added workflow/job log and artifact list/download APIs; v17 adds job detail and rerun endpoints. The current driver's API needs therefore point to **v16 or later**, subject to checking exact job-list/status responses. As of this research date, Forgejo v17.0.1 is current stable (supported until 2027-01-28); v15 is LTS through 2027-07-15 but lacks v16's log/artifact APIs. [v12 release](https://forgejo.org/2025-07-release-v12-0/), [v16 release](https://forgejo.org/2026-07-release-v16-0/), [v17 release](https://forgejo.org/2026-10-release-v17-0/), [releases](https://forgejo.org/releases/)

The artifact API is not fully GitHub-compatible. Forgejo requires upload/download action v3 or a patched v4, and Actions cannot download artifacts from another workflow run. Fullsend's behavior driver needs run-scoped lookup/download and job-name fallback, so the API and artifact producer need a compatibility spike. [Advanced features](https://forgejo.org/docs/v17.0/user/actions/advanced-features/), [v16 API notes](https://forgejo.org/2026-05-monthly-report/)

For a local trial, Forgejo 17.0.1 with Forgejo Runner 13.1.0 is a practical target. Runner v13 requires Docker 25+; Docker 28.0.1 resolves a documented IPv6 issue. Runner labels select host/container/Podman execution, and the runner is an untrusted-code execution boundary that needs isolation. [Runner releases](https://forgejo.org/releases/), [Runner v13.1](https://forgejo.org/2026-09-runner-release-v131/), [Runner v13 changes](https://forgejo.org/2026-08-runner-release-v13/), [admin guide](https://forgejo.org/docs/v17.0/admin/actions/), [security guide](https://forgejo.org/docs/v17.0/user/actions/security/)

## Behavior-test implications

The current behavior-test lifecycle depends on GitHub, GCP, and Cloudflare: the suite accepts GitHub/GitLab SCM and GitHub Actions CI; it leases GitHub pool repositories, deploys a Cloudflare mint with GitHub App PEMs, and uses GCP inference provisioning plus GitHub actor PATs. See [`env.go`](../pkg/behaviourtest/drivers/env/env.go), [`select.go`](../pkg/behaviourtest/select.go), [`run.go`](../pkg/behaviourtest/run.go), [`repopool_cfmint_previews.go`](../pkg/behaviourtest/drivers/install/repopool_cfmint_previews.go), [e2e workflow](../.github/workflows/e2e.yml), and [Makefile](../Makefile).

The user has since set the scope for the Forgejo local behavior-test and dev profile: external inference resources may remain, but the profile must not require live GitHub or any mint service. Scenarios that directly exercise GitHub or mint must be tagged/scoped out of Forgejo runs or made portable through the relevant abstractions where that behavior applies. This changes the test-profile requirement, not the evidence about the current suite. A Forgejo profile therefore does **not** need a local/test mint merely to reach its Forgejo scenarios; it needs Forgejo SCM/CI drivers, Forgejo-aware setup/actors, and a way to avoid initializing GitHub- and mint-specific scenarios. The scenario mapping and CI gate remain open in [Set Forgejo behavior-test coverage and CI gates](https://github.com/fullsend-ai/fullsend/issues/9548).

## Questions for dependent decisions

1. Which documented-but-missing triggers are required, especially review-triggered work?
2. Will the local suite require a test mint/token issuer, or should Fullsend extend its production mint trust to Forgejo OIDC claims and issuer?
3. Does v16's artifact API support all needed cross-run lookups, and which upload action will Fullsend require?
4. What local runner isolation and container runtime are acceptable?
5. Which tests run only locally, in normal PR CI, or against a hosted Forgejo instance as a release gate?
