import { describe, it, expect } from "vitest";
import { ENROLLMENT_PR_BODY, ENROLLMENT_PR_TITLE, shimWorkflowUtf8 } from "./shimWorkflow";

describe("shimWorkflow", () => {
  it("PR title matches normative enrollment SPEC §6", () => {
    expect(ENROLLMENT_PR_TITLE).toBe("Connect to fullsend agent pipeline");
  });

  it("PR body matches SPEC §6 (two paragraphs, .fullsend in backticks)", () => {
    expect(ENROLLMENT_PR_BODY).toBe(
      "This PR adds a shim workflow that routes repository events to the fullsend agent dispatch workflow in the `.fullsend` config repo.\n\nOnce merged, issues, PRs, and comments in this repo will be handled by the fullsend agent pipeline.",
    );
  });

  it("shim YAML contains required dispatch wiring", () => {
    const y = shimWorkflowUtf8();
    expect(y).toContain("name: fullsend");
    expect(y).toContain("FULLSEND_DISPATCH_TOKEN");
    expect(y).toContain("gh workflow run agent.yaml");
    expect(y).toContain("${{ github.repository_owner }}/.fullsend");
    expect(y).toContain("pull_request_target");
  });
});
