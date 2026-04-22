# Installing fullsend

Set up fullsend in a GitHub organization from scratch. By the end of this guide you will have:

- A `.fullsend` configuration repository in your org
- Per-role GitHub Apps for agent identity
- Agent workflows deployed to `.fullsend`
- A dispatch token connecting enrolled repos to the agent pipeline
- Enrollment PRs open on the repos you chose

## Prerequisites

1. **GitHub org admin access.** You must be an owner of the GitHub organization.
2. **GitHub CLI (`gh`).** Install from [cli.github.com](https://cli.github.com). Authenticate with:

   ```bash
   gh auth login
   ```

   Then add the scopes fullsend needs:

   ```bash
   gh auth refresh -s delete_repo,workflow,admin:org
   ```

   - `delete_repo` — needed for uninstall (safe to add now)
   - `workflow` — needed to write workflow files to `.fullsend`
   - `admin:org` — needed to create org-level secrets

3. **The `fullsend` CLI.** Build from source:

   ```bash
   git clone https://github.com/fullsend-ai/fullsend.git
   cd fullsend
   go build -o fullsend ./cmd/fullsend/
   ```

4. **(Optional) GCP project for inference.** If your agents will use Vertex AI for LLM calls, you need a GCP project with Vertex AI enabled, a service account key, and the region you want to use.

## Step 1: Preview the installation

Run a dry run to see what the installer would do without making changes:

```bash
fullsend admin install YOUR_ORG \
  --repo repo-one --repo repo-two \
  --dry-run
```

The output shows each layer and its status: what would be created, what already exists, and what would change. Review this before proceeding.

**Flags:**

| Flag | Purpose |
|------|---------|
| `--repo` | Repository to enable (repeatable). Only listed repos get enrollment PRs. |
| `--agents` | Comma-separated agent roles. Default: `fullsend,triage,coder,review`. |
| `--dry-run` | Preview only — no changes made. |
| `--gcp-project` | GCP project ID for Vertex AI inference (optional). |
| `--gcp-region` | GCP region for Vertex AI, e.g. `us-east5` (required with `--gcp-project`). |
| `--gcp-credentials-file` | Path to GCP service account key JSON (optional). |
| `--skip-app-setup` | Skip GitHub App creation (use when apps already exist). |

## Step 2: Run the installer

```bash
fullsend admin install YOUR_ORG \
  --repo repo-one --repo repo-two
```

The installer runs through six layers in order. Each is idempotent — you can re-run the installer safely.

### Layer 1: Config repository

The installer creates a private repository named `.fullsend` in your org. This repo holds all agent configuration: workflow files, agent instructions, harness config, and policies.

A `config.yaml` is written to the repo root with your org's settings. See the [config.yaml spec](../../normative/admin-install/v1/adr-0011-org-config-yaml/SPEC.md) for the full schema.

A `CODEOWNERS` file is created granting you ownership of all paths in `.fullsend`.

### Layer 2: Workflows

The installer writes the agent workflow scaffold to `.fullsend`:

- `.github/workflows/triage.yml` — triage agent entrypoint
- `.github/workflows/code.yml` — code agent entrypoint
- `.github/workflows/review.yml` — review agent entrypoint
- `.github/workflows/repo-maintenance.yml` — enrollment reconciliation
- Agent instructions, harness configs, policies, and scripts

See the [file layout spec](../../normative/admin-install/v1/adr-0012-fullsend-repo-files/SPEC.md) for the complete list.

### Layer 3: GitHub App setup

For each agent role, the installer creates a GitHub App using GitHub's [app manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest):

1. Your browser opens to GitHub's app creation page with pre-filled permissions.
2. You click "Create GitHub App."
3. GitHub redirects back to the CLI, which captures the app credentials.
4. The CLI checks whether the app is installed on your org. If not, it opens the installation page for you to install it.

This repeats for each role (by default: `fullsend`, `triage`, `coder`, `review`).

The app's private key (PEM) and client ID are stored as repository secrets and variables on `.fullsend`:

| Kind | Name pattern | Example |
|------|-------------|---------|
| Secret | `FULLSEND_<ROLE>_APP_PRIVATE_KEY` | `FULLSEND_TRIAGE_APP_PRIVATE_KEY` |
| Variable | `FULLSEND_<ROLE>_CLIENT_ID` | `FULLSEND_TRIAGE_CLIENT_ID` |

See the [credentials spec](../../normative/admin-install/v1/adr-0014-github-apps-and-secrets/SPEC.md) for details.

**If you already have apps from a previous install:** The installer detects existing apps by slug. If a matching app and its secret already exist, it offers to reuse them.

### Layer 4: Inference (optional)

If you passed `--gcp-project`, the installer stores GCP credentials as secrets on `.fullsend`:

- `FULLSEND_GCP_SA_KEY_JSON` — service account key
- `FULLSEND_GCP_PROJECT_ID` — project identifier
- `FULLSEND_GCP_REGION` — region (as a variable)

If you did not pass GCP flags, the installer preserves any existing inference configuration.

### Layer 5: Dispatch token

The dispatch token is a fine-grained GitHub PAT that allows enrolled repos to trigger workflows in `.fullsend`. The installer guides you through creating it:

1. Your browser opens to GitHub's PAT creation page, pre-filled with a name and description.
2. You configure the token:
   - **Resource owner:** your org
   - **Repository access:** Only `.fullsend`
   - **Permissions:** Actions → Read and write
3. Generate the token and paste it into the CLI.

The CLI verifies the token works by triggering a test dispatch, then stores it as the org-level Actions secret `FULLSEND_DISPATCH_TOKEN`.

**Why a fine-grained PAT?** The dispatch token is scoped to only the `.fullsend` repo with only Actions permissions. This limits blast radius if the token is compromised. See [ADR 0008](../ADRs/0008-workflow-dispatch-for-cross-repo-dispatch.md) for the design rationale.

### Layer 6: Enrollment

The installer dispatches the `repo-maintenance.yml` workflow in `.fullsend`, which opens enrollment PRs on each repo you listed with `--repo`. Each PR adds a shim workflow (`.github/workflows/fullsend.yaml`) that forwards GitHub events to the agent pipeline in `.fullsend`.

The shim uses `pull_request_target` (not `pull_request`) so that PR authors cannot modify the shim to exfiltrate the dispatch token. See [ADR 0009](../ADRs/0009-pull-request-target-in-shim-workflows.md).

**Enrollment is not automatic.** The PR must be reviewed and merged on each repo before fullsend activates. This is intentional — repository maintainers control whether their repo participates.

## Step 3: Merge enrollment PRs

After the installer finishes, check each enrolled repo for a PR titled **"Connect to fullsend agent pipeline."** Review and merge it. Once merged, fullsend is active on that repo.

## Step 4: Verify the installation

Run the analyzer to confirm everything is healthy:

```bash
fullsend admin analyze YOUR_ORG
```

Each layer should report **installed**. If any layer reports **not installed** or **degraded**, re-run the installer — all layers are idempotent.

## Adding repos later

To enroll additional repos after the initial install, re-run the installer with the new repos added:

```bash
fullsend admin install YOUR_ORG \
  --repo repo-one --repo repo-two --repo repo-three \
  --skip-app-setup
```

Use `--skip-app-setup` to skip the GitHub App flow (apps already exist). The installer updates `config.yaml` and dispatches enrollment for all listed repos. Already-enrolled repos are skipped.

## Removing repos

To unenroll a repo, set `enabled: false` for it in `config.yaml` (in `.fullsend`) and re-run the installer. The reconciliation workflow will open a PR to remove the shim from that repo.

## Uninstalling fullsend

To remove fullsend entirely from your org:

```bash
fullsend admin uninstall YOUR_ORG
```

This deletes the `.fullsend` repository (which removes all stored secrets with it). The CLI then opens your browser to the settings page for each GitHub App so you can delete them manually.

**This is destructive.** The CLI asks you to type the org name to confirm. Use `--yolo` to skip the confirmation (not recommended).

Note: Shim workflows in enrolled repos are not automatically removed by uninstall. Remove them manually or via PRs.

## Troubleshooting

### "Token is missing required scopes"

Re-run `gh auth refresh -s delete_repo,workflow,admin:org` and try again.

### App creation fails

If the browser-based manifest flow fails partway through, the app may exist on GitHub but without its credentials stored locally. Delete the app from your org settings (`https://github.com/organizations/YOUR_ORG/settings/apps`) and re-run the installer.

### Dispatch token verification fails

The installer verifies the token by triggering a real workflow dispatch. If this fails:

1. Confirm the token's resource owner is your org (not your personal account).
2. Confirm the token's repository access is set to `.fullsend` only.
3. Confirm Actions permissions are set to Read and write.
4. Delete the token and create a new one if needed.

### Enrollment PRs not appearing

Check the `repo-maintenance.yml` workflow run in `.fullsend` → Actions. It logs each repo it processes. Common issues:

- The repo name in `--repo` doesn't match the GitHub repo name exactly (case-sensitive).
- The workflow failed — check its logs for errors.

## What's next

Once enrollment PRs are merged, developers can start using fullsend workflows. See the [bugfix workflow guide](../user/bugfix-workflow.md) for how the end-to-end flow works.

## Reference

- [Architecture overview](../../architecture.md) — component vocabulary and execution stack
- [ADR 0003](../../ADRs/0003-org-config-repo-convention.md) — org config repo convention
- [ADR 0006](../../ADRs/0006-ordered-layer-model.md) — ordered layer model
- [ADR 0007](../../ADRs/0007-per-role-github-apps.md) — per-role GitHub Apps
- [ADR 0008](../../ADRs/0008-workflow-dispatch-for-cross-repo-dispatch.md) — workflow dispatch for cross-repo dispatch
- [Config.yaml spec](../../normative/admin-install/v1/adr-0011-org-config-yaml/SPEC.md)
- [File layout spec](../../normative/admin-install/v1/adr-0012-fullsend-repo-files/SPEC.md)
- [Enrollment spec](../../normative/admin-install/v1/adr-0013-enrollment/SPEC.md)
- [Credentials spec](../../normative/admin-install/v1/adr-0014-github-apps-and-secrets/SPEC.md)
