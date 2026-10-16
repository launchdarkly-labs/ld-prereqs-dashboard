#!/usr/bin/env node
// Registers a public OAuth client for "Sign in with LaunchDarkly" via Dynamic
// Client Registration (RFC 7591) and prints the client id to bake into the
// build. Run once per (instance, redirect URI); LD allows roughly 10
// registrations per IP per hour.
//
//   node scripts/register-oauth-client.mjs --instance commercial --redirect-uri http://localhost:3000/
//
// As of 2026-10 the EU instance advertises a registration_endpoint in its
// discovery document but the endpoint itself returns 404 — DCR is only live on
// commercial.
//
// The redirect URI must be the app root with a trailing slash, exactly as the
// dashboard computes it (origin + NEXT_PUBLIC_BASE_PATH + "/").

import { parseArgs } from "node:util";

const HOSTS = {
  commercial: "https://app.launchdarkly.com",
  eu: "https://app.eu.launchdarkly.com",
};

const { values } = parseArgs({
  options: {
    instance: { type: "string" },
    "redirect-uri": { type: "string" },
    name: { type: "string", default: "LaunchDarkly Prerequisites Dashboard" },
  },
});

const base = HOSTS[values.instance];
const redirectUri = values["redirect-uri"];
if (!base || !redirectUri) {
  console.error("Usage: --instance commercial|eu --redirect-uri <app root URL ending in />");
  process.exit(1);
}
if (!redirectUri.endsWith("/")) {
  console.error(`Redirect URI must end with "/" (the app root): ${redirectUri}`);
  process.exit(1);
}

const discovery = await fetch(`${base}/.well-known/oauth-authorization-server`).then((r) => r.json());
if (!discovery.registration_endpoint) {
  console.error(`${base} does not advertise a registration_endpoint.`);
  process.exit(1);
}

const res = await fetch(discovery.registration_endpoint, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({
    client_name: values.name,
    redirect_uris: [redirectUri],
    // Public client + PKCE: LD rejects confidential DCR clients at authorize time.
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "reader offline_access",
  }),
});
const body = await res.json().catch(() => ({}));
if (res.status === 404) {
  console.error(
    `Registration endpoint ${discovery.registration_endpoint} returned 404: Dynamic Client ` +
      `Registration is not enabled on the ${values.instance} instance (even though discovery ` +
      `advertises it). Sign-in can't be offered there until LaunchDarkly enables it.`,
  );
  process.exit(1);
}
if (!res.ok || !body.client_id) {
  console.error(`Registration failed (${res.status}):`, body);
  process.exit(1);
}

console.log(`Registered "${values.name}" on ${values.instance} for ${redirectUri}`);
console.log(`NEXT_PUBLIC_LD_OAUTH_CLIENT_ID_${values.instance.toUpperCase()}=${body.client_id}`);
