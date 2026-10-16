import { InstanceKey } from "./types";

/** A pasted LaunchDarkly API access token, sent raw as `Authorization: <token>`. */
export interface TokenCredential {
  kind: "token";
  token: string;
}

/**
 * Tokens from "Sign in with LaunchDarkly" (OAuth authorization code + PKCE,
 * public client). Sent as `Authorization: Bearer <accessToken>`.
 */
export interface OAuthCredential {
  kind: "oauth";
  instance: InstanceKey;
  clientId: string;
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms; absent when the token response carried no `expires_in`. */
  expiresAt?: number;
}

export type Credential = TokenCredential | OAuthCredential;

export function authorizationHeader(cred: Credential): string {
  return cred.kind === "token" ? cred.token.trim() : `Bearer ${cred.accessToken}`;
}
