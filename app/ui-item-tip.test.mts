// ui-item-tip.test.mts — `app/ui/item-tip.mts`, where the item tooltip gets its item (issue #10).
//
// `[fast]`: `app/ui/item-tip.mts`, where the item tooltip gets its item (issue #10): a registered record with its tooltip lines shown at once, else the cache, else one lookup by serial shared by concurrent hovers, a serial the server does not know asked for once (the partial record shown) until `forget()`, and a lookup that failed on the network not counted as a miss (asked again).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTipResolver, tipComplete, type TooltipItem } from "./ui/item-tip.mts";

const full = (name: string): TooltipItem => ({ name, lines: [name, "Lower Mana Cost 8%"] });
function setup(known: Record<number, TooltipItem> = {}) {
  const cache = new Map<number, TooltipItem>();
  const asked: number[] = [];
  const r = createTipResolver(cache, async (s) => { asked.push(s); return known[s]; });
  return { cache, asked, r };
}

test("[fast] item tooltip: a record is complete when it carries its tooltip lines", () => {
  assert.equal(tipComplete(full("Ring")), true);
  assert.equal(tipComplete({ name: "Ring" }), false);
  assert.equal(tipComplete({ name: "Ring", lines: [] }), false);
  assert.equal(tipComplete(null), false);
});

test("[fast] item tooltip: a registered full record is shown at once, with no lookup", () => {
  const { r, asked } = setup();
  const host = {}, ring = full("Ring");
  r.register(host, ring);
  assert.equal(r.resolve(host, 7), ring);
  assert.deepEqual(asked, []);
});

test("[fast] item tooltip: an unregistered host or a partial record reads the cache, else asks the server once by serial", async () => {
  const { r, cache, asked } = setup({ 9: full("Katana") });
  cache.set(5, full("Bow"));
  assert.equal((r.resolve({}, 5) as TooltipItem).name, "Bow");
  const host = {};
  r.register(host, { name: "Katana" });
  const a = r.resolve(host, 9), b = r.resolve({}, 9);
  assert.ok(a instanceof Promise && b instanceof Promise);
  assert.equal((await a)?.name, "Katana");
  assert.deepEqual((await a)?.lines, ["Katana", "Lower Mana Cost 8%"]);
  assert.equal((await b)?.name, "Katana");
  assert.deepEqual(asked, [9], "two hovers while it is asked share one lookup");
});

test("[fast] item tooltip: a serial the server does not know is asked for once, showing the partial record if there is one, until forget()", async () => {
  const { r, asked } = setup();
  const host = {};
  r.register(host, { name: "Move 1" });
  assert.equal((await r.resolve(host, 3))?.name, "Move 1");
  assert.equal(r.resolve({}, 3), null, "known to be missing: answered at once");
  assert.equal((r.resolve(host, 3) as TooltipItem).name, "Move 1");
  assert.deepEqual(asked, [3]);
  r.forget();
  assert.equal(await r.resolve({}, 3), null);
  assert.deepEqual(asked, [3, 3], "a new inventory asks again");
});

test("[fast] item tooltip: a lookup that fails on the network never throws and is no miss: the next hover asks again", async () => {
  let calls = 0;
  const r = createTipResolver(new Map(), async () => { calls++; throw new Error("offline"); });
  const host = {};
  r.register(host, { name: "Move 1" });
  assert.equal((await r.resolve(host, 1))?.name, "Move 1", "the partial record meanwhile");
  assert.equal(await r.resolve({}, 1), null);
  assert.equal(calls, 2);
});
