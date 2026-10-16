import { describe, expect, it } from "vitest";
import { Credential, OAuthCredential } from "./credential";
import { LDClient } from "./ld-client";
import { RateLimitedFetcher } from "./rate-limiter";

function client(
  credential: Credential,
  statuses: number[],
  opts: { refresher?: (c: OAuthCredential) => Promise<OAuthCredential>; now?: number } = {},
) {
  const auth: string[] = [];
  const changes: Credential[] = [];
  let i = 0;
  const fetcher = new RateLimitedFetcher({
    fetchImpl: async (_url, init) => {
      auth.push((init?.headers as Record<string, string>).Authorization);
      const status = statuses[Math.min(i++, statuses.length - 1)];
      return new Response(JSON.stringify({ items: [] }), { status });
    },
  });
  const c = new LDClient({
    instance: "eu",
    credential,
    fetcher,
    refresher: opts.refresher,
    now: () => opts.now ?? 0,
    onCredentialChange: (cred) => changes.push(cred),
  });
  return { c, auth, changes };
}

const oauth: OAuthCredential = {
  kind: "oauth",
  instance: "eu",
  clientId: "client-1",
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: 3_600_000,
};
const refreshed: OAuthCredential = { ...oauth, accessToken: "access-2", expiresAt: 7_200_000 };

describe("LDClient auth", () => {
  it("sends a pasted API token raw, exactly as before OAuth support", async () => {
    const { c, auth } = client({ kind: "token", token: "  api-123  " }, [200]);
    await c.get("/api/v2/projects");
    expect(auth).toEqual(["api-123"]);
  });

  it("does not retry a 401 for an API token", async () => {
    const { c, auth } = client({ kind: "token", token: "api-123" }, [401]);
    await expect(c.get("/api/v2/projects")).rejects.toMatchObject({ status: 401 });
    expect(auth).toHaveLength(1);
  });

  it("sends OAuth access tokens as Bearer", async () => {
    const { c, auth } = client(oauth, [200]);
    await c.get("/api/v2/projects");
    expect(auth).toEqual(["Bearer access-1"]);
  });

  it("refreshes once on 401, retries, and reports the new credential", async () => {
    const { c, auth, changes } = client(oauth, [401, 200], { refresher: async () => refreshed });
    await c.get("/api/v2/projects");
    expect(auth).toEqual(["Bearer access-1", "Bearer access-2"]);
    expect(changes).toEqual([refreshed]);
  });

  it("surfaces the 401 when the refresh itself fails", async () => {
    const { c, auth } = client(oauth, [401], {
      refresher: async () => {
        throw new Error("invalid_grant");
      },
    });
    await expect(c.get("/api/v2/projects")).rejects.toMatchObject({ status: 401 });
    expect(auth).toHaveLength(1);
  });

  it("refreshes proactively when the access token is about to expire", async () => {
    const { c, auth } = client(oauth, [200], {
      refresher: async () => refreshed,
      now: oauth.expiresAt! - 10_000,
    });
    await c.get("/api/v2/projects");
    expect(auth).toEqual(["Bearer access-2"]);
  });
});
