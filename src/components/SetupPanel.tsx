"use client";

import { useEffect, useState } from "react";
import { assetPath } from "@/lib/asset-path";
import { Credential, OAuthCredential } from "@/lib/credential";
import { getEnvironments, getProjects } from "@/lib/ld-api";
import { LDClient } from "@/lib/ld-client";
import { beginLogin, oauthEnabled } from "@/lib/oauth";
import { Environment, INSTANCES, InstanceKey, LDApiError, Project } from "@/lib/types";

export interface SetupResult {
  instance: InstanceKey;
  credential: Credential;
  remember: boolean;
  projectKey: string;
  envKey: string;
}

interface SetupPanelProps {
  initialInstance: InstanceKey;
  initialCredential?: Credential;
  initialRemember?: boolean;
  /** Shown on first render, e.g. a failed "Sign in with LaunchDarkly" redirect. */
  initialError?: string | null;
  /** Refreshed OAuth tokens, to persist right away (a refresh may rotate the refresh token). */
  onCredentialChange?: (credential: Credential, remember: boolean) => void;
  onDone: (result: SetupResult) => void;
}

type AuthMode = "token" | "oauth";

// The OAuth option only exists in builds configured with a proxy + client id;
// otherwise this panel is exactly the pasted-token form.
const OAUTH_AVAILABLE = (Object.keys(INSTANCES) as InstanceKey[]).some((k) => oauthEnabled(k));

export function SetupPanel({
  initialInstance,
  initialCredential,
  initialRemember,
  initialError,
  onCredentialChange,
  onDone,
}: SetupPanelProps) {
  const [instance, setInstance] = useState<InstanceKey>(
    initialCredential?.kind === "oauth" ? initialCredential.instance : initialInstance,
  );
  // initialError only ever comes from a failed sign-in redirect, so reopen that
  // tab — but only if this build can sign in at all (e.g. not after a rollback).
  const [mode, setMode] = useState<AuthMode>(
    OAUTH_AVAILABLE && (initialCredential?.kind === "oauth" || initialError) ? "oauth" : "token",
  );
  const [token, setToken] = useState(initialCredential?.kind === "token" ? initialCredential.token : "");
  const [oauthCred, setOauthCred] = useState<OAuthCredential | null>(
    initialCredential?.kind === "oauth" ? initialCredential : null,
  );
  const [remember, setRemember] = useState(initialRemember ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const credential: Credential | null =
    mode === "oauth" ? oauthCred : token.trim() ? { kind: "token", token: token.trim() } : null;
  // OAuth tokens are bound to the instance they were issued by, whatever the selector says.
  const instanceFor = (cred: Credential) => (cred.kind === "oauth" ? cred.instance : instance);
  const makeClient = (cred: Credential) =>
    new LDClient({
      instance: instanceFor(cred),
      credential: cred,
      onCredentialChange: (c) => {
        if (c.kind === "oauth") setOauthCred(c);
        onCredentialChange?.(c, remember);
      },
    });

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectKey, setProjectKey] = useState("");
  const [environments, setEnvironments] = useState<Environment[] | null>(null);
  const [envKey, setEnvKey] = useState("");

  const connect = async () => {
    if (!credential) return;
    setBusy(true);
    setError(null);
    try {
      const client = makeClient(credential);
      const items = await getProjects(client);
      items.sort((a, b) => a.name.localeCompare(b.name));
      setProjects(items);
      if (items.length === 1) await pickProject(items[0].key);
    } catch (e) {
      setProjects(null);
      setError(describeError(e, mode));
    } finally {
      setBusy(false);
    }
  };

  const pickProject = async (key: string) => {
    setProjectKey(key);
    setEnvironments(null);
    setEnvKey("");
    if (!key || !credential) return;
    setBusy(true);
    setError(null);
    try {
      const client = makeClient(credential);
      const envs = await getEnvironments(client, key);
      setEnvironments(envs);
      if (envs.length === 1) setEnvKey(envs[0].key);
    } catch (e) {
      setError(describeError(e, mode));
    } finally {
      setBusy(false);
    }
  };

  // Back from the LaunchDarkly consent screen: go straight to the project picker.
  // Fetching from the LD API (an external system) is the effect's job here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    if (initialCredential?.kind === "oauth" && !initialError) void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await beginLogin(instance, remember); // navigates away on success
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start sign-in.");
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
            disabled={projects !== null || (mode === "oauth" && oauthCred !== null)}
            className="rounded-md border border-ld-gray-05 bg-ld-black px-3 py-2 text-ld-white focus:border-ld-blue focus:outline-none disabled:opacity-60"
          >
            {Object.entries(INSTANCES).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {OAUTH_AVAILABLE && projects === null && (
          <div className="flex rounded-md border border-ld-gray-05 p-0.5 text-sm" role="tablist">
            {(
              [
                ["token", "API token"],
                ["oauth", "Sign in with LaunchDarkly"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  setError(null);
                  if (m === "oauth" && oauthCred) setInstance(oauthCred.instance);
                }}
                className={`flex-1 rounded px-3 py-1.5 transition-colors ${
                  mode === m ? "bg-ld-gray-05 text-ld-white" : "text-ld-gray-03 hover:text-ld-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {mode === "token" ? (
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
        ) : oauthCred ? (
          <p className="flex items-center gap-2 text-sm">
            <span className="text-ld-white">Signed in with LaunchDarkly.</span>
            {projects === null && (
              <button
                onClick={() => setOauthCred(null)}
                className="text-ld-blue-light hover:underline"
              >
                Use a different account
              </button>
            )}
          </p>
        ) : (
          <p className="text-xs text-ld-gray-04">
            {oauthEnabled(instance)
              ? "You'll be sent to LaunchDarkly to approve read-only access, then brought back here. LaunchDarkly will show this app as not verified — that's expected for self-registered apps."
              : "Sign-in is not configured for this instance. Use an API token instead."}
          </p>
        )}

        {projects === null && (
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mt-0.5 accent-[#405BFF]"
            />
            <span>
              {mode === "token"
                ? "Remember this token on this device (localStorage). Leave unchecked on shared machines — by default the token is kept only until the tab closes."
                : "Stay signed in on this device (localStorage). Leave unchecked on shared machines — by default you're signed out when the tab closes."}
            </span>
          </label>
        )}

        {projects === null && mode === "oauth" && !oauthCred ? (
          <button
            onClick={signIn}
            disabled={busy || !oauthEnabled(instance)}
            className="rounded-md bg-ld-blue px-4 py-2 text-sm font-medium text-ld-white transition-colors hover:bg-ld-blue-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Redirecting…" : "Sign in with LaunchDarkly"}
          </button>
        ) : projects === null ? (
          <button
            onClick={connect}
            disabled={busy || credential === null}
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
                onClick={() =>
                  credential &&
                  onDone({ instance: instanceFor(credential), credential, remember, projectKey, envKey })
                }
                disabled={busy || !credential || !projectKey || !envKey}
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

function describeError(e: unknown, mode: AuthMode): string {
  if (e instanceof LDApiError) {
    if (e.status === 401) {
      return mode === "token"
        ? "Invalid API token for this instance (401). Check the token and the selected instance."
        : "LaunchDarkly rejected the sign-in (401). Use a different account and sign in again.";
    }
    if (e.status === 403) {
      return mode === "token"
        ? "This token does not have permission to list projects (403)."
        : "Your LaunchDarkly account does not have permission to list projects (403).";
    }
    return `${e.message} (${e.status})`;
  }
  return e instanceof Error
    ? `${e.message} — check your network connection.`
    : "Unexpected error.";
}
