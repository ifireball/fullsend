/**
 * Copy when the org picker is empty after listing **GitHub App installations**
 * (`GET /user/installations`).
 */

/**
 * Shown when the installations API returned **200** and there are **no** organisation
 * installations in the aggregated result (success-empty, not an error).
 */
export function buildEmptyInstallationsHint(): string {
  return (
    "This list only includes organisations where the Fullsend Admin app is installed for your signed-in user. " +
    "Other Fullsend-related apps (for example apps created when you deploy Fullsend to an org) are not listed here."
  );
}
