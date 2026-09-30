// organize-server.test.mts — the Organize routes (issue #11) against a real listening server on a temp data
// folder: GET/PUT /api/organize (organize.json), GET /api/organize/plan and POST /api/organize/trip with the
// results overlay (organize-state.json), GET /api/organize/presets and POST /api/organize/match. Tags: [fast]. Run: node --test app/organize-server.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfig, ensureLayout } from "./config.mts";
import { startServer, type ServerHandle } from "./vault-server.mts";
import { candidateClientRoots } from "./installer.mts";
import { houseScan, maxOrganizeConfig, type BoxSpec, type ThingSpec } from "./organize-fixture.mts";
import { emptyRuleQuery, emptyOrganizeConfig, type OrganizeConfig } from "./organize-config.mts";
import type { Plan } from "./organize.mts";
import type { Container, Item } from "./vault-lib.mts";
import { PRESETS } from "./organize-presets.mts";
import type { Proposal } from "./organize-strategies.mts";

const FAKE_HOME = mkdtempSync(join(tmpdir(), "qm-home-"));
const A = 0x40000001, B = 0x40000002, PEARL = 0x40001001, RUBY = 0x40001002;
const CONFIG_DOC: OrganizeConfig = {
  ...emptyOrganizeConfig(),
  labels: { [String(A)]: { serial: A, name: "Reagents", origin: "manual" }, [String(B)]: { serial: B, name: "Gems", origin: "manual" } },
  rules: [
    { id: "reagents", name: "Reagents", match: { query: { ...emptyRuleQuery(), kind: ["reagent"] } }, targets: [A], origin: "manual" },
    { id: "gems", name: "Gems", match: { query: { ...emptyRuleQuery(), kind: ["gem"] } }, targets: [B], origin: "manual" },
  ],
};

async function serve(extra: ThingSpec[] = [], extraBoxes: BoxSpec[] = []): Promise<{ s: ServerHandle; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "qm-organize-"));
  const config = ensureLayout(resolveConfig(["--port", "0", "--data", dir], {}));
  const scannedAt = new Date(Date.now() - 3600e3).toISOString();
  writeFileSync(join(dir, "scans", "house.json"), JSON.stringify(houseScan({ scannedAt,
    boxes: [{ serial: A, pos: { x: 100, y: 100, z: 0, facet: 1 } }, { serial: B, pos: { x: 104, y: 100, z: 0, facet: 1 } }, ...extraBoxes],
    things: [{ serial: PEARL, name: "Black Pearl", in: B }, { serial: RUBY, name: "Ruby", in: A }, ...extra] })));
  const s = await startServer(config, {
    clientSearch: { home: FAKE_HOME, candidates: (a) => candidateClientRoots({ adapter: a.id, home: FAKE_HOME, platform: "linux", env: {}, adapterPlatform: a.platform }) },
    clientRunning: () => false,
  });
  return { s, dir };
}
const body = (method: string, value: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
async function call<T = Record<string, unknown>>(s: ServerHandle, path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const r = await fetch(s.url + path, init);
  return { status: r.status, body: (await r.json()) as T };
}

test("[fast] GET /api/organize starts empty; PUT saves a valid setup and GET reads it back", async () => {
  const { s, dir } = await serve();
  try {
    assert.deepEqual((await call(s, "/api/organize")).body, { ok: true, config: emptyOrganizeConfig(), problems: [] });
    const put = await call(s, "/api/organize", body("PUT", CONFIG_DOC));
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "organize.json"), "utf8")), CONFIG_DOC);
    assert.deepEqual((await call(s, "/api/organize")).body, { ok: true, config: CONFIG_DOC, problems: [] });
  } finally {
    await s.close();
  }
});

test("[fast] PUT /api/organize refuses a broken setup and a blacklisted label, and leaves the file alone", async () => {
  const { s, dir } = await serve();
  try {
    assert.equal((await call(s, "/api/organize", body("PUT", CONFIG_DOC))).status, 200);
    const withLoc = structuredClone(CONFIG_DOC);
    Object.assign(withLoc.rules[0]!.match.query, { loc: ["Chest"] });
    const bad = await call(s, "/api/organize", body("PUT", withLoc));
    assert.equal(bad.status, 400);
    assert.match(String(bad.body.error), /loc is not a rule filter/);
    assert.equal((await call(s, "/api/blacklist", body("POST", { serial: A, name: "Chest" }))).status, 200);
    const black = await call(s, "/api/organize", body("PUT", CONFIG_DOC));
    assert.equal(black.status, 400);
    assert.match(String(black.body.error), /blacklisted/);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "organize.json"), "utf8")), CONFIG_DOC);
  } finally {
    await s.close();
  }
});

test("[fast] a hand-edited organize.json is salvaged on read, and one that does not parse is moved aside", async () => {
  const { s, dir } = await serve();
  try {
    const edited = structuredClone(CONFIG_DOC);
    Object.assign(edited.rules[0]!.match.query, { loc: [] });
    writeFileSync(join(dir, "organize.json"), JSON.stringify(edited));
    const got = await call<{ config: OrganizeConfig; problems: string[] }>(s, "/api/organize");
    assert.deepEqual(got.body.config.rules.map((r) => r.id), ["gems"]);
    assert.match(got.body.problems.join("\n"), /rules\[0\]\.match\.query\.loc is not a rule filter.*rule dropped/);
    writeFileSync(join(dir, "organize.json"), "{oops");
    const broken = await call<{ config: OrganizeConfig; problems: string[] }>(s, "/api/organize");
    assert.deepEqual(broken.body.config, emptyOrganizeConfig());
    assert.match(broken.body.problems.join("\n"), /did not parse/);
    assert.equal(existsSync(join(dir, "organize.json.corrupt")), true);
    assert.equal(existsSync(join(dir, "organize.json")), false);
  } finally {
    await s.close();
  }
});

const queued = (dir: string): Record<string, unknown>[] => {
  const f = join(dir, "bridge", "tazuo", "queue.jsonl");
  return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>) : [];
};
const stateOf = (dir: string): { pending: { id: string }[]; moves: { serial: number; to: number | null }[] } => JSON.parse(readFileSync(join(dir, "organize-state.json"), "utf8"));

test("[fast] GET /api/organize/plan plans the moves; POST /api/organize/trip queues the current trip once", async () => {
  const { s, dir } = await serve();
  try {
    assert.equal((await call(s, "/api/organize", body("PUT", CONFIG_DOC))).status, 200);
    const plan = (await call<{ plan: Plan }>(s, "/api/organize/plan")).body.plan;
    assert.deepEqual(plan.moves.map((m) => [m.serial, m.to, m.trip]).sort((a, b) => a[0]! - b[0]!), [[PEARL, A, 1], [RUBY, B, 1]]);
    const stale = await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: "00000000" }));
    assert.equal(stale.status, 409);
    assert.equal(stale.body.stamp, plan.stamp);
    assert.deepEqual(queued(dir), []);
    const ok = await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: plan.stamp }));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const [line] = queued(dir);
    assert.deepEqual([line!.id, line!.action, line!.index, line!.stamp], [ok.body.id, "trip", 1, plan.stamp]);
    assert.deepEqual((line!.takes as { serial: number }[]).map((t) => t.serial).sort(), [PEARL, RUBY].sort());
    assert.deepEqual(stateOf(dir).pending.map((p) => p.id), [ok.body.id]);
    const again = await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: plan.stamp }));
    assert.equal(again.status, 409);
    assert.match(String(again.body.error), /has not reported back/);
    assert.equal(queued(dir).length, 1);
  } finally {
    await s.close();
  }
});

test("[fast] GET /api/organize/plan names the trip in flight, and whether its bridge has picked it up, so a reloaded page can follow it", async () => {
  const { s, dir } = await serve();
  try {
    await call(s, "/api/organize", body("PUT", CONFIG_DOC));
    const first = (await call<{ plan: Plan; running: unknown }>(s, "/api/organize/plan")).body;
    assert.equal(first.running, null);
    const id = String((await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: first.plan.stamp }))).body.id);
    const queuedAt = (JSON.parse(readFileSync(join(dir, "organize-state.json"), "utf8")) as { pending: { queuedAt: string }[] }).pending[0]!.queuedAt;
    assert.deepEqual((await call(s, "/api/organize/plan")).body.running, { id, index: 1, queuedAt, picked: false });
    const status = (current: unknown, results: unknown = {}) => writeFileSync(join(dir, "bridge", "tazuo", "status.json"), JSON.stringify({ alive: new Date().toISOString(), character: "Tester", current, results, counts: {} }));
    status({ id, action: "trip" });
    assert.deepEqual((await call(s, "/api/organize/plan")).body.running, { id, index: 1, queuedAt, picked: true });
    status(null, { [id]: { ok: true, msg: "trip 1: stopped", t: new Date().toISOString(), stopped: true, steps: [] } });
    assert.equal((await call(s, "/api/organize/plan")).body.running, null);
  } finally {
    await s.close();
  }
});

test("[fast] a trip's reported steps go into the overlay, and the next plan no longer carries them", async () => {
  const { s, dir } = await serve();
  try {
    await call(s, "/api/organize", body("PUT", CONFIG_DOC));
    const plan = (await call<{ plan: Plan }>(s, "/api/organize/plan")).body.plan;
    const id = String((await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: plan.stamp }))).body.id);
    const t = new Date().toISOString();
    writeFileSync(join(dir, "bridge", "tazuo", "status.json"), JSON.stringify({ alive: t, character: "Tester", current: null, counts: { done: 1, failed: 0 },
      results: { [id]: { ok: true, msg: "trip 1: 2 put away, 0 steps failed", t, partial: false, stopped: false, steps: [
        { op: "take", serial: RUBY, ok: true, msg: "took Ruby" }, { op: "take", serial: PEARL, ok: true, msg: "took Black Pearl" },
        { op: "put", serial: RUBY, ok: true, msg: "put Ruby away" }, { op: "put", serial: PEARL, ok: true, msg: "put Black Pearl away" }] } } }));
    const next = (await call<{ plan: Plan }>(s, "/api/organize/plan")).body.plan;
    assert.deepEqual(next.moves, []);
    assert.deepEqual(next.rules.map((r) => [r.ruleId, r.inPlace]), [["reagents", 1], ["gems", 1]]);
    assert.notEqual(next.stamp, plan.stamp);
    const st = stateOf(dir);
    assert.deepEqual(st.pending, []);
    assert.deepEqual(st.moves.map((m) => [m.serial, m.to]), [[PEARL, A], [RUBY, B]]);
    const gone = await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: next.stamp }));
    assert.equal(gone.status, 404);
  } finally {
    await s.close();
  }
});

// Issue #127: every view and bridge command reads the inventory the server serves, and that is the fold with the
// overlay applied, so after a trip Inventory, Find and Highlight point where the trip put an item.
test("[fast] after a trip the served inventory shows where it put each item, a carried item in the backpack, until a newer scan says otherwise", { timeout: 10e3 }, async () => {
  const PACK = 0x40000009;
  const { s, dir } = await serve([], [{ serial: PACK, kind: "backpack", name: "Backpack" }]);
  const events = await fetch(s.url + "/api/events");
  const reader = events.body!.getReader();
  try {
    await call(s, "/api/organize", body("PUT", CONFIG_DOC));
    const plan = (await call<{ plan: Plan }>(s, "/api/organize/plan")).body.plan;
    const id = String((await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: plan.stamp }))).body.id);
    const t = new Date().toISOString();
    writeFileSync(join(dir, "bridge", "tazuo", "status.json"), JSON.stringify({ alive: t, character: "Tester", current: null, counts: { done: 1, failed: 0 },
      results: { [id]: { ok: true, msg: "trip 1: 1 put away, 1 step failed", t, partial: false, stopped: false, steps: [
        { op: "take", serial: RUBY, ok: true, msg: "took Ruby" }, { op: "take", serial: PEARL, ok: true, msg: "took Black Pearl" },
        { op: "put", serial: RUBY, ok: true, msg: "put Ruby away" }, { op: "put", serial: PEARL, ok: false, msg: "no room" }] } } }));
    await call(s, "/api/organize/plan");   // reads the trip's result into the overlay
    // An open page hears that the inventory changed, and reloads it.
    const decoder = new TextDecoder();
    let heard = "";
    while (!heard.includes('event: changed\ndata: {"what":"inventory"')) {
      const { value, done } = await reader.read();
      assert.equal(done, false, heard);
      heard += decoder.decode(value, { stream: true });
    }
    const inv = (await call<{ inventory: { containers: Record<string, Container>; rootCounts: Record<string, number> } }>(s, "/api/inventory")).body.inventory;
    const byName = async (q: string): Promise<Item> => (await call<{ rows: Item[] }>(s, `/api/items?q=${encodeURIComponent(q)}`)).body.rows[0]!;
    // The page's chainOf (app/ui/bridge.mts): the containers around the item, root first.
    const chainOf = (it: Item): number[] => { const out: number[] = []; for (let c = inv.containers[String(it.container)]; c; c = c.parent != null ? inv.containers[String(c.parent)] : undefined) out.unshift(c.serial); return out; };
    const ruby = await byName("Ruby");
    assert.deepEqual([ruby.container, ruby.root, ruby.location?.text, ruby.location?.root, chainOf(ruby)], [B, B, `Box ${B}`, B, [B]]);
    const pearl = await byName("Black Pearl");
    assert.deepEqual([pearl.container, pearl.root, pearl.location?.kind, pearl.location?.character, pearl.location?.text, chainOf(pearl)], [PACK, PACK, "backpack", "Tester", "Tester's backpack", [PACK]]);
    assert.deepEqual((await call<{ items: Record<string, Item> }>(s, `/api/items/by-serial?serials=${RUBY}`)).body.items[RUBY]!.location?.text, `Box ${B}`);
    assert.deepEqual([inv.containers[A]!.capacity?.items, inv.containers[B]!.capacity?.items, inv.rootCounts[A], inv.rootCounts[B], inv.rootCounts[PACK]], [0, 1, undefined, 1, 1]);
    // The planner applies the overlay itself, once: nothing is planned again, the carried pearl is put away.
    const next = (await call<{ plan: Plan }>(s, "/api/organize/plan")).body.plan;
    assert.deepEqual(next.moves.map((m) => [m.serial, m.from, m.to]), [[PEARL, null, A]]);
    // A scan of the house newer than the trip wins over the overlay.
    writeFileSync(join(dir, "scans", "house-later.json"), JSON.stringify(houseScan({ scannedAt: new Date(Date.now() + 60e3).toISOString(),
      boxes: [{ serial: A }, { serial: B, pos: { x: 104, y: 100, z: 0, facet: 1 } }, { serial: PACK, kind: "backpack", name: "Backpack" }],
      things: [{ serial: PEARL, name: "Black Pearl", in: B }, { serial: RUBY, name: "Ruby", in: A }] })));
    assert.deepEqual([(await byName("Ruby")).location?.text, (await byName("Black Pearl")).location?.text], [`Box ${A}`, `Box ${B}`]);
  } finally {
    await reader.cancel().catch(() => {});
    await s.close();
  }
});

test("[fast] POST /api/organize/trip refuses a bad body, a trip that is not its site's next, and a client whose bridge cannot run trips", async () => {
  const garlic: ThingSpec[] = Array.from({ length: 21 }, (_, i) => ({ serial: 0x40002000 + i, name: "Garlic", in: B }));
  const { s, dir } = await serve(garlic);
  try {
    await call(s, "/api/organize", body("PUT", CONFIG_DOC));
    assert.equal((await call(s, "/api/organize/trip", body("POST", { index: 0, stamp: "x" }))).status, 400);
    const plan = (await call<{ plan: Plan }>(s, "/api/organize/plan")).body.plan;
    assert.deepEqual(plan.trips.map((t) => [t.index, t.site]), [[1, 0], [2, 0]]);
    const second = await call(s, "/api/organize/trip", body("POST", { index: 2, stamp: plan.stamp }));
    assert.equal(second.status, 409);
    assert.match(String(second.body.error), /run trip 1 first/);
    const web = await call(s, "/api/settings", body("PUT", { client: { adapter: "classicuo-web", scriptsDir: "" } }));
    assert.equal(web.status, 200, JSON.stringify(web.body));
    const noTrip = await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: plan.stamp }));
    assert.equal(noTrip.status, 409);
    assert.match(String(noTrip.body.error), /cannot run Organize trips/);
    assert.deepEqual(queued(dir), []);
  } finally {
    await s.close();
  }
});

test("[fast] a trip whose bridge went quiet mid-run stops holding the queue once its heartbeat is stale", async () => {
  const { s, dir } = await serve();
  try {
    await call(s, "/api/organize", body("PUT", CONFIG_DOC));
    const plan = (await call<{ plan: Plan }>(s, "/api/organize/plan")).body.plan;
    const id = String((await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: plan.stamp }))).body.id);
    const old = new Date(Date.now() - 600e3).toISOString();
    const st = JSON.parse(readFileSync(join(dir, "organize-state.json"), "utf8"));
    st.pending[0].queuedAt = old;
    writeFileSync(join(dir, "organize-state.json"), JSON.stringify(st));
    const status = (alive: string) => writeFileSync(join(dir, "bridge", "tazuo", "status.json"), JSON.stringify({ alive, character: "Tester", current: { id, action: "trip" }, results: {}, counts: {} }));
    status(new Date().toISOString());
    assert.match(String((await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: plan.stamp }))).body.error), /has not reported back/);
    status(old);
    const retry = await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: plan.stamp }));
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
  } finally {
    await s.close();
  }
});

test("[fast] no trip runs off a salvaged organize.json, and a file that is not a version 1 setup is moved aside, not overwritten", async () => {
  const { s, dir } = await serve();
  try {
    const edited = structuredClone(CONFIG_DOC);
    Object.assign(edited.rules[0]!.match.query, { loc: [] });
    writeFileSync(join(dir, "organize.json"), JSON.stringify(edited));
    const plan = (await call<{ plan: Plan }>(s, "/api/organize/plan")).body.plan;
    const refused = await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: plan.stamp }));
    assert.equal(refused.status, 409);
    assert.match(String(refused.body.error), /save the setup first/);
    assert.deepEqual(queued(dir), []);
    writeFileSync(join(dir, "organize.json"), JSON.stringify({ version: 2, future: true }));
    const got = await call<{ config: OrganizeConfig; problems: string[] }>(s, "/api/organize");
    assert.deepEqual(got.body.config, emptyOrganizeConfig());
    assert.match(got.body.problems.join("\n"), /not a version 1 Organize setup; it was moved to organize\.json\.corrupt/);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "organize.json.corrupt"), "utf8")), { version: 2, future: true });
  } finally {
    await s.close();
  }
});

test("[fast] PUT /api/organize takes the largest setup the check allows, and GET reads it back whole", async () => {
  const { s } = await serve();
  try {
    const max = maxOrganizeConfig();
    const put = await call(s, "/api/organize", body("PUT", max));
    assert.equal(put.status, 200, JSON.stringify(put.body).slice(0, 300));
    const got = await call<{ config: OrganizeConfig; problems: string[] }>(s, "/api/organize");
    assert.deepEqual(got.body.problems, []);
    assert.deepEqual(got.body.config, max);
  } finally {
    await s.close();
  }
});

test("[fast] GET /api/organize/presets lists the preset rule filters for the page", async () => {
  const { s } = await serve();
  try {
    const r = await call<{ presets: { id: string; name: string; match: { query: Record<string, unknown>; names?: string[] } }[] }>(s, "/api/organize/presets");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.presets.map((p) => p.id), PRESETS.map((p) => p.id));
    const magery = r.body.presets.find((p) => p.id === "magery-reagents");
    assert.equal(magery?.name, "Magery reagents");
    assert.deepEqual(magery?.match.names?.slice(0, 2), ["black pearl", "bloodmoss"]);
    assert.deepEqual(Object.keys(magery!.match.query).sort(), ["hideTags", "kind", "med", "nogarg", "props", "q", "rarity", "rarityMax", "rarityMin", "slayer", "slot"]);
  } finally {
    await s.close();
  }
});

test("[fast] POST /api/organize/match counts the movable items in labelled roots a rule filter takes, ignoring rule order", async () => {
  const GARLIC = 0x40001003, ASH = 0x40001004;
  const { s } = await serve([{ serial: GARLIC, name: "Garlic", in: A, amount: 30 }, { serial: ASH, name: "Sulfurous Ash", in: B, amount: 12 }]);
  const match = (m: unknown) => call<{ count: number; pieces: number; sample: string[]; error?: string }>(s, "/api/organize/match", body("POST", { match: m }));
  try {
    const reagents = { query: { ...emptyRuleQuery(), kind: ["reagent"] } };
    assert.deepEqual((await match(reagents)).body, { ok: true, count: 0, pieces: 0, sample: [] }, "nothing is labelled yet: nothing is in reach");
    assert.equal((await call(s, "/api/organize", body("PUT", CONFIG_DOC))).status, 200);
    // The Reagents rule already claims these; a second rule's count still includes them (a higher rule may claim some).
    assert.deepEqual((await match(reagents)).body, { ok: true, count: 3, pieces: 43, sample: ["Black Pearl", "Garlic", "Sulfurous Ash"] });
    assert.deepEqual((await match({ query: emptyRuleQuery(), names: ["ruby", "garlic"] })).body, { ok: true, count: 2, pieces: 31, sample: ["Garlic", "Ruby"] });
    // An unlabelled root is out of reach, whatever it holds.
    const cfg = structuredClone(CONFIG_DOC);
    delete cfg.labels[String(B)];
    cfg.rules = cfg.rules.filter((r) => !r.targets.includes(B));
    assert.equal((await call(s, "/api/organize", body("PUT", cfg))).status, 200);
    assert.deepEqual((await match(reagents)).body.sample, ["Garlic"]);
    // The same strict check PUT uses: a location filter is refused, and so is a match that is not one.
    const loc = await match({ query: { ...emptyRuleQuery(), loc: ["Chest"] } });
    assert.equal(loc.status, 400);
    assert.match(String(loc.body.error), /loc is not a rule filter/);
    assert.equal((await match("reagents")).status, 400);
    assert.equal((await call(s, "/api/organize/match", body("POST", { match: reagents, extra: "x".repeat(70e3) }))).status, 413);
  } finally {
    await s.close();
  }
});

test("[fast] POST /api/organize/propose: Simple over every offered chest; PUT saves the proposal as it is; proposing again changes nothing", async () => {
  const { s, dir } = await serve();
  try {
    const first = await call<{ ok: boolean; proposal: Proposal }>(s, "/api/organize/propose", body("POST", { strategy: "simple" }));
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const p = first.body.proposal;
    assert.deepEqual(p.containers, [A, B]);
    assert.deepEqual(p.config.rules.map((r) => [r.id, r.name, r.targets, r.origin]), [["auto-reagents", "Reagents", [B], "strategy:simple"], ["auto-gems", "Gems", [A], "strategy:simple"]]);
    assert.deepEqual(Object.values(p.config.labels).map((l) => [l.serial, l.name, l.origin]), [[A, "Gems", "strategy:simple"], [B, "Reagents", "strategy:simple"]]);
    assert.deepEqual([p.plan.moves, p.changed], [0, true]);
    assert.equal(existsSync(join(dir, "organize.json")), false, "proposing writes nothing");
    const put = await call(s, "/api/organize", body("PUT", p.config));
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const again = await call<{ ok: boolean; proposal: Proposal }>(s, "/api/organize/propose", body("POST", { strategy: "simple" }));
    assert.equal(again.body.proposal.changed, false);
    assert.deepEqual(again.body.proposal.config, p.config);
    assert.equal((await call<{ ok: boolean; plan: Plan }>(s, "/api/organize/plan")).body.plan.moves.length, 0);
  } finally {
    await s.close();
  }
});

test("[fast] POST /api/organize/propose refuses an unknown strategy, a bad container list and a salvaged setup, and reports a container it cannot use", async () => {
  const { s, dir } = await serve();
  try {
    const bad = await call(s, "/api/organize/propose", body("POST", { strategy: "by-build" }));
    assert.equal(bad.status, 400);
    assert.match(String(bad.body.error), /strategy must be/);
    assert.equal((await call(s, "/api/organize/propose", body("POST", { strategy: "simple", containers: ["x"] }))).status, 400);
    const odd = await call<{ ok: boolean; proposal: Proposal }>(s, "/api/organize/propose", body("POST", { strategy: "detailed", containers: [A, 0x4000ffff] }));
    assert.equal(odd.status, 200, JSON.stringify(odd.body));
    assert.deepEqual([odd.body.proposal.containers, odd.body.proposal.refused], [[A], [{ serial: 0x4000ffff, reason: "it is not a container on the ground in your scans" }]]);
    writeFileSync(join(dir, "organize.json"), JSON.stringify({ ...emptyOrganizeConfig(), rules: [{ id: "broken" }] }));
    const salvaged = await call(s, "/api/organize/propose", body("POST", { strategy: "simple" }));
    assert.equal(salvaged.status, 409);
    assert.match(String(salvaged.body.error), /save the setup first/);
  } finally {
    await s.close();
  }
});
