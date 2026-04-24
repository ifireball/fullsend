import { describe, it, expect } from "vitest";
import { filterOrgsBySearch } from "./filter";

describe("filterOrgsBySearch", () => {
  it("matches prefix case-insensitively", () => {
    expect(
      filterOrgsBySearch(
        [
          { login: "Alpha", hasWritePathInOrg: true, membershipCanCreateRepository: null },
          { login: "bee", hasWritePathInOrg: false, membershipCanCreateRepository: null },
        ],
        "a",
      ).map((o) => o.login),
    ).toEqual(["Alpha"]);
  });

  it("matches substring anywhere in login", () => {
    expect(
      filterOrgsBySearch(
        [
          { login: "foo-bar-org", hasWritePathInOrg: true, membershipCanCreateRepository: null },
          { login: "other", hasWritePathInOrg: true, membershipCanCreateRepository: null },
        ],
        "bar",
      ).map((o) => o.login),
    ).toEqual(["foo-bar-org"]);
  });

  it("sorts alphabetically when query is empty", () => {
    expect(
      filterOrgsBySearch(
        [
          { login: "z", hasWritePathInOrg: true, membershipCanCreateRepository: null },
          { login: "a", hasWritePathInOrg: true, membershipCanCreateRepository: null },
        ],
        "",
      ).map((o) => o.login),
    ).toEqual(["a", "z"]);
  });
});
