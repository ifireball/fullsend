import { describe, it, expect } from "vitest";
import { parseOrgConfigYaml } from "../layers/orgConfigParse";
import {
  classifyRepoUnionKind,
  filterRepoNamesBySearch,
  isRepoEnabledInConfig,
  repoNamesFromOrgConfig,
  sortedUnionRepoNames,
  uxRepoRowBucketFromUnionKind,
} from "./unionConfig";

const MINIMAL_VALID_YAML = `version: "1"
dispatch:
  platform: github-actions
`;

describe("repoNamesFromOrgConfig + union / R6 / R7", () => {
  it("R7: name in config but not on GitHub appears as config_only → R7 bucket", () => {
    const yaml = `${MINIMAL_VALID_YAML}repos:
  kept-on-github:
    enabled: true
  orphan-only-in-yaml:
    enabled: true
`;
    const cfg = parseOrgConfigYaml(yaml);
    const configSet = new Set(repoNamesFromOrgConfig(cfg));
    const githubSet = new Set(["kept-on-github"]);

    expect(classifyRepoUnionKind("orphan-only-in-yaml", githubSet, configSet)).toBe(
      "config_only",
    );
    expect(uxRepoRowBucketFromUnionKind("config_only")).toBe("R7");

    const union = sortedUnionRepoNames([...githubSet], [...configSet]);
    expect(union).toEqual(["kept-on-github", "orphan-only-in-yaml"]);
  });

  it("R6: on GitHub but not in config → github_only → R6 bucket", () => {
    const yaml = `${MINIMAL_VALID_YAML}repos:
  tracked:
    enabled: true
`;
    const cfg = parseOrgConfigYaml(yaml);
    const configSet = new Set(repoNamesFromOrgConfig(cfg));
    const githubSet = new Set(["tracked", "extra-service"]);

    expect(classifyRepoUnionKind("extra-service", githubSet, configSet)).toBe("github_only");
    expect(uxRepoRowBucketFromUnionKind("github_only")).toBe("R6");
  });

  it("managed: intersection is both", () => {
    const cfg = parseOrgConfigYaml(`${MINIMAL_VALID_YAML}repos:
  app:
    enabled: true
`);
    const configSet = new Set(repoNamesFromOrgConfig(cfg));
    const githubSet = new Set(["app"]);
    expect(classifyRepoUnionKind("app", githubSet, configSet)).toBe("both");
    expect(uxRepoRowBucketFromUnionKind("both")).toBe("managed");
  });

  it("disabled repo key still counts toward config set (not R6 when only on GitHub under same name)", () => {
    const yaml = `${MINIMAL_VALID_YAML}repos:
  dormant:
    enabled: false
`;
    const cfg = parseOrgConfigYaml(yaml);
    expect(isRepoEnabledInConfig(cfg, "dormant")).toBe(false);
    const configSet = new Set(repoNamesFromOrgConfig(cfg));
    const githubSet = new Set(["dormant"]);
    expect(classifyRepoUnionKind("dormant", githubSet, configSet)).toBe("both");
  });

  it("sortedUnionRepoNames dedupes and sorts", () => {
    expect(
      sortedUnionRepoNames(["zebra", "alpha", "alpha"], ["beta", "alpha"]),
    ).toEqual(["alpha", "beta", "zebra"]);
  });
});

describe("filterRepoNamesBySearch", () => {
  it("matches substring case-insensitively", () => {
    expect(filterRepoNamesBySearch(["FooBar", "baz"], "bar")).toEqual(["FooBar"]);
  });
});
