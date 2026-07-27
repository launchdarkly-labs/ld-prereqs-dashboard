import { RateLimitError } from "./types";

/**
 * All LaunchDarkly API traffic goes through one instance of this queue so the
 * dashboard never races itself into a rate limit:
 *
 * - at most `concurrency` requests in flight;
 * - after every response the `X-Ratelimit-*` headers are inspected, and when
 *   the remaining budget runs low the whole queue pauses until the reported
 *   reset time (proactive — avoids the 429 instead of reacting to it);
 * - a 429 pauses the queue for `Retry-After` seconds (or until
 *   `X-Ratelimit-Reset`, or an exponential fallback), always with jitter,
 *   and the request is retried up to `maxRetries` times.
 */

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface RateLimitedFetcherOptions {
  concurrency?: number;
  maxRetries?: number;
  /** Upper bound for any single wait, ms. */
  maxDelayMs?: number;
  /** Pause proactively when the reported remaining budget drops below this. */
  minRemaining?: number;
  /* Injectable for tests. */
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RateLimitedFetcher {
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly maxDelayMs: number;
  private readonly minRemaining: number;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;

  private active = 0;
  private waiters: Array<() => void> = [];
  /** Epoch ms before which no request may be sent. Shared across the queue. */
  private pausedUntil = 0;

  constructor(opts: RateLimitedFetcherOptions = {}) {
    this.concurrency = opts.concurrency ?? 2;
    this.maxRetries = opts.maxRetries ?? 6;
    this.maxDelayMs = opts.maxDelayMs ?? 30_000;
    this.minRemaining = opts.minRemaining ?? 3;
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? (() => Date.now());
    this.random = opts.random ?? Math.random;
  }

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    await this.acquire();
    try {
      for (let attempt = 0; ; attempt++) {
        await this.waitWhilePaused();
        const res = await this.fetchImpl(url, init);
        this.noteHeaders(res);
        if (res.status !== 429) return res;
        if (attempt >= this.maxRetries) throw new RateLimitError(url);
        this.pauseFor(this.retryDelayMs(res, attempt));
      }
    } finally {
      this.release();
    }
  }

  private jitter(): number {
    return this.random() * 500;
  }

  /** Delay for a 429: Retry-After wins, then X-Ratelimit-Reset, then exponential fallback. */
  private retryDelayMs(res: Response, attempt: number): number {
    const retryAfter = Number(res.headers.get("Retry-After"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000 + this.jitter();

    const reset = Number(res.headers.get("X-Ratelimit-Reset"));
    if (Number.isFinite(reset) && reset > this.now()) return reset - this.now() + this.jitter();

    return Math.min(1000 * 2 ** attempt, this.maxDelayMs) + this.jitter();
  }

  /** Proactive pause: when the route/global budget runs low, wait for the reset. */
  private noteHeaders(res: Response): void {
    const remainingHeaders = [
      res.headers.get("X-Ratelimit-Route-Remaining"),
      res.headers.get("X-Ratelimit-Global-Remaining"),
    ].filter((v): v is string => v !== null);
    if (remainingHeaders.length === 0) return;

    const remaining = Math.min(...remainingHeaders.map(Number));
    if (!Number.isFinite(remaining) || remaining >= this.minRemaining) return;

    const reset = Number(res.headers.get("X-Ratelimit-Reset"));
    if (Number.isFinite(reset) && reset > this.now()) {
      this.pauseFor(reset - this.now() + this.jitter());
    }
  }

  private pauseFor(ms: number): void {
    const until = this.now() + Math.min(Math.max(ms, 0), this.maxDelayMs);
    if (until > this.pausedUntil) this.pausedUntil = until;
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.pausedUntil > this.now()) {
      await this.sleep(this.pausedUntil - this.now());
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(() => resolve()));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }
}
