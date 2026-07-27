"use client";

import { useState } from "react";
import { assetPath } from "@/lib/asset-path";
import { getEnvironments, getProjects } from "@/lib/ld-api";
import { LDClient } from "@/lib/ld-client";
import { Environment, INSTANCES, InstanceKey, LDApiError, Project } from "@/lib/types";

export interface SetupResult {
  instance: InstanceKey;
  token: string;
  remember: boolean;
  projectKey: string;
  envKey: string;
}

interface SetupPanelProps {
  initialInstance: InstanceKey;
  initialToken?: string;
  initialRemember?: boolean;
  onDone: (result: SetupResult) => void;
}

export function SetupPanel({
  initialInstance,
  initialToken,
  initialRemember,
  onDone,
}: SetupPanelProps) {
  const [instance, setInstance] = useState<InstanceKey>(initialInstance);
  const [token, setToken] = useState(initialToken ?? "");
  const [remember, setRemember] = useState(initialRemember ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectKey, setProjectKey] = useState("");
  const [environments, setEnvironments] = useState<Environment[] | null>(null);
  const [envKey, setEnvKey] = useState("");

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const client = new LDClient({ instance, token });
      const items = await getProjects(client);
      items.sort((a, b) => a.name.localeCompare(b.name));
      setProjects(items);
      if (items.length === 1) await pickProject(items[0].key);
    } catch (e) {
      setProjects(null);
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const pickProject = async (key: string) => {
    setProjectKey(key);
    setEnvironments(null);
    setEnvKey("");
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      const client = new LDClient({ instance, token });
      const envs = await getEnvironments(client, key);
      setEnvironments(envs);
      if (envs.length === 1) setEnvKey(envs[0].key);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-16 w-full max-w-lg">
      <div className="mb-8 flex flex-col items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer */}
        <img src={assetPath("/ld-logo-white.svg")} alt="LaunchDarkly" width={220} />
        <h1 className="ld-gradient-text text-2xl">Prerequisites Dashboard</h1>
        <p className="text-center text-sm">
          A hierarchical view of your feature flags and their (nested) prerequisite chains.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-ld-gray-05 bg-ld-gray-06/40 p-6">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-ld-white">LaunchDarkly instance</span>
          <select
            value={instance}
            onChange={(e) => setInstance(e.target.value as InstanceKey)}
            disabled={projects !== null}
            className="rounded-md border border-ld-gray-05 bg-ld-black px-3 py-2 text-ld-white focus:border-ld-blue focus:outline-none disabled:opacity-60"
          >
            {Object.entries(INSTANCES).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-ld-white">API access token</span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={projects !== null}
            placeholder="api-xxxxxxxx-xxxx-…"
            autoComplete="off"
            className="rounded-md border border-ld-gray-05 bg-ld-black px-3 py-2 font-mono text-ld-white placeholder:text-ld-gray-04 focus:border-ld-blue focus:outline-none disabled:opacity-60"
          />
          <span className="text-xs text-ld-gray-04">
            Use a <span className="text-ld-gray-03">read-only</span> token (Account settings →
            Authorization). Calls go straight from your browser to the LaunchDarkly API — the
            token is never sent anywhere else.
          </span>
        </label>

        {projects === null && (
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mt-0.5 accent-[#405BFF]"
            />
            <span>
              Remember this token on this device (localStorage). Leave unchecked on shared
              machines — by default the token is kept only until the tab closes.
            </span>
          </label>
        )}

        {projects === null ? (
          <button
            onClick={connect}
            disabled={busy || token.trim().length === 0}
            className="rounded-md bg-ld-blue px-4 py-2 text-sm font-medium text-ld-white transition-colors hover:bg-ld-blue-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Connecting…" : "Connect"}
          </button>
        ) : (
          <>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-ld-white">Project</span>
              <select
                value={projectKey}
                onChange={(e) => pickProject(e.target.value)}
                className="rounded-md border border-ld-gray-05 bg-ld-black px-3 py-2 text-ld-white focus:border-ld-blue focus:outline-none"
              >
                <option value="">Select a project…</option>
                {projects.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name} ({p.key})
                  </option>
                ))}
              </select>
            </label>

            {environments && (
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-ld-white">Environment</span>
                <select
                  value={envKey}
                  onChange={(e) => setEnvKey(e.target.value)}
                  className="rounded-md border border-ld-gray-05 bg-ld-black px-3 py-2 text-ld-white focus:border-ld-blue focus:outline-none"
                >
                  <option value="">Select an environment…</option>
                  {environments.map((env) => (
                    <option key={env.key} value={env.key}>
                      {env.name} ({env.key})
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => onDone({ instance, token: token.trim(), remember, projectKey, envKey })}
                disabled={busy || !projectKey || !envKey}
                className="flex-1 rounded-md bg-ld-blue px-4 py-2 text-sm font-medium text-ld-white transition-colors hover:bg-ld-blue-light disabled:cursor-not-allowed disabled:opacity-50"
              >
                Open dashboard
              </button>
              <button
                onClick={() => {
                  setProjects(null);
                  setEnvironments(null);
                  setProjectKey("");
                  setEnvKey("");
                }}
                className="rounded-md border border-ld-gray-05 px-4 py-2 text-sm text-ld-gray-03 transition-colors hover:text-ld-white"
              >
                Back
              </button>
            </div>
          </>
        )}

        {error && (
          <p className="rounded-md border border-ld-pink/40 bg-ld-pink/10 px-3 py-2 text-sm text-ld-pink">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function describeError(e: unknown): string {
  if (e instanceof LDApiError) {
    if (e.status === 401) return "Invalid API token for this instance (401). Check the token and the selected instance.";
    if (e.status === 403) return "This token does not have permission to list projects (403).";
    return `${e.message} (${e.status})`;
  }
  return e instanceof Error
    ? `${e.message} — check your network connection.`
    : "Unexpected error.";
}
