# Design: Admin SPA org install / repair (single flat screen)

Date: 2026-04-26
Status: Draft
Related: [`2026-04-21-fullsend-admin-spa-ux-design.md`](2026-04-21-fullsend-admin-spa-ux-design.md) (entry points; wizard interiors deferred), [`2026-04-06-fullsend-admin-spa-design.md`](2026-04-06-fullsend-admin-spa-design.md) Section 4 (wizards, staging, parity), [`2026-04-27-admin-spa-org-setup-install-repair-fsm.md`](2026-04-27-admin-spa-org-setup-install-repair-fsm.md) (normative group matrix, FSM tables, `localStorage` staging — **sibling spec**)

## Purpose

Specify the **interior** of the org-level **install and repair** experience for the Fullsend admin SPA: a **single flat route** that serves both **first-time deploy** and **repair**, grouped by **how the user interacts** (especially GitHub form flows vs SPA-driven API work), with **clear partial/broken status** and **dependency-aware** enablement.

This document **does not** prescribe exact API contracts or Worker behavior; it constrains **UX structure** and **behavioral expectations** so implementation can diverge from CLI **step order** while staying aligned with **real prerequisites** between operations.

For **normative group IDs**, **three-table FSM** per group, **`.fullsend` repository setup** naming (replacing the illustrative “automation” bundle for that matrix), **dispatch token** rules, **`localStorage`** key shape, and **exclusion of enrollment** from this screen, see the sibling spec [`2026-04-27-admin-spa-org-setup-install-repair-fsm.md`](2026-04-27-admin-spa-org-setup-install-repair-fsm.md). This document’s “automation group” language maps to **`.fullsend` repository setup** there; enrollment remains out of scope for the org setup route per the sibling spec.

## Goals

- One **screen** (one primary route) for **install** and **repair**, not a linear wizard, unless a future iteration explicitly reintroduces stepped navigation.
- **Flat** layout: prefer **visible** content over deep progressive disclosure; optional collapse of **fully healthy** groups is an implementation later enhancement, not required for v1.
- **Grouping by interaction need:**
  - Each surface that **requires the user to complete work on github.com** (for example **one group per agent GitHub App** that is created or re-linked via GitHub’s UI) is its **own** group.
  - Operations the SPA can perform **without** that mandatory GitHub form hop are **one shared “automation” group** (by default: **`.fullsend` repository setup** — config repo, workflows, secrets, org dispatch secret; **enrollment is excluded** from this route per sibling spec [`2026-04-27-admin-spa-org-setup-install-repair-fsm.md`](2026-04-27-admin-spa-org-setup-install-repair-fsm.md)).
- **One primary action per group** (Install / Repair / Continue / Open GitHub—wording per group state). Sub-items show **status**; they do **not** each get a competing primary **Apply**.
- **Dependency gating:** if a group cannot run until others are satisfied, the group is **visually inactive** and its primary control is **disabled**. **Prerequisite copy is always visible** as a **muted line directly under the group title** (not on the button—button labels stay short). Example: “Complete **{prior group title}** first.” **No separate hover-only** requirement for that message when this visible hint is present (keyboard and screen-reader users read the same text).
- **No extra confirmation step** for the automation group’s primary action beyond what is already shown in the group (**detail lines, status indicators, and `wouldFix`-style summaries**). Users act from **informed consent on-screen**, not a modal **Confirm**.
- **Progress states:** while work is ongoing, the **rollup** uses a **spinner** and a **short headline** that says what is happening; **items** show unknown/grey, queued, in progress, or final states as defined in [Loading and in-flight states](#loading-and-in-flight-states). **Read-only load** disables the primary and offers **no** Abort; **mutating apply** makes **Abort** the sole primary until the run finishes.

## Non-goals

- Replacing or duplicating the **organisation dashboard** repository list; repo-scoped onboarding remains as in the UX spec.
- Automated CLI↔SPA parity tests (still out of scope per companion spec).
- Preserving **CLI install step order** as the user-visible order; **dependency-correct** ordering and **interaction-first** grouping take precedence.

## Route and entry

- **Single** client route for org-level setup (implementation picks the hash segment; must be org-scoped, for example `#/org/{login}/setup`).
- **Deploy Fullsend** (org list) and **Repair** (org dashboard Pane A) both navigate here.
- On entry (and on **Refresh** where applicable), re-run **read-only analysis** sufficient to populate group status (aligned with existing **`LayerReport`** / `analyzeOrg`-style signals in the SPA).
- **Repair** may **scroll or move focus** to the first group that is not healthy or is blocking others.

## Group taxonomy

Groups are ordered by a **directed acyclic graph** of **technical prerequisites** (derived from layer semantics in code), **not** from `fullsend admin install` step index.

Illustrative structure (names are product copy, not code identifiers):

1. **Per–GitHub App groups** — one group per agent app that requires a **github.com** flow (create, install, permissions, or paste/verify steps as implemented). Each shows **one or more** checklist-style lines (roles, verification sub-steps) but **one** primary control for “do the GitHub part / continue after return.”
2. **Automation group** — SPA-driven fixes the user does **not** need to complete via a separate GitHub **form** for that bundle (file updates, API writes, etc.). Shows **line-level** status per sub-operation; **one** primary **Repair** / **Install** / **Apply** control for the **whole** automation bundle the implementation executes as one user gesture.
3. **Manual-only** surfaces (for example **cannot delete an app via API**) — **read-only** instructions and links, **no** fake primary **Apply**. Uninstall remains governed by the companion uninstall story.

Dynamic cardinality: **N agent roles ⇒ N app groups** (or the minimal set of distinct GitHub user journeys the product defines).

## Per-group layout (flat board)

Each group is a **card** or **band**, top to bottom: **title**; when the group is **blocked by prerequisites**, a **muted prerequisite line** immediately under the title (see [Disabled and prerequisite messaging](#disabled-and-prerequisite-messaging)); **rollup status** (normally icon + short headline—see [Loading and in-flight states](#loading-and-in-flight-states) for **spinner** and copy when loading or applying); **summary**; optional **item list** (one line per sub-check; **links** to GitHub where helpful); trailing **primary button** (short label only).

- **Exactly one** primary **button** per group (accessibility: real `button` or equivalent; visible focus ring per UX spec).
- **Secondary** text links (documentation, “open in GitHub”, PR links) are allowed and do not count as second primaries.

## Disabled and prerequisite messaging

When a group is blocked:

- Reduce emphasis (opacity / disabled controls) per design system.
- **Prerequisite copy:** **always-visible** muted line **under the group title** (above status rollup and item list), same text for mouse, keyboard, and assistive tech—e.g. “Complete **{named prior group}** before this step.” This keeps long explanations out of the **button** chrome.
- **Primary button:** `disabled` with a **short** action label only (for example **Continue** / **Repair** / **Install**); the button does **not** carry the prerequisite sentence.
- **Do not** rely on **hover-only** tooltips for the **only** explanation of why the group is blocked when visible copy is shown.
- **Accessibility:** implementations **should** expose the title-adjacent prerequisite line to assistive tech as the description for the disabled primary (for example `aria-describedby` from the button to the hint element).

## Loading and in-flight states

Two different “not idle” patterns: **read-only loading** (analysis / status fetch) and **in-flight apply** (user started a mutating API path for this group). Both reuse the same **rollup** real estate: **indeterminate spinner** replaces the usual health **icon**; the **headline** is always a **short verb phrase** describing what is happening (never the same copy as a completed health state).

### Read-only loading (initial entry, Refresh, re-analyze)

Applies while the SPA is still **discovering** this group’s status and has **not** finished the reads needed to show real outcomes.

- **Rollup:** spinner + headline such as **Checking…** or **Loading…** (implementation may substitute a slightly more specific phrase, e.g. **Checking configuration…**, if it stays one line).
- **Item list:** any line whose result is **not yet known** is shown **greyed / muted** (no success, error, or “would fix” pretence until data exists). Lines not yet enumerated may be omitted or shown as grey placeholders—implementation choice; if shown, they stay muted until known.
- **Primary button:** **disabled** with a short label (for example the normal **Repair** / **Install** label remains **disabled**, or **Loading…**—pick one consistently per product). **No Abort** control: the user did not start a cancellable apply from this group.
- **Prerequisite line:** only if the group is also dependency-blocked once partial data exists; while wholly unknown, optional “Checking…” under the title is redundant with rollup—**omit** duplicate copy unless it aids layout.

### In-flight apply (mutating API work for this group)

Applies after the user invokes this group’s **primary** mutating action (typically the **automation** group’s **Repair** / **Install** / **Apply**; other groups follow the same pattern if they run long API sequences).

- **Rollup:** spinner + headline that reflects **ongoing work**, e.g. **Applying changes…** or, when the implementation can surface it, a **phase-specific** phrase (**Updating workflows…**, **Writing secrets…**) that updates as the phase advances.
- **Item list:** each line shows **live pipeline state**: **queued / not started yet** (greyed); **in progress** (spinner or other non-final indicator + short label); **complete** (success treatment); **failed** (error treatment, consistent with [Status and partial outcomes](#status-and-partial-outcomes)). Order should match execution order where possible so users can scan top-to-bottom progress.
- **Primary button:** the sole primary becomes **Abort** (or **Cancel**—pick one product-wide). It **ends** the in-flight operation from the user’s perspective (see [Open questions](#open-questions) for server/client cancellation semantics). **Abort** uses normal **button** affordances and focus ring; consider **secondary** visual weight vs destructive styling depending on how safe abort is.
- **Prerequisite / blocked groups:** other groups that depend on this one may show under-title copy such as **Wait for {this group title} to finish** while this group is in-flight.

### GitHub-pending (user on github.com)

When the next step is **outside** the SPA (user completing a form on GitHub), **do not** use the in-flight API spinner as the main signal unless the SPA is **actively polling** for completion. Prefer **instructional** rollup copy and a **Continue** or **I’ve finished on GitHub** primary (or equivalent) per app-group design—still **one** primary per group.

## Status and partial outcomes

- **Rollup** for the group (when **idle** and fully known): **worst** child state wins for icon + headline. While [loading or in-flight](#loading-and-in-flight-states), rollup follows that section instead.
- Sub-items show **enough detail** that a user can understand **what would change** in the automation group **without** a separate confirmation dialog; reuse patterns from existing **`LayerReport.details`**, **`wouldFix`**, and related strings where possible for parity with CLI wording.
- If the automation group’s action **partially** succeeds: show **per-item** outcome inside the group; offer **Retry** for failed items **without** introducing a second **primary** affordance that violates “one primary per group”—implementation may use the **same** primary label transitioning to **Retry failed** or a **single** Retry that re-runs only failed sub-operations, but **only one** prominent button slot per group state.

**Technical detail** for failures: follow the **per-row / popover** pattern from the org UX spec where it fits (popover for HTTP detail, correlation id); for in-group API failures, an **equivalent** compact popover or inline “Error” + **i** control is acceptable.

## GitHub interrupts and staging

- Leaving the SPA for **github.com** is **expected** for app groups.
- **Staging** of intermediate app and dispatch material may use **`localStorage`** on the current origin; never put secrets in URLs or logs.
- **Normative rules** for which keys persist (including **across sign-out** for partial installs), when to clear staging, and how **heuristic app slugs** interact with GitHub APIs are defined in the sibling spec [`2026-04-27-admin-spa-org-setup-install-repair-fsm.md`](2026-04-27-admin-spa-org-setup-install-repair-fsm.md) (**Browser `localStorage` keys**, **Installation vs GitHub App existence**). Where that policy differs from the generic wizard staging note in [`2026-04-06-fullsend-admin-spa-design.md`](2026-04-06-fullsend-admin-spa-design.md), **this route follows the sibling spec** for the `fullsend:setup:*` namespace.

## Relation to companion “final review”

The companion spec calls for **final review before mutating** bulk installation. For this screen, **the automation group’s visible detail and status lines constitute that review**; there is **no** additional modal or separate **review step** before the automation primary runs.

## Acceptance notes (UX)

- Install and repair both use **the same route** and **the same group set**; entry path may only affect **focus** and **initial analysis**.
- Each **GitHub-mandatory** interaction class has **its own group**; **API-only** work lives in **one** automation group.
- **One** primary button per group; disabled groups show **visible** prerequisite text **under the group title**, not on the button and not hover-only.
- Automation group runs **without** an extra **Confirm** modal; informed intent comes from **on-screen** lists and status.
- Partial automation failure is visible **inside** the automation group with a clear **retry** path.
- **Read-only loading:** rollup spinner + “what’s happening” headline; unknown items **greyed**; primary **disabled**; **no** Abort.
- **In-flight apply:** rollup spinner + phase headline; items show **queued / in progress / done / failed**; primary is **Abort** until the run ends; dependent groups may show **wait** copy under the title.

## Open questions

- **Exact hash route** and breadcrumb behavior (org segment already required on dashboard).
- **Whether** to add **collapse healthy groups** after shipping v1 if vertical length hurts usability.
- **Automation bundle atomicity:** all-or-nothing vs best-effort partial apply—product and engineering choice; UX assumes **visible per-item** outcomes in either case.
- **Abort semantics:** best-effort client cancel, server-side cancellation, or “stop UI polling but server continues”—must be defined per implementation; UX assumes **after Abort** the group returns to an **idle** state with **accurate per-item** outcomes for whatever completed before stop, plus clear **Retry** if anything failed or was left incomplete.
