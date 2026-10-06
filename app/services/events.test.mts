// events.test.mts — `app/services/events.mts` on its own: event frames, the broadcast and `close()`.
//
// `app/services/events.mts`: one event frame, a broadcast to the attached streams only, and `close()` ending them. `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import type http from "node:http";
import { createEventBus, sse } from "./events.mts";

const stream = () => {
  const s = { written: [] as string[], ended: false };
  return { s, res: { write: (t: string) => { s.written.push(t); return true; }, end: () => { s.ended = true; } } as unknown as http.ServerResponse };
};

test("[fast] events: sse() writes one frame, the bus broadcasts to the attached streams, and close() ends them", () => {
  const a = stream(), b = stream(), bus = createEventBus();
  sse(a.res, "hello", { ok: true });
  assert.deepEqual(a.s.written, ["event: hello\ndata: {\"ok\":true}\n\n"]);
  bus.add(a.res); bus.add(b.res); bus.remove(b.res);
  bus.broadcast("changed", { what: "runs" });
  assert.equal(a.s.written[1], "event: changed\ndata: {\"what\":\"runs\"}\n\n");
  assert.equal(b.s.written.length, 0);
  bus.close();
  assert.ok(a.s.ended && !b.s.ended);
  bus.broadcast("changed", {});
  assert.equal(a.s.written.length, 2, "nothing is written after close");
});
