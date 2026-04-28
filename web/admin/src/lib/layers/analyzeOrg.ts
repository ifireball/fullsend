import type { LayerReport } from "../status/types";
import { rollupOrgLayerStatus } from "../status/engine";
import { analyzeConfigRepoLayer } from "./configRepo";
import { analyzeDispatchTokenLayer } from "./dispatch";
import { analyzeEnrollmentLayer } from "./enrollment";
import type { LayerGithub } from "./githubClient";
import { analyzeSecretsLayer } from "./secrets";
import { analyzeWorkflowsLayer } from "./workflows";

export type AnalyzeOrgLayersInput = {
  org: string;
  gh: LayerGithub;
  /** Agent roles from org config (drives secret/variable names). */
  agents: { role: string }[];
  /** Repos with `enabled: true` in config (drives enrollment checks). */
  enabledRepos: string[];
};

/** Input for org-dashboard rollup only (no per-repo enrollment). */
export type AnalyzeOrgInstallRollupInput = {
  org: string;
  gh: LayerGithub;
  agents: { role: string }[];
};

/**
 * Read-only checks for **org-level “Fullsend status”** (`.fullsend` config repo, managed workflows
 * and role secrets/vars on that repo, org dispatch secret). Does **not** call GitHub for each
 * managed repository’s enrollment shim — that belongs on the repository list and does not scale.
 */
export async function analyzeOrgInstallRollupLayers(
  input: AnalyzeOrgInstallRollupInput,
): Promise<{
  reports: LayerReport[];
  rollup: ReturnType<typeof rollupOrgLayerStatus>;
}> {
  const { org, gh, agents } = input;
  const reports: LayerReport[] = [
    await analyzeConfigRepoLayer(org, gh),
    await analyzeWorkflowsLayer(org, gh),
    await analyzeSecretsLayer(org, gh, agents),
    await analyzeDispatchTokenLayer(org, gh),
  ];
  return { reports, rollup: rollupOrgLayerStatus(reports) };
}

/**
 * Runs read-only Analyze for all stack layers (order matches typical install stack).
 * Includes **enrollment** (per enabled repo); use {@link analyzeOrgInstallRollupLayers} for
 * dashboard status when you only need `.fullsend` + org dispatch.
 */
export async function analyzeOrgLayers(input: AnalyzeOrgLayersInput): Promise<{
  reports: LayerReport[];
  rollup: ReturnType<typeof rollupOrgLayerStatus>;
}> {
  const { org, gh, agents, enabledRepos } = input;
  const reports: LayerReport[] = [
    await analyzeConfigRepoLayer(org, gh),
    await analyzeWorkflowsLayer(org, gh),
    await analyzeSecretsLayer(org, gh, agents),
    await analyzeEnrollmentLayer(org, gh, enabledRepos),
    await analyzeDispatchTokenLayer(org, gh),
  ];
  return { reports, rollup: rollupOrgLayerStatus(reports) };
}
