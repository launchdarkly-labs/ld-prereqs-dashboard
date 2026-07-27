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
- **Fully static** — deploys to GitHub Pages (free) or Vercel; there is no server.

## Security model

There is deliberately no backend. Your LaunchDarkly API token is entered in the browser and calls go **directly from your browser to the LaunchDarkly REST API** (which supports CORS). The token is never sent anywhere else.

- Use a **read-only** API access token (Account settings → Authorization → create token with the Reader role).
- By default the token lives in `sessionStorage` and is forgotten when the tab closes.
- "Remember this token on this device" stores it in `localStorage` — avoid on shared machines.

## Quick start

1. In LaunchDarkly, create a **read-only** API access token (Account settings → Authorization).
2. Open the deployed dashboard (or run it locally, below), pick your instance (EU or commercial), and paste the token.
3. Choose a project and environment — the tree of dependency chains loads from a single flags sweep.

## Requirements

- To use: any modern browser and a LaunchDarkly API access token (Reader role is sufficient).
- To develop: Node.js 20+ and npm.

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # vitest — graph + rate limiter unit tests
npm run build      # static export to out/
```

## Deploy — GitHub Pages

1. Push this repo to GitHub.
2. Repository **Settings → Pages → Source: GitHub Actions**.
3. Push to `main` — [.github/workflows/deploy.yml](.github/workflows/deploy.yml) builds the static export with `NEXT_PUBLIC_BASE_PATH=/<repo-name>` and publishes it.

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
