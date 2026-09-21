// ui/api.mts — the one place every page fetch goes through (Task 4, localhost security). Adds
// X-Client-Id (so the server can tell one browser tab's optimize job from another's and cap it at
// one running job per client) and content-type: application/json on a body; throws with the
// server's own {error} message on any non-2xx response so callers can just try/catch instead of
// checking r.ok by hand. Deliberately carries no Authorization header and no token — the bare page
// has no token code at all (spec §4.5); a future Electron shell adds the header itself when it
// embeds this same page (Phase 4), which is why a --token server 401s every page fetch today (see
// CONTRIBUTING.md's Security section).
//
// EventSource cannot carry custom headers, so it cannot send this id (or a token) either — callers
// open it themselves with CLIENT_ID as a `?client=` query parameter instead (see ui/builder.mts),
// which is what lets the server confirm a stream belongs to the job's own owner without needing
// the token exemption to also mean "anyone can read anyone's progress".
import type { ApiError } from "./api-types.mts";

function newId(): string {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
}
function loadClientId(): string {
  try {
    const existing = sessionStorage.getItem("qm.client");
    if (existing) return existing;
    const id = newId();
    sessionStorage.setItem("qm.client", id);
    return id;
  } catch {
    return newId();   // sessionStorage unavailable (private mode, etc.) — fall back to one id for the page's life
  }
}
export const CLIENT_ID = loadClientId();

export interface ApiOptions {
  method?: string | undefined;
  body?: unknown;
}
// api<T>(path, opts) — every call site names the response shape it expects (api-types.mts has one
// interface per route); `T` defaults to `unknown` for a caller that only checks `.ok` or ignores the
// body, same trust level a raw HTTP response deserves everywhere else in this project
// (server.test.mts's own asJson<T>() documents the identical reasoning on the Node side).
export async function api<T = unknown>(path: string, { method = "GET", body }: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "x-client-id": CLIENT_ID };
  if (body !== undefined) headers["content-type"] = "application/json";
  // RequestInit's own type has no `| undefined` on `body` (only `BodyInit | null`), and
  // exactOptionalPropertyTypes holds every optional property to its exact declared type — this cast
  // is compiler-only (the object literal itself, and what fetch() receives, are unchanged): passing
  // `body: undefined` and omitting `body` entirely are identical to fetch() itself either way.
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined } as RequestInit);
  let data: unknown = null;
  try { data = await res.json(); } catch { /* no/invalid JSON body — data stays null */ }
  if (!res.ok) {
    // status is attached (not just the message) so a caller can branch on a specific code — e.g. the
    // setup wizard telling a 501 ("not available outside the desktop app", host.pickFolder missing)
    // apart from a real 400/409 it should show the user instead. `data` is unvalidated network input
    // (the whole reason `api()`'s own return is generic) — this cast only reaches for the two fields
    // an error body has always carried, same trust as the rest of this function.
    const errBody = data as { error?: string; code?: unknown } | null;
    const err: ApiError = new Error((errBody && errBody.error) || `${method} ${path} failed: ${res.status}`);
    err.status = res.status;
    err.code = errBody && errBody.code;
    throw err;
  }
  return data as T;
}
