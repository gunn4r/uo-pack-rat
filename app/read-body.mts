// read-body.mts — reading a request's JSON body under a byte cap, shared by the app server (app/vault-server.mts) and
// the MCP listener (app/mcp.mts).
import type http from "node:http";
import { jsonErrorReason } from "./paste-scan.mts";

// Errors readBody() throws carry a statusCode the top-level route handler reads off them — the
// same shape installer.mts's own thrown errors describe with an inline cast at each read site;
// here the shape recurs often enough (readBody, the top-level catch) to name once.
export interface HttpError extends Error {
  statusCode?: number;
}

// `content-type: application/json`, any case, parameters (`; charset=utf-8`) allowed.
export const isJsonContentType = (v: string | string[] | undefined): boolean => String(v || "").split(";")[0]!.trim().toLowerCase() === "application/json";

interface ReadBodyOptions {
  limit?: number;
  tooLargeMsg?: string;
  // An empty body is a parse error (400) instead of {} (the MCP listener: JSON-RPC needs a message).
  requireBody?: boolean;
}

// limit defaults to 50 MB (the prior, unnamed global cap); a route can pass a tighter one (profiles:
// 1 MB) plus its own message for the 413. The cap is checked on every chunk (not content-length, so
// a lying client can't just skip the check) — once tripped, the rest of the body is drained and no
// further chunks are appended, so a huge rejected upload doesn't keep growing an already-doomed buffer.
// The cap counts BYTES, not JS string length (post-review fix): req emits raw Buffer chunks (no
// req.setEncoding() call anywhere in this file), and a Buffer's .length is already byte length, so
// summing chunk.length is exact regardless of encoding — the earlier version concatenated chunks into
// a JS string first (`buf += c`), which measured UTF-16 code-unit length; multi-byte UTF-8 (even a
// plain "é", 2 bytes/1 code unit) could then smuggle up to ~2x the intended byte limit past the check.
// The resolved body is `unknown` provenance (an HTTP request from any caller, trusted or not) — every
// route below narrows the fields it actually reads, per the route's own pre-existing checks.
// How much of an over-cap body readBody keeps reading (and discarding) after it has refused it, so the
// client gets to finish writing and actually read its 413 — see the overflow branch below.
const OVERFLOW_DRAIN_BYTES = 4 * 1024 * 1024;

export function readBody(req: http.IncomingMessage, { limit = 50e6, tooLargeMsg = "body too large", requireBody = false }: ReadBodyOptions = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Global Constraint (spec §4.5): a PUT/POST must declare a JSON body. The SSE cancel beacon
    // (navigator.sendBeacon, no body) never calls readBody, so it's naturally exempt.
    if ((req.method === "PUT" || req.method === "POST") && !isJsonContentType(req.headers["content-type"])) {
      req.resume();   // drain the body instead of leaving it unread — else a large rejected body can
                       // surface to the client as a connection error rather than the clean 415 below.
      const e = new Error("content-type must be application/json") as HttpError;
      e.statusCode = 415;
      return reject(e);
    }
    const chunks: Buffer[] = [];
    let bytes = 0, discarded = 0;
    let tooLarge: HttpError | null = null;
    req.on("data", (c: Buffer) => {
      if (tooLarge) {
        // Past the cap, a chunk is counted and dropped, never kept, and the 413 waits for the request
        // to end. Answering at once — the connection closes behind a `connection: close` answer —
        // raced a client still writing its body: it saw the socket end under it before it could read
        // the refusal, which Node's fetch reports as "fetch failed" / EPIPE. Waiting for `end` makes
        // the answer readable for a body that is merely too big; past OVERFLOW_DRAIN_BYTES the 413
        // goes out and the socket is destroyed, so an upload of any size still costs this process at
        // most that much reading and nothing of memory.
        discarded += c.length;
        if (discarded > OVERFLOW_DRAIN_BYTES) { reject(tooLarge); req.destroy(); }
        return;
      }
      bytes += c.length;   // c is a Buffer — .length is bytes, not decoded characters
      if (bytes > limit) {
        chunks.length = 0;   // the accepted part is doomed too — release it now
        tooLarge = new Error(tooLargeMsg) as HttpError;
        tooLarge.statusCode = 413;
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (tooLarge) return reject(tooLarge);
      // A body that does not parse is the caller's mistake, not this server's: a 400 carrying
      // jsonErrorReason's shape of the failure (never the body's own bytes), and no stack in the log.
      try { const buf = Buffer.concat(chunks); resolve(buf.length || requireBody ? JSON.parse(buf.toString("utf8")) : {}); }
      catch (e) {
        const bad = new Error(jsonErrorReason(e)) as HttpError;
        bad.statusCode = 400;
        reject(bad);
      }
    });
    req.on("error", reject);
  });
}

