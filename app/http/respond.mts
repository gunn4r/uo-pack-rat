// respond.mts — how the server answers: send() with the headers every response carries, the event streams' own header set, the Content-Security-Policy, and the guard that turns a body that is not a JSON object into a 400.
import type http from "node:http";
import type { HttpError } from "../read-body.mts";

// Global Constraints CSP: no inline/external script beyond same-origin, no framing, no form posts
// off-page. Applied to every text/html response; every response also gets nosniff and
// x-frame-options: DENY. frame-ancestors has to be spelled out — it is one of the few directives
// with no default-src fallback, so the comment used to claim a "no framing" the header never sent
// (post-review fix, Important 6): any page could iframe GET / (a framed navigation carries this
// server's own Host and no Origin, so the middleware passes it) and clickjack the app.
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function send(res: http.ServerResponse, status: number, body: unknown, type = "application/json", extra: Record<string, string> = {}): void {
  // Every non-JSON caller passes an already-read file: a string (readFileSync's utf8 result) for
  // text, a Buffer for the favicon and the fonts — the cast is compiler-only, matching config.mts's
  // rawPort pattern. Binary types (image/*, font/*) carry no charset.
  const data = type === "application/json" ? JSON.stringify(body) : (body as string | Buffer);
  // x-frame-options rides on EVERY response, not just text/html: it is the belt to the CSP's braces
  // for anything that ignores frame-ancestors, and a JSON response rendered directly as a document
  // is framable too.
  const headers: Record<string, string> = { "content-type": type.startsWith("image/") || type.startsWith("font/") ? type : type + "; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-frame-options": "DENY" };
  if (type === "text/html") headers["content-security-policy"] = CSP;
  res.writeHead(status, { ...headers, ...extra });
  res.end(data);
}

// The two event-stream routes write their own headers (a stream is never finished by send()), so the
// "every response carries x-frame-options" rule is restated here rather than inherited: the same
// nosniff/DENY pair send() adds, plus the CSP's frame-ancestors half, since a text/event-stream
// response opened directly as a document is as framable as a JSON one.
export const SSE_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive",
  "x-content-type-options": "nosniff", "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'",
};

// Every route below reads its body as an object of named fields, but JSON.parse happily returns
// null, an array, a string or a number for a perfectly well-formed body — and destructuring null is
// a TypeError, so a literal `null` body used to 500 ten routes at once, each appending a stack to
// the log (post-review fix, Minor 8). One guard in front of them all turns that into the 400 it
// always was. Throws rather than returning a result the caller has to check: the statusCode the
// top-level handler already reads off readBody's own errors carries it straight to the client.
export function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const e = new Error("body must be a JSON object") as HttpError;
    e.statusCode = 400;
    throw e;
  }
  return body as Record<string, unknown>;
}
