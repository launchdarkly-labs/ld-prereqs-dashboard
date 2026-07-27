/** LaunchDarkly REST API types — only the fields this dashboard consumes. */

export type InstanceKey = "commercial" | "eu";

export const INSTANCES: Record<InstanceKey, { label: string; apiBase: string; appBase: string }> = {
  eu: {
    label: "EU (app.eu.launchdarkly.com)",
    apiBase: "https://app.eu.launchdarkly.com",
    appBase: "https://app.eu.launchdarkly.com",
  },
  commercial: {
    label: "Commercial (app.launchdarkly.com)",
    apiBase: "https://app.launchdarkly.com",
    appBase: "https://app.launchdarkly.com",
  },
};

export interface Link {
  href: string;
  type?: string;
}

export interface Paginated<T> {
  items: T[];
  totalCount?: number;
  _links?: { next?: Link; [k: string]: Link | undefined };
}

export interface Project {
  key: string;
  name: string;
}

export interface Environment {
  key: string;
  name: string;
  color?: string;
}

export interface Prerequisite {
  key: string;
  /** Index into the prerequisite flag's `variations` array that must be served. */
  variation: number;
}

export interface Variation {
  _id?: string;
  value: unknown;
  name?: string;
  description?: string;
}

export interface FlagEnvironmentConfig {
  on: boolean;
  archived?: boolean;
  prerequisites?: Prerequisite[];
  offVariation?: number;
  fallthrough?: { variation?: number; rollout?: unknown };
  lastModified?: number;
  _environmentName?: string;
}

export interface FeatureFlag {
  key: string;
  name: string;
  kind: "boolean" | "multivariate" | string;
  description?: string;
  tags?: string[];
  archived?: boolean;
  temporary?: boolean;
  variations: Variation[];
  maintainer?: { email?: string; firstName?: string; lastName?: string };
  /** Absent for some flags (e.g. archived) even when `env` is requested. */
  environments?: Record<string, FlagEnvironmentConfig>;
  creationDate?: number;
}

export interface DependentFlag {
  key: string;
  name?: string;
}

export interface DependentFlagsResponse {
  items: DependentFlag[];
}

export class LDApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
  ) {
    super(message);
    this.name = "LDApiError";
  }
}

/** Thrown when retries are exhausted after repeated 429 responses. */
export class RateLimitError extends LDApiError {
  constructor(url: string) {
    super("Rate limit exceeded and retries exhausted. Wait a moment and try again.", 429, url);
    this.name = "RateLimitError";
  }
}
