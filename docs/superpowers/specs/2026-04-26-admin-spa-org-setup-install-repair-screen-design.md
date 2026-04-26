# Design: Admin SPA org install / repair (single flat screen)

Date: 2026-04-26  
Status: Draft  
Related: [`2026-04-21-fullsend-admin-spa-ux-design.md`](2026-04-21-fullsend-admin-spa-ux-design.md) (entry points; wizard interiors deferred), [`2026-04-06-fullsend-admin-spa-design.md`](2026-04-06-fullsend-admin-spa-design.md) Section 4 (wizards, staging, parity)

## Purpose

Specify the **interior** of the org-level **install and repair** experience for the Fullsend admin SPA: a **single flat route** that serves both **first-time deploy** and **repair**, grouped by **how the user interacts** (especially GitHub form flows vs SPA-driven API work), with **clear partial/broken status** and **dependency-aware** enablement.

This document **does not** prescribe exact API contracts or Worker behavior; it constrains **UX structure** and **behavioral expectations** so implementation can diverge from CLI **step order** while staying aligned with **real prerequisites** between operations.

## Goals

- One **screen** (one primary route) for **install** and **repair**, not a linear wizard, unless a future iteration explicitly reintroduces stepped navigation.
- **Flat** layout: prefer **visible** content over deep progressive disclosure; optional collapse of **fully healthy** groups is an implementation later enhancement, not required for v1.
- **Grouping by interaction need:**
  - Each surface that **requires the user to complete work on github.com** (for example **one group per agent GitHub App** that is created or re-linked via GitHub’s UI) is its **own** group.
  - Operations the SPA can perform **without** that mandatory GitHub form hop are **one shared “automation” group** (config repo content, workflows, secrets via GitHub APIs, enrollment/dispatch fixes—exact membership follows implementation and parity with the Go layer stack).
- **One primary action per group** (Install / Repair / Continue / Open GitHub—wording per group state). Sub-items show **status**; they do **not** each get a competing primary **Apply**.
- **Dependency gating:** if a group cannot run until others are satisfied, the group is **visually inactive** and its primary control is **disabled**. **Prerequisite copy is always visible** (for example a muted line under the disabled button: “Complete **{prior group title}** first”). **No separate hover-only** requirement for that message when this visible hint is present (keyboard and screen-reader users read the same text).
- **No extra confirmation step** for the automation group’s primary action beyond what is already shown in the group (**detail lines, status indicators, and `wouldFix`-style summaries**). Users act from **informed consent on-screen**, not a modal **Confirm**.

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

Each group is a **card** or **band**: **title**, **rollup status** (icon + short headline, consistent with org dashboard language: deployed / degraded / not installed / unknown), **summary**, optional **item list** (one line per sub-check; **links** to GitHub where helpful).

- **Exactly one** primary **button** per group (accessibility: real `button` or equivalent; visible focus ring per UX spec).
- **Secondary** text links (documentation, “open in GitHub”, PR links) are allowed and do not count as second primaries.

## Disabled and prerequisite messaging

When a group is blocked:

- Reduce emphasis (opacity / disabled controls) per design system.
- **Primary button:** `disabled` with **always-visible** prerequisite text (same content for mouse, keyboard, and assistive tech), e.g. “Complete **{named prior group}** before this step.”
- **Do not** rely on **hover-only** tooltips for the **only** explanation of why the group is blocked when visible copy is shown.

## Status and partial outcomes

- **Rollup** for the group: **worst** child state wins for icon + headline.
- Sub-items show **enough detail** that a user can understand **what would change** in the automation group **without** a separate confirmation dialog; reuse patterns from existing **`LayerReport.details`**, **`wouldFix`**, and related strings where possible for parity with CLI wording.
- If the automation group’s action **partially** succeeds: show **per-item** outcome inside the group; offer **Retry** for failed items **without** introducing a second **primary** affordance that violates “one primary per group”—implementation may use the **same** primary label transitioning to **Retry failed** or a **single** Retry that re-runs only failed sub-operations, but **only one** prominent button slot per group state.

**Technical detail** for failures: follow the **per-row / popover** pattern from the org UX spec where it fits (popover for HTTP detail, correlation id); for in-group API failures, an **equivalent** compact popover or inline “Error” + **i** control is acceptable.

## GitHub interrupts and staging

Unchanged from [`2026-04-06-fullsend-admin-spa-design.md`](2026-04-06-fullsend-admin-spa-design.md):

- Leaving the SPA for **github.com** is **expected** for app groups.
- **Staging** of intermediate app material may use **`localStorage`** on the current origin; clear on success, cancel, sign-out, or documented abandon behavior; never put secrets in URLs or logs.

## Relation to companion “final review”

The companion spec calls for **final review before mutating** bulk installation. For this screen, **the automation group’s visible detail and status lines constitute that review**; there is **no** additional modal or separate **review step** before the automation primary runs.

## Acceptance notes (UX)

- Install and repair both use **the same route** and **the same group set**; entry path may only affect **focus** and **initial analysis**.
- Each **GitHub-mandatory** interaction class has **its own group**; **API-only** work lives in **one** automation group.
- **One** primary button per group; disabled groups show **visible** prerequisite text, not hover-only.
- Automation group runs **without** an extra **Confirm** modal; informed intent comes from **on-screen** lists and status.
- Partial automation failure is visible **inside** the automation group with a clear **retry** path.

## Open questions

- **Exact hash route** and breadcrumb behavior (org segment already required on dashboard).
- **Whether** to add **collapse healthy groups** after shipping v1 if vertical length hurts usability.
- **Automation bundle atomicity:** all-or-nothing vs best-effort partial apply—product and engineering choice; UX assumes **visible per-item** outcomes in either case.
