"use client";

import { useState } from "react";
import { GraphNode, PrereqGraph, requiredVariationLabel } from "@/lib/prereq-graph";
import { Prerequisite } from "@/lib/types";
import { PrereqNotMetBadge, RequiresChip, StatusPill, UsedByBadge } from "./pills";

/**
 * 'dependents'   — reverse pyramid (default): apex flags on top, expanding a
 *                  row reveals the flags that depend on it, recursively.
 * 'prerequisites' — classic direction: expanding a row reveals what it requires.
 */
export type TreeDirection = "dependents" | "prerequisites";

/** Children of an expanded node beyond this count sit behind a "show more" button. */
const CHILD_PAGE_SIZE = 50;

interface FlagTreeProps {
  graph: PrereqGraph;
  direction: TreeDirection;
  topLevelKeys: string[];
  /** null = everything expanded. */
  expanded: Set<string> | null;
  onToggle: (path: string) => void;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

export function FlagTree({
  graph,
  direction,
  topLevelKeys,
  expanded,
  onToggle,
  selectedKey,
  onSelect,
}: FlagTreeProps) {
  if (topLevelKeys.length === 0) {
    return (
      <div className="rounded-lg border border-ld-gray-05 p-10 text-center text-sm">
        No flags match the current filter.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-ld-gray-05 bg-ld-gray-06/30">
      {topLevelKeys.map((key) => (
        <TreeNode
          key={key}
          graph={graph}
          direction={direction}
          nodeKey={key}
          path={key}
          viaEdge={null}
          expanded={expanded}
          onToggle={onToggle}
          selectedKey={selectedKey}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

/**
 * The edge a row was reached through. `prereq.key` always identifies the
 * prerequisite-side flag — the child itself in the prerequisites direction,
 * the parent in the dependents direction — so the "needs" chip resolves the
 * variation (and its broken state) identically in both directions.
 */
interface ChildEdge {
  childKey: string;
  prereq: Prerequisite;
}

function childEdges(graph: PrereqGraph, node: GraphNode, direction: TreeDirection): ChildEdge[] {
  if (direction === "prerequisites") {
    return node.prerequisites.map((prereq) => ({ childKey: prereq.key, prereq }));
  }
  return node.dependents.map((depKey) => ({
    childKey: depKey,
    prereq: graph.nodes.get(depKey)!.prerequisites.find((p) => p.key === node.flag.key)!,
  }));
}

interface TreeNodeProps {
  graph: PrereqGraph;
  direction: TreeDirection;
  nodeKey: string;
  /** Slash-joined key path from the top-level row — expansion state is per occurrence. */
  path: string;
  viaEdge: Prerequisite | null;
  expanded: Set<string> | null;
  onToggle: (path: string) => void;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

function TreeNode({
  graph,
  direction,
  nodeKey,
  path,
  viaEdge,
  expanded,
  onToggle,
  selectedKey,
  onSelect,
}: TreeNodeProps) {
  const node = graph.nodes.get(nodeKey);

  if (!node) {
    // Prerequisite referenced by another flag but absent from the sweep
    // (only reachable in the prerequisites direction).
    return (
      <div className="flex items-center gap-2 border-b border-ld-gray-05/50 px-3 py-2 last:border-b-0">
        <span className="w-5" />
        <span className="font-mono text-sm text-ld-orange">{nodeKey}</span>
        <span className="rounded-full border border-ld-orange px-2 py-0.5 text-[11px] text-ld-orange">
          missing — deleted or archived?
        </span>
      </div>
    );
  }

  const children = childEdges(graph, node, direction);
  const isExpanded = expanded === null || expanded.has(path);
  const isSelected = selectedKey === nodeKey;
  // Rendering cycle guard: never nest a flag inside itself.
  const ancestors = path.split("/");

  return (
    <div className="border-b border-ld-gray-05/50 last:border-b-0">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(nodeKey)}
        onKeyDown={(e) => e.key === "Enter" && onSelect(nodeKey)}
        className={`flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors ${
          isSelected ? "bg-ld-blue/15" : "hover:bg-ld-gray-06"
        }`}
      >
        {children.length > 0 ? (
          <button
            aria-label={isExpanded ? "Collapse" : "Expand"}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(path);
            }}
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-ld-gray-03 transition-transform hover:bg-ld-gray-05 hover:text-ld-white ${
              isExpanded ? "rotate-90" : ""
            }`}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M2 1l6 4-6 4V1z" />
            </svg>
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}

        <span className="truncate text-sm font-medium text-ld-white">{node.flag.name}</span>
        <span className="hidden truncate font-mono text-xs text-ld-gray-04 lg:inline">
          {node.flag.key}
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {viaEdge && (
            <RequiresChip
              label={requiredVariationLabel(graph.nodes, viaEdge)}
              broken={graph.nodes.get(viaEdge.key)?.chainBroken ?? true}
            />
          )}
          {node.atRisk && <PrereqNotMetBadge />}
          {direction === "dependents" ? (
            <DependentsBadge count={node.dependents.length} expanded={isExpanded} />
          ) : (
            <UsedByBadge count={node.dependents.length} />
          )}
          {node.flag.archived && (
            <span className="rounded-full border border-ld-gray-05 px-2 py-0.5 text-[11px] text-ld-gray-04">
              archived
            </span>
          )}
          <StatusPill on={node.on} />
        </span>
      </div>

      {children.length > 0 && isExpanded && (
        <ChildList
          graph={graph}
          direction={direction}
          childrenEdges={children}
          parentPath={path}
          ancestors={ancestors}
          expanded={expanded}
          onToggle={onToggle}
          selectedKey={selectedKey}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

/** Child lists longer than this get their own filter controls. */
const CHILD_FILTER_THRESHOLD = 5;

type StateFilter = "all" | "on" | "off";
type StructureFilter = "all" | "with" | "without";

/**
 * Renders an expanded node's children in pages of CHILD_PAGE_SIZE so a flag
 * with hundreds of dependents stays responsive, with per-list filters for
 * state and further nesting. State resets on collapse (the list unmounts).
 */
function ChildList({
  graph,
  direction,
  childrenEdges,
  parentPath,
  ancestors,
  expanded,
  onToggle,
  selectedKey,
  onSelect,
}: {
  graph: PrereqGraph;
  direction: TreeDirection;
  childrenEdges: ChildEdge[];
  parentPath: string;
  ancestors: string[];
  expanded: Set<string> | null;
  onToggle: (path: string) => void;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(CHILD_PAGE_SIZE);
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [structureFilter, setStructureFilter] = useState<StructureFilter>("all");

  const filtered = childrenEdges.filter(({ childKey }) => {
    const child = graph.nodes.get(childKey);
    if (!child) return true; // missing-prerequisite rows are always worth seeing
    if (stateFilter !== "all" && child.on !== (stateFilter === "on")) return false;
    const furtherCount =
      direction === "dependents" ? child.dependents.length : child.prerequisites.length;
    if (structureFilter === "with" && furtherCount === 0) return false;
    if (structureFilter === "without" && furtherCount > 0) return false;
    return true;
  });
  const visible = filtered.slice(0, visibleCount);
  const remaining = filtered.length - visible.length;
  const furtherLabel = direction === "dependents" ? "dependents" : "prerequisites";

  return (
    <div className="ml-[22px] border-l border-ld-gray-05">
      {childrenEdges.length > CHILD_FILTER_THRESHOLD && (
        <div className="flex flex-wrap items-center gap-2 border-b border-ld-gray-05/50 px-3 py-1.5">
          <ChildFilterSelect
            value={stateFilter}
            onChange={(v) => setStateFilter(v as StateFilter)}
            options={[
              ["all", "All states"],
              ["on", "On only"],
              ["off", "Off only"],
            ]}
          />
          <ChildFilterSelect
            value={structureFilter}
            onChange={(v) => setStructureFilter(v as StructureFilter)}
            options={[
              ["all", "All flags"],
              ["with", `With further ${furtherLabel}`],
              ["without", `Without further ${furtherLabel}`],
            ]}
          />
          <span className="text-[11px] text-ld-gray-04">
            {filtered.length === childrenEdges.length
              ? `${childrenEdges.length} flags`
              : `${filtered.length} of ${childrenEdges.length} flags`}
          </span>
        </div>
      )}
      {filtered.length === 0 && (
        <p className="px-3 py-2 text-xs text-ld-gray-04">No flags match these filters.</p>
      )}
      {visible.map(({ childKey, prereq }) =>
        ancestors.includes(childKey) ? (
          <div key={childKey} className="px-3 py-2 font-mono text-xs text-ld-orange">
            {childKey} — circular reference
          </div>
        ) : (
          <TreeNode
            key={childKey}
            graph={graph}
            direction={direction}
            nodeKey={childKey}
            path={`${parentPath}/${childKey}`}
            viaEdge={prereq}
            expanded={expanded}
            onToggle={onToggle}
            selectedKey={selectedKey}
            onSelect={onSelect}
          />
        ),
      )}
      {remaining > 0 && (
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            onClick={() => setVisibleCount((c) => c + CHILD_PAGE_SIZE)}
            className="rounded-md border border-ld-gray-05 px-2.5 py-1 text-xs text-ld-gray-03 transition-colors hover:border-ld-gray-04 hover:text-ld-white"
          >
            Show {Math.min(CHILD_PAGE_SIZE, remaining)} more
          </button>
          <button
            onClick={() => setVisibleCount(childrenEdges.length)}
            className="rounded-md border border-ld-gray-05 px-2.5 py-1 text-xs text-ld-gray-03 transition-colors hover:border-ld-gray-04 hover:text-ld-white"
          >
            Show all
          </button>
          <span className="text-xs text-ld-gray-04">
            {remaining} of {filtered.length} hidden
          </span>
        </div>
      )}
    </div>
  );
}

function ChildFilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<[value: string, label: string]>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-ld-gray-05 bg-ld-gray-06 px-1.5 py-0.5 text-[11px] text-ld-gray-02 focus:border-ld-blue focus:outline-none"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

function DependentsBadge({ count, expanded }: { count: number; expanded: boolean }) {
  if (count === 0 || expanded) return null;
  return (
    <span
      className="shrink-0 rounded-full border border-ld-blue/50 px-2 py-0.5 text-[11px] text-ld-blue-light"
      title={`${count} flag${count === 1 ? "" : "s"} depend on this flag — expand to see them`}
    >
      {count} dependent{count === 1 ? "" : "s"}
    </span>
  );
}

/** Every expandable path under the given top-level keys (used to materialize "expand all"). */
export function collectAllPaths(
  graph: PrereqGraph,
  topLevelKeys: string[],
  direction: TreeDirection,
): Set<string> {
  const paths = new Set<string>();
  const walk = (key: string, path: string, ancestors: string[]) => {
    const node = graph.nodes.get(key);
    if (!node) return;
    const children = childEdges(graph, node, direction);
    if (children.length === 0) return;
    paths.add(path);
    for (const { childKey } of children) {
      if (!ancestors.includes(childKey)) {
        walk(childKey, `${path}/${childKey}`, [...ancestors, childKey]);
      }
    }
  };
  for (const key of topLevelKeys) walk(key, key, [key]);
  return paths;
}
