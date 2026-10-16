/**
 * Stateless CORS pass-through for LaunchDarkly's OAuth endpoints.
 *
 * LD's /trust/oauth/* endpoints send no CORS headers, so a browser can't read
 * their responses. This forwards exactly three operations to a hardcoded host
 * per instance and hands the upstream response back. It holds no secrets
 * (public client + PKCE) and never touches /api/v2.
 *
 * CORS headers are added by the Lambda Function URL's CORS config, not here:
 * emitting Access-Control-* from code would duplicate them and break browsers.
 */

export const UPSTREAM_HOSTS = {
  commercial: "app.launchdarkly.com",
  eu: "app.eu.launchdarkly.com",
} as const;

type Instance = keyof typeof UPSTREAM_HOSTS;

const ROUTES = {
  token: { upstreamPath: "/trust/oauth/token", contentType: "application/x-www-form-urlencoded" },
  revoke: { upstreamPath: "/trust/oauth/revoke", contentType: "application/x-www-form-urlencoded" },
  register: { upstreamPath: "/trust/oauth/register/dcr", contentType: "application/json" },
} as const;

type Op = keyof typeof ROUTES;

/** OAuth payloads are tiny; anything bigger isn't a legitimate call. */
export const MAX_BODY_BYTES = 16 * 1024;
/** Below the 10 s Lambda timeout so we can still answer with a 504. */
export const UPSTREAM_TIMEOUT_MS = 8000;

export interface ProxyRequest {
  method: string;
  path: string;
  origin: string | undefined;
  contentType: string | undefined;
  body: string;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface LogEntry {
  method: string;
  route: string;
  instance?: string;
  status: number;
  upstreamStatus?: number;
}

export interface ProxyDeps {
  fetch: typeof fetch;
  allowedOrigins: readonly string[];
  log?: (entry: LogEntry) => void;
}

const PATH_RE = /^\/([a-z]+)\/([a-z]+)$/;

function isInstance(value: string): value is Instance {
  return Object.prototype.hasOwnProperty.call(UPSTREAM_HOSTS, value);
}

function isOp(value: string): value is Op {
  return Object.prototype.hasOwnProperty.call(ROUTES, value);
}

function mediaType(contentType: string | undefined): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}

function error(status: number, code: string): ProxyResponse {
  return {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify({ error: code }),
  };
}

export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export async function handle(req: ProxyRequest, deps: ProxyDeps): Promise<ProxyResponse> {
  const log = deps.log ?? ((entry: LogEntry) => console.log(JSON.stringify(entry)));
  const method = req.method.toUpperCase();
  const match = PATH_RE.exec(req.path);
  const instance = match && isInstance(match[1]) ? match[1] : undefined;
  const op = match && isOp(match[2]) ? match[2] : undefined;
  const route = op ?? "unknown";

  const finish = (res: ProxyResponse, upstreamStatus?: number): ProxyResponse => {
    log({ method, route, instance, status: res.status, upstreamStatus });
    return res;
  };

  if (!req.origin || !deps.allowedOrigins.includes(req.origin)) {
    return finish(error(403, "origin_not_allowed"));
  }
  if (method !== "POST" || !instance || !op) {
    return finish(error(404, "not_found"));
  }

  const routeDef = ROUTES[op];
  if (mediaType(req.contentType) !== routeDef.contentType) {
    return finish(error(415, "unsupported_media_type"));
  }
  if (Buffer.byteLength(req.body, "utf8") > MAX_BODY_BYTES) {
    return finish(error(413, "payload_too_large"));
  }

  let upstream: Response;
  try {
    upstream = await deps.fetch(`https://${UPSTREAM_HOSTS[instance]}${routeDef.upstreamPath}`, {
      method: "POST",
      headers: { "content-type": req.contentType as string, accept: "application/json" },
      body: req.body,
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return finish(error(timedOut ? 504 : 502, timedOut ? "upstream_timeout" : "upstream_unreachable"));
  }

  const body = await upstream.text();
  const headers: Record<string, string> = { "cache-control": "no-store" };
  const upstreamType = upstream.headers.get("content-type");
  if (upstreamType) headers["content-type"] = upstreamType;
  return finish({ status: upstream.status, headers, body }, upstream.status);
}
