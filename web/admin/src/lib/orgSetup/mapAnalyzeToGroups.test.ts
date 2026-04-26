import { describe, it, expect } from "vitest";
import type { LayerReport } from "../status/types";
import { mapAnalyzeToGroups } from "./mapAnalyzeToGroups";

function rep(
  name: string,
  status: LayerReport["status"],
  partial?: Partial<Pick<LayerReport, "details" | "wouldFix">>,
): LayerReport {
  return {
    name,
    status,
    details: partial?.details ?? [],
    wouldInstall: [],
    wouldFix: partial?.wouldFix ?? [],
  };
}

describe("mapAnalyzeToGroups", () => {
  it("creates two github_app groups and one automation group with layer text", () => {
    const reports: LayerReport[] = [
      rep("config-repo", "installed"),
      rep("workflows", "installed", {
        details: ["All workflow files present."],
        wouldFix: ["Would refresh dispatch inputs."],
      }),
    ];
    const agents = [{ role: "coder" }, { role: "reviewer" }];
    const groups = mapAnalyzeToGroups(reports, agents);

    const apps = groups.filter((g) => g.kind === "github_app");
    const auto = groups.find((g) => g.kind === "automation");

    expect(apps).toHaveLength(2);
    expect(apps.some((g) => /coder/i.test(g.title))).toBe(true);
    expect(apps.some((g) => /reviewer/i.test(g.title))).toBe(true);

    expect(auto).toBeDefined();
    const joined = (auto?.itemLines ?? []).join("\n");
    expect(joined).toMatch(/workflows/i);
    expect(joined).toMatch(/Would refresh dispatch inputs/i);
  });

  it("disables automation primary when config repo is not installed", () => {
    const reports: LayerReport[] = [
      rep("config-repo", "not_installed"),
      rep("workflows", "not_installed"),
    ];
    const groups = mapAnalyzeToGroups(reports, [{ role: "coder" }]);
    const auto = groups.find((g) => g.kind === "automation");
    expect(auto?.primary.disabled).toBe(true);
    expect(auto?.prerequisiteHint).not.toBeNull();
  });
});
