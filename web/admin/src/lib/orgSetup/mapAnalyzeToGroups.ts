import type { LayerReport } from "../status/types";
import { rollupOrgLayerStatus } from "../status/engine";
import type { LayerStatus } from "../status/types";
import { prerequisiteHint, sortGroupsForDisplay, type DepEdge } from "./groupOrder";
import type { SetupGroupViewModel } from "./types";

function humanizeRole(role: string): string {
  if (!role) return "Agent";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function rollupToneForOrg(s: LayerStatus): SetupGroupViewModel["rollupTone"] {
  switch (s) {
    case "installed":
      return "ok";
    case "degraded":
      return "warn";
    case "not_installed":
      return "warn";
    case "unknown":
    default:
      return "unknown";
  }
}

function headlineForOrgStatus(s: LayerStatus): string {
  switch (s) {
    case "installed":
      return "Healthy";
    case "degraded":
      return "Needs attention";
    case "not_installed":
      return "Not fully installed";
    case "unknown":
    default:
      return "Status unknown";
  }
}

/**
 * Dependency edges: each GitHub App group waits for config; synthetic `apps_ready`
 * waits for every app group; automation waits for `apps_ready`.
 */
export function orgSetupDepEdges(agentRoles: string[]): DepEdge[] {
  const roles = [...new Set(agentRoles)].sort();
  const edges: DepEdge[] = [];
  for (const role of roles) {
    const gid = `github_app:${role}`;
    edges.push({ group: gid, requiresSatisfied: "config_ok" });
    edges.push({ group: "apps_ready", requiresSatisfied: gid });
  }
  if (roles.length === 0) {
    edges.push({ group: "apps_ready", requiresSatisfied: "config_ok" });
  }
  edges.push({ group: "automation", requiresSatisfied: "apps_ready" });
  return edges;
}

function satisfiedGateIds(
  reports: LayerReport[],
  agentRoles: string[],
): Set<string> {
  const satisfied = new Set<string>();
  const configReport = reports.find((r) => r.name === "config-repo");
  if (configReport?.status === "installed") {
    satisfied.add("config_ok");
  }

  const roles = [...new Set(agentRoles)].sort();
  for (const role of roles) {
    // Task 13: treat per-app GitHub flow as unblocked once config exists (real app state in Task 14).
    if (satisfied.has("config_ok")) {
      satisfied.add(`github_app:${role}`);
    }
  }

  if (
    roles.length > 0 &&
    roles.every((r) => satisfied.has(`github_app:${r}`))
  ) {
    satisfied.add("apps_ready");
  } else if (roles.length === 0 && satisfied.has("config_ok")) {
    satisfied.add("apps_ready");
  }

  return satisfied;
}

function automationItemLines(reports: LayerReport[]): string[] {
  const lines: string[] = [];
  for (const r of reports) {
    for (const d of r.details) {
      const t = d.trim();
      if (t) lines.push(`${r.name}: ${t}`);
    }
    for (const w of r.wouldFix) {
      const t = w.trim();
      if (t) lines.push(`${r.name}: ${t}`);
    }
  }
  if (lines.length === 0) {
    lines.push("No pending automation changes detected.");
  }
  return lines;
}

/**
 * Maps analyze output + configured agents to interaction-first setup groups.
 */
export function mapAnalyzeToGroups(
  reports: LayerReport[],
  agents: { role: string }[],
): SetupGroupViewModel[] {
  const roles = [...new Set(agents.map((a) => a.role))].sort();
  const depEdges = orgSetupDepEdges(roles);
  const satisfied = satisfiedGateIds(reports, roles);

  const orgRollup = rollupOrgLayerStatus(reports);
  const orgTone = rollupToneForOrg(orgRollup);
  const orgHeadline = headlineForOrgStatus(orgRollup);

  const groups: SetupGroupViewModel[] = [];

  for (const role of roles) {
    const id = `github_app:${role}`;
    const hint = prerequisiteHint(id, satisfied, depEdges);
    groups.push({
      id,
      kind: "github_app",
      title: `${humanizeRole(role)} GitHub App`,
      rollupHeadline: satisfied.has(id) ? "Ready to continue" : "Action needed on GitHub",
      rollupTone: satisfied.has(id) ? "ok" : "warn",
      itemLines: [
        `Create or verify the GitHub App for the ${humanizeRole(role)} agent, then install it on this organisation.`,
      ],
      prerequisiteHint: hint,
      primary: {
        label: "Continue",
        disabled: true,
      },
    });
  }

  const autoHint = prerequisiteHint("automation", satisfied, depEdges);
  const autoPrimaryLabel = orgRollup === "not_installed" ? "Install" : "Repair";

  groups.push({
    id: "automation",
    kind: "automation",
    title: "Automation",
    rollupHeadline: orgHeadline,
    rollupTone: orgTone,
    itemLines: automationItemLines(reports),
    prerequisiteHint: autoHint,
    primary: {
      label: autoPrimaryLabel,
      disabled: autoHint !== null,
    },
  });

  const ids = groups.map((g) => g.id);
  const order = sortGroupsForDisplay(ids, depEdges);
  const orderIndex = new Map(order.map((id, i) => [id, i]));
  return [...groups].sort(
    (a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0),
  );
}
