import { FeatureFlag, InstanceKey } from "./types";

/**
 * Client-side persistence for a fully static app.
 *
 * The API token stays in sessionStorage by default (cleared when the tab
 * closes); "remember on this device" moves it to localStorage. Everything
 * else (instance/project/env selection, flag cache) lives in localStorage.
 */

const TOKEN_KEY = "ld-dash.token";
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

export function loadToken(): { token: string; remembered: boolean } | null {
  if (!isBrowser) return null;
  const session = sessionStorage.getItem(TOKEN_KEY);
  if (session) return { token: session, remembered: false };
  const local = localStorage.getItem(TOKEN_KEY);
  if (local) return { token: local, remembered: true };
  return null;
}

export function saveToken(token: string, remember: boolean): void {
  if (!isBrowser) return;
  clearToken();
  (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (!isBrowser) return;
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
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
