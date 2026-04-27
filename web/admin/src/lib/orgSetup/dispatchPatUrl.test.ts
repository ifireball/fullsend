import { describe, it, expect } from "vitest";
import { buildDispatchPatCreationUrl } from "./dispatchPatUrl";

describe("buildDispatchPatCreationUrl", () => {
  it("includes org name and actions scope", () => {
    const u = buildDispatchPatCreationUrl("acme-corp");
    expect(u).toContain("github.com/settings/personal-access-tokens/new");
    expect(u).toContain(encodeURIComponent("acme-corp"));
    expect(u).toContain("actions=write");
  });
});
