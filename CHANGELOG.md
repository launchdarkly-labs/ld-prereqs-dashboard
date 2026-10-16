# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Optional "Sign in with LaunchDarkly" (OAuth authorization code + PKCE, public client via Dynamic Client Registration) alongside the pasted API token. Hidden unless the build sets `NEXT_PUBLIC_LD_OAUTH_PROXY_URL` and a client id for the instance. Commercial instance only for now: LaunchDarkly has not enabled DCR on EU.
- `oauth-proxy/`: a stateless AWS Lambda (SAM) that forwards only LaunchDarkly's OAuth token, revoke and register endpoints, which send no CORS headers.
- `scripts/register-oauth-client.mjs` to register the OAuth client per instance and redirect URI.

### Changed

- The API client now carries a credential (API token or OAuth tokens). OAuth access tokens refresh automatically. Pasted API tokens are sent exactly as before, and existing saved tokens keep working.

## [0.1.0] - 2026-07-27

### Added

- Reverse-pyramid dependents tree (default view): apex flags at the top, expanding a row walks down through the flags that depend on it, nested to any depth, with each flag's on/off state per environment.
- Direction toggle to flip to the classic prerequisites-upward view.
- "Prerequisite not met" detection: flags that are on but whose prerequisite chain contains an off or missing flag are badged — they silently serve their off variation.
- Tag filter: every flag carrying the selected tag becomes a top-level row.
- Per-list filters on an expanded flag's children: state (on/off) and with/without further dependents.
- Chunked child rendering (pages of 50 with show more / show all) for flags with hundreds of dependents.
- Support for both the LaunchDarkly EU (`app.eu.launchdarkly.com`) and commercial (`app.launchdarkly.com`) instances.
- Rate-limit-aware API client: single paginated flag sweep (`GET /flags?env=<env>&summary=0`), shared request queue honoring `X-Ratelimit-*` headers, jittered backoff on 429, local caching with manual refresh.
- Flag detail panel with variations, prerequisites, dependents, and an optional per-flag cross-check against the beta dependent-flags endpoint.
- Fully static Next.js export deployable to GitHub Pages (bundled workflow) or Vercel.
