import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../test/web-storage";
import type { OAuthCredential } from "./credential";
import {
  OAuthConfig,
  beginLogin,
  completeLogin,
  oauthEnabled,
  pkceChallenge,
  refreshCredential,
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
});
