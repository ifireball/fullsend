export type SetupGroupKind =
  | "github_app"
  | "dispatch_pat"
  | "fullsend_repo_setup";

export type SetupGroupId = string;

/** Closed vocabulary from FSM spec (maps to card status icon). */
export type SetupStatusIcon =
  | "unknown"
  | "in_progress"
  | "ok"
  | "warn"
  | "error";

export type SetupItemLineTone = "ok" | "warn" | "error" | "unknown";

/** Row-level control rendered after the label (org setup screen only). */
export type SetupItemLineTrailingAction =
  | { kind: "recheck_org_app_installs"; label: string }
  | { kind: "open_dispatch_token_paste"; label: string };

export type SetupItemLine = {
  id?: string;
  label: string;
  lineTone: SetupItemLineTone;
  /** Extra copy for the (i) popover beside this row (keep label short). */
  detail?: string | null;
  /** Optional link under `detail` in the popover (GitHub UI, not API). */
  detailLinkHref?: string | null;
  detailLinkLabel?: string | null;
  /** Optional link-style action after the label (e.g. recheck install after GitHub flow in another tab). */
  trailingAction?: SetupItemLineTrailingAction | null;
};

export type SetupPrimaryAction =
  | { label: string; disabled?: boolean }
  | null;

export type SetupGroupViewModel = {
  id: SetupGroupId;
  kind: SetupGroupKind;
  /** Fixed card title (FSM). */
  title: string;
  statusIcon: SetupStatusIcon;
  /** Single dynamic line: situation + next step (FSM Table A). */
  subtitle: string;
  itemLines: SetupItemLine[];
  /** Optional extra line for repair flow config gate (parent screen spec). */
  prerequisiteHint: string | null;
  /** Omit control when no primary action (`—` in FSM tables). */
  primary: SetupPrimaryAction;
  /** For "Install app on Organisation" after slug is resolved. */
  githubAppSlug?: string | null;
  /** Pre-filled GitHub PAT creation page for dispatch card. */
  dispatchPatCreationUrl?: string | null;
};
