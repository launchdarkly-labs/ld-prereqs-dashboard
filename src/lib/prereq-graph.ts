import { FeatureFlag, Prerequisite } from "./types";

/**
 * Pure graph logic over one flag sweep. Nodes are flags; a prerequisite edge
 * points from a dependent flag to the flag it requires (with the variation it
 * must serve). Dependents are the same edges reversed.
 *
 * LaunchDarkly semantics behind "chain broken" / "at risk": a prerequisite is
 * met only if the prerequisite flag is ON (in the selected environment) and
 * evaluates to the required variation. An OFF prerequisite deterministically
 * fails, so every flag downstream of it serves its off variation — even
 * though those flags still show as "on". That silent failure mode is exactly
 * what the dashboard highlights. Whether an ON prerequisite serves the
 * required variation depends on per-context targeting, so ON prerequisites
 * are not flagged.
 */

export interface GraphNode {
  flag: FeatureFlag;
  /** Prerequisites of this flag in the selected environment. */
  prerequisites: Prerequisite[];
  /** Keys of flags that list this flag as a prerequisite. */
  dependents: string[];
  on: boolean;
  /** Longest prerequisite chain below this flag (0 = no prerequisites). */
  depth: number;
  /**
   * This flag cannot serve its ON variations: it is off, a prerequisite is
   * missing from the dataset (deleted/archived), or something in its
   * prerequisite chain is off.
   */
  chainBroken: boolean;
  /**
   * The actionable signal: the flag is ON, yet its prerequisite chain is
   * broken — so it silently serves its off variation.
   */
  atRisk: boolean;
  /** Prerequisite keys not present in the flag sweep (deleted/archived). */
  missingPrerequisites: string[];
}

export interface GraphStats {
  totalFlags: number;
  withPrerequisites: number;
  usedAsPrerequisite: number;
  atRisk: number;
  maxDepth: number;
}

export interface PrereqGraph {
  nodes: Map<string, GraphNode>;
  /**
   * Keys of flags that have prerequisites but are not themselves a
   * prerequisite of anything — the tops of the dependency chains when viewing
   * in the prerequisites direction.
   */
  chainRoots: string[];
  /**
   * Keys of "apex" flags: flags others depend on that have no prerequisites
   * of their own (e.g. a customer's top-level release_* flags) — the roots of
   * the reverse pyramid when viewing in the dependents direction.
   */
  dependentRoots: string[];
  /** Keys of flags with no prerequisites and no dependents. */
  standalone: string[];
  stats: GraphStats;
}

export function buildGraph(flags: FeatureFlag[], envKey: string): PrereqGraph {
  const nodes = new Map<string, GraphNode>();

  for (const flag of flags) {
    // A flag can come back with no config for the selected environment (or no
    // `environments` object at all, e.g. archived flags) — treat as off/no-prereqs.
    const env = flag.environments?.[envKey];
    nodes.set(flag.key, {
      flag,
      prerequisites: env?.prerequisites ?? [],
      dependents: [],
      on: env?.on ?? false,
      depth: 0,
      chainBroken: false,
      atRisk: false,
      missingPrerequisites: [],
    });
  }

  for (const node of nodes.values()) {
    for (const prereq of node.prerequisites) {
      const target = nodes.get(prereq.key);
      if (target) target.dependents.push(node.flag.key);
      else node.missingPrerequisites.push(prereq.key);
    }
  }

  const depthMemo = new Map<string, number>();
  const brokenMemo = new Map<string, boolean>();
  for (const [key, node] of nodes) {
    node.depth = computeDepth(nodes, key, depthMemo, new Set());
    node.chainBroken = computeChainBroken(nodes, key, brokenMemo, new Set());
    // For an ON flag, a broken chain can only come from its prerequisites —
    // which is precisely the silent-failure signal.
    node.atRisk = node.on && node.chainBroken;
  }

  const chainRoots: string[] = [];
  const dependentRoots: string[] = [];
  const standalone: string[] = [];
  for (const [key, node] of nodes) {
    const hasPrereqs = node.prerequisites.length > 0;
    const isPrereq = node.dependents.length > 0;
    if (hasPrereqs && !isPrereq) chainRoots.push(key);
    else if (isPrereq && !hasPrereqs) dependentRoots.push(key);
    else if (!hasPrereqs && !isPrereq) standalone.push(key);
  }

  const byName = (a: string, b: string) =>
    nodes.get(a)!.flag.name.localeCompare(nodes.get(b)!.flag.name);
  chainRoots.sort(byName);
  dependentRoots.sort(byName);
  standalone.sort(byName);
  for (const node of nodes.values()) node.dependents.sort(byName);

  return { nodes, chainRoots, dependentRoots, standalone, stats: computeStats(nodes) };
}

/** LD prevents prerequisite cycles, but guard anyway — bad data must not hang the UI. */
function computeDepth(
  nodes: Map<string, GraphNode>,
  key: string,
  memo: Map<string, number>,
  visiting: Set<string>,
): number {
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const node = nodes.get(key);
  if (!node || visiting.has(key)) return 0;

  visiting.add(key);
  let depth = 0;
  for (const prereq of node.prerequisites) {
    depth = Math.max(
      depth,
      nodes.has(prereq.key) ? computeDepth(nodes, prereq.key, memo, visiting) + 1 : 1,
    );
  }
  visiting.delete(key);
  memo.set(key, depth);
  return depth;
}

function computeChainBroken(
  nodes: Map<string, GraphNode>,
  key: string,
  memo: Map<string, boolean>,
  visiting: Set<string>,
): boolean {
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const node = nodes.get(key);
  if (!node) return true; // missing prerequisite — cannot be satisfied
  if (visiting.has(key)) return false;

  visiting.add(key);
  const broken =
    !node.on ||
    node.missingPrerequisites.length > 0 ||
    node.prerequisites.some(
      (p) => nodes.has(p.key) && computeChainBroken(nodes, p.key, memo, visiting),
    );
  visiting.delete(key);
  memo.set(key, broken);
  return broken;
}

function computeStats(nodes: Map<string, GraphNode>): GraphStats {
  let withPrerequisites = 0;
  let usedAsPrerequisite = 0;
  let atRisk = 0;
  let maxDepth = 0;
  for (const node of nodes.values()) {
    if (node.prerequisites.length > 0) withPrerequisites++;
    if (node.dependents.length > 0) usedAsPrerequisite++;
    if (node.atRisk) atRisk++;
    maxDepth = Math.max(maxDepth, node.depth);
  }
  return { totalFlags: nodes.size, withPrerequisites, usedAsPrerequisite, atRisk, maxDepth };
}

/** Human label for the variation a prerequisite requires. */
export function requiredVariationLabel(
  nodes: Map<string, GraphNode>,
  prereq: Prerequisite,
): string {
  const target = nodes.get(prereq.key);
  const variation = target?.flag.variations[prereq.variation];
  if (!variation) return `variation ${prereq.variation}`;
  if (variation.name) return variation.name;
  return typeof variation.value === "string"
    ? variation.value
    : JSON.stringify(variation.value);
}
