# Design: Documentation site on Cloudflare Pages (PR previews, fork-safe CI)

Date: 2026-04-09
Status: Draft (brainstorm consolidated)

## Context

The repository publishes a **static documentation site**. Today the primary surface is the interactive document graph in `docs/mindmap.html`; the site will likely **grow** (more pages or assets under `docs/` or a dedicated static tree). CI treats this as **one deployable site**: produce a directory (today `_site/` with `index.html` from the mindmap) and upload it.

**Implemented:** [`.github/workflows/site-build.yml`](../../../.github/workflows/site-build.yml) and [`.github/workflows/site-deploy.yml`](../../../.github/workflows/site-deploy.yml) deploy the site to **Cloudflare Pages** using the build → artifact → `workflow_run` deploy split described below. The previous GitHub Pages workflow (`site-github-pages.yml`) has been **removed**.

**Operator setup:** Cloudflare project, API token, and GitHub Actions secrets/variables are still required before deploys succeed; see [`docs/site-deployment.md`](../../site-deployment.md).

## Goals

- Deploy this **documentation site** to **Cloudflare Pages** instead of GitHub Pages.
- **Per-PR previews** on Cloudflare, including **fork PRs**, using a **two-workflow** pattern: unprivileged build + artifact, privileged deploy.
- Integrate with **GitHub Deployments** using environment names **`site-preview`** and **`site-production`** (preview vs production), with correct `deployment_status` and `environment_url` pointing at the Cloudflare URL.
- Surface preview links via **GitHub Deployments** and a **single upserted PR comment** (no comment spam on reruns).
- Use **stable workflow and artifact names** centered on **site** (not a specific page like the mindmap) so CI stays accurate as site content grows.
- Roll out in **two phases**: validate on a **personal fork** and Cloudflare account first; then land **upstream** and document org setup. Upstream may start on **`*.pages.dev`** and move to **`konflux.sh`** when DNS is ready.

## Non-goals

- Rewriting site **application** code (graph logic, bundlers) beyond what packaging requires.
- Non-GitHub CI (e.g. only Cloudflare Git integration) as the source of truth—**GitHub Actions** remains the deploy driver.
- OIDC to Cloudflare in the initial design (optional hardening later); **API token** in GitHub **secrets** is sufficient for phase 1 and 2.

## Approach comparison (condensed)

| Approach | Idea | Verdict |
|----------|------|--------|
| **A — `workflow_run` + artifact** | Secretless workflow builds and uploads artifact; second workflow on `workflow_run` downloads artifact and deploys. | **Chosen.** Aligns with GitHub’s model for fork PRs. |
| **B — `pull_request_target`** | Run deploy with base-repo secrets on PR events. | **Rejected.** High risk if build steps ever execute untrusted code; unnecessary here. |
| **C — External bot** | Webhook or service triggers deploy. | **Rejected.** Extra operational burden for a static site. |

**Deploy tooling:** Use a **maintained Cloudflare path** (e.g. **Wrangler**-based `pages deploy` via `cloudflare/wrangler-action`, or Cloudflare’s **Pages deploy action**) with a **scoped API token**. The implementation plan will pick one concrete action and pin versions.

## Architecture

### Workflow split

1. **Build workflow** (no secrets required beyond default `GITHUB_TOKEN` for checkout/upload):
   - **Triggers:** `pull_request` and `push` to `main`, with a **`paths`** filter. **Initially** the same as today (`docs/mindmap.html`). As the site grows, **extend `paths`** (or add build steps) so changes to other site sources trigger rebuilds—without renaming workflows.
   - **Checkout:** For `pull_request`, use the **PR head** ref / SHA so fork PRs build the contributor’s tree. For `push` to `main`, use the push ref.
   - **Build step:** Produce `_site/` suitable for static hosting. **Today:** `mkdir _site` and `cp docs/mindmap.html _site/index.html`. **Later:** copy or generate additional assets into `_site/` as needed.
   - **Artifact:** `actions/upload-artifact` with fixed name **`site`** and **short retention** (enough for the deploy workflow to run; typical 1–5 days).
   - **Permissions:** `contents: read` (and whatever the upload action minimally needs). **No** Cloudflare or `pages: write`.

2. **Deploy workflow** (secrets and GitHub Deployment API):
   - **Trigger:** `workflow_run` with `types: [completed]`, **`if`** the conclusion is **`success`**, the triggering workflow is the **site build** workflow (by name), and the triggering event is **`pull_request`** or **`push`**.
   - **Artifact:** Download using **`github.event.workflow_run.id`** and repository **`github.event.workflow_run.repository.full_name`** (normally the same repo).
   - **Permissions (minimum conceptual set):** `actions: read`, `contents: read`, **`deployments: write`**, **`pull-requests: write`** (for PR comments on fork PRs). Do **not** grant `pages: write` for Cloudflare deploy—GitHub Pages is being replaced for this site.
   - **Steps:** Deploy `_site` to Cloudflare Pages (production vs preview per branch/event); create **GitHub Deployment** on the **head SHA**; set **`deployment_status`** to success with **`environment_url`**; upsert PR comment for previews.

**Workflow file names (recommended):** `site-build.yml`, `site-deploy.yml`. **Workflow `name:` (display) values:** **`Build Site`**, **`Deploy Site`**—these must match the `workflow_run.workflows` filter exactly.

### GitHub environment names (Deployments API)

Use exactly these **GitHub deployment environment** names:

- **`site-preview`** — every **PR** build (including forks) that produces a preview URL on Cloudflare.
- **`site-production`** — **`push` to `main`** that updates the production Pages deployment.

**Semantics:**

- For **`site-preview`:** `transient_environment: true`, `production_environment: false`. Each deployment targets the PR head commit; Cloudflare preview URL becomes **`environment_url`** (and PR comment body).
- For **`site-production`:** `production_environment: true`, `transient_environment: false`. Deployment ref is the **`main`** commit SHA after merge/push.

Naming in the GitHub UI will follow these environment names; optional **GitHub Environments** (protection rules) can be added later for `site-production` without changing the names.

### PR comment (preview only)

- After a successful preview deploy, **create or update** one comment on the PR (hidden **HTML comment marker**, e.g. `<!-- site-preview -->`).
- **PR number resolution:** Prefer `github.event.workflow_run.pull_requests[0].number` when present; otherwise **query the API** for an open PR whose **head SHA** matches `github.event.workflow_run.head_sha` (GitHub does not always populate `pull_requests` on `workflow_run`).
- **Idempotency:** Updating the same comment keeps noise low across force-pushes and reruns.

### Cloudflare Pages

- **Single project** for this documentation site (name configurable via variable, e.g. `CLOUDFLARE_PROJECT_NAME`).
- **Production branch:** `main` (Cloudflare “production” deployment for pushes to `main`).
- **Previews:** Enabled for non-production branches / PRs so each PR gets a distinct preview URL.
- **Secrets (repository or environment):** e.g. `CLOUDFLARE_API_TOKEN` (scoped: Account **Cloudflare Pages — Edit** or equivalent minimal set), `CLOUDFLARE_ACCOUNT_ID`. Project name can be secret or variable.

### Domains

- **Fork / phase 1:** Operator may attach a **personal domain or subdomain** to the Pages project for demos; document optional **Custom domains** steps in Cloudflare.
- **Upstream / phase 2:** Start with the default **`*.pages.dev`** production hostname so merging is not blocked on **`konflux.sh`** DNS. Document a **follow-up**: add **`konflux.sh`** (or subdomain) in Cloudflare and GitHub deployment URLs once org DNS is available.

### Security (fork PRs)

- The **build** workflow must stay **minimal and auditable**: today it only copies a static file. If the pipeline later adds **install/build** steps, they must not run arbitrary code from the PR without review (e.g. avoid `npm install` executing postinstall from untrusted `package.json` until trusted lockfiles and policies exist).
- The **deploy** workflow trusts **artifacts** produced by the **known** build workflow run, not arbitrary user uploads. Document optional **extra checks** (e.g. verifying `head_repository` or workflow path) if the org wants defense-in-depth; for static site preview only, the main risk is **replacing preview content** on Cloudflare, not repository takeover.

### Concurrency

- Preserve intent of the current **`concurrency`** block: avoid overlapping deploys fighting each other. Use a **`group`** keyed by workflow purpose and **branch or PR identifier**, with **`cancel-in-progress: true`** where appropriate for PR previews.

### Removal of GitHub Pages for this site

- **Done:** **`site-github-pages.yml`** was removed; the site is **no longer** deployed via `actions/deploy-pages` / `upload-pages-artifact`.
- **Repository settings:** Disable GitHub Pages under **Settings → Pages** if it was only used for this site (upstream maintainers, phase 2).

## Rollout phases

### Phase 1 — Fork + personal Cloudflare

- Workflows **`site-build.yml`** and **`site-deploy.yml`** are in the repository; on a **fork**, merge or cherry-pick them to the default branch if needed.
- Create Cloudflare **Pages project** and **API token**; add **GitHub Actions secrets** on the fork.
- Optionally attach a **demo domain** to the project.
- Validate: **`main`** → `site-production` + production URL; **PR** (including from a test fork) → `site-preview` + preview URL + **PR comment**.

### Phase 2 — Upstream

- Open a **PR** with the same workflow changes and **in-repo setup documentation** (this spec or a linked operator doc—implementation plan decides path).
- Upstream maintainers: create **org/repo secrets** (and Cloudflare project for **konflux-ci** or the chosen org account); start on **`*.pages.dev`**; schedule **`konflux.sh`** when DNS owners are ready.

## Operator documentation (must ship with implementation)

Include a runbook section covering:

- **Cloudflare:** Create Pages project, enable previews, token scopes, optional custom domain, where to read **preview vs production** URLs after deploy.
- **GitHub (fork):** Required **secrets**, **`workflow_run`** and **`pull_request`** permissions (forks must be allowed to run workflows from collaborators / standard fork policy).
- **GitHub (upstream):** Same secrets at org or repo level; note **`pull-requests: write`** for comment upsert on fork PRs.
- **Troubleshooting:** Missing PR number on `workflow_run`, failed artifact download (`actions: read`), wrong workflow filter (must match **`Build Site`**).

## Testing and acceptance

- Path filter: changing unrelated files does **not** trigger **site** workflows (until paths are intentionally expanded).
- **`main`** push that hits the path filter: Cloudflare **production** updates; GitHub **Deployment** for **`site-production`** is **success** with correct **`environment_url`**.
- **Same-repo PR:** Preview URL, **`site-preview`** deployment, PR comment updated on rerun.
- **Fork PR:** Preview deploy and comment succeed; **fork build** logs show **no** Cloudflare secrets.

## Spec self-review (2026-04-09)

- **Placeholders:** Deploy action choice left to implementation plan (Wrangler vs Pages action)—intentional.
- **Consistency:** Environment names **`site-preview`** / **`site-production`**; workflows and artifact use **site** naming.
- **Scope:** Static site packaging and CI; mindmap is the current primary page, not the name of the pipeline.
- **Ambiguity:** “GitHub deployment environment names” are the **environment** field on the Deployments API, matching GitHub Environments if those are created with the same names.
- **Naming revision:** Pipelines and artifacts use **site** (e.g. `Build Site`, artifact `site`) so the CI names stay valid as site content grows beyond the mindmap.
