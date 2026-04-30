import { describe, it, expect } from "vitest";
import { orgRowsAndSlugFromInstallations } from "./installationOrgRows";

describe("orgRowsAndSlugFromInstallations", () => {
  it("returns Organization accounts sorted by login and appSlug from app_slug", () => {
    const { orgs, appSlug } = orgRowsAndSlugFromInstallations([
      {
        account: { login: "zebra-org", type: "Organization" },
        app_slug: "my-github-app",
      },
      {
        account: { login: "alpha-org", type: "Organization" },
        app_slug: "my-github-app",
      },
    ]);
    expect(orgs.map((o) => o.login)).toEqual(["alpha-org", "zebra-org"]);
    expect(appSlug).toBe("my-github-app");
  });

  it("drops User installations", () => {
    const { orgs, appSlug } = orgRowsAndSlugFromInstallations([
      {
        account: { login: "alice", type: "User" },
        app_slug: "some-app",
      },
      {
        account: { login: "real-org", type: "Organization" },
        app_slug: "some-app",
      },
    ]);
    expect(orgs).toEqual([{ login: "real-org" }]);
    expect(appSlug).toBe("some-app");
  });

  it("dedupes the same org from two installation records", () => {
    const { orgs, appSlug } = orgRowsAndSlugFromInstallations([
      {
        account: { login: "dup-org", type: "Organization" },
        app_slug: "dedupe-app",
      },
      {
        account: { login: "dup-org", type: "Organization" },
        app_slug: "dedupe-app",
      },
    ]);
    expect(orgs).toEqual([{ login: "dup-org" }]);
    expect(appSlug).toBe("dedupe-app");
  });

  it("uses nested app.slug when app_slug is absent", () => {
    const { orgs, appSlug } = orgRowsAndSlugFromInstallations([
      {
        account: { login: "nested-org", type: "Organization" },
        app: { slug: "from-nested-slug" },
      },
    ]);
    expect(orgs).toEqual([{ login: "nested-org" }]);
    expect(appSlug).toBe("from-nested-slug");
  });
});
