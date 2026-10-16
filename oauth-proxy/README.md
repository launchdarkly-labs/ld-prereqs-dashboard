# oauth-proxy

A stateless CORS pass-through for LaunchDarkly's OAuth endpoints. It runs as an AWS Lambda function behind a Function URL and is deployed with AWS SAM.

LaunchDarkly's `/trust/oauth/*` endpoints send no CORS headers, so the dashboard can't read their responses from the browser. This proxy forwards three operations and nothing else:

| Dashboard calls | Forwarded to | Body |
|---|---|---|
| `POST {ProxyUrl}/{instance}/token` | `https://{host}/trust/oauth/token` | form-urlencoded |
| `POST {ProxyUrl}/{instance}/revoke` | `https://{host}/trust/oauth/revoke` | form-urlencoded |
| `POST {ProxyUrl}/{instance}/register` | `https://{host}/trust/oauth/register/dcr` | JSON |

`instance` is `commercial` (`app.launchdarkly.com`) or `eu` (`app.eu.launchdarkly.com`). The hosts are hardcoded, and the proxy never forwards to a URL the caller supplies. (As of October 2026, DCR is not enabled on EU, so EU sign-in can't be configured yet. The EU routes are ready for when it is.)

- It holds no secrets: the dashboard is an OAuth public client that uses PKCE. REST calls to `/api/v2` go straight from the browser with `Authorization: Bearer` and never pass through here.
- It returns 403 for an `Origin` not in `ALLOWED_ORIGINS`, 404 for any other path, method or instance, 415 for the wrong content type, and 413 for a body over 16 KB.
- It passes the body and `content-type` through unchanged, and returns the upstream status, body and `content-type` with `Cache-Control: no-store`. It doesn't follow redirects. An upstream timeout (8 s) returns 504, and a network error returns 502.
- The Function URL's CORS config adds the CORS headers, so the code never emits `Access-Control-*` headers (duplicates break browsers).
- It logs only the method, route, instance and status, never request or response bodies.
- Reserved concurrency is 5, which caps cost and abuse.

## Layout

- `src/handler.ts`: a pure `handle(request, { fetch, allowedOrigins })` function that holds all the logic.
- `src/lambda.ts`: the Function URL (payload v2) adapter. It decodes base64 bodies.
- `src/handler.test.ts`: Vitest tests. The repo root's `npm test` runs them.
- `template.yaml` and `samconfig.toml`: the SAM stack `ld-prereqs-oauth-proxy` in `us-east-1`, using profile `aws-admin`.

## Test

From the repo root:

```bash
npm test
```

```bash
npx tsc -p oauth-proxy
```

The root `tsconfig.json` excludes `oauth-proxy/`, which has its own `tsconfig.json`.

## Build and deploy

You need the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) and Node.js. Run these from `oauth-proxy/`:

```bash
npm install
```

```bash
sam validate --lint
```

```bash
sam build
```

```bash
sam deploy
```

`samconfig.toml` supplies the stack name, Region, profile, tags and `CAPABILITY_IAM`, and `confirm_changeset = true` shows the change set before anything is applied. To allow other origins, for example a preview host:

```bash
sam deploy --parameter-overrides AllowedOrigins="https://launchdarkly-labs.github.io,http://localhost:3000,https://example.test"
```

`AllowedOrigins` drives both the Function URL CORS config and the in-code 403 check. Origins must match exactly: scheme, host and port, with no trailing slash.

Read the URL after deploying:

```bash
aws cloudformation describe-stacks --stack-name ld-prereqs-oauth-proxy --region us-east-1 --profile aws-admin --query "Stacks[0].Outputs[?OutputKey=='ProxyUrl'].OutputValue" --output text
```

Set it as `NEXT_PUBLIC_LD_OAUTH_PROXY_URL` for the dashboard build. The URL ends in `/`, and the dashboard strips it.

### Notes

- `AuthType: NONE` is intentional, because browsers call the proxy directly. Lambda requires two resource-policy statements for a public Function URL: `lambda:InvokeFunctionUrl` with `FunctionUrlAuthType: NONE`, and `lambda:InvokeFunction` with `InvokedViaFunctionUrl: true`. The SAM transform generates both from `FunctionUrlConfig`. If you ever recreate the URL by hand with the CLI, add both, or every call returns 403.
- `ReservedConcurrentExecutions: 5` fails to deploy if the account's concurrency quota is too low, because Lambda keeps at least 100 unreserved. Check the quota with `aws lambda get-account-settings`.
- The function writes to its own log group, `/aws/lambda/ld-prereqs-oauth-proxy`, with 14-day retention. Its execution role can only write to that group.

## Smoke test

A disallowed origin must get a 403:

```bash
curl -i -X POST "${PROXY_URL}commercial/token" -H "Origin: https://evil.example" -H "Content-Type: application/x-www-form-urlencoded" -d "grant_type=refresh_token&refresh_token=x&client_id=x"
```

An allowed origin must reach LaunchDarkly. With a dummy token this returns LD's own 4xx (for example `invalid_grant`) and a single `Access-Control-Allow-Origin` header:

```bash
curl -i -X POST "${PROXY_URL}commercial/token" -H "Origin: http://localhost:3000" -H "Content-Type: application/x-www-form-urlencoded" -d "grant_type=refresh_token&refresh_token=x&client_id=x"
```

Tail the logs:

```bash
sam logs --stack-name ld-prereqs-oauth-proxy --tail
```

## Remove

```bash
sam delete --stack-name ld-prereqs-oauth-proxy --region us-east-1 --profile aws-admin
```
