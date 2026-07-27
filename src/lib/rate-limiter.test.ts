import { describe, expect, it } from "vitest";
import { RateLimitedFetcher } from "./rate-limiter";
import { RateLimitError } from "./types";

/**
 * Deterministic harness: virtual clock, sleep() advances it instantly, and a
 * scripted fetch records the virtual time of every attempt.
 */
function harness(
  script: Array<{ status: number; headers?: Record<string, string> }>,
  opts: Partial<ConstructorParameters<typeof RateLimitedFetcher>[0]> = {},
) {
  let now = 1_000_000;
  const calls: Array<{ url: string; at: number }> = [];
  let i = 0;

  const fetcher = new RateLimitedFetcher({
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    random: () => 0, // no jitter in tests
    fetchImpl: async (url) => {
      calls.push({ url, at: now });
      const step = script[Math.min(i++, script.length - 1)];
      return new Response(step.status === 204 ? null : "{}", {
        status: step.status,
        headers: step.headers,
      });
    },
    ...opts,
  });

  return { fetcher, calls, time: () => now, startedAt: 1_000_000 };
}

describe("RateLimitedFetcher", () => {
  it("passes successful responses straight through", async () => {
    const { fetcher, calls } = harness([{ status: 200 }]);
    const res = await fetcher.fetch("https://api/x");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("waits Retry-After seconds on 429, then retries", async () => {
    const { fetcher, calls, startedAt } = harness([
      { status: 429, headers: { "Retry-After": "3" } },
      { status: 200 },
    ]);
    const res = await fetcher.fetch("https://api/x");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1].at - startedAt).toBeGreaterThanOrEqual(3000);
  });

  it("falls back to X-Ratelimit-Reset when Retry-After is absent", async () => {
    const { fetcher, calls, startedAt } = harness([
      { status: 429, headers: { "X-Ratelimit-Reset": String(1_000_000 + 5000) } },
      { status: 200 },
    ]);
    await fetcher.fetch("https://api/x");
    expect(calls[1].at - startedAt).toBeGreaterThanOrEqual(5000);
  });

  it("uses capped exponential backoff when no headers are present", async () => {
    const { fetcher, calls, startedAt } = harness([
      { status: 429 },
      { status: 429 },
      { status: 429 },
      { status: 200 },
    ]);
    await fetcher.fetch("https://api/x");
    // 1s + 2s + 4s
    expect(calls[3].at - startedAt).toBeGreaterThanOrEqual(7000);
  });

  it("adds jitter to every wait", async () => {
    const { fetcher, calls, startedAt } = harness(
      [{ status: 429, headers: { "Retry-After": "1" } }, { status: 200 }],
      { random: () => 1 },
    );
    await fetcher.fetch("https://api/x");
    expect(calls[1].at - startedAt).toBeGreaterThanOrEqual(1500);
  });

  it("throws RateLimitError once retries are exhausted", async () => {
    const { fetcher, calls } = harness([{ status: 429 }], { maxRetries: 2 });
    await expect(fetcher.fetch("https://api/x")).rejects.toBeInstanceOf(RateLimitError);
    expect(calls).toHaveLength(3); // initial + 2 retries
  });

  it("proactively pauses until reset when the remaining budget runs low", async () => {
    const { fetcher, calls, startedAt } = harness([
      {
        status: 200,
        headers: {
          "X-Ratelimit-Route-Remaining": "1",
          "X-Ratelimit-Reset": String(1_000_000 + 4000),
        },
      },
      { status: 200 },
    ]);
    await fetcher.fetch("https://api/one");
    await fetcher.fetch("https://api/two");
    expect(calls[1].at - startedAt).toBeGreaterThanOrEqual(4000);
  });

  it("does not pause while plenty of budget remains", async () => {
    const { fetcher, calls, startedAt } = harness([
      { status: 200, headers: { "X-Ratelimit-Route-Remaining": "50" } },
      { status: 200 },
    ]);
    await fetcher.fetch("https://api/one");
    await fetcher.fetch("https://api/two");
    expect(calls[1].at - startedAt).toBe(0);
  });

  it("limits concurrent requests to the configured concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetcher = new RateLimitedFetcher({
      concurrency: 2,
      fetchImpl: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return new Response("{}", { status: 200 });
      },
    });
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => fetcher.fetch(`https://api/${i}`)),
    );
    expect(peak).toBe(2);
  });
});
