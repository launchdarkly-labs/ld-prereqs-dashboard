"use client";

import { useState } from "react";
import { getDependentFlags } from "@/lib/ld-api";
import { LDClient } from "@/lib/ld-client";
import { PrereqGraph, requiredVariationLabel } from "@/lib/prereq-graph";
import { DependentFlag, INSTANCES } from "@/lib/types";
import { PrereqNotMetBadge, StatusPill } from "./pills";

interface DetailPanelProps {
  graph: PrereqGraph;
  flagKey: string;
  client: LDClient;
  projectKey: string;
  envKey: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}

export function DetailPanel({
  graph,
  flagKey,
  client,
  projectKey,
  envKey,
  onSelect,
  onClose,
}: DetailPanelProps) {
  const [verified, setVerified] = useState<DependentFlag[] | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const node = graph.nodes.get(flagKey);
  if (!node) return null;
  const { flag } = node;
  const env = flag.environments?.[envKey];

  const ldUrl = `${INSTANCES[client.instance].appBase}/projects/${projectKey}/flags/${flag.key}/targeting?env=${envKey}&selected-env=${envKey}`;

  const verifyDependents = async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      setVerified(await getDependentFlags(client, projectKey, envKey, flag.key));
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <aside className="flex w-96 shrink-0 flex-col gap-4 self-start rounded-lg border border-ld-gray-05 bg-ld-gray-06/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base">{flag.name}</h3>
          <p className="truncate font-mono text-xs text-ld-gray-04">{flag.key}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close details"
          className="rounded p-1 text-ld-gray-04 hover:bg-ld-gray-05 hover:text-ld-white"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill on={node.on} />
        {node.atRisk && <PrereqNotMetBadge />}
        <span className="rounded-full border border-ld-gray-05 px-2 py-0.5 text-[11px] text-ld-gray-03">
          {flag.kind}
        </span>
        {flag.temporary && (
          <span className="rounded-full border border-ld-gray-05 px-2 py-0.5 text-[11px] text-ld-gray-03">
            temporary
          </span>
        )}
        {flag.tags?.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-ld-gray-05 px-2 py-0.5 text-[11px] text-ld-gray-02"
          >
            {tag}
          </span>
        ))}
      </div>

      {flag.description && <p className="text-sm">{flag.description}</p>}

      <Section title="Variations">
        <ul className="flex flex-col gap-1">
          {flag.variations.map((variation, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className="font-mono text-xs text-ld-gray-04">{i}</span>
              <span className="text-ld-gray-02">
                {variation.name ??
                  (typeof variation.value === "string"
                    ? variation.value
                    : JSON.stringify(variation.value))}
              </span>
              {env?.offVariation === i && (
                <span className="rounded bg-ld-gray-05 px-1.5 text-[10px] uppercase text-ld-gray-03">
                  off
                </span>
              )}
              {env?.fallthrough?.variation === i && (
                <span className="rounded bg-ld-blue/20 px-1.5 text-[10px] uppercase text-ld-blue-light">
                  fallthrough
                </span>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Prerequisites (${node.prerequisites.length})`}>
        {node.prerequisites.length === 0 ? (
          <p className="text-sm text-ld-gray-04">None</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {node.prerequisites.map((prereq) => {
              const target = graph.nodes.get(prereq.key);
              return (
                <li key={prereq.key} className="flex items-center gap-2 text-sm">
                  <FlagLink
                    label={target?.flag.name ?? prereq.key}
                    missing={!target}
                    onClick={() => target && onSelect(prereq.key)}
                  />
                  <span className="ml-auto font-mono text-xs text-ld-gray-04">
                    needs {requiredVariationLabel(graph.nodes, prereq)}
                  </span>
                  {target && <StatusPill on={target.on} />}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title={`Dependent flags (${node.dependents.length})`}>
        {node.dependents.length === 0 ? (
          <p className="text-sm text-ld-gray-04">No flags require this one</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {node.dependents.map((key) => (
              <li key={key} className="flex items-center gap-2 text-sm">
                <FlagLink
                  label={graph.nodes.get(key)!.flag.name}
                  onClick={() => onSelect(key)}
                />
                <span className="ml-auto">
                  <StatusPill on={graph.nodes.get(key)!.on} />
                </span>
              </li>
            ))}
          </ul>
        )}
        <button
          onClick={verifyDependents}
          disabled={verifying}
          className="mt-2 rounded-md border border-ld-gray-05 px-2.5 py-1 text-xs text-ld-gray-03 transition-colors hover:border-ld-gray-04 hover:text-ld-white disabled:opacity-50"
          title="Cross-check against GET …/dependent-flags (beta endpoint), one call for this flag only"
        >
          {verifying ? "Checking…" : "Verify via API (beta)"}
        </button>
        {verifyError && <p className="mt-1 text-xs text-ld-pink">{verifyError}</p>}
        {verified && (
          <p className="mt-1 text-xs text-ld-gray-04">
            API reports {verified.length} dependent flag{verified.length === 1 ? "" : "s"}
            {verified.length > 0 && (
              <>: {verified.map((d) => d.name ?? d.key).join(", ")}</>
            )}
          </p>
        )}
      </Section>

      {flag.maintainer?.email && (
        <Section title="Maintainer">
          <p className="text-sm text-ld-gray-02">
            {[flag.maintainer.firstName, flag.maintainer.lastName].filter(Boolean).join(" ") ||
              flag.maintainer.email}
            <span className="ml-1 text-ld-gray-04">{flag.maintainer.email}</span>
          </p>
        </Section>
      )}

      <a
        href={ldUrl}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-ld-blue-light hover:underline"
      >
        Open in LaunchDarkly ↗
      </a>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ld-gray-04">
        {title}
      </h4>
      {children}
    </section>
  );
}

function FlagLink({
  label,
  onClick,
  missing,
}: {
  label: string;
  onClick: () => void;
  missing?: boolean;
}) {
  if (missing) {
    return (
      <span className="truncate font-mono text-ld-orange" title="Not in this project's flag list — deleted or archived?">
        {label} ⚠
      </span>
    );
  }
  return (
    <button
      onClick={onClick}
      className="truncate text-left text-ld-blue-light hover:underline"
    >
      {label}
    </button>
  );
}
