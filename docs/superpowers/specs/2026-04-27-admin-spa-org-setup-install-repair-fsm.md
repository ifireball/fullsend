# Design: Admin SPA org install / repair — FSM and group matrix (sibling spec)

Date: 2026-04-27  
Status: Draft  
Related: [`2026-04-26-admin-spa-org-setup-install-repair-screen-design.md`](2026-04-26-admin-spa-org-setup-install-repair-screen-design.md) (flat screen UX, layout, loading patterns), Go install flow (`internal/cli/admin.go`, `internal/appsetup`, `internal/layers`)

## Purpose

This document is the **normative companion** to the 2026-04-26 org setup screen spec. It defines:

- **Which groups** appear on the install/repair route and their **stable IDs** and **fixed titles**.
- **What each group owns** (including **browser `localStorage`** staging rules).
- **Dependency gates** between groups.
- For each group, **three uniform tables**: **Group FSM (states)**, **Transitions**, **Items**.

The 2026-04-26 document remains the source for **card layout**, **prerequisite line placement**, **read-only loading vs in-flight apply** (spinner, **Abort**), and **GitHub interrupts**. Where that document speaks of an “automation” bundle and **enrollment**, **this** document **renames** that bundle to **`.fullsend` repository setup** and **excludes enrollment** from this screen (enrollment stays elsewhere in the product).

## Non-goals (this iteration)

- **Dispatch PAT verification** via `workflow_dispatch` (or any other verify step). Out of scope until a later spec; the org may still store a token that fails at first real dispatch.
- **Changing** which GitHub App or PAT is in use after a successful bind (re-pick / rotate flows). Intentionally deferred; tables may reserve **Notes** only.
- **Repository enrollment** (shim workflow PRs, per-repo onboarding). Not on this screen.
- Exact **Worker / REST** contracts.

## Conventions

### Group chrome (layout)

- **Group title** is **fixed** for the lifetime of the card (e.g. `Coder GitHub App`). It appears **next to the status icon**.
- **Status icon** changes with **Table A (State ID)**.
- **Exactly one** dynamic textual line under the title: the **subtitle** (muted). There is **no** separate changing “headline” beside the icon — the subtitle carries both status and “what to do next,” including when **no primary button** is shown.
- **Primary button**: at most **one** per group; **omit** the control entirely when no action is needed (`—` in tables). When absent, **icon + subtitle + Table C rows** must still make the state obvious.

### Status icon set (closed vocabulary)

Use one token per row in **Table A → Status icon** (map to visuals in implementation):

| Token | Meaning |
|-------|--------|
| `unknown` | Still resolving dependencies for this card. |
| `in_progress` | Work in progress (includes read-only **loading** and mutating **apply**; distinguish if needed via **Notes** and parent spec’s Abort rules). |
| `ok` | Group requirements satisfied for this card’s scope. |
| `warn` | Action available or attention needed without hard failure. |
| `error` | Blocking error for this card (e.g. lost PEM with no recovery on this device). |

### Browser `localStorage` keys (staging)

**Goal:** survive a **partial** install on the **same browser profile** before `.fullsend` exists; **avoid cross-account leaks** when the signed-in GitHub user changes.

**Required key segments** (in order; implementation defines exact string concatenation):

1. **Product prefix** — e.g. `fullsend:setup:` (constant).
2. **SCM host** — API host name (e.g. `github.com`, `github.enterprise.example`) so **GitHub Enterprise Server** and future SCM hosts do not collide.
3. **Actor** — GitHub **login** of the authenticated user (the “username” in product language).
4. **Organisation** — target org **login** (same human may set up multiple orgs on one host).
5. **Artifact path** — e.g. `app:{role}:pem`, `app:{role}:meta`, `dispatch_pat` (string material).

**Risk acceptance:** **PEM** and **PAT** material may live in `localStorage` only for a **short window** until written to the correct GitHub destinations (repo secrets / org secret). **XSS or local compromise** can read them; this is an **accepted trade-off** for v1 and must be stated in any user-facing security copy when implemented.

**Clear staging** when: `.fullsend` holds the authoritative secret, user signs out, or a documented **abandon** action runs (align with parent spec’s staging story).

### App identity resolution

For each configured **role**, resolve **display name** and **slug** in order:

1. **`config.yaml`** on `.fullsend` (when repo exists and file readable).
2. **`localStorage`** metadata for `{host, user, org, role}`.
3. **Heuristic:** default slug `{org_login}-{role}` (and display name derived in product copy).

Installation checks use the **resolved slug** (or installation id if implementation prefers) against org installation listings from the API.

### Dispatch token “exists”

For **Table C** and health: token material is **present** if **either**:

- Org secret **`FULLSEND_DISPATCH_TOKEN`** exists on GitHub for this org, **or**
- **`localStorage`** holds the PAT string under the key scheme above (until cleared after successful org write).

**No verification** step in v1 (see Non-goals).

### Cross-group health: **App** card

An **`github_app:{role}`** group is **healthy** only if:

- **Installation:** the app is **installed** on the target organisation (API), **and**
- **Credentials:** PEM is available **either** in `.fullsend` repo secrets **or** in scoped `localStorage` for this host/user/org/role.

**Table C** for app cards lists only **name** and **installation**; the **PEM presence** rule is a **group-level check** reflected in **Table A** (subtitle + icon) and **Transitions** guards, **not** a third checklist row on the app card.

---

## Group catalog

| `group.id` | Fixed group title (example for role `coder`) | Kind |
|------------|-----------------------------------------------|------|
| `github_app:{role}` | `{HumanizedRole} GitHub App` | `github_app` |
| `dispatch_pat` | `Dispatch token` | `dispatch_pat` |
| `fullsend_repo_setup` | `.fullsend` repository setup | `fullsend_repo_setup` |

**Cardinality:** one row per configured agent **role** for `github_app:*`; exactly **one** dispatch card; exactly **one** `.fullsend` setup card.

**HumanizedRole:** same rule as SPA today (e.g. `coder` → `Coder`).

---

## Dependency gates (between groups)

Edges are **unidirectional prerequisites** for **enabling** the downstream card’s primary (or for leaving **blocked** subtitle state).

| Downstream | Upstream (must be satisfied first) |
|------------|-----------------------------------|
| `fullsend_repo_setup` | **All** `github_app:{role}` groups are **healthy** (installation + PEM availability per [Cross-group health](#cross-group-health-app-card)). |
| `fullsend_repo_setup` | **`dispatch_pat`** token material **exists** ([Dispatch token “exists”](#dispatch-token-exists)) — required so the apply bundle can create/update the org secret when applicable. |

**Not gated:** `github_app:*` does **not** wait on `.fullsend`. **`dispatch_pat`** does **not** wait on `.fullsend` (user may create PAT and store locally first).

When `fullsend_repo_setup` is blocked, the **subtitle** (and optional second line in parent spec’s **prerequisite** pattern) names the **blocking group titles**; no text-only-on-hover requirement.

---

## Uniform table columns (reference)

### Table A — Group FSM (states)

| Column | Description |
|--------|-------------|
| State ID | Stable identifier. |
| Status icon | Token from [Status icon set](#status-icon-set-closed-vocabulary). |
| Subtitle | Single dynamic line: situation + next step. |
| Primary button | Exact label, or `—` if **no** button. |
| Primary effect | What the button does (one sentence), or `—`. |
| Secondary actions | Non-primary links only, or `—`. |
| Item presentation | How Table C rows render (e.g. all `ok`, `unknown` greyed), or `see Table C`. |
| Notes | Guards, timers, deferred product, alignment with parent spec. |

### Table B — Transitions

| Column | Description |
|--------|-------------|
| From | State ID. |
| Event | User action, API result, timer, storage event, navigation. |
| Guard | Boolean condition on checks / other groups, or `—`. |
| To | State ID. |

### Table C — Items

| Column | Description |
|--------|-------------|
| Item ID | Stable id. |
| Label template | User-visible template; `{…}` placeholders allowed. |
| Sub-states | Closed set for this item row. |
| Icon per sub-state | Map each sub-state to `ok` / `warn` / `error` / `unknown` row treatment (or same vocabulary as rollup). |
| How we know | `config`, `localStorage`, `API`, `heuristic`, or combination. |
| Copy when missing / error | Short hint text. |

---

## `github_app:{role}` — per-role GitHub App

**Fixed group title:** `{HumanizedRole} GitHub App` (e.g. **Coder GitHub App**).

### Table A — Group FSM (states)

| State ID | Status icon | Subtitle | Primary button | Primary effect | Secondary actions | Item presentation | Notes |
|----------|-------------|----------|------------------|----------------|-------------------|---------------------|-------|
| `ga_loading` | `in_progress` | Checking this agent’s app on GitHub… | `—` | `—` | `—` | Table C rows `unknown`. | Read-only load; no Abort (parent spec). |
| `ga_need_create` | `warn` | No app registered for this agent yet. Create it on GitHub, then return to this screen. | **Create app on GitHub** | Opens the GitHub app-creation URL / manifest flow for this org and role (implementation detail). | Link to docs if available, or `—`. | `item_app_name` missing or heuristic; `item_app_install` `missing`. | May pre-seed `localStorage` after callback when implementation supplies PEM+meta. |
| `ga_need_install` | `warn` | App exists but is not installed on this organisation. Install it, then return here. | **Install app on Organisation** | Opens GitHub **install** URL for the resolved app slug. | `Open app settings on GitHub` (optional), or `—`. | `item_app_name` `ok` when known; `item_app_install` `missing`. | Requires **resolved slug**; PEM may already be in `localStorage` from create flow. |
| `ga_poll_install` | `in_progress` | Waiting for GitHub to show this app on the organisation… | `—` | `—` | `—` | `item_app_install` `in_progress` (or `unknown`). | Optional state if SPA polls installations; else fold into `ga_need_install` until API shows install. |
| `ga_blocked_lost_pem` | `error` | An app is registered on GitHub but credentials are not on this device or in `.fullsend`. Remove the app or complete a fresh create flow. | `—` | `—` | Link to GitHub app settings / uninstall docs, or `—`. | `item_app_install` `ok`; name row per API if any. | Aligns with Go “PEM lost” semantics; recovery is **outside** this card’s primary. |
| `ga_healthy` | `ok` | This agent’s app is created, installed, and credentials are available (in `.fullsend` or saved on this device until setup completes). | `—` | `—` | Optional read-only **View on GitHub**, or `—`. | Both Table C rows `ok`. | **Off-card check:** PEM in repo secrets **or** `localStorage` for this host/user/org/role. |

### Table B — Transitions (`github_app:{role}`)

| From | Event | Guard | To |
|------|-------|-------|-----|
| `ga_loading` | Analysis finished | slug unknown, no install, no usable local PEM | `ga_need_create` |
| `ga_loading` | Analysis finished | slug known, install missing | `ga_need_install` |
| `ga_loading` | Analysis finished | install ok ∧ PEM available | `ga_healthy` |
| `ga_loading` | Analysis finished | install ok ∧ PEM missing | `ga_blocked_lost_pem` |
| `ga_need_create` | User clicked **Create app on GitHub** | `—` | `ga_need_create` | Stay in this state until re-analysis (return from GitHub / callback). Optional future: insert `ga_github_create_pending` between create click and return. |
| `ga_need_create` | Re-analysis / callback | slug+install missing | `ga_need_install` |
| `ga_need_create` | Re-analysis / callback | install ok ∧ PEM ok | `ga_healthy` |
| `ga_need_install` | User clicked **Install app on Organisation** | `—` | `ga_poll_install` or `ga_need_install` |
| `ga_poll_install` | Poll shows installation | PEM ok | `ga_healthy` |
| `ga_poll_install` | Poll timeout / failure | `—` | `ga_need_install` or `ga_blocked_lost_pem` (product choice) |

*(Implementation may collapse `ga_poll_install` into `ga_need_install` with spinner subtitle; document the chosen graph in code comments.)*

### Table C — Items (`github_app:{role}`)

| Item ID | Label template | Sub-states | Icon per sub-state | How we know | Copy when missing / error |
|---------|----------------|------------|----------------------|-------------|---------------------------|
| `item_app_name` | App name: `{display_name}` | `ok`, `unknown`, `heuristic` | `ok`→ok, `unknown`→unknown, `heuristic`→warn | `config` → `localStorage` → `{org}-{role}` heuristic | “Name not confirmed until you create the app or open the configuration repository.” |
| `item_app_install` | Installed on **{org_login}** | `ok`, `missing`, `in_progress` | `ok`→ok, `missing`→warn, `in_progress`→in_progress | GitHub **List org installations** (or equivalent) vs resolved slug | “Install the app on this organisation to continue.” |

---

## `dispatch_pat` — Dispatch token

**Fixed group title:** **Dispatch token**.

### Table A — Group FSM (states)

| State ID | Status icon | Subtitle | Primary button | Primary effect | Secondary actions | Item presentation | Notes |
|----------|-------------|----------|------------------|----------------|-------------------|---------------------|-------|
| `dp_loading` | `in_progress` | Checking whether a dispatch token is already configured… | `—` | `—` | `—` | Table C `unknown`. | Read-only load. |
| `dp_missing` | `warn` | No dispatch token found for this organisation on this device. Create a fine-grained PAT scoped to `.fullsend`, then save it here. | **Create token in GitHub** | Opens GitHub PAT creation (pre-filled URL pattern per Go CLI intent). | Link to GitHub token settings, or `—`. | Table C `missing`. | After user pastes/saves locally, transition to `dp_ready_local` without `.fullsend`. |
| `dp_ready_local` | `ok` | Token saved on this device. It will be written to GitHub when you run **`.fullsend` repository setup**. | `—` | `—` | `Replace token` (optional future; **deferred**), or `—`. | Table C `ok_local`. | Still **ok** for this card’s scope; downstream org secret is **fullsend** group’s job. |
| `dp_ready_org` | `ok` | Organisation dispatch secret **FULLSEND_DISPATCH_TOKEN** is configured on GitHub. | `—` | `—` | `View org secrets` (optional deep link if feasible), or `—`. | Table C `ok_org`. | May coexist with cleared local copy. |

### Table B — Transitions (`dispatch_pat`)

| From | Event | Guard | To |
|------|-------|-------|-----|
| `dp_loading` | Analysis + storage read | org secret exists | `dp_ready_org` |
| `dp_loading` | Analysis + storage read | org secret missing ∧ local PAT missing | `dp_missing` |
| `dp_loading` | Analysis + storage read | org secret missing ∧ local PAT present | `dp_ready_local` |
| `dp_missing` | User returned from GitHub and saved token into SPA / storage | string persisted | `dp_ready_local` |
| `dp_ready_local` | **`.fullsend` repository setup** completed org secret write | success | `dp_ready_org` |
| `dp_ready_org` | User removed org secret (repair) | detected on refresh | `dp_missing` or `dp_ready_local` if local still has string |

### Table C — Items (`dispatch_pat`)

| Item ID | Label template | Sub-states | Icon per sub-state | How we know | Copy when missing / error |
|---------|----------------|------------|----------------------|-------------|---------------------------|
| `item_dispatch_token` | Dispatch token for workflow triggers | `missing`, `ok_local`, `ok_org` | `missing`→warn, `ok_local`→ok, `ok_org`→ok | GitHub org secret API **or** `localStorage` key for `dispatch_pat` | “Create a PAT with access to **Actions (read/write)** for **only** the `.fullsend` repository, then add it here.” |

---

## `fullsend_repo_setup` — `.fullsend` repository setup

**Fixed group title:** **`.fullsend` repository setup**.

**Scope:** Idempotent **API-driven** alignment with the Go layer stack **excluding enrollment**: ensure configuration repository, workflow files, **agent credentials (PEM + app id variables) on `.fullsend`**, and **org-level** `FULLSEND_DISPATCH_TOKEN` from staged local PAT when needed. **Does not** list or create enrollment PRs.

### Table A — Group FSM (states)

| State ID | Status icon | Subtitle | Primary button | Primary effect | Secondary actions | Item presentation | Notes |
|----------|-------------|----------|------------------|----------------|-------------------|---------------------|-------|
| `fs_loading` | `in_progress` | Checking `.fullsend` and related settings… | `—` | `—` | `—` | Table C `unknown` / grey. | Read-only load. |
| `fs_blocked` | `warn` | Complete **{HumanizedRole} GitHub App** for: {roles…} **and** finish **Dispatch token** before running setup. | `—` | `—` | `—` | Rows muted or `blocked` per Table C rules. | Prerequisite line must name blocking groups (parent spec). |
| `fs_need_install` | `warn` | `.fullsend` is missing or incomplete. Apply changes to create or repair it on GitHub. | **Install** | Runs mutating apply bundle (config → workflows → secrets → org dispatch secret). | `—` | Mixed `missing` / `ok` per row. | First-time copy; **Install** label when org-level rollup is `not_installed` analogue. |
| `fs_need_repair` | `warn` | Some `.fullsend` settings do not match what Fullsend needs. | **Repair** | Same bundle as **Install** (idempotent). | `—` | Any row may show `would_fix` style attention. | Use **Repair** when partial/degraded (align with SPA `mapAnalyzeToGroups` intent). |
| `fs_applying` | `in_progress` | Applying changes to `.fullsend` on GitHub… | **Abort** | Cancels **in-flight** client orchestration per parent spec semantics. | `—` | Rows show `queued` / `in_progress` / `complete` / `failed` live. | Sole primary is **Abort** (parent spec). |
| `fs_partial` | `warn` | Some steps failed. Fix errors below, then retry. | **Retry failed** | Re-runs failed sub-operations only (or full idempotent bundle — implementation choice documented in code). | `—` | Per-row `failed` visible. | Same **one** primary slot as parent spec partial rule. |
| `fs_healthy` | `ok` | `.fullsend` is present and matches Fullsend’s required configuration for this organisation. | `—` | `—` | `Open .fullsend on GitHub`, or `—`. | All rows `ok`. | No enrollment checks here. |

### Table B — Transitions (`fullsend_repo_setup`)

| From | Event | Guard | To |
|------|-------|-------|-----|
| `fs_loading` | Analysis done | upstream gates false | `fs_blocked` |
| `fs_loading` | Analysis done | upstream gates true ∧ bundle needed (greenfield) | `fs_need_install` |
| `fs_loading` | Analysis done | upstream gates true ∧ degraded | `fs_need_repair` |
| `fs_loading` | Analysis done | upstream gates true ∧ all items ok | `fs_healthy` |
| `fs_blocked` | Upstream becomes satisfied | all apps healthy ∧ dispatch material exists | `fs_need_install` or `fs_need_repair` or `fs_healthy` |
| `fs_need_install` / `fs_need_repair` | User clicked primary | `—` | `fs_applying` |
| `fs_applying` | All steps success | `—` | `fs_healthy` |
| `fs_applying` | Some step failed | `—` | `fs_partial` |
| `fs_applying` | User **Abort** | per parent spec | `fs_partial` or prior state with per-row outcomes |
| `fs_partial` | User **Retry failed** | `—` | `fs_applying` |

### Table C — Items (`.fullsend` repository setup)

| Item ID | Label template | Sub-states | Icon per sub-state | How we know | Copy when missing / error |
|---------|----------------|------------|----------------------|-------------|---------------------------|
| `item_config_repo` | Configuration repository **.fullsend** | `ok`, `missing`, `unknown`, `blocked` | Standard map | GitHub repo + `config.yaml` presence | “Create the `.fullsend` repository and `config.yaml`.” |
| `item_workflows` | Workflow files (`agent.yaml`, `repo-onboard.yaml`, `CODEOWNERS`) | `ok`, `missing`, `unknown`, `blocked` | Standard map | Contents API / analysis | “Write required workflow files into `.fullsend`.” |
| `item_secrets_{role}` | Secrets for **{HumanizedRole}** agent (private key + app id) | `ok`, `missing`, `unknown`, `blocked` | Standard map | Repo secrets + variables on `.fullsend`; PEM source may be `localStorage` until written | “Store the app private key and app id on `.fullsend`.” |
| `item_dispatch_org_secret` | Organisation secret **FULLSEND_DISPATCH_TOKEN** | `ok`, `missing`, `unknown`, `blocked` | Standard map | Org secret API; value may be read from staged local PAT | “Write the dispatch token to the organisation secret and scope it to enrolled repositories when policy requires.” |

**Note:** `item_secrets_{role}` expands to **one row per configured role** (same cardinality as app groups).

---

## Alignment checklist (authoring / implementation)

- [ ] Three tables per group with **identical column headers** as [Uniform table columns](#uniform-table-columns-reference).
- [ ] **No** PAT verify path in v1.
- [ ] **No** enrollment rows on this screen.
- [ ] `localStorage` keys include **SCM host**, **GitHub login**, **org login**, and **artifact**.
- [ ] **Primary omitted** when `—`; icon + subtitle + items still inform.
- [ ] **`.fullsend` repository setup** naming used in product copy; parent spec’s “automation group” wording maps here for **this** matrix.

---

## Open questions (carry forward)

- **Abort** semantics (client vs server) — parent spec open question.
- **Replace token / replace app** flows.
- **Dispatch verification** location and trigger when added back.
- **Default branch** for future PAT verify (Go CLI hardcodes `main` today).
