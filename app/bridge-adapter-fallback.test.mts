// bridge-adapter-fallback.test.mts — app/ui/bridge.mts's currentAdapter()/bridgeNote(): the bug fix
// where a player who pressed Skip in the setup wizard, or installed an adapter's scripts by hand
// (settings.client left unset on purpose in both cases — see currentAdapter()'s own comment), lost
// every Highlight/Grab/Go-to button even though POST /api/bridge was already routing commands to
// bridgeAdapter()'s own default (app/vault-server.mts) the whole time. GET /api/setup now reports that
// same routing id back as state.setup.bridgeAdapter, and currentAdapter() falls back to it when
// settings.client is unset.
//
// app/ui/bridge.mts is not DOM-free like app/ui/adapters.mts (app/wizard-default-adapter.test.mts) —
// it imports app/ui/store.mts, which reads `localStorage.getItem` at MODULE SCOPE to seed
// state.cols. Nothing else in the bridge.mts -> {store,dom,api}.mts import chain touches `document` or
// `localStorage` at module scope: app/ui/dom.mts's `document` uses are all inside function bodies (or
// a default-parameter expression, evaluated lazily at call time, not at import time), and
// app/ui/api.mts's `sessionStorage` read is already wrapped in its own try/catch with a fallback for
// exactly this "no Web Storage global" case. So a minimal `globalThis.localStorage` stub — imported
// FIRST, see ../scripts/localstorage-shim-for-tests.mts for why it has to be its own module rather than a plain
// statement in this file — is enough to run bridge.mts's pure functions under plain node:test — no
// real DOM, no Playwright.
import "../scripts/localstorage-shim-for-tests.mts";

import test from "node:test";
import assert from "node:assert/strict";
import { state } from "./ui/store.mts";
import { currentAdapter, bridgeNote } from "./ui/bridge.mts";

// ui/store.mts types state.setup as api-types.mts's full SetupApiResponse | null — richer than this
// file needs. TestSetupState is the minimal shape THIS file's own fixtures actually exercise
// (currentAdapter()/bridgeNote() only ever read settings.client, adapters[].{id,name,capabilities.bridge}
// and bridgeAdapter); the cast at the assignment site below stands in for a real SetupApiResponse the
// same way a hand-built fixture always does, not a claim this covers every field that type declares.
interface TestAdapter {
  id: string;
  name: string;
  capabilities: { bridge: string[] };
}
interface TestSetupState {
  settings: { client: { adapter: string; scriptsDir: string } | null };
  adapters: TestAdapter[];
  bridgeAdapter: string | null;
}
const setSetup = (s: TestSetupState | null): void => { (state as { setup: TestSetupState | null }).setup = s; };

const TAZUO: TestAdapter = { id: "tazuo", name: "TazUO", capabilities: { bridge: ["highlight", "grab", "goto"] } };
const NOBRIDGE: TestAdapter = { id: "nobridge", name: "No Bridge Client", capabilities: { bridge: [] } };

// ---------------------------------------------------------------- currentAdapter()

test("[fast] currentAdapter falls back to state.setup.bridgeAdapter when no client is configured", () => {
  setSetup({ settings: { client: null }, adapters: [TAZUO, NOBRIDGE], bridgeAdapter: "tazuo" });
  assert.deepEqual(currentAdapter(), TAZUO);
});

test("[fast] currentAdapter returns null when no client is configured and the fallback id is null (server had nothing to fall back to either)", () => {
  setSetup({ settings: { client: null }, adapters: [TAZUO, NOBRIDGE], bridgeAdapter: null });
  assert.equal(currentAdapter(), null);
});

test("[fast] currentAdapter returns null when settings.setup itself has never loaded", () => {
  setSetup(null);
  assert.equal(currentAdapter(), null);
});

test("[fast] currentAdapter prefers a configured client over the fallback id, even when they differ", () => {
  setSetup({ settings: { client: { adapter: "nobridge", scriptsDir: "/x" } }, adapters: [TAZUO, NOBRIDGE], bridgeAdapter: "tazuo" });
  assert.deepEqual(currentAdapter(), NOBRIDGE);
});

test("[fast] currentAdapter returns null for a configured client whose adapter id isn't in the discovered list (unchanged pre-existing behavior)", () => {
  setSetup({ settings: { client: { adapter: "ghost", scriptsDir: "/x" } }, adapters: [TAZUO, NOBRIDGE], bridgeAdapter: "tazuo" });
  assert.equal(currentAdapter(), null);
});

// ---------------------------------------------------------------- bridgeNote()

test("[fast] bridgeNote names the fallback adapter and points at Settings when no client is configured but the fallback resolves", () => {
  setSetup({ settings: { client: null }, adapters: [TAZUO, NOBRIDGE], bridgeAdapter: "tazuo" });
  // bridgeNote()'s return type is string | null; this branch always returns a string (a fallback
  // adapter resolved) — the `!` stands in for the assert.ok(x) narrowing node:assert's types don't
  // give string | null (see the migration plan's `!` rule), not a case this test means to detect null.
  const msg = bridgeNote()!;
  assert.match(msg, /TazUO/);
  assert.match(msg, /Settings/);
  assert.doesNotMatch(msg, /No client set up yet/, "must not be the old blanket message — the buttons are actually working here");
});

test("[fast] bridgeNote keeps the original \"no client\" message when neither a client nor a fallback resolves", () => {
  setSetup({ settings: { client: null }, adapters: [TAZUO, NOBRIDGE], bridgeAdapter: null });
  assert.equal(bridgeNote(), "No client set up yet — visit Settings to install one that supports in-game actions like Highlight/Grab/Go to.");
});

test("[fast] bridgeNote returns null for a fully-capable CONFIGURED client (unchanged pre-existing behavior)", () => {
  setSetup({ settings: { client: { adapter: "tazuo", scriptsDir: "/x" } }, adapters: [TAZUO, NOBRIDGE], bridgeAdapter: "tazuo" });
  assert.equal(bridgeNote(), null);
});

test("[fast] bridgeNote still reports missing actions for a CONFIGURED client with no bridge (unchanged pre-existing behavior)", () => {
  setSetup({ settings: { client: { adapter: "nobridge", scriptsDir: "/x" } }, adapters: [TAZUO, NOBRIDGE], bridgeAdapter: "tazuo" });
  assert.equal(bridgeNote(), "No Bridge Client can't run in-game actions — Highlight, Grab and Go to aren't available for this client.");
});
