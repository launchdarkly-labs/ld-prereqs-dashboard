import { Credential, OAuthCredential, authorizationHeader } from "./credential";
import { refreshCredential } from "./oauth";
import { RateLimitedFetcher } from "./rate-limiter";
import { INSTANCES, InstanceKey, LDApiError, Paginated } from "./types";

export interface LDClientConfig {
  instance: InstanceKey;
  credential: Credential;
  fetcher?: RateLimitedFetcher;
  /** Called after an OAuth refresh so the caller can persist the new tokens. */
  onCredentialChange?: (credential: Credential) => void;
  /** Injectable for tests; defaults to a refresh through the OAuth proxy. */
  refresher?: (credential: OAuthCredential) => Promise<OAuthCredential>;
  now?: () => number;
}

/**
 * One queue for the whole app: every LDClient shares it by default, so setup
 * calls, the flag sweep, and detail-panel calls can never race each other
 * into a rate limit.
 */
export const sharedFetcher = new RateLimitedFetcher();

/** Refresh OAuth access tokens this long before they expire. */
const REFRESH_SKEW_MS = 60_000;

interface RequestOptions {
  params?: Record<string, string | number | undefined>;
  /** Send `LD-API-Version: beta` (needed for the dependent-flags endpoints). */
  beta?: boolean;
}

/** Thin typed wrapper over the LD REST API: auth, base URL by instance, pagination. */
export class LDClient {
  readonly instance: InstanceKey;
  private credential: Credential;
  private readonly fetcher: RateLimitedFetcher;
  private readonly onCredentialChange?: (credential: Credential) => void;
  private readonly refresher: (credential: OAuthCredential) => Promise<OAuthCredential>;
  private readonly now: () => number;

  constructor(cfg: LDClientConfig) {
    this.instance = cfg.instance;
    this.credential = cfg.credential;
    this.fetcher = cfg.fetcher ?? sharedFetcher;
    this.onCredentialChange = cfg.onCredentialChange;
    this.refresher = cfg.refresher ?? refreshCredential;
    this.now = cfg.now ?? (() => Date.now());
  }

  get apiBase(): string {
    return INSTANCES[this.instance].apiBase;
  }

  async get<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(path, this.apiBase);
    for (const [k, v] of Object.entries(opts.params ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    if (this.oauthExpiresSoon()) await this.tryRefresh();
    let res = await this.send(url, opts);
    // An OAuth access token can be revoked or expire early: refresh once and retry.
    if (res.status === 401 && this.canRefresh() && (await this.tryRefresh())) {
      res = await this.send(url, opts);
    }

    if (!res.ok) {
      let message = `LaunchDarkly API request failed (${res.status})`;
      try {
        const body = await res.json();
        if (body?.message) message = body.message;
      } catch {
        /* non-JSON error body */
      }
      throw new LDApiError(message, res.status, url.toString());
    }
    return (await res.json()) as T;
  }

  /**
   * Collect every page of a paginated endpoint by following `_links.next`
   * (more robust than computing offsets if LD adjusts page sizes server-side).
   */
  async getAllPages<T>(
    path: string,
    opts: RequestOptions = {},
    onProgress?: (fetched: number, total?: number) => void,
  ): Promise<T[]> {
    const items: T[] = [];
    let page = await this.get<Paginated<T>>(path, opts);
    for (;;) {
      items.push(...page.items);
      onProgress?.(items.length, page.totalCount);
      const next = page._links?.next?.href;
      if (!next) return items;
      // next hrefs are server-relative (e.g. /api/v2/flags/proj?offset=…) and
      // already carry every query param, including any beta flags' params.
      page = await this.get<Paginated<T>>(next, { beta: opts.beta });
    }
  }

  private send(url: URL, opts: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { Authorization: authorizationHeader(this.credential) };
    if (opts.beta) headers["LD-API-Version"] = "beta";
    return this.fetcher.fetch(url.toString(), { headers });
  }

  private canRefresh(): boolean {
    return this.credential.kind === "oauth" && !!this.credential.refreshToken;
  }

  private oauthExpiresSoon(): boolean {
    const c = this.credential;
    return (
      c.kind === "oauth" &&
      !!c.refreshToken &&
      c.expiresAt !== undefined &&
      c.expiresAt - this.now() < REFRESH_SKEW_MS
    );
  }

  /** Returns false (leaving the current token in place) if the refresh fails. */
  private async tryRefresh(): Promise<boolean> {
    if (this.credential.kind !== "oauth") return false;
    try {
      this.credential = await this.refresher(this.credential);
    } catch {
      return false;
    }
    this.onCredentialChange?.(this.credential);
    return true;
  }
}
