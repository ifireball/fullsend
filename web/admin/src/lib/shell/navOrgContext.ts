import { writable } from "svelte/store";

/** Organisation segment for the top account bar (UX: breadcrumb next to user). */
export type NavOrgContext = {
  login: string;
  avatarUrl: string | null;
  displayName: string | null;
};

export const navOrgContext = writable<NavOrgContext | null>(null);

export function setNavOrgContext(value: NavOrgContext | null): void {
  navOrgContext.set(value);
}
