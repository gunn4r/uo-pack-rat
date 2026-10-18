// ui-profiles.test.mts — `app/ui/profiles.mts`'s saves against a stand-in server: the stamp each save sends and keeps, the stale retry, and a reload racing a save.
//
// `fetch` is replaced by a small in-memory /api/profiles with the real routes' stamp rules (a PUT whose `base` is not the current stamp is refused 409 "stale"; a PATCH answers the stamp before it as `was`), and a PUT can be held at the server, so a test can put a read between a save leaving the page and landing. Lives in app/ rather than app/ui/ for the reason app/ui-render.test.mts gives.
import "../scripts/localstorage-shim-for-tests.mts";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProfilesV3 } from "./build-spec.mts";
import { state } from "./ui/store.mts";
import { applyProfileEdits, type ProfileEdit } from "./profile-edits.mts";
import { loadProfiles, saveProfiles, setCharacterLabel } from "./ui/profiles.mts";

type Doc = { characters: Record<string, Record<string, unknown>>; templates: Record<string, unknown> };
const server = { doc: { characters: {}, templates: {} } as Doc, n: 0, stale: 0, fail: 0, hold: null as Promise<void> | null };
const stamp = (): string => `s${server.n}`;
const answer = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = (async (path: string, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  if (path === "/api/profiles" && method === "GET") return answer(200, { ok: true, profiles: structuredClone(server.doc), stamp: stamp(), builtinTemplates: {} });
  if (path === "/api/profiles" && method === "PUT") {
    const { base, ...body } = JSON.parse(String(init!.body)) as Doc & { base: string };
    if (server.hold) await server.hold;   // the body is still on its way: anything else the server answers meanwhile goes first
    if (server.fail) { server.fail--; return answer(500, { ok: false, error: "internal error" }); }
    if (base !== stamp()) { server.stale++; return answer(409, { ok: false, code: "stale", error: "stale", stamp: stamp() }); }
    server.doc = body; server.n++;
    return answer(200, { ok: true, stamp: stamp() });
  }
  if (path === "/api/profiles" && method === "PATCH") {
    const { edits } = JSON.parse(String(init!.body)) as { edits: ProfileEdit[] };
    const was = stamp(), refused = applyProfileEdits(server.doc as unknown as ProfilesV3, edits, { builtins: {}, canLabel: () => true });
    if (refused) return answer(409, { ok: false, code: "conflict", error: refused });
    server.n++;
    return answer(200, { ok: true, stamp: stamp(), was });
  }
  throw new Error(`unexpected ${method} ${path}`);
}) as typeof fetch;

// A fresh server, and the page holding what it serves.
function fresh(doc: Doc = { characters: {}, templates: {} }): void {
  Object.assign(server, { doc: structuredClone(doc), n: 0, stale: 0, fail: 0, hold: null });
  state.profiles = structuredClone(doc) as unknown as ProfilesV3;
  state.profilesStamp = stamp();
}
// Holds every PUT at the server until the returned function is called.
function holdPuts(): () => void {
  let release!: () => void;
  server.hold = new Promise((r) => { release = r; });
  return () => { server.hold = null; release(); };
}
const put = (name: string) => (p: ProfilesV3): void => { (p.templates as Record<string, unknown>)[name] = { spec: {} }; };
const names = (): string[] => Object.keys(server.doc.templates).sort();

test("[fast] profiles: a copy read while a save is in flight keeps its own stamp, so the next save cannot undo the one before", async () => {
  fresh();
  const release = holdPuts();
  const a = saveProfiles(put("A"));
  // another reader of the profiles (as a scan's reload once did) answered before A landed: the file without A, and its stamp
  const before = await (await fetch("/api/profiles")).json() as { profiles: ProfilesV3; stamp: string };
  state.profiles = before.profiles; state.profilesStamp = before.stamp;
  release();
  assert.equal((await a).ok, true);
  assert.equal(state.profilesStamp, before.stamp, "A's stamp is not taken over a copy that lacks A");
  const b = await saveProfiles(put("B"));
  assert.equal(b.ok, true);
  assert.deepEqual(names(), ["A", "B"], "B's save went through a stale retry rather than writing over A");
  assert.equal(server.stale, 1);
});

test("[fast] profiles: a reload waits for the save in flight, so it reads the file with that save in it", async () => {
  fresh();
  const release = holdPuts();
  const a = saveProfiles(put("A"));
  const loaded = loadProfiles();
  release();
  await Promise.all([a, loaded]);
  assert.deepEqual(Object.keys(state.profiles!.templates), ["A"]);
  assert.equal(state.profilesStamp, stamp());
  assert.equal((await saveProfiles(put("B"))).ok, true);
  assert.deepEqual(names(), ["A", "B"]);
  assert.equal(server.stale, 0, "no save was refused");
});

test("[fast] profiles: a save over a file saved elsewhere reloads, makes the edit again, and says the copy was reloaded", async () => {
  fresh();
  server.doc.templates.Other = { spec: {} }; server.n++;   // another window's save
  const r = await saveProfiles(put("Mine"));
  assert.deepEqual(r, { ok: true, reloaded: true });
  assert.deepEqual(names(), ["Mine", "Other"]);
  assert.deepEqual(Object.keys(state.profiles!.templates).sort(), ["Mine", "Other"]);
});

test("[fast] profiles: a retry that fails for another reason still says the copy was reloaded, so nothing is undone on a detached one", async () => {
  fresh();
  server.doc.templates.Other = { spec: {} }; server.n++;   // another window's save, so the first PUT is refused stale
  // the retry meets a server error
  const orig = globalThis.fetch;
  let puts = 0;
  globalThis.fetch = (async (path: string, init?: RequestInit) => {
    if (init?.method === "PUT" && ++puts === 2) server.fail = 1;
    return orig(path, init);
  }) as typeof fetch;
  try {
    const r = await saveProfiles(put("Mine"));
    assert.deepEqual(r, { ok: false, error: "internal error", reloaded: true });
    assert.deepEqual(names(), ["Other"]);
  } finally { globalThis.fetch = orig; }
});

test("[fast] profiles: a second stale refusal gives up with the stale message; an edit a change just before it made moot does not blame another window", async () => {
  fresh({ characters: {}, templates: { T: { spec: {} } } });
  // every save meets a file saved elsewhere since
  const orig = globalThis.fetch;
  globalThis.fetch = (async (path: string, init?: RequestInit) => {
    if (init?.method === "PUT") server.n++;
    return orig(path, init);
  }) as typeof fetch;
  try {
    const r = await saveProfiles(put("Mine"));
    assert.equal(r.ok, false);
    assert.equal(r.reloaded, true);
    assert.match(r.error!, /another window/);
  } finally { globalThis.fetch = orig; }

  fresh({ characters: {}, templates: { T: { spec: {} } } });
  const del = saveProfiles((p) => { delete (p.templates as Record<string, unknown>).T; });
  const update = saveProfiles((p) => { if (!Object.hasOwn(p.templates, "T")) return false; (p.templates as Record<string, unknown>).T = { spec: { x: 1 } }; });
  assert.equal((await del).ok, true);
  const u = await update;
  assert.equal(u.ok, false);
  assert.equal(u.reloaded, false);
  assert.doesNotMatch(u.error!, /another window/);
  assert.match(u.error!, /change you made just before it/);
});

test("[fast] profiles: a label saved over the file this page read takes its stamp; saved over another one, the rest is read again", async () => {
  fresh({ characters: { Bo: { spec: {} } }, templates: {} });
  assert.equal(await setCharacterLabel("Bo", "Main"), true);
  assert.equal((state.profiles!.characters.Bo as { label?: string }).label, "Main");
  assert.equal(state.profilesStamp, stamp());

  fresh({ characters: { Bo: { spec: {} } }, templates: {} });
  server.doc.templates.Other = { spec: {} }; server.n++;   // saved elsewhere since this page read it
  assert.equal(await setCharacterLabel("Bo", "Main"), true);
  assert.deepEqual(Object.keys(state.profiles!.templates), ["Other"], "the rest is read again");
  assert.equal(state.profilesStamp, stamp());
});
