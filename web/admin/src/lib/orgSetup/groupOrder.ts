/**
 * Dependency edges for org setup groups: `group` stays blocked until
 * `requiresSatisfied` is present in the caller's satisfied-id set.
 */
export type DepEdge = {
  group: string;
  requiresSatisfied: string;
};

/** Map internal satisfied / blocker ids to user-visible group titles. */
export function groupDisplayTitle(id: string): string {
  if (id === "config_ok") return "Configuration repository";
  if (id === "apps_ready") return "Agent GitHub apps";
  if (id === "automation") return "Automation";
  if (id.startsWith("github_app:")) {
    const role = id.slice("github_app:".length);
    return `${humanizeRole(role)} GitHub App`;
  }
  return id;
}

function humanizeRole(role: string): string {
  if (!role) return "Agent";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * When `groupId` has an unsatisfied predecessor (transitive), return
 * prerequisite copy for the nearest missing gate (product: under group title).
 */
export function prerequisiteHint(
  groupId: string,
  satisfied: Set<string>,
  edges: DepEdge[],
): string | null {
  const memo = new Map<string, string | null>();

  function blockingHint(g: string): string | null {
    const hit = memo.get(g);
    if (hit !== undefined) return hit;

    const preds = edges.filter((e) => e.group === g);
    if (preds.length === 0) {
      memo.set(g, null);
      return null;
    }

    const unsatisfied = preds
      .map((e) => e.requiresSatisfied)
      .filter((id) => !satisfied.has(id))
      .sort();

    if (unsatisfied.length === 0) {
      memo.set(g, null);
      return null;
    }

    for (const pred of unsatisfied) {
      const inner = blockingHint(pred);
      if (inner !== null) {
        memo.set(g, inner);
        return inner;
      }
    }

    const title = groupDisplayTitle(unsatisfied[0]!);
    const msg = `Complete ${title} first.`;
    memo.set(g, msg);
    return msg;
  }

  return blockingHint(groupId);
}

/**
 * Topological order for displayed group ids (dependencies first).
 * Includes ids referenced only as `requiresSatisfied` so ordering is well-defined.
 */
export function sortGroupsForDisplay(ids: string[], edges: DepEdge[]): string[] {
  const nodes = new Set<string>(ids);
  for (const e of edges) {
    nodes.add(e.group);
    nodes.add(e.requiresSatisfied);
  }

  const adj = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const n of nodes) {
    adj.set(n, new Set());
    inDegree.set(n, 0);
  }

  for (const e of edges) {
    const from = e.requiresSatisfied;
    const to = e.group;
    if (!nodes.has(from) || !nodes.has(to)) continue;
    const outs = adj.get(from)!;
    if (!outs.has(to)) {
      outs.add(to);
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const n of nodes) {
    if ((inDegree.get(n) ?? 0) === 0) queue.push(n);
  }
  queue.sort();

  const ordered: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    ordered.push(u);
    const outs = [...(adj.get(u) ?? [])].sort();
    for (const v of outs) {
      const next = (inDegree.get(v) ?? 0) - 1;
      inDegree.set(v, next);
      if (next === 0) {
        queue.push(v);
        queue.sort();
      }
    }
  }

  if (ordered.length !== nodes.size) {
    throw new Error("sortGroupsForDisplay: cycle in dependency graph");
  }

  const idSet = new Set(ids);
  return ordered.filter((n) => idSet.has(n));
}
