import { writable } from "svelte/store";

/** Organisation segment for the top account bar (UX: breadcrumb next to user). */
export type NavOrgContext = {
  login: string;
  avatarUrl: string | null;
  displayName: string | null;
  /** Set on `#/org/:login/setup` after analyze: drives the nav bar cluster after the org. */
  setupFlow?: "deploy" | "repair";
  /**
   * When `false`, the org segment is plain text (no dashboard link). Used on
   * setup for greenfield deploy so users stay in install until config exists.
   */
  orgClusterLinksToDashboard?: boolean;
};

export const navOrgContext = writable<NavOrgContext | null>(null);

export function setNavOrgContext(value: NavOrgContext | null): void {
  navOrgContext.set(value);
}
