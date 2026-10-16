# LaunchDarkly Prerequisites Dashboard

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Deploy to GitHub Pages](https://github.com/launchdarkly-labs/ld-prereqs-dashboard/actions/workflows/deploy.yml/badge.svg)](https://github.com/launchdarkly-labs/ld-prereqs-dashboard/actions/workflows/deploy.yml)

A desktop-optimized dashboard that shows LaunchDarkly feature flags as an **expandable hierarchy of prerequisite chains** — the view the built-in dashboard doesn't have. Built for accounts that use (multi-level) prerequisite flags heavily.

- **Reverse-pyramid tree** (default): apex flags — e.g. top-level `release_*` flags — at the top; expanding a row walks down through the flags that depend on it, nested to any depth, with each flag's on/off state per environment. A direction toggle flips to the classic prerequisites-upward view.
- **Tag filter**: pick a tag (e.g. `release`) and every flag carrying it becomes a top-level row, wherever it sits in the graph.
- **Built for scale**: nodes with hundreds of dependents render in pages of 50 with "show more / show all"; the tree starts collapsed.
- **Unmet-prerequisite detection**: flags that are *on* but whose prerequisite chain contains an off, deleted, or archived flag get a "prerequisite not met" badge — those flags silently serve their off variation.
- **Per-list filters**: an expanded flag's dependents can be narrowed by state (on/off) and by whether they have further dependents of their own.
- **EU and commercial instances** (`app.eu.launchdarkly.com` / `app.launchdarkly.com`).
- **Rate-limit aware**: one paginated sweep of `GET /flags?env=<env>&summary=0` provides prerequisites for every flag, so the whole graph is built from a single bulk call. All requests go through a queue that honors `X-Ratelimit-*` headers proactively and backs off on 429 with `Retry-After` + jitter. Results are cached locally; refresh is manual.
- **Two ways to connect**: paste a read-only API token, or (when configured) **Sign in with LaunchDarkly** via OAuth — commercial instance only for now, see [below](#optional--sign-in-with-launchdarkly-oauth).
- **Fully static** — deploys to GitHub Pages (free) or Vercel; there is no app server. The optional OAuth sign-in adds one tiny, separately deployed [token proxy](oauth-proxy/).

## Security model

The dashboard has no backend. Your credential is entered in the browser and REST calls go **directly from your browser to the LaunchDarkly REST API** (which supports CORS). A pasted API token is never sent anywhere else.

- Use a **read-only** API access token (Account settings → Authorization → create token with the Reader role).
- By default the token lives in `sessionStorage` and is forgotten when the tab closes.
- "Remember this token on this device" stores it in `localStorage` — avoid on shared machines.
- With **Sign in with LaunchDarkly**, the same storage rules apply to the OAuth tokens. REST calls still go straight to LaunchDarkly (as `Bearer`). Only the code exchange, token refresh and sign-out revocation go through the small [`oauth-proxy`](oauth-proxy/), because LaunchDarkly's OAuth endpoints don't send CORS headers. The proxy is stateless, holds no secrets, and never logs bodies — but tokens do pass through it, so host it in an account you trust.

## Quick start

1. In LaunchDarkly, create a **read-only** API access token (Account settings → Authorization).
2. Open the deployed dashboard (or run it locally, below), pick your instance (EU or commercial), and paste the token.
   - On the commercial instance, if the deployment has sign-in configured, you can choose **Sign in with LaunchDarkly** instead and approve read-only access. No token needed.
3. Choose a project and environment — the tree of dependency chains loads from a single flags sweep.

## Requirements

- To use: any modern browser and either a LaunchDarkly API access token (Reader role is sufficient) or, with sign-in configured, a LaunchDarkly login on the commercial instance.
- To develop: Node.js 20+ and npm.

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # vitest — graph, rate limiter, auth/storage and oauth-proxy unit tests
npm run build      # static export to out/
```

## Deploy — GitHub Pages

1. Push this repo to GitHub.
2. Repository **Settings → Pages → Source: GitHub Actions**.
3. Push to `main` — [.github/workflows/deploy.yml](.github/workflows/deploy.yml) builds the static export with `NEXT_PUBLIC_BASE_PATH=/<repo-name>` and publishes it.

## Optional — Sign in with LaunchDarkly (OAuth)

Lets users approve read-only access on LaunchDarkly's consent screen instead of creating an API token. It uses a public OAuth client registered via Dynamic Client Registration (no LaunchDarkly admin setup) and the authorization code flow with PKCE. Scopes: `reader offline_access`.

1. **Deploy the proxy** (AWS Lambda behind a Function URL, deployed with SAM): see [oauth-proxy/README.md](oauth-proxy/README.md). `AllowedOrigins` defaults to `https://launchdarkly-labs.github.io` and `http://localhost:3000`; add your own origin if you host elsewhere. Note the `ProxyUrl` output.
2. **Register a client per instance and redirect URI.** The redirect URI is the app root with a trailing slash:
   ```bash
   node scripts/register-oauth-client.mjs --instance commercial --redirect-uri https://<owner>.github.io/<repo>/
   ```
   **EU:** as of October 2026, Dynamic Client Registration is not enabled on `app.eu.launchdarkly.com`. Discovery advertises it, but the endpoint returns 404. Leave `NEXT_PUBLIC_LD_OAUTH_CLIENT_ID_EU` unset: EU users get the API token form, and the sign-in tab says it isn't configured for that instance.
3. **Set build variables.** For GitHub Pages, add these as repository **variables** (Settings → Secrets and variables → Actions → Variables), then re-run the deploy workflow:
   - `NEXT_PUBLIC_LD_OAUTH_PROXY_URL`
   - `NEXT_PUBLIC_LD_OAUTH_CLIENT_ID_COMMERCIAL`
   - `NEXT_PUBLIC_LD_OAUTH_CLIENT_ID_EU` — only once DCR is enabled on EU

Leave them unset and the dashboard is token-only. Deleting them and re-deploying is the rollback. LaunchDarkly's consent screen labels self-registered apps "not verified by LaunchDarkly"; that is expected.

Client ids are public (no secret), so repository variables are fine. Access tokens are short-lived and refreshed automatically; signing out revokes them.

For local development, register a client for `http://localhost:3000/` and create `.env.local` (git-ignored):

```
NEXT_PUBLIC_LD_OAUTH_PROXY_URL=https://<function-url-id>.lambda-url.us-east-1.on.aws
NEXT_PUBLIC_LD_OAUTH_CLIENT_ID_COMMERCIAL=<printed by the script>
```

## Deploy — Vercel

Import the repo in Vercel; no configuration needed (leave `NEXT_PUBLIC_BASE_PATH` unset). The static export works on the free tier.

## How it stays inside the rate limits

| Concern | Approach |
| --- | --- |
| Bulk data | Single paginated sweep of `GET /api/v2/flags/{project}?env=<env>&summary=0&limit=100`, following `_links.next`. Prerequisites, state, and variations for every flag arrive in this one sweep; the dependency graph (both directions) is derived client-side. |
| Per-flag calls | None in bulk. The beta `dependent-flags` endpoint is called only when you click "Verify via API" on a single flag. |
| Concurrency | All requests share one queue (max 2 in flight). |
| Approaching the limit | When `X-Ratelimit-{Route,Global}-Remaining` drops below 3, the queue pauses until `X-Ratelimit-Reset` before sending more. |
| 429 | Waits `Retry-After` (or the reset header, or capped exponential fallback), always with jitter; up to 6 retries, then a friendly error with manual retry. |
| Re-fetching | The last sweep is cached in `localStorage` per instance/project/environment and shown instantly with a "last updated" stamp; refresh is a manual action, never a poll. |

## About

This repository is maintained by LaunchDarkly Labs. While we try to keep it
up to date, it is not officially supported by LaunchDarkly. For officially
supported SDKs and tools, visit https://launchdarkly.com

## License

Apache 2.0 — see [LICENSE](LICENSE).
