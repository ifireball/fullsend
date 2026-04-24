import { describe, expect, it } from "vitest";
import { computePreflight } from "../layers/preflight";
import type { LayerReport } from "../status/types";
import { deployRequiredOAuthScopes } from "./deployOAuthScopes";
import {
  buildDeployPreflight,
  orgListRowFromAnalysis,
  type OrgListAnalysisErr,
  type OrgListAnalysisOk,
  type OrgListDeployRowContext,
} from "./orgListRow";

const writeMemberNull: OrgListDeployRowContext = {
  hasWritePathInOrg: true,
  membershipCanCreateRepository: null,
};
const readOnlyMemberNull: OrgListDeployRowContext = {
  hasWritePathInOrg: false,
  membershipCanCreateRepository: null,
};
const memberCannotCreateRepo: OrgListDeployRowContext = {
  hasWritePathInOrg: true,
  membershipCanCreateRepository: false,
};

function preflightAllGranted() {
  return computePreflight([...deployRequiredOAuthScopes()], [
    "repo",
    "workflow",
    "admin:org",
  ]);
}

function rep(
  name: string,
  status: LayerReport["status"],
): LayerReport {
  return {
    name,
    status,
    details: [],
    wouldInstall: [],
    wouldFix: [],
  };
}

describe("orgListRowFromAnalysis", () => {
  it("cannot_deploy on forbidden error", () => {
    const err: OrgListAnalysisErr = {
      kind: "error",
      message: "no access",
      forbidden: true,
    };
    expect(orgListRowFromAnalysis(err, preflightAllGranted(), writeMemberNull)).toEqual({
      kind: "cannot_deploy",
      reason: "no access",
    });
  });

  it("error on non-forbidden failure", () => {
    const err: OrgListAnalysisErr = {
      kind: "error",
      message: "network",
      forbidden: false,
    };
    expect(orgListRowFromAnalysis(err, preflightAllGranted(), writeMemberNull)).toEqual({
      kind: "error",
      message: "network",
    });
  });

  it("deploy when config repo not installed and OAuth preflight ok", () => {
    const ok: OrgListAnalysisOk = {
      kind: "ok",
      rollup: "not_installed",
      reports: [
        rep("config-repo", "not_installed"),
        rep("workflows", "not_installed"),
        rep("secrets", "not_installed"),
        rep("enrollment", "installed"),
        rep("dispatch-token", "not_installed"),
      ],
    };
    expect(orgListRowFromAnalysis(ok, preflightAllGranted(), writeMemberNull)).toEqual({
      kind: "deploy",
    });
  });

  it("cannot_deploy when GitHub membership says user cannot create org repositories", () => {
    const ok: OrgListAnalysisOk = {
      kind: "ok",
      rollup: "not_installed",
      reports: [
        rep("config-repo", "not_installed"),
        rep("workflows", "not_installed"),
        rep("secrets", "not_installed"),
        rep("enrollment", "installed"),
        rep("dispatch-token", "not_installed"),
      ],
    };
    const row = orgListRowFromAnalysis(ok, preflightAllGranted(), memberCannotCreateRepo);
    expect(row.kind).toBe("cannot_deploy");
    if (row.kind === "cannot_deploy") {
      expect(row.reason).toContain("creating new repositories");
      expect(row.helpBullets?.length).toBeGreaterThan(0);
    }
  });

  it("cannot_deploy when config not installed but OAuth scopes missing", () => {
    const ok: OrgListAnalysisOk = {
      kind: "ok",
      rollup: "not_installed",
      reports: [
        rep("config-repo", "not_installed"),
        rep("workflows", "not_installed"),
        rep("secrets", "not_installed"),
        rep("enrollment", "installed"),
        rep("dispatch-token", "not_installed"),
      ],
    };
    const pf = computePreflight([...deployRequiredOAuthScopes()], ["repo"]);
    const row = orgListRowFromAnalysis(ok, pf, writeMemberNull);
    expect(row.kind).toBe("cannot_deploy");
    if (row.kind === "cannot_deploy") {
      expect(row.helpBullets?.length).toBeGreaterThanOrEqual(2);
      expect(row.reason).toContain("does not include all of the GitHub access");
    }
  });

  it("deploy when preflight skipped and membership grants repo creation", () => {
    const ok: OrgListAnalysisOk = {
      kind: "ok",
      rollup: "not_installed",
      reports: [
        rep("config-repo", "not_installed"),
        rep("workflows", "not_installed"),
        rep("secrets", "not_installed"),
        rep("enrollment", "installed"),
        rep("dispatch-token", "not_installed"),
      ],
    };
    const pf = buildDeployPreflight(null);
    expect(pf.skipped).toBe(true);
    expect(
      orgListRowFromAnalysis(ok, pf, {
        hasWritePathInOrg: false,
        membershipCanCreateRepository: true,
      }),
    ).toEqual({ kind: "deploy" });
  });

  it("deploy when preflight skipped, membership unknown, and repos have write path", () => {
    const ok: OrgListAnalysisOk = {
      kind: "ok",
      rollup: "not_installed",
      reports: [
        rep("config-repo", "not_installed"),
        rep("workflows", "not_installed"),
        rep("secrets", "not_installed"),
        rep("enrollment", "installed"),
        rep("dispatch-token", "not_installed"),
      ],
    };
    const pf = buildDeployPreflight(null);
    expect(orgListRowFromAnalysis(ok, pf, writeMemberNull)).toEqual({ kind: "deploy" });
  });

  it("cannot_deploy when preflight skipped, membership unknown, and repos look read-only", () => {
    const ok: OrgListAnalysisOk = {
      kind: "ok",
      rollup: "not_installed",
      reports: [
        rep("config-repo", "not_installed"),
        rep("workflows", "not_installed"),
        rep("secrets", "not_installed"),
        rep("enrollment", "installed"),
        rep("dispatch-token", "not_installed"),
      ],
    };
    const pf = buildDeployPreflight(null);
    const row = orgListRowFromAnalysis(ok, pf, readOnlyMemberNull);
    expect(row.kind).toBe("cannot_deploy");
    if (row.kind === "cannot_deploy") {
      expect(row.reason).toContain("cannot confirm");
      expect(row.helpBullets?.length).toBeGreaterThan(0);
    }
  });

  it("configure when config repo exists (installed)", () => {
    const ok: OrgListAnalysisOk = {
      kind: "ok",
      rollup: "degraded",
      reports: [
        rep("config-repo", "installed"),
        rep("workflows", "degraded"),
        rep("secrets", "not_installed"),
        rep("enrollment", "installed"),
        rep("dispatch-token", "not_installed"),
      ],
    };
    expect(orgListRowFromAnalysis(ok, preflightAllGranted(), writeMemberNull)).toEqual({
      kind: "configure",
    });
  });

  it("configure when config repo degraded", () => {
    const ok: OrgListAnalysisOk = {
      kind: "ok",
      rollup: "degraded",
      reports: [
        rep("config-repo", "degraded"),
        rep("workflows", "not_installed"),
        rep("secrets", "not_installed"),
        rep("enrollment", "installed"),
        rep("dispatch-token", "not_installed"),
      ],
    };
    expect(orgListRowFromAnalysis(ok, preflightAllGranted(), writeMemberNull)).toEqual({
      kind: "configure",
    });
  });

  it("configure when scopes missing but config already present (no deploy gate)", () => {
    const ok: OrgListAnalysisOk = {
      kind: "ok",
      rollup: "degraded",
      reports: [
        rep("config-repo", "installed"),
        rep("workflows", "not_installed"),
        rep("secrets", "not_installed"),
        rep("enrollment", "installed"),
        rep("dispatch-token", "not_installed"),
      ],
    };
    const pf = computePreflight([...deployRequiredOAuthScopes()], ["repo"]);
    expect(orgListRowFromAnalysis(ok, pf, readOnlyMemberNull)).toEqual({ kind: "configure" });
  });
});
