# Documentation site deployment (Cloudflare Pages)

## Overview

This repository publishes a static documentation site built from `docs/mindmap.html` (copied to `_site/index.html` in CI). Deployment is driven by two GitHub Actions workflows: **Build Site** produces artifact `site` on `pull_request` and `push` to `main` when the mindmap changes; **Deploy Site** runs after a successful build via `workflow_run`, downloads that artifact, uploads to Cloudflare Pages with Wrangler, records a GitHub Deployment (`site-preview` or `site-production`), and upserts a single PR comment for previews.

For architecture, security boundaries, and naming conventions, see the design spec: [2026-04-09-site-cloudflare-pages-design.md](superpowers/specs/2026-04-09-site-cloudflare-pages-design.md).

## Cloudflare setup

Create a **Cloudflare Pages** project configured for **Direct Upload**. GitHub Actions is the source of truth for builds; do not rely on Cloudflare’s Git-connected CI as the primary pipeline for this site.

In the Pages project settings, set the **production branch** to `main`. Enable **preview deployments** for branches that are not production so pull requests receive distinct preview URLs.

Create an **API token** with at least **Account → Cloudflare Pages → Edit**. Some accounts also require **Account → Account Settings → Read** for Wrangler; add that permission if token validation fails. Store the token value in GitHub as the secret `CLOUDFLARE_API_TOKEN`.

From the Cloudflare dashboard, copy your **Account ID** and store it as the GitHub secret `CLOUDFLARE_ACCOUNT_ID`.

Add **`CLOUDFLARE_PROJECT_NAME`** as a GitHub **Actions variable** (not a secret) whose value is exactly the Pages project name used in the dashboard. If your organization prefers this value in secrets instead, change the deploy workflow expression to use `secrets.CLOUDFLARE_PROJECT_NAME` and document that choice here for operators.

For a public hostname beyond the default `*.pages.dev` (for example a fork demo or later `konflux.sh`), use Pages → **Custom domains**, add the hostname, and complete the DNS steps Cloudflare provides.

## GitHub fork phase 1

On a **fork** used to validate the setup before upstream cutover, open the repository **Settings → Secrets and variables → Actions**. Under **Secrets**, add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Under **Variables**, add `CLOUDFLARE_PROJECT_NAME` matching your Cloudflare project name.

Fork contributors need the **build** workflow to run on their pull requests. Under **Settings → Actions → General**, find **Fork pull request workflows** and allow workflows from contributors so fork PRs can execute **Build Site** without placing Cloudflare credentials in the fork.

The **Deploy Site** workflow runs in the base repository context with your secrets; fork logs should not contain those values.

## GitHub upstream phase 2

For the canonical upstream repository, configure the same secrets and variables at **organization or repository** scope according to your governance model.

The deploy workflow already declares `pull-requests: write` so the default `GITHUB_TOKEN` can comment on fork PRs when the deploy job runs on the base repo. Confirm this matches your org policy before enabling wide fork contributions.

After cutover, if GitHub Pages was only used for this documentation site, disable it under **Settings → Pages** to avoid duplicate or confusing hosting.

Production and deployment metadata may show `*.pages.dev` URLs until a custom domain (for example **`konflux.sh`** or a subdomain) is attached in Cloudflare. Once Wrangler reports the alias or primary URL you care about, GitHub Deployments’ `environment_url` will follow; if the alias remains `*.pages.dev` until DNS is primary, note that in release communications.

## Troubleshooting

**Deploy job skipped.** The `workflow_run` trigger requires the completed workflow’s display name to match **Build Site** exactly. The job also requires `github.event.workflow_run.repository.full_name` to equal the current repository. If either condition fails, the deploy job is intentionally skipped.

**`Missing deployment URL` in the GitHub Script step.** The script reads Wrangler outputs `deployment-alias-url` or `deployment-url`. Pin or upgrade `cloudflare/wrangler-action` as needed, and keep the deploy step `id: cf` so expressions still resolve.

**Artifact download fails (for example 404).** The deploy job needs `actions: read` (already set) and a valid `run-id` from the triggering workflow run (already wired). The **Build Site** workflow must have uploaded an artifact named **`site`**.

**No PR comment after a preview deploy.** GitHub sometimes omits `workflow_run.pull_requests`. The script then lists open PRs with `head=owner:branch` and expects exactly one match. Draft PRs, multiple open PRs for the same head, or unusual branch naming can cause the script to skip commenting; adjust the PR state or resolve ambiguity and re-run the build.
