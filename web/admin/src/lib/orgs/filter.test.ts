import { describe, it, expect } from "vitest";
import { filterOrgsByPrefix } from "./filter";

describe("filterOrgsByPrefix", () => {
  it("is case-insensitive prefix", () => {
    expect(
      filterOrgsByPrefix([{ login: "Alpha" }, { login: "beta" }], "a").map(
        (o) => o.login,
      ),
    ).toEqual(["Alpha"]);
  });
});
