/**
 * Enrollment constants and shim body — aligned with
 * docs/normative/admin-install/v1/adr-0013-enrollment/SPEC.md §3–5
 * and internal/layers/enrollment.go shimWorkflowContent.
 */

export const ENROLLMENT_BRANCH = "fullsend/onboard";

export const ENROLLMENT_PR_TITLE = "Connect to fullsend agent pipeline";

/** SPEC §6 — body (exact Markdown, two paragraphs). */
export const ENROLLMENT_PR_BODY = `This PR adds a shim workflow that routes repository events to the fullsend agent dispatch workflow in the \`.fullsend\` config repo.

Once merged, issues, PRs, and comments in this repo will be handled by the fullsend agent pipeline.`;

export const ENROLLMENT_COMMIT_MESSAGE_ADD = "chore: add fullsend shim workflow";

export const ENROLLMENT_COMMIT_MESSAGE_UPDATE = "chore: update fullsend shim workflow";

/** SPEC §5 / Go shimWorkflowContent — byte-aligned YAML. */
export function shimWorkflowUtf8(): string {
  return [
    "# fullsend shim workflow",
    "# Routes events to the agent dispatch workflow in .fullsend.",
    "#",
    "# Security: pull_request_target runs the BASE branch version of this workflow,",
    "# preventing PRs from modifying it to exfiltrate the dispatch token.",
    "# This shim never checks out PR code, so it is not vulnerable to \"pwn request\"",
    "# attacks (see: Trivy CVE-2026-33634, hackerbot-claw campaign).",
    "name: fullsend",
    "",
    "on:",
    "  issues:",
    "    types: [opened, edited, labeled]",
    "  issue_comment:",
    "    types: [created]",
    "  pull_request_target:",
    "    types: [opened, synchronize, ready_for_review]",
    "  pull_request_review:",
    "    types: [submitted]",
    "",
    "jobs:",
    "  dispatch:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Dispatch to fullsend",
    "        env:",
    "          GH_TOKEN: ${{ secrets.FULLSEND_DISPATCH_TOKEN }}",
    "        run: |",
    "          gh workflow run agent.yaml \\",
    '            --repo "${{ github.repository_owner }}/.fullsend" \\',
    '            --field event_type="${{ github.event_name }}" \\',
    '            --field source_repo="${{ github.repository }}" \\',
    "            --field event_payload='${{ toJSON(github.event) }}'",
  ].join("\n") + "\n";
}
