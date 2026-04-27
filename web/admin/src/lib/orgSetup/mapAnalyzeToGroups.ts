/**
 * Org setup view models are built by {@link buildOrgSetupGroups} in `./buildOrgSetupGroups.ts`
 * (FSM spec 2026-04-27). This module re-exports the public API for stable import paths.
 */
export {
  buildOrgSetupGroups,
  githubOrgAppSettingsUrl,
  installationRecordAppSlug,
  orgSetupDepEdgesFsm,
  setupBoardTitlesFromAgents,
} from "./buildOrgSetupGroups";

/** @deprecated Use {@link orgSetupDepEdgesFsm}; kept for older call sites. */
export { orgSetupDepEdgesFsm as orgSetupDepEdges } from "./buildOrgSetupGroups";
