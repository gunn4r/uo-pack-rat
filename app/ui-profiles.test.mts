// ui-profiles.test.mts — `app/ui/profiles.mts`'s saves against a stand-in server: the stamp each save keeps, a file saved elsewhere, refused edits, and a reload racing a save.
//
// `fetch` is replaced by a small in-memory /api/profiles with the real route's rules (a PATCH makes its edits with `app/profile-edits.mts` on the file as it is, answers the stamp before it as `was`, and refuses a list it can't make with 409), and a PATCH can be held at the server, so a test can put a read between a save leaving the page and landing. Lives in app/ rather than app/ui/ for the reason app/ui-render.test.mts gives.
import "../scripts/localstorage-shim-for-tests.mts";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProfilesV3 } from "./build-spec.mts";
import { state } from "./ui/store.mts";
import { applyProfileEdits, type ProfileEdit } from "./profile-edits.mts";
import { editProfiles, loadProfiles, setCharacterLabel } from "./ui/profiles.mts";

type Doc = { characters: Record<string, Record<string, unknown>>; templates: Record<string, unknown> };
const server = { doc: { characters: {}, templates: {} } as Doc, n: 0, hold: null as Promise<void> | null };
const stamp = (): string => `s${server.n}`;
const answer = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = (async (path: string, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  if (path === "/api/profiles" && method === "GET") return answer(200, { ok: true, profiles: structuredClone(server.doc), stamp: stamp(), builtinTemplates: {} });
  if (path === "/api/profiles" && method === "PATCH") {
    const { edits } = JSON.parse(String(init!.body)) as { edits: ProfileEdit[] };
    if (server.hold) await server.hold;   // the body is still on its way: anything else the server answers meanwhile goes first
    const next = structuredClone(server.doc), was = stamp(), refused = applyProfileEdits(next as unknown as ProfilesV3, edits, { builtins: {}, canLabel: () => true });
    if (refused) return answer(409, { ok: false, code: "conflict", error: refused });
    server.doc = next; server.n++;
    return answer(200, { ok: true, stamp: stamp(), was });
  }
  throw new Error(`unexpected ${method} ${path}`);
}) as typeof fetch;

// A fresh server, and the page holding what it serves.
function fresh(doc: Doc = { characters: {}, templates: {} }): void {
  Object.assign(server, { doc: structuredClone(doc), n: 0, hold: null });
  state.profiles = structuredClone(doc) as unknown as ProfilesV3;
  state.profilesStamp = stamp();
}
// Holds every PATCH at the server until the returned function is called.
function holdSaves(): () => void {
  let release!: () => void;
  server.hold = new Promise((r) => { release = r; });
  return () => { server.hold = null; release(); };
}
const put = (id: string, create = false): ProfileEdit[] => [{ op: "putTemplate", id, entry: { spec: { id } } as never, ...(create ? { create } : {}) }];
const names = (doc: { templates: object }): string[] => Object.keys(doc.templates).sort();

test("[fast] profiles: edits answered after a copy was read meanwhile read the file again rather than take its stamp", async () => {
  fresh();
  const release = holdSaves();
  const saving = editProfiles(put("A"));
  // another reader answered before A landed: the file without it, and its stamp
  const before = await (await fetch("/api/profiles")).json() as { profiles: ProfilesV3; stamp: string };
  state.profiles = before.profiles; state.profilesStamp = before.stamp;
  release();
  assert.equal((await saving).ok, true);
  assert.deepEqual(names(state.profiles!), ["A"], "the page's copy is the file, A included");
  assert.equal(state.profilesStamp, stamp());
});

test("[fast] profiles: a reload waits for the save in flight, so it reads the file with that save in it", async () => {
  fresh();
  const release = holdSaves();
  const saving = editProfiles(put("A"));
  const loaded = loadProfiles();
  release();
  await Promise.all([saving, loaded]);
  assert.deepEqual(names(state.profiles!), ["A"]);
  assert.equal(state.profilesStamp, stamp());
});

test("[fast] profiles: edits over a file saved elsewhere since land on it, and the page reads it again", async () => {
  fresh();
  server.doc.templates.Other = { spec: {} }; server.n++;   // another window's save
  assert.deepEqual(await editProfiles(put("Mine")), { ok: true, reloaded: true });
  assert.deepEqual(names(server.doc), ["Mine", "Other"]);
  assert.deepEqual(names(state.profiles!), ["Mine", "Other"]);
  assert.equal(state.profilesStamp, stamp());
});

test("[fast] profiles: a template put with create never writes over one made elsewhere since; the page says why and reads the file again", async () => {
  fresh();
  server.doc.templates.Spare = { spec: { theirs: true } }; server.n++;   // another window made Spare after this page checked the name
  const r = await editProfiles(put("Spare", true));
  assert.equal(r.ok, false);
  assert.equal(r.reloaded, true);
  assert.match(r.error!, /already a template named Spare/);
  assert.deepEqual(server.doc.templates.Spare, { spec: { theirs: true } }, "theirs is kept");
  assert.deepEqual(state.profiles!.templates.Spare, { spec: { theirs: true } }, "and the page shows it");
});

test("[fast] profiles: a label saved over the file this page read takes its stamp; saved over another one, the rest is read again", async () => {
  fresh({ characters: { Bo: { spec: {} } }, templates: {} });
  assert.equal(await setCharacterLabel("Bo", "Main"), true);
  assert.equal((state.profiles!.characters.Bo as { label?: string }).label, "Main");
  assert.equal(state.profilesStamp, stamp());

  fresh({ characters: { Bo: { spec: {} } }, templates: {} });
  server.doc.templates.Other = { spec: {} }; server.n++;   // saved elsewhere since this page read it
  assert.equal(await setCharacterLabel("Bo", "Main"), true);
  assert.deepEqual(names(state.profiles!), ["Other"], "the rest is read again");
  assert.equal(state.profilesStamp, stamp());
});

test("[fast] profiles: an edit that no longer applies after a reload queued ahead of it says the template was deleted elsewhere", async () => {
  fresh({ characters: {}, templates: { T: { spec: {} } } });
  delete server.doc.templates.T; server.n++;   // another window deleted T
  const loaded = loadProfiles();   // a scan's reload, queued first
  const update = editProfiles([{ op: "updateTemplate", id: "T", spec: { x: 1 } as never, savedAt: "2026-10-18T00:00:00.000Z" }]);
  await loaded;
  const r = await update;
  assert.equal(r.ok, false);
  assert.equal(r.reloaded, true);
  assert.match(r.error!, /deleted elsewhere/);
  assert.deepEqual(names(state.profiles!), []);
});
