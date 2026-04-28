import { describe, it, expect, vi, afterEach } from "vitest";
import { RequestError } from "@octokit/request-error";
import type { Octokit } from "@octokit/rest";
import {
  buildOrgSetupGroups,
  githubOrgAppSettingsUrl,
  installationRecordAppSlug,
  setupBoardTitlesFromAgents,
} from "./buildOrgSetupGroups";
import type { LayerReport } from "../status/types";
import * as setupStorage from "./setupStorage";

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

function notFoundError(): RequestError {
  return new RequestError("Not Found", 404, {
    request: { method: "GET", url: "https://api.github.com/test", headers: {} },
  });
}

function mockOctokit(opts: {
  installationSlugs?: string[];
  slugProbe?: "exists" | "missing" | "inconclusive";
}): Octokit {
  const installationSlugs = opts.installationSlugs ?? [];
  const slugProbe = opts.slugProbe ?? "missing";
  return {
    rest: {
      orgs: {
        listAppInstallations: vi.fn().mockResolvedValue({
          data: installationSlugs.map((slug) => ({ app_slug: slug })),
        }),
      },
      apps: {
        getBySlug: vi.fn().mockImplementation(async () => {
          if (slugProbe === "missing") throw notFoundError();
          if (slugProbe === "inconclusive") {
            throw new RequestError("Forbidden", 403, {
              request: {
                method: "GET",
                url: "https://api.github.com/test",
                headers: {},
              },
            });
          }
          return { data: { slug: "app" } };
        }),
      },
    },
  } as unknown as Octokit;
}

const baseGh = {
  getRepoExists: vi.fn().mockResolvedValue(false),
  getRepoFileUtf8: vi.fn(),
  repoSecretExists: vi.fn().mockResolvedValue(false),
  repoVariableExists: vi.fn().mockResolvedValue(false),
  orgSecretExists: vi.fn(),
};

const ghWithRepoSecrets = {
  ...baseGh,
  getRepoExists: vi.fn().mockResolvedValue(true),
  repoSecretExists: vi.fn().mockResolvedValue(true),
  repoVariableExists: vi.fn().mockResolvedValue(true),
};

describe("installationRecordAppSlug", () => {
  it("reads app_slug when REST omits nested app.slug", () => {
    expect(installationRecordAppSlug({ app_slug: "seaci-coder" })).toBe("seaci-coder");
  });

  it("prefers nested app.slug when both are present", () => {
    expect(
      installationRecordAppSlug({ app: { slug: "from-nested" }, app_slug: "from-flat" }),
    ).toBe("from-nested");
  });

  it("returns null when neither slug is usable", () => {
    expect(installationRecordAppSlug({})).toBeNull();
    expect(installationRecordAppSlug({ app_slug: "   " })).toBeNull();
  });
});

describe("githubOrgAppSettingsUrl", () => {
  it("builds the organisation GitHub App settings path", () => {
    expect(githubOrgAppSettingsUrl("seaci", "seaci-coder")).toBe(
      "https://github.com/organizations/seaci/settings/apps/seaci-coder",
    );
  });
});

describe("setupBoardTitlesFromAgents", () => {
  it("returns app titles sorted by role then dispatch and fullsend cards", () => {
    expect(
      setupBoardTitlesFromAgents([{ role: "coder" }, { role: "review" }]),
    ).toEqual([
      "Coder GitHub App",
      "Review GitHub App",
      "Dispatch token",
      ".fullsend repository setup",
    ]);
  });

  it("dedupes duplicate roles", () => {
    expect(setupBoardTitlesFromAgents([{ role: "coder" }, { role: "coder" }])).toEqual([
      "Coder GitHub App",
      "Dispatch token",
      ".fullsend repository setup",
    ]);
  });

  it("omits app cards when there are no agent roles", () => {
    expect(setupBoardTitlesFromAgents([])).toEqual([
      "Dispatch token",
      ".fullsend repository setup",
    ]);
  });
});

describe("buildOrgSetupGroups", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers paste token on dispatch row when org secret is not installed", async () => {
    const reports: LayerReport[] = [
      rep("config-repo", "installed"),
      rep("workflows", "installed"),
      rep("secrets", "not_installed"),
      rep("dispatch-token", "not_installed"),
    ];
    const octokit = mockOctokit({
      installationSlugs: [],
      slugProbe: "exists",
    });
    const groups = await buildOrgSetupGroups({
      org: "myorg",
      actorLogin: "alice",
      octokit,
      gh: ghWithRepoSecrets as never,
      reports,
      agents: [{ role: "coder" }],
      parsedConfig: null,
      greenfieldDeploy: false,
    });
    const dispatch = groups.find((g) => g.id === "dispatch_pat");
    const tokenLine = dispatch?.itemLines.find((li) => li.id === "item_dispatch_token");
    expect(tokenLine?.trailingAction).toEqual({
      kind: "open_dispatch_token_paste",
      label: "Paste token",
    });
  });

  it("re-reads org installations until two consecutive list responses match", async () => {
    const listAppInstallations = vi
      .fn()
      .mockResolvedValueOnce({
        data: { installations: [] as { app_slug: string }[], total_count: 0 },
      })
      .mockResolvedValueOnce({
        data: {
          installations: [{ app_slug: "myorg-coder" }],
          total_count: 1,
        },
      })
      .mockResolvedValue({
        data: {
          installations: [{ app_slug: "myorg-coder" }],
          total_count: 1,
        },
      });
    const octokit = {
      rest: {
        orgs: { listAppInstallations },
        apps: {
          getBySlug: vi.fn().mockResolvedValue({ data: { slug: "myorg-coder" } }),
        },
      },
    } as unknown as Octokit;
    const reports: LayerReport[] = [
      rep("config-repo", "installed"),
      rep("workflows", "installed"),
      rep("secrets", "not_installed"),
      rep("dispatch-token", "not_installed"),
    ];
    const groups = await buildOrgSetupGroups({
      org: "myorg",
      actorLogin: "alice",
      octokit,
      gh: ghWithRepoSecrets as never,
      reports,
      agents: [{ role: "coder" }],
      parsedConfig: null,
      greenfieldDeploy: false,
    });
    const installLine = groups
      .find((g) => g.kind === "github_app")
      ?.itemLines.find((li) => li.id === "item_app_install");
    expect(installLine?.label).toBe("Installed on myorg");
    expect(listAppInstallations).toHaveBeenCalledTimes(3);
  });

  it("includes dispatch token and .fullsend setup cards after app cards", async () => {
    const reports: LayerReport[] = [
      rep("config-repo", "installed"),
      rep("workflows", "installed", {
        details: ["All workflow files present."],
        wouldFix: ["Would refresh dispatch inputs."],
      }),
      rep("secrets", "installed"),
      rep("enrollment", "not_installed"),
      rep("dispatch-token", "installed", {
        details: ["FULLSEND_DISPATCH_TOKEN org secret exists"],
      }),
    ];
    const agents = [{ role: "coder" }, { role: "review" }];
    const slug = "myorg-coder";
    const octokit = mockOctokit({
      installationSlugs: [slug, "myorg-review"],
      slugProbe: "exists",
    });
    const groups = await buildOrgSetupGroups({
      org: "myorg",
      actorLogin: "alice",
      octokit,
      gh: ghWithRepoSecrets as never,
      reports,
      agents,
      parsedConfig: null,
      greenfieldDeploy: false,
    });

    const kinds = groups.map((g) => g.kind);
    expect(kinds.filter((k) => k === "github_app")).toHaveLength(2);
    expect(kinds).toContain("dispatch_pat");
    expect(kinds).toContain("fullsend_repo_setup");
    const lastAppIdx = groups.map((g) => g.kind).lastIndexOf("github_app");
    const dispatchIdx = groups.findIndex((g) => g.kind === "dispatch_pat");
    const fullsendIdx = groups.findIndex((g) => g.kind === "fullsend_repo_setup");
    expect(dispatchIdx).toBeGreaterThan(lastAppIdx);
    expect(fullsendIdx).toBeGreaterThan(dispatchIdx);

    const coderInstall = groups
      .find((g) => g.id === "github_app:coder")
      ?.itemLines.find((li) => li.id === "item_app_install");
    expect(coderInstall?.label).toMatch(/^Installed on /);
    expect(coderInstall?.trailingAction).toBeUndefined();

    const fullsend = groups.find((g) => g.id === "fullsend_repo_setup");
    expect(fullsend?.title).toBe(".fullsend repository setup");
    const joined = (fullsend?.itemLines ?? []).map((l) => l.label).join("\n");
    expect(joined).toMatch(/Workflow files/i);
    expect(joined).toMatch(/Would refresh dispatch inputs/i);
  });

  it("puts installation-list API failure on the install row, not the card subtitle (ga_need_create)", async () => {
    const reports: LayerReport[] = [
      rep("config-repo", "not_installed"),
      rep("workflows", "not_installed"),
      rep("secrets", "not_installed"),
      rep("dispatch-token", "not_installed"),
    ];
    const octokit = {
      rest: {
        orgs: {
          listAppInstallations: vi.fn().mockRejectedValue(notFoundError()),
        },
        apps: {
          getBySlug: vi.fn().mockRejectedValue(notFoundError()),
        },
      },
    } as unknown as Octokit;
    const groups = await buildOrgSetupGroups({
      org: "myorg",
      actorLogin: "alice",
      octokit,
      gh: baseGh as never,
      reports,
      agents: [{ role: "coder" }],
      parsedConfig: null,
      greenfieldDeploy: true,
    });
    const app = groups.find((g) => g.kind === "github_app");
    expect(app?.subtitle).toMatch(/No app registered/i);
    expect(app?.subtitle).not.toMatch(/Could not list organisation app installations/i);
    expect(app?.primary?.label).toBe("Create app on GitHub");
    const installLine = app?.itemLines.find((li) => li.id === "item_app_install");
    expect(installLine?.lineTone).toBe("unknown");
    expect(installLine?.label).toBe("Install status on myorg — unknown");
    expect(installLine?.detail).toMatch(/cannot list organisation app installations/i);
    expect(installLine?.trailingAction).toBeUndefined();
  });

  it("shows ga_need_install when the app slug exists but org install listing is forbidden", async () => {
    const reports: LayerReport[] = [
      rep("config-repo", "not_installed"),
      rep("workflows", "not_installed"),
      rep("secrets", "not_installed"),
      rep("dispatch-token", "not_installed"),
    ];
    const octokit = {
      rest: {
        orgs: {
          listAppInstallations: vi.fn().mockRejectedValue(notFoundError()),
        },
        apps: {
          getBySlug: vi.fn().mockResolvedValue({ data: { slug: "myorg-coder" } }),
        },
      },
    } as unknown as Octokit;
    const groups = await buildOrgSetupGroups({
      org: "myorg",
      actorLogin: "alice",
      octokit,
      gh: baseGh as never,
      reports,
      agents: [{ role: "coder" }],
      parsedConfig: null,
      greenfieldDeploy: true,
    });
    const app = groups.find((g) => g.kind === "github_app");
    expect(app?.subtitle).toMatch(/not installed on this organisation/i);
    expect(app?.subtitle).not.toMatch(/No app registered/i);
    expect(app?.primary?.label).toBe("Install app on Organisation");
    expect(
      app?.itemLines.find((li) => li.id === "item_app_install")?.trailingAction,
    ).toEqual({ kind: "recheck_org_app_installs", label: "Recheck" });
  });

  it("shows need-install guidance when credentials are saved but slug probe is missing and listing is forbidden", async () => {
    const reports: LayerReport[] = [
      rep("config-repo", "not_installed"),
      rep("workflows", "not_installed"),
      rep("secrets", "not_installed"),
      rep("dispatch-token", "not_installed"),
    ];
    const octokit = {
      rest: {
        orgs: {
          listAppInstallations: vi.fn().mockRejectedValue(notFoundError()),
        },
        apps: {
          getBySlug: vi.fn().mockRejectedValue(notFoundError()),
        },
      },
    } as unknown as Octokit;
    vi.spyOn(setupStorage, "readStagedAppPemPresent").mockReturnValue(true);
    const groups = await buildOrgSetupGroups({
      org: "myorg",
      actorLogin: "alice",
      octokit,
      gh: baseGh as never,
      reports,
      agents: [{ role: "coder" }],
      parsedConfig: null,
      greenfieldDeploy: true,
    });
    const app = groups.find((g) => g.kind === "github_app");
    expect(app?.subtitle).toMatch(/cannot confirm install status via the API/i);
    expect(app?.subtitle).not.toMatch(/No app registered/i);
    expect(app?.primary?.label).toBe("Install app on Organisation");
    expect(
      app?.itemLines.find((li) => li.id === "item_app_install")?.trailingAction,
    ).toEqual({ kind: "recheck_org_app_installs", label: "Recheck" });
  });

  it("adds org settings link on app name when PEM is saved but GET /apps slug is missing", async () => {
    const reports: LayerReport[] = [
      rep("config-repo", "not_installed"),
      rep("workflows", "not_installed"),
      rep("secrets", "not_installed"),
      rep("dispatch-token", "not_installed"),
    ];
    const octokit = mockOctokit({ slugProbe: "missing" });
    vi.spyOn(setupStorage, "readStagedAppPemPresent").mockReturnValue(true);
    vi.spyOn(setupStorage, "readStagedAppMeta").mockReturnValue({
      slug: "seaci-coder",
      displayName: "Seaci Coder",
    });
    const groups = await buildOrgSetupGroups({
      org: "seaci",
      actorLogin: "alice",
      octokit,
      gh: baseGh as never,
      reports,
      agents: [{ role: "coder" }],
      parsedConfig: null,
      greenfieldDeploy: true,
    });
    const nameLine = groups
      .find((g) => g.kind === "github_app")
      ?.itemLines.find((li) => li.id === "item_app_name");
    expect(nameLine?.lineTone).toBe("ok");
    expect(nameLine?.label).toMatch(/\(cannot confirm\)/);
    expect(nameLine?.detail).toMatch(/GET \/apps/i);
    expect(nameLine?.detailLinkHref).toBe(
      "https://github.com/organizations/seaci/settings/apps/seaci-coder",
    );
    expect(nameLine?.detailLinkLabel).toMatch(/organisation settings/i);
    const app = groups.find((g) => g.kind === "github_app");
    expect(app?.subtitle).toBe(
      "App exists but is not installed on this organisation. Install it, then return here.",
    );
  });

  it("labels install row as not installed when listing works and app is absent", async () => {
    const reports: LayerReport[] = [
      rep("config-repo", "installed"),
      rep("workflows", "installed"),
      rep("secrets", "not_installed"),
      rep("dispatch-token", "not_installed"),
    ];
    const octokit = mockOctokit({
      installationSlugs: [],
      slugProbe: "exists",
    });
    const groups = await buildOrgSetupGroups({
      org: "myorg",
      actorLogin: "alice",
      octokit,
      gh: baseGh as never,
      reports,
      agents: [{ role: "coder" }],
      parsedConfig: null,
      greenfieldDeploy: false,
    });
    const installLine = groups
      .find((g) => g.kind === "github_app")
      ?.itemLines.find((li) => li.id === "item_app_install");
    expect(installLine?.label).toBe("Not installed on myorg");
    expect(installLine?.detail).toBeNull();
    expect(installLine?.lineTone).toBe("unknown");
    expect(installLine?.trailingAction).toEqual({
      kind: "recheck_org_app_installs",
      label: "Recheck",
    });
  });

  it("offers Create app on GitHub when slug probe is missing (greenfield)", async () => {
    const reports: LayerReport[] = [
      rep("config-repo", "not_installed"),
      rep("workflows", "not_installed"),
      rep("secrets", "not_installed"),
      rep("dispatch-token", "not_installed"),
    ];
    const octokit = mockOctokit({ slugProbe: "missing" });
    const groups = await buildOrgSetupGroups({
      org: "myorg",
      actorLogin: "alice",
      octokit,
      gh: baseGh as never,
      reports,
      agents: [{ role: "coder" }],
      parsedConfig: null,
      greenfieldDeploy: true,
    });
    const app = groups.find((g) => g.kind === "github_app");
    expect(app?.primary?.label).toBe("Create app on GitHub");
    expect(app?.primary?.disabled).not.toBe(true);
    const nameLine = app?.itemLines.find((li) => li.id === "item_app_name");
    expect(nameLine?.label).toMatch(/needs to be created on GitHub/i);
    expect(app?.itemLines.find((li) => li.id === "item_app_install")?.trailingAction).toBeUndefined();
  });

  it("blocks .fullsend setup until apps and dispatch are satisfied", async () => {
    const reports: LayerReport[] = [
      rep("config-repo", "not_installed"),
      rep("workflows", "not_installed"),
      rep("secrets", "not_installed"),
      rep("dispatch-token", "not_installed"),
    ];
    const octokit = mockOctokit({ slugProbe: "missing" });
    const groups = await buildOrgSetupGroups({
      org: "myorg",
      actorLogin: "alice",
      octokit,
      gh: baseGh as never,
      reports,
      agents: [{ role: "coder" }, { role: "review" }],
      parsedConfig: null,
      greenfieldDeploy: true,
    });
    const fullsend = groups.find((g) => g.id === "fullsend_repo_setup");
    expect(fullsend?.primary).toBeNull();
    expect(fullsend?.subtitle).toMatch(/Complete/i);
    expect(fullsend?.subtitle).toMatch(/Dispatch token/i);
  });

  it("enables Install on .fullsend when prerequisites are satisfied", async () => {
    const slug = "myorg-coder";
    const reports: LayerReport[] = [
      rep("config-repo", "installed"),
      rep("workflows", "not_installed"),
      rep("secrets", "installed"),
      rep("dispatch-token", "installed"),
    ];
    const octokit = mockOctokit({
      installationSlugs: [slug],
      slugProbe: "exists",
    });
    const groups = await buildOrgSetupGroups({
      org: "myorg",
      actorLogin: "alice",
      octokit,
      gh: ghWithRepoSecrets as never,
      reports,
      agents: [{ role: "coder" }],
      parsedConfig: null,
      greenfieldDeploy: false,
    });
    const fullsend = groups.find((g) => g.id === "fullsend_repo_setup");
    expect(fullsend?.primary?.label).toBe("Install");
    expect(fullsend?.primary?.disabled).not.toBe(true);
    expect(fullsend?.subtitle).toMatch(/Apply changes/i);
    expect(fullsend?.itemLines.find((li) => li.id === "item_fullsend_apply_cli")).toBeUndefined();
  });

  it("offers Install app on Organisation when app exists but is not installed", async () => {
    const reports: LayerReport[] = [
      rep("config-repo", "installed"),
      rep("workflows", "installed"),
      rep("secrets", "not_installed"),
      rep("dispatch-token", "not_installed"),
    ];
    const octokit = mockOctokit({
      installationSlugs: [],
      slugProbe: "exists",
    });
    const groups = await buildOrgSetupGroups({
      org: "myorg",
      actorLogin: "alice",
      octokit,
      gh: baseGh as never,
      reports,
      agents: [{ role: "coder" }],
      parsedConfig: null,
      greenfieldDeploy: false,
    });
    const app = groups.find((g) => g.kind === "github_app");
    expect(app?.primary?.label).toBe("Install app on Organisation");
  });

  it("disables GitHub App actions until config exists when not greenfield", async () => {
    const reports: LayerReport[] = [
      rep("config-repo", "not_installed"),
      rep("workflows", "not_installed"),
    ];
    const octokit = mockOctokit({ slugProbe: "missing" });
    const groups = await buildOrgSetupGroups({
      org: "myorg",
      actorLogin: "alice",
      octokit,
      gh: baseGh as never,
      reports,
      agents: [{ role: "coder" }],
      parsedConfig: null,
      greenfieldDeploy: false,
    });
    const app = groups.find((g) => g.kind === "github_app");
    expect(app?.primary).toBeNull();
    expect(app?.prerequisiteHint).not.toBeNull();
  });
});
