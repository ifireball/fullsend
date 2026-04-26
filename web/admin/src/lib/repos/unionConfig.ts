import type { OrgConfigYaml } from "../layers/orgConfigParse";

/**
 * Every repository name listed under `repos:` in org `config.yaml`
 * (including disabled entries and orphans not visible on GitHub).
 */
export function repoNamesFromOrgConfig(cfg: OrgConfigYaml): string[] {
  return Object.keys(cfg.repos ?? {}).sort((a, b) => a.localeCompare(b));
}

export function isRepoEnabledInConfig(cfg: OrgConfigYaml, repoName: string): boolean {
  return cfg.repos?.[repoName]?.enabled === true;
}

export type RepoUnionRowKind = "github_only" | "config_only" | "both";

export function classifyRepoUnionKind(
  name: string,
  githubNames: ReadonlySet<string>,
  configNames: ReadonlySet<string>,
): RepoUnionRowKind {
  const onGh = githubNames.has(name);
  const inCfg = configNames.has(name);
  if (onGh && inCfg) return "both";
  if (onGh) return "github_only";
  return "config_only";
}

/**
 * Sorted unique union of GitHub-visible repo short names and config `repos:` keys.
 */
export function sortedUnionRepoNames(
  githubRepoNames: string[],
  configRepoNames: string[],
): string[] {
  const all = new Set<string>();
  for (const g of githubRepoNames) {
    all.add(g);
  }
  for (const c of configRepoNames) {
    all.add(c);
  }
  return [...all].sort((a, b) => a.localeCompare(b));
}

/**
 * High-level UX bucket from union membership alone.
 * - **R6** — visible on GitHub, not listed in Fullsend config.
 * - **R7** — listed in config, repository missing from GitHub (orphan).
 * - **managed** — present in both sets (enrollment / PR states resolved in UI).
 */
export function uxRepoRowBucketFromUnionKind(kind: RepoUnionRowKind): "R6" | "R7" | "managed" {
  switch (kind) {
    case "github_only":
      return "R6";
    case "config_only":
      return "R7";
    default:
      return "managed";
  }
}

/** Case-insensitive substring filter, stable alphabetical order. */
export function filterRepoNamesBySearch(names: string[], q: string): string[] {
  const t = q.trim().toLowerCase();
  const base = [...names].sort((a, b) => a.localeCompare(b));
  if (!t) return base;
  return base.filter((n) => n.toLowerCase().includes(t));
}
