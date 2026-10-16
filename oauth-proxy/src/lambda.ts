/** Lambda Function URL (payload v2) adapter for the pure handler. */
import { handle, parseAllowedOrigins } from "./handler";

/** The subset of the Function URL v2 event this adapter reads. */
export interface FunctionUrlEvent {
  rawPath: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded: boolean;
  requestContext: { http: { method: string } };
}

export interface FunctionUrlResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

export async function handler(event: FunctionUrlEvent): Promise<FunctionUrlResult> {
  // Function URLs deliver header names lowercased.
  const headers = event.headers ?? {};
  const rawBody = event.body ?? "";
  const body = event.isBase64Encoded ? Buffer.from(rawBody, "base64").toString("utf8") : rawBody;

  const res = await handle(
    {
      method: event.requestContext.http.method,
      path: event.rawPath,
      origin: headers["origin"],
      contentType: headers["content-type"],
      body,
    },
    { fetch, allowedOrigins },
  );
  return { statusCode: res.status, headers: res.headers, body: res.body };
}
