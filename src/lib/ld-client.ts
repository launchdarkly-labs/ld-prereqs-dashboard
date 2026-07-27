import { RateLimitedFetcher } from "./rate-limiter";
import { INSTANCES, InstanceKey, LDApiError, Paginated } from "./types";

export interface LDClientConfig {
  instance: InstanceKey;
  token: string;
  fetcher?: RateLimitedFetcher;
}

/**
 * One queue for the whole app: every LDClient shares it by default, so setup
 * calls, the flag sweep, and detail-panel calls can never race each other
 * into a rate limit.
 */
export const sharedFetcher = new RateLimitedFetcher();

interface RequestOptions {
  params?: Record<string, string | number | undefined>;
  /** Send `LD-API-Version: beta` (needed for the dependent-flags endpoints). */
  beta?: boolean;
}

/** Thin typed wrapper over the LD REST API: auth, base URL by instance, pagination. */
export class LDClient {
  readonly instance: InstanceKey;
  private readonly token: string;
  private readonly fetcher: RateLimitedFetcher;

  constructor(cfg: LDClientConfig) {
    this.instance = cfg.instance;
    this.token = cfg.token.trim();
    this.fetcher = cfg.fetcher ?? sharedFetcher;
  }

  get apiBase(): string {
    return INSTANCES[this.instance].apiBase;
  }

  async get<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(path, this.apiBase);
    for (const [k, v] of Object.entries(opts.params ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = { Authorization: this.token };
    if (opts.beta) headers["LD-API-Version"] = "beta";

    const res = await this.fetcher.fetch(url.toString(), { headers });
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
}
