export function StatusPill({ on }: { on: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
        on ? "bg-ld-lime text-ld-black" : "bg-ld-gray-05 text-ld-gray-03"
      }`}
    >
      {on ? "On" : "Off"}
    </span>
  );
}

/**
 * The flag is ON but a prerequisite somewhere up its chain is off or missing,
 * so the prerequisite is not met and the flag serves its off variation.
 * Deliberately factual wording — it states what is happening, no alarm.
 */
export function PrereqNotMetBadge() {
  return (
    <span
      className="shrink-0 rounded-full border border-ld-orange px-2 py-0.5 text-[11px] text-ld-orange"
      title="This flag is on, but a prerequisite in its chain is off or missing. Until the prerequisite is met, contexts receive this flag's off variation."
    >
      prerequisite not met
    </span>
  );
}

export function UsedByBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      className="shrink-0 rounded-full border border-ld-gray-05 px-2 py-0.5 text-[11px] text-ld-gray-03"
      title={`${count} flag${count === 1 ? "" : "s"} list this flag as a prerequisite`}
    >
      used by {count}
    </span>
  );
}

/** "needs <variation>" chip on nested prerequisite rows; orange when the requirement fails. */
export function RequiresChip({ label, broken }: { label: string; broken: boolean }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] ${
        broken
          ? "bg-ld-orange/15 text-ld-orange"
          : "bg-ld-blue/15 text-ld-blue-light"
      }`}
      title={
        broken
          ? "The prerequisite flag cannot currently serve this variation"
          : "Variation this prerequisite must serve"
      }
    >
      needs {label}
    </span>
  );
}
