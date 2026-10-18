// ui-profiles.test.mts — `app/ui/profiles.mts`'s saves against a stand-in server: the stamp each save sends and keeps, the stale retry, and a reload racing a save.
//
// `fetch` is replaced by a small in-memory /api/profiles with the real routes' stamp rules (a PUT whose `base` is not the current stamp is refused 409 "stale"; a PATCH answers the stamp before it as `was`), and a PUT can be held at the server, so a test can put a read between a save leaving the page and landing. Lives in app/ rather than app/ui/ for the reason app/ui-render.test.mts gives.
import "../scripts/localstorage-shim-for-tests.mts";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProfilesV3 } from "./build-spec.mts";
import { state } from "./ui/store.mts";
import { applyProfileEdits, type ProfileEdit } from "./profile-edits.mts";
import { editProfiles, loadProfiles, saveProfiles, setCharacterLabel } from "./ui/profiles.mts";

type Doc = { characters: Record<string, Record<string, unknown>>; templates: Record<string, unknown> };
// `fail`: the next PUTs or PATCHes answered 500 (a PATCH's then takes the server `down` when `downAfter`); `down`: every request fails with no answer at all; `drop`: the next PATCH is saved, then its answer lost
const server = { doc: { characters: {}, templates: {} } as Doc, n: 0, stale: 0, fail: 0, down: false, downAfter: false, drop: false, hold: null as Promise<void> | null };
const stamp = (): string => `s${server.n}`;
const answer = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = (async (path: string, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  if (server.down) throw new TypeError("fetch failed");
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
    if (server.hold) await server.hold;
    if (server.fail) { server.fail--; server.down = server.downAfter; return answer(500, { ok: false, error: "internal error" }); }
    const was = stamp(), refused = applyProfileEdits(server.doc as unknown as ProfilesV3, edits, { builtins: {}, canLabel: () => true });
    if (refused) return answer(409, { ok: false, code: "conflict", error: refused });
    server.n++;
    if (server.drop) { server.drop = false; throw new TypeError("fetch failed"); }
    return answer(200, { ok: true, stamp: stamp(), was });
  }
  throw new Error(`unexpected ${method} ${path}`);
}) as typeof fetch;

// A fresh server, and the page holding what it serves.
function fresh(doc: Doc = { characters: {}, templates: {} }): void {
  Object.assign(server, { doc: structuredClone(doc), n: 0, stale: 0, fail: 0, down: false, downAfter: false, drop: false, hold: null });
  state.profiles = structuredClone(doc) as unknown as ProfilesV3;
  state.profilesStamp = stamp();
}
// Holds every PUT and PATCH at the server until the returned function is called.
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

test("[fast] profiles: edits answered after a copy was read meanwhile read the file again rather than take its stamp", async () => {
  fresh({ characters: { Bo: { spec: {} } }, templates: {} });
  const release = holdPuts();
  const saving = setCharacterLabel("Bo", "Main");
  // another reader answered before the label landed: the file without it, and its stamp
  const before = await (await fetch("/api/profiles")).json() as { profiles: ProfilesV3; stamp: string };
  state.profiles = before.profiles; state.profilesStamp = before.stamp;
  release();
  assert.equal(await saving, true);
  assert.equal((state.profiles!.characters.Bo as { label?: string }).label, "Main", "the page's copy is the file, label included");
  assert.equal(state.profilesStamp, stamp());
});

test("[fast] profiles: an edit that no longer applies after a reload queued ahead of it blames the other window, not the page's own last change", async () => {
  fresh({ characters: {}, templates: { T: { spec: {} } } });
  delete server.doc.templates.T; server.n++;   // another window deleted T
  const loaded = loadProfiles();   // a scan's reload, queued first
  const update = saveProfiles((p) => { if (!Object.hasOwn(p.templates, "T")) return false; (p.templates as Record<string, unknown>).T = { spec: { x: 1 } }; });
  await loaded;
  const r = await update;
  assert.equal(r.ok, false);
  assert.equal(r.reloaded, true);
  assert.match(r.error!, /another window/);
});

test("[fast] profiles: edits that fail while the file can't be read again either are taken back off the copy, and the next save reads the file first", async () => {
  fresh({ characters: { Bo: { spec: {} } }, templates: {} });
  server.fail = 1; server.downAfter = true;   // the PATCH fails, and the reload after it finds the server gone
  const r = await editProfiles([{ op: "setLabel", name: "Bo", label: "Main" }]);
  server.down = false;
  assert.deepEqual(r, { ok: false, error: "internal error", reloaded: false });
  assert.equal((state.profiles!.characters.Bo as { label?: string }).label, undefined, "the page does not show the label as saved");
  assert.notEqual(state.profilesStamp, stamp(), "the copy's stamp no longer matches the file");
  // a whole-file save made next is refused as stale, reads the file and makes its own edit again, never carrying the failed one
  assert.equal((await saveProfiles(put("Next"))).ok, true);
  assert.equal(server.doc.characters.Bo!.label, undefined);
  assert.deepEqual(names(), ["Next"]);
});

test("[fast] profiles: edits whose answer was lost after the server saved them say the change may have been saved, and the copy shows that it was", async () => {
  fresh({ characters: { Bo: { spec: {} } }, templates: {} });
  server.drop = true;
  const r = await editProfiles([{ op: "setLabel", name: "Bo", label: "Main" }]);
  assert.equal(r.ok, false);
  assert.equal(r.reloaded, true);
  assert.match(r.error!, /may have been saved/);
  assert.equal((state.profiles!.characters.Bo as { label?: string }).label, "Main", "read again: the label is there");
  assert.equal(state.profilesStamp, stamp());
});
