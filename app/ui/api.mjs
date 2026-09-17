// ui/api.mjs — the one place every page fetch goes through (Task 4, localhost security). Adds
// X-Client-Id (so the server can tell one browser tab's optimize job from another's and cap it at
// one running job per client) and content-type: application/json on a body; throws with the
// server's own {error} message on any non-2xx response so callers can just try/catch instead of
// checking r.ok by hand. Deliberately carries no Authorization header and no token — the bare page
// has no token code at all (spec §4.5); a future Electron shell adds the header itself when it
// embeds this same page (Phase 4), which is why a --token server 401s every page fetch today (see
// CONTRIBUTING.md's Security section).
//
// EventSource cannot carry custom headers, so it cannot send this id (or a token) either — callers
// open it themselves with CLIENT_ID as a `?client=` query parameter instead (see ui/builder.mjs),
// which is what lets the server confirm a stream belongs to the job's own owner without needing
// the token exemption to also mean "anyone can read anyone's progress".
function newId() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
}
function loadClientId() {
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

export async function api(path, { method = "GET", body } = {}) {
  const headers = { "x-client-id": CLIENT_ID };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* no/invalid JSON body — data stays null */ }
  if (!res.ok) {
    // status is attached (not just the message) so a caller can branch on a specific code — e.g. the
    // setup wizard telling a 501 ("not available outside the desktop app", host.pickFolder missing)
    // apart from a real 400/409 it should show the user instead.
    const err = new Error((data && data.error) || `${method} ${path} failed: ${res.status}`);
    err.status = res.status;
    err.code = data && data.code;
    throw err;
  }
  return data;
}
