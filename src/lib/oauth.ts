import { assetPath } from "./asset-path";
import { OAuthCredential } from "./credential";
import { INSTANCES, InstanceKey } from "./types";

/**
 * "Sign in with LaunchDarkly": OAuth 2.0 authorization code + PKCE (S256)
 * as a public client registered through Dynamic Client Registration
 * (scripts/register-oauth-client.mjs).
 *
 * LaunchDarkly's /trust/oauth/* endpoints send no CORS headers, so the token
 * and revoke calls go through the stateless oauth-proxy (AWS Lambda). The
 * authorize step is a top-level navigation and REST API calls stay
 * browser-direct, so the proxy never sees API traffic.
 *
 * Disabled unless NEXT_PUBLIC_LD_OAUTH_PROXY_URL and a client id for the
 * instance are set at build time.
 */

export const OAUTH_SCOPE = "reader offline_access";

const PENDING_KEY = "ld-dash.oauth.pending";
const PENDING_TTL_MS = 10 * 60_000;

// Literal process.env reads so Next inlines them into the static export.
const PROXY_URL = process.env.NEXT_PUBLIC_LD_OAUTH_PROXY_URL ?? "";
const CLIENT_IDS: Record<InstanceKey, string> = {
  commercial: process.env.NEXT_PUBLIC_LD_OAUTH_CLIENT_ID_COMMERCIAL ?? "",
  eu: process.env.NEXT_PUBLIC_LD_OAUTH_CLIENT_ID_EU ?? "",
};

export interface OAuthConfig {
  proxyUrl: string;
  clientIds: Partial<Record<InstanceKey, string>>;
}

const buildConfig: OAuthConfig = { proxyUrl: PROXY_URL, clientIds: CLIENT_IDS };

export function oauthEnabled(instance: InstanceKey, config: OAuthConfig = buildConfig): boolean {
  return !!config.proxyUrl && !!config.clientIds[instance];
}

export class OAuthError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

interface PendingLogin {
  state: string;
  verifier: string;
  instance: InstanceKey;
  remember: boolean;
  createdAt: number;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

// --- PKCE -------------------------------------------------------------------

export function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(byteLength: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

// --- Flow -------------------------------------------------------------------

/** The registered redirect URI: the app root, so no trailing-slash ambiguity on GitHub Pages. */
export function redirectUri(): string {
  return `${window.location.origin}${assetPath("/")}`;
}

export function authorizeEndpoint(instance: InstanceKey): string {
  return `${INSTANCES[instance].appBase}/trust/oauth/authorize`;
}

function proxyEndpoint(instance: InstanceKey, op: "token" | "revoke", config: OAuthConfig): string {
  // Never fall back to a relative URL: after a rollback (proxy var removed) a
  // saved credential must not be POSTed to the dashboard's own host.
  if (!/^https?:\/\//.test(config.proxyUrl)) {
    throw new OAuthError("Sign-in is not configured in this build; sign in again or use an API token.");
  }
  return `${config.proxyUrl.replace(/\/+$/, "")}/${instance}/${op}`;
}

/** Store PKCE state for this tab and navigate to LaunchDarkly's consent screen. */
export async function beginLogin(
  instance: InstanceKey,
  remember: boolean,
  config: OAuthConfig = buildConfig,
): Promise<void> {
  const clientId = config.clientIds[instance];
  if (!clientId) throw new OAuthError(`Sign-in is not configured for the ${instance} instance.`);

  const pending: PendingLogin = {
    state: randomString(24),
    verifier: randomString(32),
    instance,
    remember,
    createdAt: Date.now(),
  };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

  const url = new URL(authorizeEndpoint(instance));
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri(),
    scope: OAUTH_SCOPE,
    state: pending.state,
    code_challenge: await pkceChallenge(pending.verifier),
    code_challenge_method: "S256",
  }).toString();
  window.location.assign(url.toString());
}

/** True when the current URL looks like a return from the authorize step. */
export function isOAuthCallback(url: URL): boolean {
  return url.searchParams.has("state") && (url.searchParams.has("code") || url.searchParams.has("error"));
}

/** Finish the redirect: verify state, exchange the code via the proxy. */
export async function completeLogin(
  url: URL,
  config: OAuthConfig = buildConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ credential: OAuthCredential; remember: boolean }> {
  const raw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  const pending = raw ? (JSON.parse(raw) as PendingLogin) : null;

  const error = url.searchParams.get("error");
  if (error) {
    const description = url.searchParams.get("error_description");
    throw new OAuthError(
      error === "access_denied" ? "Sign-in was cancelled." : `Sign-in failed: ${description ?? error}`,
      error,
    );
  }
  if (!pending || pending.state !== url.searchParams.get("state")) {
    throw new OAuthError("Sign-in could not be verified (state mismatch). Please try again.");
  }
  if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
    throw new OAuthError("Sign-in took too long and expired. Please try again.");
  }
  const clientId = config.clientIds[pending.instance];
  if (!clientId) throw new OAuthError(`Sign-in is not configured for the ${pending.instance} instance.`);

  const tokens = await postToken(
    pending.instance,
    {
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri(),
      code: url.searchParams.get("code") ?? "",
      code_verifier: pending.verifier,
    },
    config,
    fetchImpl,
  );
  return {
    credential: toCredential(pending.instance, clientId, tokens),
    remember: pending.remember,
  };
}

/**
 * Keyed by the refresh token being spent. Parallel requests share one
 * refresh. When LD rotates the refresh token, the result stays cached so a
 * client still holding the spent token gets it instead of replaying the spent
 * token. When it doesn't rotate, the entry is evicted, or the next refresh
 * would return the same (soon expired) access token forever.
 */
const refreshes = new Map<string, Promise<OAuthCredential>>();

export function refreshCredential(
  cred: OAuthCredential,
  config: OAuthConfig = buildConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthCredential> {
  const refreshToken = cred.refreshToken;
  if (!refreshToken) return Promise.reject(new OAuthError("No refresh token; sign in again."));
  let p = refreshes.get(refreshToken);
  if (!p) {
    p = postToken(
      cred.instance,
      { grant_type: "refresh_token", client_id: cred.clientId, refresh_token: refreshToken },
      config,
      fetchImpl,
    ).then((tokens) => {
      const next = toCredential(cred.instance, cred.clientId, tokens);
      // LD may not rotate refresh tokens: keep the old one if none came back.
      next.refreshToken ??= refreshToken;
      if (next.refreshToken === refreshToken) refreshes.delete(refreshToken);
      return next;
    });
    p.catch(() => refreshes.delete(refreshToken));
    refreshes.set(refreshToken, p);
  }
  return p;
}

/** Best-effort revocation of both tokens; sign-out proceeds regardless. */
export async function revokeCredential(
  cred: OAuthCredential,
  config: OAuthConfig = buildConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const tokens: Array<[string, string | undefined]> = [
    ["refresh_token", cred.refreshToken],
    ["access_token", cred.accessToken],
  ];
  for (const [hint, token] of tokens) {
    if (!token) continue;
    try {
      await fetchImpl(proxyEndpoint(cred.instance, "revoke", config), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: cred.clientId, token, token_type_hint: hint }),
      });
    } catch {
      /* best effort */
    }
  }
}

async function postToken(
  instance: InstanceKey,
  params: Record<string, string>,
  config: OAuthConfig,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  const res = await fetchImpl(proxyEndpoint(instance, "token", config), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(params),
  });
  let body: Partial<TokenResponse> & { error?: string; error_description?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok || !body.access_token) {
    throw new OAuthError(
      `Token request failed (${res.status})${body.error_description ? `: ${body.error_description}` : ""}`,
      body.error,
    );
  }
  return body as TokenResponse;
}

function toCredential(instance: InstanceKey, clientId: string, t: TokenResponse): OAuthCredential {
  return {
    kind: "oauth",
    instance,
    clientId,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined,
  };
}
