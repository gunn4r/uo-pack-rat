// put-away.test.mts — `app/put-away.mts` (issue #131): the strict check on the TazUO panel's Put away request.
//
// `app/put-away.mts` (issue #131): the Put away request's strict check (every field, the picked container, the 60-second window, the click time, the tile) and the one-line reason a plan moves nothing. All `[fast]`.
//
// Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPutAwayRequest, nothingDetail, requestId } from "./put-away.mts";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const good = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ id: "1727697600000-1", container: 0x40000001, character: "Tester", requestedAt: "2026-09-30T13:59:58+02:00", clickedAt: "2026-09-30T11:55:00Z", at: { x: 1520, y: 1631, facet: 1 }, ...over });
const refused = (raw: unknown): string => {
  const r = checkPutAwayRequest(raw, NOW);
  assert.equal(r.ok, false, `accepted ${JSON.stringify(raw)}`);
  return r.ok ? "" : r.error;
};

test("[fast] a Put away request is an id, the picked container, a character, a fresh time and where the character stands", () => {
  const r = checkPutAwayRequest(good(), NOW);
  assert.deepEqual(r, { ok: true, request: good() });
  const noFacet = checkPutAwayRequest(good({ at: { x: 0, y: 0 } }), NOW);
  assert.deepEqual(noFacet.ok && noFacet.request.at, { x: 0, y: 0 });
});

test("[fast] anything else is refused: extra fields, a bad id, container, character, place, or a stale or future time", () => {
  for (const raw of [null, [], "put away", 7]) refused(raw);
  assert.match(refused(good({ dest: [1] })), /does not take/);
  for (const id of [undefined, "", "x".repeat(65), "../x", 5]) assert.match(refused(good({ id })), /no id/);
  for (const container of [undefined, 0, -1, 1.5, 0x100000000, "0x40000001"]) assert.match(refused(good({ container })), /no container/);
  assert.match(refused(good({ source: "backpack" })), /does not take/);
  for (const character of [undefined, "", "x".repeat(65), "Tes\nter", 3]) assert.match(refused(good({ character })), /no character/);
  for (const requestedAt of ["2026-09-30T11:58:59Z", "2026-09-30T12:00:06Z", "yesterday", undefined]) assert.match(refused(good({ requestedAt })), /too old/);
  for (const clickedAt of [undefined, "later", "2026-09-30T12:00:04Z", "2026-09-30T10:59:57Z"]) assert.match(refused(good({ clickedAt })), /when Put away was clicked/);
  for (const at of [undefined, {}, { x: 1, y: 1, z: 0 }, { x: -1, y: 1 }, { x: 1.5, y: 1 }, { x: 1, y: 5000 }, { x: 1, y: 1, facet: 6 }, [1, 1]]) {
    assert.match(refused(good({ at })), /where you stand/);
  }
  assert.equal(requestId(good({ id: "../x" })), null);
  assert.equal(requestId(good()), "1727697600000-1");
});

test("[fast] a plan that moves nothing says what stayed and why in one short line, never an empty one", () => {
  const rules = [{ ruleId: "a", matched: 3, inPlace: 1, toMove: 0, noRoom: 2 }, { ruleId: "b", matched: 1, inPlace: 0, toMove: 0, noRoom: 0 }];
  assert.equal(nothingDetail({ unclaimed: 4, crossSite: [{ ruleId: "b", count: 1 }], rules }, "your pack"), "4 with no rule stay in your pack, 1 for another house, 2 with no room, 1 already filed");
  assert.equal(nothingDetail({ unclaimed: 1, crossSite: [], rules: [] }, "that container"), "1 with no rule stays in that container");
  assert.equal(nothingDetail({ unclaimed: 0, crossSite: [], rules: [] }, "your pack", { bags: 1, pinned: 7 }), "1 container, 7 pinned stay in your pack");
  assert.equal(nothingDetail({ unclaimed: 0, crossSite: [], rules: [] }, "your pack", { bags: 1, pinned: 0 }), "1 container stays in your pack");
  assert.equal(nothingDetail({ unclaimed: 2, crossSite: [], rules: [] }, "your pack", { bags: 0, pinned: 1 }), "1 pinned, 2 with no rule stay in your pack");
  assert.equal(nothingDetail({ unclaimed: 0, crossSite: [], rules: [] }, "that container"), "Nothing lies directly in that container.");
});
