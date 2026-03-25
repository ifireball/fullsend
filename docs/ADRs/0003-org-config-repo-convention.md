---
title: "3. Org-level configuration lives in a conventional repo"
status: Proposed
relates_to:
  - governance
  - codebase-context
  - intent-representation
  - architectural-invariants
  - agent-architecture
  - agent-infrastructure
topics:
  - configuration
  - adoption
  - convention
---

# 3. Org-level configuration lives in a conventional repo

Date: 2026-03-25

## Status

Proposed

## Context

Fullsend defines a general framework — agents, workflows, review models, intent
systems, sandbox profiles — but an organization adopting fullsend needs to
configure all of this for their specific context. Today there is no conventional
place for that configuration. Issue #75 identifies the gap: core fullsend
content is organization-agnostic, but adopting organizations need a place for
operational configuration that tooling can discover automatically.

The configuration an org needs to provide includes:

- **Pointers to org-specific repos.** Where is the intent/features repo (see
  [intent-representation.md](../problems/intent-representation.md))? Where is
  the architecture documentation (see
  [architectural-invariants.md](../problems/architectural-invariants.md))?
- **Agent runtime defaults.** Which agent runtime to use, which model, what
  resource limits.
- **Workflow definitions.** Base workflow overrides or extensions for the org
  (see issue #68, #69).
- **Infrastructure layer configuration.** Where agents run — Kubernetes,
  CI runners, or other compute (see
  [agent-infrastructure.md](../problems/agent-infrastructure.md), issue #79).
- **Sandbox layer configuration.** Isolation profiles, network policies,
  filesystem restrictions (issue #78).
- **Harness assembly configuration.** How the trigger layer, runtime, and
  sandbox are composed into a running agent session (issue #74).
- **Org-specific agents and skills.** Additional agent definitions and skills
  beyond the base set (issues #71, #72).
- **Per-repo overrides.** Repos within the org that need different
  configuration from the org defaults.
- **Org-wide guardrails.** Minimum standards that repos cannot weaken (see
  [governance.md](../problems/governance.md)).

Without a conventional location, every piece of tooling that needs this
information must be told where to find it — or worse, each tool invents its own
convention. A single conventional repo makes the entire system bootstrappable:
tooling knows where to look, and everything else is discovered from there.

## Options

### Option 1: `<org>/.fullsend` repo

Each adopting organization creates a repo named `.fullsend` in their org or
group (GitHub org, GitLab group, Forgejo org, or equivalent). This is the
single entry point for all fullsend configuration in that org.

The dot-prefix mirrors conventions like GitHub's `.github` repo for org-level
configuration. It signals "infrastructure/meta" rather than application code.
The name is specific enough that it won't collide with other tooling.

**Pros:**
- Clean, memorable convention. Tooling has exactly one place to look.
- Org-owned — the adopting org controls their own configuration, permissions,
  and review process.
- Decoupled from fullsend's release cycle. Org config evolves independently.
- The dot-prefix is a well-established pattern (`.github`, `.gitignore`,
  `.editorconfig`).
- CODEOWNERS in this repo can enforce that configuration changes require
  appropriate approval, aligning with the governance model.

**Cons:**
- Dot-prefixed repos can be less visible in some forge UIs (sorted differently,
  sometimes hidden in listings).
- Establishes a new convention that adopters need to learn.
- GitLab groups and Forgejo orgs support the same repo naming, but visibility
  behavior of dot-prefixed repos may vary across platforms.

### Option 2: `<org>/fullsend-config` repo

Same as Option 1 but without the dot-prefix. More explicit and visible.

**Pros:**
- More discoverable across all forge UIs — appears in normal alphabetical
  listings regardless of platform.
- Name is self-documenting.

**Cons:**
- Doesn't benefit from the dot-prefix convention signaling "meta/infra."
- Slightly more generic name — could theoretically collide, though unlikely.

### Option 3: Configuration inside an existing platform meta-repo

Put fullsend configuration in a subdirectory of the org's existing platform
meta-repo — GitHub's `.github`, or equivalent. (GitLab and Forgejo don't have
an exact equivalent convention, which is itself a problem with this option.)

**Pros:**
- No new repo to create on platforms that have a meta-repo convention.
- Permissions may already be set up.

**Cons:**
- Mixes concerns. Platform meta-repos have their own established conventions
  (issue templates, CI config, default community health files). Adding a full
  agent configuration system overloads their purpose.
- Harder for tooling to isolate — must look inside a subdirectory of a repo
  that serves other purposes.
- CODEOWNERS for fullsend config would need to coexist with CODEOWNERS for
  other content in the same repo.
- As fullsend config grows (agent definitions, skills, workflow overrides),
  it could dominate the meta-repo.
- Not portable across forges. GitHub's `.github` repo doesn't have a direct
  equivalent on GitLab or Forgejo, so this option only works for some
  platforms.

### Option 4: External configuration management system

Use a runtime configuration store — Consul, etcd, HashiCorp Vault, AWS
Parameter Store, or similar — as the source of truth for org-level config.

**Pros:**
- Purpose-built for configuration management. Dynamic updates, access
  control, secret storage.
- Some organizations already run these systems.

**Cons:**
- Breaks the "everything is auditable in version control" principle. No PR
  review, no CODEOWNERS, no merge history on config changes.
- Introduces infrastructure dependencies that not every org has and that
  vary across environments.
- Not portable — each store has its own API, auth model, and operational
  requirements.
- Config changes become opaque to the review and governance processes
  that fullsend relies on. A change to agent permissions in Consul doesn't
  go through the same governed review as a change in a git repo.
- Secrets and dynamic runtime values (API keys, tokens) belong in systems
  like Vault. But structural configuration (what agents exist, what
  workflows to use, where the intent repo is) is not secret and benefits
  from version control and review.

### Option 5: Forge-native org/group settings

Store fullsend configuration in the forge's own org-level settings (GitHub
org settings API, GitLab group variables, Forgejo org settings).

**Pros:**
- No additional repo or system. Configuration lives where the org already
  manages settings.

**Cons:**
- Opaque — not version-controlled, not reviewable via merge requests, no
  audit trail beyond platform logs.
- Varies across forges. Each platform exposes different settings APIs with
  different capabilities. A configuration model that works on GitHub may
  not map to GitLab or Forgejo.
- Limited expressiveness. Org settings are key-value or flat structures,
  not rich enough for agent definitions, workflow overrides, or layered
  inheritance.
- Governed by platform admin permissions, not CODEOWNERS-style path-level
  review — less granular control over who can change what.

### Option 6: Hosted control plane / SaaS

A hosted web service where orgs configure fullsend via a UI or API.

**Pros:**
- Could offer a polished configuration experience with validation,
  previews, and guided setup.

**Cons:**
- Introduces a central service dependency — availability, security, and
  trust properties are no longer in the org's control.
- Moves configuration out of version control. No PR-based review, no
  CODEOWNERS, no git history.
- Creates a high-value attack target. Compromising the control plane
  compromises every org's agent configuration.
- Contrary to fullsend's design philosophy: the repo is the coordinator,
  not a service.

### Option 7: Configuration inside the fullsend repo itself

Each adopting org gets a directory in the fullsend repo (e.g., `orgs/nonflux/`).

**Pros:**
- Everything in one place. Simple for the fullsend maintainers to see all
  adopters.

**Cons:**
- Couples org config to fullsend's release cycle and permissions. An org
  can't modify their own config without a PR to fullsend.
- Doesn't scale. Every adopting org's config changes create PRs in fullsend.
- Violates the principle that org config is org-owned.
- Conflates the framework with its instances.

## Decision

Adopting organizations create a **`<org>/.fullsend`** repo as the conventional
location for all org-level fullsend configuration.

This repo is the root of the dependency graph for fullsend in an org. All
tooling — the harness, trigger layer, agent runtimes, drift scanners — discovers
what it needs starting from this repo. The convention is:

1. **Tooling looks for `<org>/.fullsend`** to bootstrap. If the repo exists,
   the org has adopted fullsend. If it doesn't, there's nothing to configure.
2. **The `.fullsend` repo points to everything else.** It contains or
   references: the intent repo, the architecture repo, infrastructure config,
   agent definitions, workflow definitions, sandbox profiles, and per-repo
   overrides.
3. **The `.fullsend` repo is governed by the adopting org.** Its CODEOWNERS,
   branch protection, and review requirements are set by the org according to
   their governance model. Changes to this repo are governance-level changes
   (see [governance.md](../problems/governance.md) — configuration security).
4. **Agents cannot modify this repo.** This is a hard rule. The `.fullsend`
   repo defines agent behavior; agents must not be able to modify their own
   configuration. This aligns with the existing principle that CODEOWNERS
   files are always human-owned.

### Repo structure (initial)

```
.fullsend/
  config.yaml              # Top-level org configuration
  agents/                  # Org-specific agent definitions (extends base set)
  skills/                  # Org-specific skills (extends base set)
  workflows/               # Workflow overrides/extensions
  repos/                   # Per-repo configuration overrides
    <repo-name>.yaml
```

The `config.yaml` contains pointers and org-wide defaults:

```yaml
# Where to find org-specific resources
intent_repo: <org>/features         # or <org>/intent
architecture_repo: <org>/architecture

# Agent runtime defaults
runtime:
  default: claude-code              # or opencode
  model: claude-sonnet-4-6

# Infrastructure
infrastructure:
  platform: kubernetes              # or github-actions, etc.
  # platform-specific config follows

# Sandbox defaults
sandbox:
  network_policy: restricted
  filesystem: ephemeral
```

Per-repo overrides in `repos/<repo-name>.yaml` can override org defaults
(within the bounds of org-wide guardrails that cannot be weakened).

The exact schema will evolve. The decision here is about the convention and
location, not the schema details.

### Inheritance model

Base fullsend provides default agents, skills, and workflows. The `.fullsend`
repo extends or overrides them for the org. Per-repo config in
`repos/<repo-name>.yaml` further overrides for specific repos. The layering is:

```
fullsend defaults < org .fullsend config < per-repo overrides
```

Org config can add agents, skills, and workflows. It can override defaults. It
cannot weaken org-wide guardrails (that's a governance enforcement, not a
technical one — CODEOWNERS on the guardrails section of config prevents it).

## Consequences

- **Every adopting org gets a single, discoverable configuration root.** No
  ambiguity about where config lives or how tooling finds it.
- **Org config is fully org-owned.** No PRs to the fullsend repo needed for
  org-specific changes. The org controls permissions, review, and release
  cadence for their own config.
- **The `.fullsend` repo becomes a security-critical asset.** It defines what
  agents can do. It must be protected accordingly — restricted write access,
  required reviews, audit logging. This is called out in the governance doc
  as "configuration security."
- **Tooling can be built against a stable convention.** The harness assembly
  process, trigger layer, and any CLI tooling can assume `.fullsend` exists
  and follow pointers from there.
- **Per-repo overrides are centralized in the org config repo** rather than
  scattered across individual repos. This makes it possible to audit and
  review the full org configuration in one place.
- **The `docs/problems/applied/` directory in fullsend remains for
  problem analysis**, not operational config. This cleanly separates "how we
  think about this problem for org X" from "how org X actually configures
  fullsend."
- **Adoption has a natural first step.** If a "fullsend installer" or setup
  tool is ever built, its first action is walking the user through creating
  the `.fullsend` repo in their org and populating it with initial config
  values (intent repo pointer, architecture repo pointer, runtime defaults).
  Everything else in the setup process flows from that repo existing. The
  convention makes bootstrapping deterministic — the installer doesn't need
  to ask "where should I put your config?"
