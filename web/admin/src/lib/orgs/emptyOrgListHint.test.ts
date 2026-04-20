import { describe, it, expect } from "vitest";
import { buildEmptyOrgsFromReposHint } from "./emptyOrgListHint";

describe("buildEmptyOrgsFromReposHint", () => {
  it("explains non-200 from repo listing", () => {
    const h = buildEmptyOrgsFromReposHint(0, 0, 502, {});
    expect(h).toMatch(/502/);
    expect(h).toMatch(/user\/repos/);
  });

  it("hints classic repo scope when repos are empty but scopes omit repo", () => {
    const h = buildEmptyOrgsFromReposHint(0, 0, 200, {
      "x-oauth-scopes": "read:org",
    });
    expect(h).toMatch(/repo/);
    expect(h).toMatch(/read:org/);
  });

  it("returns generic no-repos when scopes absent", () => {
    const h = buildEmptyOrgsFromReposHint(0, 0, 200, {});
    expect(h).toMatch(/No repositories/);
    expect(h).toMatch(/GET \/user\/repos/);
  });

  it("explains personal-account-only repos", () => {
    const h = buildEmptyOrgsFromReposHint(3, 0, 200, {});
    expect(h).toMatch(/personal account/);
  });

  it("returns null when org owners exist", () => {
    expect(buildEmptyOrgsFromReposHint(5, 2, 200, {})).toBeNull();
  });
});
