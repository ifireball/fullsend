export type SetupGroupKind = "github_app" | "automation" | "manual_info";

export type SetupGroupId = string;

export type SetupRollupTone = "ok" | "warn" | "error" | "unknown";

export type SetupGroupViewModel = {
  id: SetupGroupId;
  kind: SetupGroupKind;
  title: string;
  /** Idle rollup headline (not loading / in-flight copy). */
  rollupHeadline: string;
  rollupTone: SetupRollupTone;
  /** Checklist-style lines (grey until known in OrgSetup when loading). */
  itemLines: string[];
  prerequisiteHint: string | null;
  primary: { label: string; disabled: boolean };
};
