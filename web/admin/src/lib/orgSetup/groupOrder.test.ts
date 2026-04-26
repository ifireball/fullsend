import { describe, it, expect } from "vitest";
import {
  prerequisiteHint,
  sortGroupsForDisplay,
  type DepEdge,
} from "./groupOrder";

describe("prerequisiteHint", () => {
  const edges: DepEdge[] = [
    { group: "automation", requiresSatisfied: "apps_ready" },
    { group: "apps_ready", requiresSatisfied: "config_ok" },
  ];

  it("returns null when all predecessors satisfied", () => {
    expect(
      prerequisiteHint("automation", new Set(["config_ok", "apps_ready"]), edges),
    ).toBeNull();
  });

  it("returns first missing predecessor title for automation", () => {
    expect(
      prerequisiteHint("automation", new Set(["config_ok"]), edges),
    ).toMatch(/apps/i);
  });

  it("uses Complete … first wording", () => {
    const h = prerequisiteHint("automation", new Set(["config_ok"]), edges);
    expect(h).toMatch(/Complete/i);
    expect(h).toMatch(/first/i);
  });
});

describe("sortGroupsForDisplay", () => {
  it("orders dependencies before dependents", () => {
    const edges: DepEdge[] = [
      { group: "automation", requiresSatisfied: "app:a" },
      { group: "app:a", requiresSatisfied: "config_ok" },
    ];
    expect(
      sortGroupsForDisplay(["automation", "config_ok", "app:a"], edges),
    ).toEqual(["config_ok", "app:a", "automation"]);
  });

  it("throws when a cycle is present", () => {
    const edges: DepEdge[] = [
      { group: "a", requiresSatisfied: "b" },
      { group: "b", requiresSatisfied: "a" },
    ];
    expect(() => sortGroupsForDisplay(["a", "b"], edges)).toThrow(/cycle/i);
  });
});
