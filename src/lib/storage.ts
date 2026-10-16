import { Credential, OAuthCredential } from "./credential";
import { FeatureFlag, InstanceKey } from "./types";

/**
 * Client-side persistence for a fully static app.
 *
 * The credential (pasted API token, or OAuth tokens from "Sign in with
 * LaunchDarkly") stays in sessionStorage by default (cleared when the tab
 * closes); "remember on this device" moves it to localStorage. Everything
 * else (instance/project/env selection, flag cache) lives in localStorage.
 */

const TOKEN_KEY = "ld-dash.token"; // raw string — format unchanged so existing sessions survive
const OAUTH_KEY = "ld-dash.oauth";
const SETTINGS_KEY = "ld-dash.settings";
const CACHE_PREFIX = "ld-dash.cache";

export interface Settings {
  instance: InstanceKey;
  projectKey?: string;
  envKey?: string;
}

export interface FlagCache {
  fetchedAt: number;
  flags: FeatureFlag[];
}

const isBrowser = typeof window !== "undefined";

function readJson<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: Storage, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // quota exceeded or storage disabled — treat as best-effort
  }
}

/** sessionStorage wins over localStorage; within each, an OAuth sign-in wins over a pasted token. */
export function loadCredential(): { credential: Credential; remembered: boolean } | null {
  if (!isBrowser) return null;
  for (const [storage, remembered] of [
    [sessionStorage, false],
    [localStorage, true],
  ] as const) {
    const oauth = readJson<OAuthCredential>(storage, OAUTH_KEY);
    if (oauth?.kind === "oauth" && oauth.accessToken) return { credential: oauth, remembered };
    const token = storage.getItem(TOKEN_KEY);
    if (token) return { credential: { kind: "token", token }, remembered };
  }
  return null;
}

export function saveCredential(credential: Credential, remember: boolean): void {
  if (!isBrowser) return;
  clearCredential();
  const storage = remember ? localStorage : sessionStorage;
  if (credential.kind === "token") storage.setItem(TOKEN_KEY, credential.token);
  else writeJson(storage, OAUTH_KEY, credential);
}

/** The stored OAuth credential, for cross-tab refresh coordination (src/lib/oauth.ts). */
export const oauthCredentialStore = {
  read(): OAuthCredential | null {
    const stored = loadCredential();
    return stored?.credential.kind === "oauth" ? stored.credential : null;
  },
  write(credential: OAuthCredential): void {
    const stored = loadCredential();
    if (stored) saveCredential(credential, stored.remembered);
  },
};

export function clearCredential(): void {
  if (!isBrowser) return;
  for (const storage of [sessionStorage, localStorage]) {
    storage.removeItem(TOKEN_KEY);
    storage.removeItem(OAUTH_KEY);
  }
}

export function loadSettings(): Settings {
  if (!isBrowser) return { instance: "eu" };
  return readJson<Settings>(localStorage, SETTINGS_KEY) ?? { instance: "eu" };
}

export function saveSettings(settings: Settings): void {
  if (!isBrowser) return;
  writeJson(localStorage, SETTINGS_KEY, settings);
}

function cacheKey(instance: InstanceKey, projectKey: string, envKey: string): string {
  return `${CACHE_PREFIX}.${instance}.${projectKey}.${envKey}`;
}

export function loadFlagCache(
  instance: InstanceKey,
  projectKey: string,
  envKey: string,
): FlagCache | null {
  if (!isBrowser) return null;
  return readJson<FlagCache>(localStorage, cacheKey(instance, projectKey, envKey));
}

export function saveFlagCache(
  instance: InstanceKey,
  projectKey: string,
  envKey: string,
  flags: FeatureFlag[],
): void {
  if (!isBrowser) return;
  writeJson(localStorage, cacheKey(instance, projectKey, envKey), {
    fetchedAt: Date.now(),
    flags,
  } satisfies FlagCache);
}
