# LaunchDarkly Prerequisites Dashboard — agent notes

Static Next.js dashboard visualizing LaunchDarkly flag prerequisite hierarchies as an expandable dependents tree ("reverse pyramid": apex flags on top, their dependents below).

## Commands

- `npm run dev` — dev server on http://localhost:3000
- `npm test` — vitest unit tests (graph model + rate limiter)
- `npm run build` — static export to `out/`; set `NEXT_PUBLIC_BASE_PATH=/<repo>` for GitHub Pages sub-path builds
- `npm run lint` / `npx tsc --noEmit`

## Architecture constraints (do not break these)

- **No server code.** `next.config.ts` uses `output: "export"`; the app must work as pure static files (GitHub Pages). No API routes, no server actions, no `next/image` optimizer.
- **All LaunchDarkly API calls happen in the browser** with a user-supplied token (CORS is supported by the LD API). The token must never be sent anywhere except the LD API, never logged, and never committed.
- **One bulk call only.** The whole dependency graph is built client-side from a single paginated sweep of `GET /api/v2/flags/{project}?env=<env>&summary=0` (`src/lib/ld-api.ts`). Never add per-flag calls in bulk — LD rate limits are strict. The beta dependent-flags endpoint is for single-flag, user-initiated checks only.
- **Every request goes through the shared `RateLimitedFetcher`** (`src/lib/rate-limiter.ts`): honors `X-Ratelimit-*` headers proactively and backs off on 429 with jitter. Route new API calls through `LDClient`, which uses it by default.
- Static assets referenced in JSX need `assetPath()` (`src/lib/asset-path.ts`) so GitHub Pages sub-path deploys keep working.

## Layout

- `src/lib/` — pure logic (typed API client, rate limiter, graph model, storage). `prereq-graph.ts` and `rate-limiter.ts` are unit-tested; keep them free of React/DOM.
- `src/components/` — UI. Branding follows the LaunchDarkly 2026 brand tokens defined in `src/app/globals.css` (Sora headings, Inter body, dark `#191919` background).
- User-facing wording: say "prerequisite not met" for on-flags whose prerequisite chain is broken — deliberately factual, not alarming ("at risk" is avoided).

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
