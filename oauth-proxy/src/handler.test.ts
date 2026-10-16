import { describe, expect, it, vi } from "vitest";
import { handle, MAX_BODY_BYTES, parseAllowedOrigins, type LogEntry, type ProxyRequest } from "./handler";

const ORIGIN = "https://launchdarkly-labs.github.io";
const FORM = "application/x-www-form-urlencoded";
const TOKEN_BODY = "grant_type=authorization_code&code=abc&code_verifier=xyz&client_id=cid";

function upstreamOk(body = '{"access_token":"t"}', init: ResponseInit = {}) {
  return vi.fn<typeof fetch>(async () =>
    new Response(body, { status: 200, headers: { "content-type": "application/json" }, ...init }),
  );
}

function req(overrides: Partial<ProxyRequest> = {}): ProxyRequest {
  return { method: "POST", path: "/commercial/token", origin: ORIGIN, contentType: FORM, body: TOKEN_BODY, ...overrides };
}

function deps(fetchImpl: typeof fetch = upstreamOk(), log: (e: LogEntry) => void = () => {}) {
  return { fetch: fetchImpl, allowedOrigins: [ORIGIN, "http://localhost:3000"], log };
}

describe("origin allowlist", () => {
  it.each([undefined, "", "https://evil.example", "https://launchdarkly-labs.github.io.evil.example", "null"])(
    "rejects origin %j with 403 and never calls upstream",
    async (origin) => {
      const fetchImpl = upstreamOk();
      const res = await handle(req({ origin }), deps(fetchImpl));
      expect(res.status).toBe(403);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("accepts each allowed origin", async () => {
    for (const origin of [ORIGIN, "http://localhost:3000"]) {
      expect((await handle(req({ origin }), deps())).status).toBe(200);
    }
  });

  it("parses the comma-separated env var", () => {
    expect(parseAllowedOrigins(" https://a.example/ ,http://localhost:3000,, ")).toEqual([
      "https://a.example",
      "http://localhost:3000",
    ]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});

describe("routing", () => {
  it.each([
    ["/commercial/token", FORM, "https://app.launchdarkly.com/trust/oauth/token"],
    ["/commercial/revoke", FORM, "https://app.launchdarkly.com/trust/oauth/revoke"],
    ["/commercial/register", "application/json", "https://app.launchdarkly.com/trust/oauth/register/dcr"],
    ["/eu/token", FORM, "https://app.eu.launchdarkly.com/trust/oauth/token"],
    ["/eu/revoke", FORM, "https://app.eu.launchdarkly.com/trust/oauth/revoke"],
    ["/eu/register", "application/json", "https://app.eu.launchdarkly.com/trust/oauth/register/dcr"],
  ])("forwards %s to the hardcoded host", async (path, contentType, url) => {
    const fetchImpl = upstreamOk();
    await handle(req({ path, contentType }), deps(fetchImpl));
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe(url);
  });

  it.each([
    "/federal/token",
    "/commercial/authorize",
    "/commercial/token/",
    "/commercial/token/extra",
    "/commercial",
    "/",
    "",
    "/api/v2/flags",
    "/commercial/../api/v2/token",
    "/https://evil.example/token",
    "/evil.example/token",
    "/constructor/token",
    "/commercial/toString",
    "/COMMERCIAL/token",
  ])("returns 404 for path %j", async (path) => {
    const fetchImpl = upstreamOk();
    const res = await handle(req({ path }), deps(fetchImpl));
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["GET", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])("returns 404 for %s", async (method) => {
    const fetchImpl = upstreamOk();
    const res = await handle(req({ method }), deps(fetchImpl));
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns 415 when the content-type doesn't match the operation", async () => {
    const fetchImpl = upstreamOk();
    expect((await handle(req({ contentType: "application/json" }), deps(fetchImpl))).status).toBe(415);
    expect((await handle(req({ path: "/eu/register", contentType: FORM }), deps(fetchImpl))).status).toBe(415);
    expect((await handle(req({ contentType: undefined }), deps(fetchImpl))).status).toBe(415);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns 413 for oversized bodies", async () => {
    const fetchImpl = upstreamOk();
    const res = await handle(req({ body: "a".repeat(MAX_BODY_BYTES + 1) }), deps(fetchImpl));
    expect(res.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("passthrough", () => {
  it("forwards body and content-type unchanged, without following redirects", async () => {
    const fetchImpl = upstreamOk();
    const contentType = "application/x-www-form-urlencoded;charset=UTF-8";
    await handle(req({ contentType }), deps(fetchImpl));
    const init = fetchImpl.mock.calls[0][1]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(TOKEN_BODY);
    expect(init.redirect).toBe("manual");
    expect(new Headers(init.headers).get("content-type")).toBe(contentType);
    expect(new Headers(init.headers).has("origin")).toBe(false);
  });

  it("forwards a JSON registration body unchanged", async () => {
    const fetchImpl = upstreamOk('{"client_id":"new"}', { status: 201 });
    const body = JSON.stringify({ client_name: "x", redirect_uris: ["https://launchdarkly-labs.github.io/cb"] });
    const res = await handle(req({ path: "/eu/register", contentType: "application/json", body }), deps(fetchImpl));
    expect(fetchImpl.mock.calls[0][1]!.body).toBe(body);
    expect(res.status).toBe(201);
    expect(res.body).toBe('{"client_id":"new"}');
  });

  it("returns upstream status, body and content-type with no-store", async () => {
    const fetchImpl = upstreamOk('{"error":"invalid_grant"}', {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "set-cookie": "s=1", "x-ld-thing": "1" },
    });
    const res = await handle(req(), deps(fetchImpl));
    expect(res).toEqual({
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      body: '{"error":"invalid_grant"}',
    });
  });

  it("maps network failures to 502 and timeouts to 504", async () => {
    const failing = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await handle(req(), deps(failing))).status).toBe(502);
    const timingOut = vi.fn<typeof fetch>(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    expect((await handle(req(), deps(timingOut))).status).toBe(504);
  });
});

describe("headers and logging", () => {
  it("never emits Access-Control-* headers, on success or error", async () => {
    const upstreamWithCors = upstreamOk("{}", {
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    });
    const responses = [
      await handle(req(), deps(upstreamWithCors)),
      await handle(req({ origin: "https://evil.example" }), deps()),
      await handle(req({ path: "/nope/token" }), deps()),
      await handle(req({ contentType: "text/plain" }), deps()),
    ];
    for (const res of responses) {
      expect(Object.keys(res.headers).filter((h) => h.toLowerCase().startsWith("access-control-"))).toEqual([]);
      expect(res.headers["cache-control"]).toBe("no-store");
    }
  });

  it("logs only method, route, instance and status, never bodies", async () => {
    const entries: LogEntry[] = [];
    const fetchImpl = upstreamOk('{"access_token":"SECRET_TOKEN"}');
    await handle(req({ body: "code=SECRET_CODE" }), deps(fetchImpl, (e) => entries.push(e)));
    expect(entries).toEqual([
      { method: "POST", route: "token", instance: "commercial", status: 200, upstreamStatus: 200 },
    ]);
    expect(JSON.stringify(entries)).not.toMatch(/SECRET/);
  });
});

describe("lambda adapter", () => {
  it("decodes base64 bodies and maps the Function URL event", async () => {
    vi.stubEnv("ALLOWED_ORIGINS", `${ORIGIN},http://localhost:3000`);
    vi.resetModules();
    const { handler } = await import("./lambda");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await handler({
        rawPath: "/eu/token",
        headers: { origin: ORIGIN, "content-type": FORM },
        body: Buffer.from(TOKEN_BODY).toString("base64"),
        isBase64Encoded: true,
        requestContext: { http: { method: "POST" } },
      });
      expect(res).toEqual({
        statusCode: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
        body: "{}",
      });
      expect(fetchSpy.mock.calls[0][0]).toBe("https://app.eu.launchdarkly.com/trust/oauth/token");
      expect(fetchSpy.mock.calls[0][1]!.body).toBe(TOKEN_BODY);

      const denied = await handler({
        rawPath: "/eu/token",
        headers: { origin: "https://evil.example", "content-type": FORM },
        body: TOKEN_BODY,
        isBase64Encoded: false,
        requestContext: { http: { method: "POST" } },
      });
      expect(denied.statusCode).toBe(403);
      expect(fetchSpy).toHaveBeenCalledOnce();
    } finally {
      fetchSpy.mockRestore();
      logSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
