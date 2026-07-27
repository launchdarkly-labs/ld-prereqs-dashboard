"use client";

import { GraphStats } from "@/lib/prereq-graph";
import { TreeDirection } from "./FlagTree";

export type FilterMode = "roots" | "all" | "has-prereqs" | "is-prereq" | "at-risk";

export const FILTER_LABELS: Record<FilterMode, string> = {
  roots: "Top-level flags",
  all: "All flags",
  "has-prereqs": "Has prerequisites",
  "is-prereq": "Is a prerequisite",
  "at-risk": "Prerequisite not met",
};

interface ToolbarProps {
  direction: TreeDirection;
  onDirection: (value: TreeDirection) => void;
  search: string;
  onSearch: (value: string) => void;
  filter: FilterMode;
  onFilter: (value: FilterMode) => void;
  tags: string[];
  tag: string;
  onTag: (value: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  fetchedAt: number | null;
}

export function Toolbar({
  direction,
  onDirection,
  search,
  onSearch,
  filter,
  onFilter,
  tags,
  tag,
  onTag,
  onExpandAll,
  onCollapseAll,
  onRefresh,
  refreshing,
  fetchedAt,
}: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="flex overflow-hidden rounded-md border border-ld-gray-05 text-sm"
        role="group"
        aria-label="Tree direction"
      >
        <DirectionButton
          active={direction === "dependents"}
          onClick={() => onDirection("dependents")}
          title="Apex flags on top; expand to walk down through the flags that depend on them"
        >
          Dependents ↓
        </DirectionButton>
        <DirectionButton
          active={direction === "prerequisites"}
          onClick={() => onDirection("prerequisites")}
          title="Expand a flag to walk through what it requires"
        >
          Prerequisites ↑
        </DirectionButton>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search name, key, or tag…"
        className="w-64 rounded-md border border-ld-gray-05 bg-ld-gray-06 px-3 py-1.5 text-sm text-ld-white placeholder:text-ld-gray-04 focus:border-ld-blue focus:outline-none"
      />
      <select
        value={tag}
        onChange={(e) => onTag(e.target.value)}
        className="max-w-44 rounded-md border border-ld-gray-05 bg-ld-gray-06 px-3 py-1.5 text-sm text-ld-white focus:border-ld-blue focus:outline-none"
        title="Only show flags carrying this tag as top-level rows"
      >
        <option value="">All tags</option>
        {tags.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <select
        value={filter}
        onChange={(e) => onFilter(e.target.value as FilterMode)}
        className="rounded-md border border-ld-gray-05 bg-ld-gray-06 px-3 py-1.5 text-sm text-ld-white focus:border-ld-blue focus:outline-none"
      >
        {Object.entries(FILTER_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1">
        <ToolbarButton onClick={onExpandAll}>Expand all</ToolbarButton>
        <ToolbarButton onClick={onCollapseAll}>Collapse all</ToolbarButton>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {fetchedAt && (
          <span className="text-xs text-ld-gray-04" title={new Date(fetchedAt).toLocaleString()}>
            updated {timeAgo(fetchedAt)}
          </span>
        )}
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="rounded-md bg-ld-blue px-3 py-1.5 text-sm font-medium text-ld-white transition-colors hover:bg-ld-blue-light disabled:cursor-not-allowed disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </div>
  );
}

function DirectionButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`px-3 py-1.5 transition-colors ${
        active ? "bg-ld-blue font-medium text-ld-white" : "text-ld-gray-03 hover:text-ld-white"
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border border-ld-gray-05 px-3 py-1.5 text-sm text-ld-gray-03 transition-colors hover:border-ld-gray-04 hover:text-ld-white"
    >
      {children}
    </button>
  );
}

export function StatsBar({ stats }: { stats: GraphStats }) {
  const chips: Array<{ label: string; value: number; alert?: boolean; title?: string }> = [
    { label: "flags", value: stats.totalFlags },
    { label: "with prerequisites", value: stats.withPrerequisites },
    { label: "used as prerequisite", value: stats.usedAsPrerequisite },
    { label: "deepest chain", value: stats.maxDepth },
    {
      label: stats.atRisk === 1 ? "prerequisite not met" : "prerequisites not met",
      value: stats.atRisk,
      alert: stats.atRisk > 0,
      title:
        "Flags that are on but whose prerequisite chain has an off or missing flag — they currently serve their off variation.",
    },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <span
          key={chip.label}
          title={chip.title}
          className={`rounded-full border px-3 py-1 text-xs ${
            chip.alert
              ? "border-ld-orange text-ld-orange"
              : "border-ld-gray-05 text-ld-gray-03"
          }`}
        >
          <span className={`font-semibold ${chip.alert ? "" : "text-ld-white"}`}>
            {chip.value}
          </span>{" "}
          {chip.label}
        </span>
      ))}
    </div>
  );
}

export function timeAgo(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
