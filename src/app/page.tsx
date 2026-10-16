"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DetailPanel } from "@/components/DetailPanel";
import { FlagTree, TreeDirection, collectAllPaths } from "@/components/FlagTree";
import { SetupPanel, SetupResult } from "@/components/SetupPanel";
import { FilterMode, StatsBar, Toolbar } from "@/components/Toolbar";
import { assetPath } from "@/lib/asset-path";
import { Credential } from "@/lib/credential";
import { getAllFlags } from "@/lib/ld-api";
import { LDClient } from "@/lib/ld-client";
import { completeLogin, isOAuthCallback, revokeCredential } from "@/lib/oauth";
import { buildGraph } from "@/lib/prereq-graph";
import {
  clearCredential,
  loadCredential,
  loadFlagCache,
  loadSettings,
  saveCredential,
  saveFlagCache,
  saveSettings,
} from "@/lib/storage";
import { FeatureFlag, InstanceKey, LDApiError, RateLimitError } from "@/lib/types";

interface Session {
  instance: InstanceKey;
  credential: Credential;
  remember: boolean;
  projectKey: string;
  envKey: string;
}

interface FlagData {
  flags: FeatureFlag[];
  fetchedAt: number;
}

export default function Home() {
  // Static export pre-renders this page; wait for mount before touching storage.
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [editingSetup, setEditingSetup] = useState(false);
  /** Result of a "Sign in with LaunchDarkly" redirect that still needs a project/env. */
  const [signedIn, setSignedIn] = useState<{ credential: Credential; remember: boolean } | null>(
    null,
  );
  const [signInError, setSignInError] = useState<string | null>(null);

  const [data, setData] = useState<FlagData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<{ fetched: number; total?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [direction, setDirection] = useState<TreeDirection>("dependents");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("roots");
  const [tag, setTag] = useState("");
  /** null = "everything expanded"; starts collapsed — apex flags can have hundreds of dependents. */
  const [expanded, setExpanded] = useState<Set<string> | null>(new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  /** Persist refreshed OAuth tokens and hand them to the next client. */
  const credentialSaver = useCallback(
    (remember: boolean) => (credential: Credential) => {
      saveCredential(credential, remember);
      setSession((prev) => (prev ? { ...prev, credential } : prev));
    },
    [],
  );

  const refresh = useCallback(async (s: Session) => {
    setRefreshing(true);
    setError(null);
    setProgress(null);
    try {
      const client = new LDClient({
        instance: s.instance,
        credential: s.credential,
        onCredentialChange: credentialSaver(s.remember),
      });
      const flags = await getAllFlags(client, s.projectKey, s.envKey, (fetched, total) =>
        setProgress({ fetched, total }),
      );
      setData({ flags, fetchedAt: Date.now() });
      saveFlagCache(s.instance, s.projectKey, s.envKey, flags);
    } catch (e) {
      setError(describeError(e, s.credential.kind));
    } finally {
      setRefreshing(false);
      setProgress(null);
    }
  }, [credentialSaver]);

  /** Show the cached sweep instantly; fetch only when there is no cache. */
  const openSession = useCallback(
    (s: Session) => {
      setSession(s);
      setSelectedKey(null);
      setExpanded(new Set());
      setError(null);
      const cache = loadFlagCache(s.instance, s.projectKey, s.envKey);
      setData(cache ? { flags: cache.flags, fetchedAt: cache.fetchedAt } : null);
      if (!cache) void refresh(s);
    },
    [refresh],
  );

  // One-time client boot: hydrate from web storage (an external system) —
  // the documented case where an effect must set state.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const settings = loadSettings();
    const url = new URL(window.location.href);
    if (isOAuthCallback(url)) {
      // Back from LaunchDarkly's consent screen: drop code/state from the URL first.
      window.history.replaceState(null, "", url.pathname);
      completeLogin(url)
        .then(({ credential, remember }) => {
          saveCredential(credential, remember);
          if (settings.instance === credential.instance && settings.projectKey && settings.envKey) {
            openSession({
              instance: credential.instance,
              credential,
              remember,
              projectKey: settings.projectKey,
              envKey: settings.envKey,
            });
          } else {
            setSignedIn({ credential, remember });
          }
        })
        .catch((e) => setSignInError(e instanceof Error ? e.message : "Sign-in failed."))
        .finally(() => setMounted(true));
      return;
    }

    const stored = loadCredential();
    if (stored && settings.projectKey && settings.envKey) {
      openSession({
        instance: settings.instance,
        credential: stored.credential,
        remember: stored.remembered,
        projectKey: settings.projectKey,
        envKey: settings.envKey,
      });
    }
    setMounted(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const client = useMemo(
    () =>
      session
        ? new LDClient({
            instance: session.instance,
            credential: session.credential,
            onCredentialChange: credentialSaver(session.remember),
          })
        : null,
    [session, credentialSaver],
  );

  const graph = useMemo(
    () => (data && session ? buildGraph(data.flags, session.envKey) : null),
    [data, session],
  );

  const allTags = useMemo(() => {
    if (!graph) return [];
    const tags = new Set<string>();
    for (const node of graph.nodes.values()) {
      for (const t of node.flag.tags ?? []) tags.add(t);
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
  }, [graph]);

  const topLevelKeys = useMemo(() => {
    if (!graph) return [];
    const term = search.trim().toLowerCase();
    const matches = (key: string) => {
      const { flag } = graph.nodes.get(key)!;
      if (tag && !(flag.tags ?? []).includes(tag)) return false;
      if (!term) return true;
      return (
        flag.name.toLowerCase().includes(term) ||
        flag.key.toLowerCase().includes(term) ||
        (flag.tags ?? []).some((t) => t.toLowerCase().includes(term))
      );
    };
    const byName = (a: string, b: string) =>
      graph.nodes.get(a)!.flag.name.localeCompare(graph.nodes.get(b)!.flag.name);

    let keys: string[];
    switch (filter) {
      case "roots":
        // Roots of the current direction. A search or tag filter widens the
        // scope to every matching flag, so e.g. selecting the "release" tag
        // surfaces every release flag as a top-level row wherever it sits in
        // the graph.
        keys =
          term || tag
            ? [...graph.nodes.keys()]
            : direction === "dependents"
              ? graph.dependentRoots
              : graph.chainRoots;
        break;
      case "all":
        keys = [...graph.nodes.keys()];
        break;
      case "has-prereqs":
        keys = [...graph.nodes.keys()].filter((k) => graph.nodes.get(k)!.prerequisites.length > 0);
        break;
      case "is-prereq":
        keys = [...graph.nodes.keys()].filter((k) => graph.nodes.get(k)!.dependents.length > 0);
        break;
      case "at-risk":
        keys = [...graph.nodes.keys()].filter((k) => graph.nodes.get(k)!.atRisk);
        break;
    }
    return keys.filter(matches).sort(byName);
  }, [graph, direction, filter, search, tag]);

  const handleSetupDone = (result: SetupResult) => {
    saveCredential(result.credential, result.remember);
    saveSettings({ instance: result.instance, projectKey: result.projectKey, envKey: result.envKey });
    setEditingSetup(false);
    setSignedIn(null);
    setSignInError(null);
    openSession(result);
  };

  const signOut = () => {
    if (session?.credential.kind === "oauth") void revokeCredential(session.credential);
    clearCredential();
    setSession(null);
    setData(null);
    setEditingSetup(false);
  };

  if (!mounted) return null;

  if (!session || editingSetup) {
    return (
      <main className="flex-1 px-6 pb-16">
        <SetupPanel
          initialInstance={session?.instance ?? loadSettings().instance}
          initialCredential={session?.credential ?? signedIn?.credential}
          initialRemember={session?.remember ?? signedIn?.remember}
          initialError={signInError}
          onDone={handleSetupDone}
        />
        {session && (
          <p className="mt-4 text-center">
            <button
              onClick={() => setEditingSetup(false)}
              className="text-sm text-ld-blue-light hover:underline"
            >
              ← Back to dashboard
            </button>
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-6 py-6">
      <header className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer */}
        <img src={assetPath("/ld-logo-white.svg")} alt="LaunchDarkly" width={160} />
        <h1 className="text-lg">Prerequisites Dashboard</h1>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-ld-gray-03">
            <span className="font-medium text-ld-white">{session.projectKey}</span>
            {" / "}
            <span className="font-medium text-ld-white">{session.envKey}</span>
            <span className="ml-2 rounded-full border border-ld-gray-05 px-2 py-0.5 text-[11px] uppercase">
              {session.instance}
            </span>
          </span>
          <button
            onClick={() => setEditingSetup(true)}
            className="rounded-md border border-ld-gray-05 px-3 py-1.5 text-ld-gray-03 transition-colors hover:text-ld-white"
          >
            Change
          </button>
          <button
            onClick={signOut}
            className="rounded-md border border-ld-gray-05 px-3 py-1.5 text-ld-gray-03 transition-colors hover:text-ld-white"
            title={
              session.credential.kind === "oauth"
                ? "Sign out of LaunchDarkly on this device"
                : "Forget the API token on this device"
            }
          >
            Sign out
          </button>
        </div>
      </header>

      {error && (
        <div className="flex items-center gap-3 rounded-md border border-ld-pink/40 bg-ld-pink/10 px-4 py-3 text-sm text-ld-pink">
          <span>{error}</span>
          <button
            onClick={() => refresh(session)}
            className="ml-auto rounded-md border border-ld-pink/60 px-3 py-1 hover:bg-ld-pink/20"
          >
            Retry
          </button>
        </div>
      )}

      {!graph ? (
        !error && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24">
            <Spinner />
            <p className="text-sm">
              Loading flags…
              {progress && (
                <span className="ml-1 font-mono text-ld-gray-04">
                  {progress.fetched}
                  {progress.total ? ` / ${progress.total}` : ""}
                </span>
              )}
            </p>
            <p className="max-w-md text-center text-xs text-ld-gray-04">
              One paginated sweep of the flags endpoint — prerequisites for every flag come back
              in the same response, so this is the only bulk call the dashboard ever makes.
            </p>
          </div>
        )
      ) : (
        <>
          <StatsBar stats={graph.stats} />
          <Toolbar
            direction={direction}
            onDirection={(d) => {
              setDirection(d);
              setExpanded(new Set()); // paths are direction-specific
            }}
            search={search}
            onSearch={setSearch}
            filter={filter}
            onFilter={setFilter}
            tags={allTags}
            tag={tag}
            onTag={setTag}
            onExpandAll={() => setExpanded(null)}
            onCollapseAll={() => setExpanded(new Set())}
            onRefresh={() => refresh(session)}
            refreshing={refreshing}
            fetchedAt={data?.fetchedAt ?? null}
          />
          {refreshing && progress && (
            <p className="text-xs text-ld-gray-04">
              Refreshing… {progress.fetched}
              {progress.total ? ` / ${progress.total}` : ""} flags
            </p>
          )}
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <FlagTree
                graph={graph}
                direction={direction}
                topLevelKeys={topLevelKeys}
                expanded={expanded}
                onToggle={(path) =>
                  setExpanded((prev) => {
                    // null = all expanded: materialize the full set, then toggle.
                    const next = new Set(
                      prev ?? collectAllPaths(graph, [...graph.nodes.keys()], direction),
                    );
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  })
                }
                selectedKey={selectedKey}
                onSelect={(key) => setSelectedKey((prev) => (prev === key ? null : key))}
              />
            </div>
            {selectedKey && client && (
              <DetailPanel
                graph={graph}
                flagKey={selectedKey}
                client={client}
                projectKey={session.projectKey}
                envKey={session.envKey}
                onSelect={setSelectedKey}
                onClose={() => setSelectedKey(null)}
              />
            )}
          </div>
        </>
      )}
    </main>
  );
}

function Spinner() {
  return (
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-ld-gray-05 border-t-ld-blue" />
  );
}

function describeError(e: unknown, kind: Credential["kind"]): string {
  if (e instanceof RateLimitError) {
    return "LaunchDarkly rate limit reached and retries were exhausted. Wait a minute, then retry.";
  }
  if (e instanceof LDApiError) {
    if (e.status === 401) {
      return kind === "token"
        ? "The API token was rejected (401). Sign out and enter a valid token."
        : "Your LaunchDarkly session has expired (401). Sign out and sign in again.";
    }
    if (e.status === 403) {
      return kind === "token"
        ? "The token lacks permission to read this project's flags (403)."
        : "Your LaunchDarkly account lacks permission to read this project's flags (403).";
    }
    if (e.status === 404) return "Project or environment not found (404) — it may have been deleted.";
    return `${e.message} (${e.status})`;
  }
  return e instanceof Error ? `${e.message} — check your network connection.` : "Unexpected error.";
}
