/**
 * Managed workflow files for `.fullsend` (parity with `internal/layers/workflows.go`).
 * CODEOWNERS is generated per authenticated GitHub user.
 */

export const AGENT_WORKFLOW_PATH = ".github/workflows/agent.yaml";
export const ONBOARD_WORKFLOW_PATH = ".github/workflows/repo-onboard.yaml";
export const CODEOWNERS_PATH = "CODEOWNERS";

export const MANAGED_WORKFLOW_PATHS = [
  AGENT_WORKFLOW_PATH,
  ONBOARD_WORKFLOW_PATH,
  CODEOWNERS_PATH,
] as const;

const agentWorkflowContent = `# Agent dispatch workflow
# Triggered by shim workflows in enrolled repos via workflow_dispatch.
# Reads its own repo secrets (App PEMs) — secrets never leave this repo.
name: Agent Dispatch

on:
  workflow_dispatch:
    inputs:
      event_type:
        required: true
        type: string
      source_repo:
        required: true
        type: string
      event_payload:
        required: true
        type: string

jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run fullsend entrypoint
        run: echo "fullsend entrypoint - event=\${{ inputs.event_type }} repo=\${{ inputs.source_repo }}"
        env:
          EVENT_TYPE: \${{ inputs.event_type }}
          SOURCE_REPO: \${{ inputs.source_repo }}
          EVENT_PAYLOAD: \${{ inputs.event_payload }}
`;

const onboardWorkflowContent = `# Repo onboarding workflow
# Creates enrollment PRs for repos listed in config.yaml.
name: Repo Onboard

on:
  push:
    branches: [main]
    paths: [config.yaml]

permissions:
  contents: write
  pull-requests: write

jobs:
  onboard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Read enabled repos
        id: repos
        run: |
          repos=$(yq '.repos | to_entries | map(select(.value.enabled == true)) | .[].key' config.yaml)
          echo "repos<<EOF" >> "$GITHUB_OUTPUT"
          echo "$repos" >> "$GITHUB_OUTPUT"
          echo "EOF" >> "$GITHUB_OUTPUT"
      - name: Create enrollment PRs
        run: echo "Would create enrollment PRs for enabled repos"
`;

export function codeownersForActor(githubLogin: string): string {
  return `# fullsend configuration is governed by org admins.
* @${githubLogin}
`;
}

export function workflowFileUtf8(path: string, githubLogin: string): string {
  switch (path) {
    case AGENT_WORKFLOW_PATH:
      return agentWorkflowContent;
    case ONBOARD_WORKFLOW_PATH:
      return onboardWorkflowContent;
    case CODEOWNERS_PATH:
      return codeownersForActor(githubLogin);
    default:
      throw new Error(`unknown managed workflow path: ${path}`);
  }
}
