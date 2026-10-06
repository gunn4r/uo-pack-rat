// newer-files.test.mts — data files made by a newer Pack Rat (app/migrate.mts), on a real server and temp data folder: `GET /api/organize`, `/api/item-kinds`, `/api/house-map` and `/api/profiles` read what they can and say `readOnly` ("made by a newer Pack Rat"), and every save to them (`PUT /api/organize`, `POST /api/item-kinds` and its import, `PUT /api/house-map/<id>`, `PUT /api/profiles`) is a 409 with that message, the file left byte for byte. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfig, ensureLayout } from "./config.mts";
import { startTestServer } from "./server-fixture.mts";
import { emptyOrganizeConfig } from "./organize-config.mts";

const notice = (name: string, v: number): string => `${name} was made by a newer Pack Rat (version ${v}); it is read-only here until Pack Rat is updated`;
const body = (method: string, value: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(value) });

test("[fast] newer files: organize, item kinds, the house map and profiles are read what they can be, said read-only, and every save is a 409 that leaves the file alone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-newer-"));
  const config = ensureLayout(resolveConfig(["--port", "0", "--data", dir], {}));
  const files: Record<string, string> = {
    "organize.json": JSON.stringify({ ...emptyOrganizeConfig(), version: 2, future: true }),
    "item-kinds.json": JSON.stringify({ version: 3, names: { ruby: "gem" }, graphics: {} }),
    "house-map.json": JSON.stringify({ version: 2, houses: { "1-1-1": { name: "Main house" } } }),
    "profiles.json": JSON.stringify({ schemaVersion: 4, characters: {}, templates: {} }),
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const s = await startTestServer(config);
  const call = async (path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> => {
    const r = await fetch(s.url + path, init);
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  try {
    const organize = await call("/api/organize");
    assert.deepEqual(organize.body, { ok: true, config: emptyOrganizeConfig(), problems: [], readOnly: notice("organize.json", 2) });
    const kinds = await call("/api/item-kinds");
    assert.deepEqual(kinds.body, { ok: true, version: 1, names: { ruby: "gem" }, graphics: {}, readOnly: notice("item-kinds.json", 3) });
    const houses = await call("/api/house-map");
    assert.deepEqual(houses.body, { ok: true, houses: { "1-1-1": { name: "Main house" } }, readOnly: notice("house-map.json", 2) });
    const profiles = await call("/api/profiles");
    assert.deepEqual([profiles.body.profiles, profiles.body.readOnly], [JSON.parse(files["profiles.json"]!), notice("profiles.json", 4)]);

    const saves: [string, RequestInit, string][] = [
      ["/api/organize", body("PUT", emptyOrganizeConfig()), notice("organize.json", 2)],
      ["/api/item-kinds", body("POST", { name: "Ruby", kind: "decor" }), notice("item-kinds.json", 3)],
      ["/api/item-kinds/import", body("POST", { version: 1, names: { pearl: "gem" } }), `the import was refused: ${notice("item-kinds.json", 3)}`],
      ["/api/house-map/1-1-1", body("PUT", { name: "Renamed" }), notice("house-map.json", 2)],
      ["/api/profiles", body("PUT", { schemaVersion: 3, characters: {}, templates: {} }), notice("profiles.json", 4)],
    ];
    for (const [path, init, error] of saves) assert.deepEqual(await call(path, init), { status: 409, body: { ok: false, error } }, path);
    for (const [name, text] of Object.entries(files)) assert.equal(readFileSync(join(dir, name), "utf8"), text, name);
  } finally {
    await s.close();
  }
});
