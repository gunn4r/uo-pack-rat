// profiles-patch.test.mts — `patchProfiles` (PATCH /api/profiles' save, `app/http/routes/prefs.mts`) when two saves race the first read of a v2 file: neither loses the other's edits.
//
// The first read of a v2 file whose ui-prefs still hold buffs waits on the scanned characters, and every read meanwhile shares that one migration, so two saves can start from the same copy. Each writes only over the file it read (the store's `base`), and the one that finds the file changed makes its edits again on it. The second save starts a few microtasks after the first, at each offset that lost an edit before the fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProfilesStore } from "./store/profiles.mts";
import { createUiPrefsStore } from "./store/ui-prefs.mts";
import { patchProfiles } from "./http/routes/prefs.mts";
import type { ProfileEdit } from "./profile-edits.mts";
import { templateSpecFrom } from "./build-spec.mts";

const APP = dirname(fileURLToPath(import.meta.url));

for (const delay of [0, 2, 3, 4, 5]) {
  test(`[fast] patchProfiles: two saves racing a v2 file's first read both land (the second ${delay} microtasks later)`, async (t) => {
    const d = mkdtempSync(join(tmpdir(), "packrat-patch-race-")), gold = join(APP, "fixtures", "profiles-v2");
    t.after(() => rmSync(d, { recursive: true, force: true }));
    for (const n of ["profiles.json", "ui-prefs.json"]) copyFileSync(join(gold, n), join(d, n));
    const store = createProfilesStore({ file: join(d, "profiles.json"), defaults: join(APP, "data", "profiles.default.json"), templatesDir: join(APP, "data", "templates"), shard: () => "uoalive", log: () => {}, uiPrefs: createUiPrefsStore(join(d, "ui-prefs.json")), scanned: async () => ["Aldric", "Brena", "Corwin"] });
    const put = (id: string): ProfileEdit[] => [{ op: "putTemplate", id, entry: { spec: templateSpecFrom({}), savedAt: id } }];
    const later = async (): Promise<Awaited<ReturnType<typeof patchProfiles>>> => {
      for (let i = 0; i < delay; i++) await Promise.resolve();
      return patchProfiles(store, put("B"), []);
    };
    const [a, b] = await Promise.all([patchProfiles(store, put("A"), []), later()]);
    assert.deepEqual([a.status, b.status], [200, 200]);
    const templates = (JSON.parse(readFileSync(join(d, "profiles.json"), "utf8")) as { templates: Record<string, unknown> }).templates;
    assert.ok(Object.hasOwn(templates, "A") && Object.hasOwn(templates, "B"), `both saves are in the file: ${Object.keys(templates).join(", ")}`);
    assert.notEqual(a.body.was, b.body.was, "each save says which file it wrote over");
  });
}
