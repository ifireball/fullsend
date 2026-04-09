# Mindmap → Cloudflare Pages (fork-safe CI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GitHub Pages mindmap deploy with Cloudflare Pages (production + per-PR previews), using a secretless build workflow plus a `workflow_run` deploy workflow that holds Cloudflare and GitHub Deployment credentials, including `site-preview` / `site-production` environments and an upserted PR comment.

**Architecture:** `Build Document Mindmap` runs on `pull_request` and `push` to `main` (path-filtered), checks out the PR head SHA on PRs, copies `docs/mindmap.html` to `_site/index.html`, uploads artifact `mindmap-site`. `Deploy Document Mindmap` runs on successful completion of that workflow, downloads the artifact by run id, runs `wrangler pages deploy` via `cloudflare/wrangler-action@v3.14.1`, then uses `actions/github-script` to create a GitHub Deployment + success status (`environment_url` from Wrangler outputs) and upsert a preview PR comment when the triggering event was `pull_request`.

**Tech Stack:** GitHub Actions, Cloudflare Pages (direct upload), Wrangler (`cloudflare/wrangler-action@v3.14.1`), `actions/github-script@v8`, REST Deployments API.

**Spec:** [2026-04-09-mindmap-cloudflare-pages-design.md](../specs/2026-04-09-mindmap-cloudflare-pages-design.md)

---

## File map

| File | Role |
|------|------|
| `.github/workflows/mindmap-build.yml` | Secretless build + `mindmap-site` artifact |
| `.github/workflows/mindmap-deploy.yml` | Artifact download, Wrangler deploy, GitHub Deployment + PR comment |
| `.github/workflows/mindmap.yml` | **Remove** (replaced by the two workflows above) |
| `docs/mindmap-deployment.md` | Operator runbook: Cloudflare project, token scopes, GitHub secrets/variables, fork policy, troubleshooting, phase 2 / `konflux.sh` follow-up |

---

### Task 1: Add build workflow

**Files:**

- Create: `.github/workflows/mindmap-build.yml`

- [ ] **Step 1: Create the workflow file**

Use this exact content (pin `actions/checkout` to `v6.0.2` to match other workflows in this repo):

```yaml
name: Build Document Mindmap

on:
  pull_request:
    paths:
      - 'docs/mindmap.html'
  push:
    branches: [main]
    paths:
      - 'docs/mindmap.html'

permissions:
  contents: read

concurrency:
  group: mindmap-build-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6.0.2
        with:
          ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}

      - name: Prepare site
        run: |
          mkdir -p _site
          cp docs/mindmap.html _site/index.html

      - uses: actions/upload-artifact@v4
        with:
          name: mindmap-site
          path: _site/
          retention-days: 5
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/mindmap-build.yml
git commit -m "ci: add mindmap build workflow for Cloudflare handoff"
```

---

### Task 2: Add deploy workflow

**Files:**

- Create: `.github/workflows/mindmap-deploy.yml`

- [ ] **Step 1: Create the workflow file**

The job must only run for successful runs of **this repository’s** build workflow, and only for `pull_request` or `push` events.

Use this exact content:

```yaml
name: Deploy Document Mindmap

on:
  workflow_run:
    workflows: [Build Document Mindmap]
    types: [completed]

permissions:
  contents: read
  actions: read
  deployments: write
  pull-requests: write

concurrency:
  group: mindmap-deploy-${{ github.event.workflow_run.event }}-${{ github.event.workflow_run.head_repository.owner.login }}-${{ github.event.workflow_run.head_branch }}
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    if: >-
      github.event.workflow_run.conclusion == 'success' &&
      github.event.workflow_run.repository.full_name == github.repository &&
      contains(fromJSON('["pull_request","push"]'), github.event.workflow_run.event)
    env:
      HEAD_BRANCH: ${{ github.event.workflow_run.head_branch }}
      HEAD_SHA: ${{ github.event.workflow_run.head_sha }}
    steps:
      - name: Download build artifact
        uses: actions/download-artifact@v4
        with:
          name: mindmap-site
          path: _site
          github-token: ${{ secrets.GITHUB_TOKEN }}
          run-id: ${{ github.event.workflow_run.id }}

      - name: Deploy to Cloudflare Pages
        id: cf
        uses: cloudflare/wrangler-action@v3.14.1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy _site --project-name=${{ vars.CLOUDFLARE_PROJECT_NAME }} --branch=${{ env.HEAD_BRANCH }}

      - name: GitHub Deployment + preview comment
        uses: actions/github-script@v8
        env:
          DEPLOYMENT_URL: ${{ steps.cf.outputs.deployment-alias-url || steps.cf.outputs.deployment-url }}
        with:
          script: |
            const run = context.payload.workflow_run;
            const owner = context.repo.owner;
            const repo = context.repo.repo;
            const sha = run.head_sha;
            const isPR = run.event === 'pull_request';
            const environment = isPR ? 'site-preview' : 'site-production';
            const url = process.env.DEPLOYMENT_URL;
            if (!url) {
              core.setFailed('Missing deployment URL from Wrangler outputs (deployment-alias-url / deployment-url)');
              return;
            }

            const deployment = await github.rest.repos.createDeployment({
              owner,
              repo,
              ref: sha,
              environment,
              auto_merge: false,
              required_contexts: [],
              transient_environment: isPR,
              production_environment: !isPR,
            });
            const deploymentId = deployment.data.id;

            await github.rest.repos.createDeploymentStatus({
              owner,
              repo,
              deployment_id: deploymentId,
              state: 'success',
              environment_url: url,
              description: 'Cloudflare Pages',
              auto_inactive: isPR,
            });

            if (!isPR) return;

            const marker = '<!-- mindmap-preview -->';
            let prNumber = run.pull_requests?.[0]?.number;
            if (!prNumber) {
              const head = `${run.head_repository.owner.login}:${run.head_branch}`;
              const { data: prs } = await github.rest.pulls.list({
                owner,
                repo,
                state: 'open',
                head,
                per_page: 100,
              });
              if (prs.length !== 1) {
                core.info(`Skipping PR comment: expected 1 open PR for head=${head}, found ${prs.length}`);
                return;
              }
              prNumber = prs[0].number;
            }

            const body = [
              marker,
              '### Document mindmap preview',
              '',
              `**Preview:** ${url}`,
              '',
              `Commit: \`${sha}\``,
            ].join('\n');

            const { data: comments } = await github.rest.issues.listComments({
              owner,
              repo,
              issue_number: prNumber,
              per_page: 100,
            });
            const existing = comments.find((c) => c.body?.includes(marker));
            if (existing) {
              await github.rest.issues.updateComment({
                owner,
                repo,
                comment_id: existing.id,
                body,
              });
            } else {
              await github.rest.issues.createComment({
                owner,
                repo,
                issue_number: prNumber,
                body,
              });
            }
```

Notes baked into this YAML:

- **`vars.CLOUDFLARE_PROJECT_NAME`:** configure as a **repository variable** (not secret). If you prefer a secret name instead, replace that single expression with `${{ secrets.CLOUDFLARE_PROJECT_NAME }}` and document it in the runbook.
- **`--branch`:** matches `workflow_run.head_branch` so Cloudflare associates the upload with the correct preview or production branch (production when the branch is `main` per Pages project settings).

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/mindmap-deploy.yml
git commit -m "ci: add mindmap deploy to Cloudflare with GitHub Deployments"
```

---

### Task 3: Remove GitHub Pages workflow

**Files:**

- Delete: `.github/workflows/mindmap.yml`

- [ ] **Step 1: Delete the file**

Remove `.github/workflows/mindmap.yml` entirely so the mindmap is no longer deployed via `actions/deploy-pages`.

- [ ] **Step 2: Commit**

```bash
git rm .github/workflows/mindmap.yml
git commit -m "ci: drop GitHub Pages workflow for mindmap"
```

---

### Task 4: Operator runbook

**Files:**

- Create: `docs/mindmap-deployment.md`

- [ ] **Step 1: Add the runbook**

Create `docs/mindmap-deployment.md` with the following sections (adjust org/repo names when copying for upstream):

1. **Overview** — Link to the design spec `docs/superpowers/specs/2026-04-09-mindmap-cloudflare-pages-design.md` and summarize the two workflows.
2. **Cloudflare setup**
   - Create a **Pages** project for **Direct Upload** (not Git-connected CI as the source of truth; GitHub Actions uploads builds).
   - In project settings, set **production branch** to `main`.
   - Ensure **preview deployments** are enabled for non-production branches.
   - Create an **API Token** with at least **Account → Cloudflare Pages → Edit** (and **Account → Account Settings → Read** if required by your account for Wrangler). Store as `CLOUDFLARE_API_TOKEN`.
   - Copy **Account ID** from the Cloudflare dashboard → `CLOUDFLARE_ACCOUNT_ID`.
   - Add **`CLOUDFLARE_PROJECT_NAME`** as a GitHub **Actions variable** (same string as the Pages project name).
   - Optional **custom domain** (fork demos or later `konflux.sh`): Pages → Custom domains → add hostname; complete DNS instructions Cloudflare shows.
3. **GitHub setup (fork — phase 1)**
   - Repository → **Settings → Secrets and variables → Actions**:
     - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
     - Variables: `CLOUDFLARE_PROJECT_NAME`
   - **Settings → Actions → General → Fork pull request workflows**: allow workflows from contributors (so fork PRs can run the **build** workflow).
4. **GitHub setup (upstream — phase 2)**
   - Same secrets/variables at **org or repo** level as your governance prefers.
   - Confirm the deploy workflow’s `GITHUB_TOKEN` can comment on fork PRs (`pull-requests: write` is already declared in the workflow).
   - After cutover, **disable GitHub Pages** for this repo if it was only used for the mindmap (**Settings → Pages**).
   - **Later:** attach **`konflux.sh`** (or a subdomain) in Cloudflare; production URLs in Deployments and docs will then use that hostname once Wrangler reports it (or add a note if the alias URL remains `*.pages.dev` until custom domain is primary).
5. **Troubleshooting**
   - **Deploy job skipped:** wrong triggering workflow name (must match `Build Document Mindmap` exactly), or `workflow_run.repository` not equal to current repo.
   - **`Missing deployment URL`:** upgrade Wrangler via wrangler-action or inspect action outputs; ensure deploy step id remains `cf`.
   - **Artifact download 404:** deploy job needs `actions: read` and correct `run-id` (already set); build must have uploaded `mindmap-site`.
   - **No PR comment:** `workflow_run.pull_requests` empty and `pulls.list` with `head=owner:branch` did not return exactly one open PR (document for draft PRs or unusual head branches).

- [ ] **Step 2: Commit**

```bash
git add docs/mindmap-deployment.md
git commit -m "docs: add mindmap Cloudflare Pages operator runbook"
```

---

### Task 5: Phase 1 validation (fork)

**Files:** none (manual)

- [ ] **Step 1: Configure Cloudflare + GitHub** per `docs/mindmap-deployment.md` on your fork.

- [ ] **Step 2: Push a commit on `main` that touches `docs/mindmap.html`**

Expected: `Build Document Mindmap` succeeds; `Deploy Document Mindmap` runs; Cloudflare production updates; GitHub shows a **Deployment** for environment **`site-production`** with `environment_url` matching the Pages URL.

- [ ] **Step 3: Open a PR (same repo) that changes `docs/mindmap.html`**

Expected: preview deployment; **`site-preview`** deployment; one PR comment updated on reruns.

- [ ] **Step 4: Open a PR from a second GitHub user / fork** (or your own fork of your fork) changing `docs/mindmap.html`**

Expected: build succeeds on the base repo without Cloudflare secrets in fork logs; deploy + comment still occur from the base repo’s deploy workflow.

---

### Task 6: Phase 2 — upstream PR

**Files:** none (manual); branch should contain Tasks 1–4 commits.

- [ ] **Step 1: Push your branch to origin and open a PR** against `konflux-ci/fullsend` (or upstream default branch).

- [ ] **Step 2: In the PR description**, list maintainer follow-ups: add Actions secrets/variables, verify fork workflow policy, disable legacy GitHub Pages when ready, optional `konflux.sh` DNS later.

- [ ] **Step 3: After merge**, repeat a subset of Task 5 checks on upstream.

---

## Plan self-review

**1. Spec coverage**

| Spec requirement | Task |
|------------------|------|
| Cloudflare instead of GitHub Pages | Tasks 2–3 |
| Two-phase build + `workflow_run` deploy | Tasks 1–2 |
| `site-preview` / `site-production` | Task 2 (`createDeployment`) |
| PR comment upsert + PR resolution fallback | Task 2 (github-script) |
| Path filter / PR head checkout | Task 1 |
| Fork-safe (no secrets on build) | Tasks 1 vs 2 permissions |
| Operator docs + phases | Tasks 4–6 |
| Concurrency | Both workflows |
| `*.pages.dev` then `konflux.sh` | Task 4 runbook |

**2. Placeholder scan**

No TBD/TODO left in workflow YAML or task text; Wrangler action version pinned to `v3.14.1`, github-script to `v8`.

**3. Type / naming consistency**

- Single artifact name `mindmap-site` in build and deploy.
- Build `name:` must stay **`Build Document Mindmap`** — it is the `workflow_run.workflows` filter target.
- Environment names exactly `site-preview` and `site-production`.

**Known follow-up (optional hardening):** If `createDeployment` returns **409** for a rare duplicate ref/environment case, extend the github-script to locate the existing deployment and only create a status (not required for normal one-commit-per-deploy usage).

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-09-mindmap-cloudflare-pages.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach do you want?**
