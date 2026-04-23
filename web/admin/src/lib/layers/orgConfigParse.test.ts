import { describe, expect, it } from "vitest";
import { parseOrgConfigYaml, validateOrgConfig } from "./orgConfigParse";

describe("validateOrgConfig", () => {
  it("accepts minimal valid config", () => {
    const cfg = parseOrgConfigYaml(`version: "1"
dispatch:
  platform: github-actions
defaults:
  roles: [fullsend]
  max_implementation_retries: 0
repos: {}
`);
    expect(validateOrgConfig(cfg)).toBeNull();
  });

  it("rejects bad version", () => {
    expect(
      validateOrgConfig(
        parseOrgConfigYaml(`version: "9"
dispatch:
  platform: github-actions
`),
      ),
    ).toContain("unsupported version");
  });
});
