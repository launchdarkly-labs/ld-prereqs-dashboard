import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../test/web-storage";
import type { OAuthCredential } from "./credential";
import {
  OAuthConfig,
  beginLogin,
  completeLogin,
  oauthEnabled,
  pkceChallenge,
  CredentialStore,
  refreshAcrossTabs,
  refreshCredential,
  revokeCredential,
} from "./oauth";

const config: OAuthConfig = {
  proxyUrl: "https://proxy.example/",
  clientIds: { eu: "client-eu" },
};

const session = new MemoryStorage();
let assigned = "";

beforeEach(() => {
  session.clear();
  assigned = "";
  vi.stubGlobal("sessionStorage", session);
  vi.stubGlobal("window", {
    location: {
      origin: "https://dash.example",
      assign: (url: string) => {
        assigned = url;
      },
    },
  });
});

function tokenFetch(body: object, status = 200) {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body as URLSearchParams });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("oauth", () => {
  it("is disabled unless both the proxy and a client id are configured", () => {
    expect(oauthEnabled("eu", config)).toBe(true);
    expect(oauthEnabled("commercial", config)).toBe(false);
    expect(oauthEnabled("eu", { proxyUrl: "", clientIds: { eu: "x" } })).toBe(false);
  });

  it("computes the S256 challenge as unpadded base64url(SHA-256(verifier))", async () => {
    // Expected value from: printf %s pkce-test-verifier | openssl dgst -sha256 -binary | base64url
    expect(await pkceChallenge("pkce-test-verifier")).toBe("aNsHKVxnyY9miDbOaa5GLREr8C-xfjIdLs44tdhMKgM");
  });

  it("redirects to the instance's authorize endpoint with PKCE, then exchanges the code", async () => {
    await beginLogin("eu", true, config);
    const authorize = new URL(assigned);
    expect(authorize.origin + authorize.pathname).toBe(
      "https://app.eu.launchdarkly.com/trust/oauth/authorize",
    );
    expect(authorize.searchParams.get("client_id")).toBe("client-eu");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("redirect_uri")).toBe("https://dash.example/");
    expect(authorize.searchParams.get("scope")).toBe("reader offline_access");

    const state = authorize.searchParams.get("state")!;
    const { calls, fetchImpl } = tokenFetch({
      access_token: "a1",
      refresh_token: "r1",
      expires_in: 3600,
    });
    const { credential, remember } = await completeLogin(
      new URL(`https://dash.example/?code=abc&state=${state}`),
      config,
      fetchImpl,
    );
    expect(remember).toBe(true);
    expect(credential).toMatchObject({ kind: "oauth", instance: "eu", accessToken: "a1" });
    expect(calls[0].url).toBe("https://proxy.example/eu/token");
    expect(calls[0].body.get("grant_type")).toBe("authorization_code");
    expect(calls[0].body.get("code")).toBe("abc");
    expect(await pkceChallenge(calls[0].body.get("code_verifier")!)).toBe(
      authorize.searchParams.get("code_challenge"),
    );
  });

  it("rejects a callback whose state does not match", async () => {
    await beginLogin("eu", false, config);
    const { fetchImpl, calls } = tokenFetch({});
    await expect(
      completeLogin(new URL("https://dash.example/?code=abc&state=forged"), config, fetchImpl),
    ).rejects.toThrow(/state mismatch/);
    expect(calls).toHaveLength(0);
  });

  it("shares one refresh between concurrent callers and keeps an unrotated refresh token", async () => {
    const cred: OAuthCredential = {
      kind: "oauth",
      instance: "eu",
      clientId: "client-eu",
      accessToken: "a1",
      refreshToken: "r-shared",
    };
    const { calls, fetchImpl } = tokenFetch({ access_token: "a2" });
    const [a, b] = await Promise.all([
      refreshCredential(cred, config, fetchImpl),
      refreshCredential(cred, config, fetchImpl),
    ]);
    expect(calls).toHaveLength(1);
    expect(a).toBe(b);
    expect(a).toMatchObject({ accessToken: "a2", refreshToken: "r-shared" });
  });

  it("refreshes again on the next cycle when LD does not rotate the refresh token", async () => {
    const cred: OAuthCredential = {
      kind: "oauth",
      instance: "eu",
      clientId: "client-eu",
      accessToken: "a1",
      refreshToken: "r-stable",
    };
    let n = 0;
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ access_token: `a${++n + 1}`, refresh_token: "r-stable" }))) as typeof fetch;
    const first = await refreshCredential(cred, config, fetchImpl);
    const second = await refreshCredential(first, config, fetchImpl);
    expect(n).toBe(2);
    expect(first.accessToken).toBe("a2");
    expect(second.accessToken).toBe("a3");
  });

  it("never sends tokens to a relative URL when the proxy is not configured", async () => {
    const cred: OAuthCredential = {
      kind: "oauth",
      instance: "commercial",
      clientId: "c",
      accessToken: "a1",
      refreshToken: "r-rollback",
    };
    const unconfigured: OAuthConfig = { proxyUrl: "", clientIds: {} };
    const { calls, fetchImpl } = tokenFetch({ access_token: "a2" });
    await expect(refreshCredential(cred, unconfigured, fetchImpl)).rejects.toThrow(/not configured/);
    await revokeCredential(cred, unconfigured, fetchImpl);
    expect(calls).toHaveLength(0);
  });

  it("resolves a stale credential to the newest tokens after two rotations", async () => {
    const original: OAuthCredential = {
      kind: "oauth",
      instance: "eu",
      clientId: "client-eu",
      accessToken: "a1",
      refreshToken: "chain-r1",
    };
    let n = 1;
    const fetchImpl = (async () => {
      n++;
      return new Response(JSON.stringify({ access_token: `a${n}`, refresh_token: `chain-r${n}`, expires_in: 3600 }));
    }) as typeof fetch;
    const second = await refreshCredential(original, config, fetchImpl); // r1 -> r2
    const third = await refreshCredential(second, config, fetchImpl); // r2 -> r3
    expect(third.refreshToken).toBe("chain-r3");

    // A client still holding the original gets r3 without spending r1 again.
    const stale = await refreshCredential(original, config, fetchImpl);
    expect(stale).toEqual(third);
    expect(n).toBe(3);
  });

  describe("refreshAcrossTabs", () => {
    const base: OAuthCredential = {
      kind: "oauth",
      instance: "eu",
      clientId: "client-eu",
      accessToken: "tab-a1",
      refreshToken: "tab-r1",
    };
    function memoryStore(initial: OAuthCredential | null) {
      let value = initial;
      const writes: OAuthCredential[] = [];
      const store: CredentialStore = {
        read: () => value,
        write: (c) => {
          value = c;
          writes.push(c);
        },
      };
      return { store, writes, set: (c: OAuthCredential | null) => (value = c) };
    }

    it("adopts tokens another tab already refreshed instead of spending a rotated refresh token", async () => {
      const fromOtherTab = { ...base, accessToken: "tab-a2", refreshToken: "tab-r2", expiresAt: Date.now() + 3_600_000 };
      const { store } = memoryStore(fromOtherTab);
      const { calls, fetchImpl } = tokenFetch({ access_token: "never" });
      expect(await refreshAcrossTabs(base, store, config, fetchImpl)).toEqual(fromOtherTab);
      expect(calls).toHaveLength(0);
    });

    it("refreshes from the stored credential and persists it before returning", async () => {
      const { store, writes } = memoryStore(base);
      const { calls, fetchImpl } = tokenFetch({ access_token: "tab-a3", refresh_token: "tab-r3" });
      const next = await refreshAcrossTabs(base, store, config, fetchImpl);
      expect(calls[0].body.get("refresh_token")).toBe("tab-r1");
      expect(writes).toEqual([next]);
    });

    it("does not write tokens back after sign-out cleared the store", async () => {
      const signedOut = { ...base, refreshToken: "tab-r-signed-out" };
      const { store, writes } = memoryStore(null);
      const { fetchImpl } = tokenFetch({ access_token: "late", refresh_token: "late-r" });
      await refreshAcrossTabs(signedOut, store, config, fetchImpl);
      expect(writes).toHaveLength(0);
    });
  });
});
