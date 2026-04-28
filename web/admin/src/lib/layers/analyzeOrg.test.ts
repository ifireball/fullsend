import { describe, expect, it } from "vitest";
import type { LayerGithub } from "./githubClient";
import { analyzeOrgInstallRollupLayers, analyzeOrgLayers } from "./analyzeOrg";
import {
  AGENT_WORKFLOW_PATH,
  CODEOWNERS_PATH,
  CONFIG_FILE_PATH,
  CONFIG_REPO_NAME,
  ONBOARD_WORKFLOW_PATH,
  SHIM_WORKFLOW_PATH,
} from "./constants";
import { secretNameForRole, variableNameForRole } from "./secrets";

const validConfig = `version: "1"
dispatch:
  platform: github-actions
defaults:
  roles: [fullsend]
repos:
  r1:
    enabled: true
`;

function fullStackMock(): LayerGithub {
  return {
    getRepoExists: async (_o, repo) => repo === CONFIG_REPO_NAME,
    getRepoFileUtf8: async (org, repo, path) => {
      if (repo === CONFIG_REPO_NAME && path === CONFIG_FILE_PATH) return validConfig;
      if (repo === CONFIG_REPO_NAME)
        return [AGENT_WORKFLOW_PATH, ONBOARD_WORKFLOW_PATH, CODEOWNERS_PATH].includes(path)
          ? "ok"
          : null;
      if (repo === "r1" && path === SHIM_WORKFLOW_PATH) return "shim";
      return null;
    },
    repoSecretExists: async (_o, _r, name) => name === secretNameForRole("fullsend"),
    repoVariableExists: async (_o, _r, name) => name === variableNameForRole("fullsend"),
    orgSecretExists: async () => ({ kind: "ok", exists: true }),
  };
}

describe("analyzeOrgInstallRollupLayers", () => {
  it("returns installed rollup without per-repo enrollment calls", async () => {
    const gh = fullStackMock();
    const { reports, rollup } = await analyzeOrgInstallRollupLayers({
      org: "acme",
      gh,
      agents: [{ role: "fullsend" }],
    });
    expect(reports).toHaveLength(4);
    expect(reports.map((r) => r.name)).toEqual([
      "config-repo",
      "workflows",
      "secrets",
      "dispatch-token",
    ]);
    expect(rollup).toBe("installed");
  });

  it("stays installed when enrollment would be not_installed (shim missing on r1)", async () => {
    const gh: LayerGithub = {
      getRepoExists: async (_o, repo) => repo === CONFIG_REPO_NAME,
      getRepoFileUtf8: async (_org, repo, path) => {
        if (repo === CONFIG_REPO_NAME && path === CONFIG_FILE_PATH) return validConfig;
        if (repo === CONFIG_REPO_NAME) {
          return [AGENT_WORKFLOW_PATH, ONBOARD_WORKFLOW_PATH, CODEOWNERS_PATH].includes(path)
            ? "ok"
            : null;
        }
        return null;
      },
      repoSecretExists: async (_o, _r, name) => name === secretNameForRole("fullsend"),
      repoVariableExists: async (_o, _r, name) => name === variableNameForRole("fullsend"),
      orgSecretExists: async () => ({ kind: "ok", exists: true }),
    };
    const { rollup: rollupInstall } = await analyzeOrgInstallRollupLayers({
      org: "acme",
      gh,
      agents: [{ role: "fullsend" }],
    });
    const { rollup: rollupFull } = await analyzeOrgLayers({
      org: "acme",
      gh,
      agents: [{ role: "fullsend" }],
      enabledRepos: ["r1"],
    });
    expect(rollupInstall).toBe("installed");
    expect(rollupFull).toBe("not_installed");
  });
});

describe("analyzeOrgLayers", () => {
  it("returns installed rollup when mock stack is healthy", async () => {
    const { reports, rollup } = await analyzeOrgLayers({
      org: "acme",
      gh: fullStackMock(),
      agents: [{ role: "fullsend" }],
      enabledRepos: ["r1"],
    });
    expect(reports).toHaveLength(5);
    expect(reports.map((r) => r.name)).toEqual([
      "config-repo",
      "workflows",
      "secrets",
      "enrollment",
      "dispatch-token",
    ]);
    expect(rollup).toBe("installed");
  });
});
