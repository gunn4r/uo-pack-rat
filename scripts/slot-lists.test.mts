// slot-lists.test.mts — a [smoke] guard for one slot vocabulary (issue #218).
//
// a `[smoke]` guard for one slot vocabulary (issue #218): no tracked non-test `.mts` file outside `app/vault-lib.mts` and `scripts/optimizer-core.mts` may hold an array literal naming three or more gear slots, except the files in its `ALLOWED` table, each with how many lists it may hold and why (Manual's paperdoll layout, Organize's Armor and Jewelry bins, a superseded spike). A planted list checks the scan catches one. Derive a new slot list from `GEAR_SLOTS` or `GEAR_SLOT_GROUPS` instead of adding to `ALLOWED`.
//
// Gear slots and their groups are listed in app/vault-lib.mts (GEAR_SLOTS, GEAR_SLOT_GROUPS, REQUIRED_SLOTS) and copied in scripts/optimizer-core.mts, which is pasted without imports (app/solver.test.mts checks its copy). Any other array literal naming three or more gear slots is a second list that can drift.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GEAR_SLOTS } from "../app/vault-lib.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OWNERS = new Set(["app/vault-lib.mts", "scripts/optimizer-core.mts"]);
// file → how many slot lists it may hold, and why it keeps its own.
const ALLOWED: Record<string, { lists: number; why: string }> = {
  "app/ui/manual-model.mts": { lists: 3, why: "Manual's paperdoll layout (two columns, a kilt beside the legs); app/manual-model.test.mts checks it holds GEAR_SLOTS once, in order" },
  "app/organize-strategies.mts": { lists: 2, why: "Organize's Armor and Jewelry bins put the neck slot with Jewelry and take neck armor by name; changing them would move items" },
  "app/bench/mip-spike.mts": { lists: 2, why: "a superseded spike kept as evidence, not wired into the app" },
};

function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "*.mts"], { cwd: root, encoding: "utf8" }).split("\n")
    .filter((f) => f && !f.endsWith(".test.mts") && !OWNERS.has(f));
}
// Each bracketed span with no brackets inside it that names three or more distinct gear slots as string literals.
function slotLists(body: string): string[][] {
  const out: string[][] = [];
  for (const m of body.matchAll(/\[[^[\]]*\]/g)) {
    const named = new Set([...m[0].matchAll(/["'`](\w+)["'`]/g)].map((x) => x[1]!).filter((w) => GEAR_SLOTS.includes(w)));
    if (named.size >= 3) out.push([...named]);
  }
  return out;
}

test("[smoke] no gear slot list outside vault-lib and the optimizer core, except the allowed ones", () => {
  const found: string[] = [];
  for (const file of sourceFiles()) {
    const n = slotLists(readFileSync(join(root, file), "utf8")).length;
    if (n !== (ALLOWED[file]?.lists ?? 0)) found.push(`${file}: ${n} slot list(s), ${ALLOWED[file]?.lists ?? 0} allowed`);
  }
  assert.deepEqual(found, [], `derive slot lists from vault-lib's GEAR_SLOTS or GEAR_SLOT_GROUPS:\n${found.join("\n")}`);
});

test("[smoke] the slot-list guard sees lists: the owners hold them and a planted one is caught", () => {
  assert.ok(sourceFiles().length > 50);
  assert.ok(slotLists(readFileSync(join(root, "app/vault-lib.mts"), "utf8")).length >= 4);
  assert.deepEqual(slotLists(`const x = ["ring", "bracelet", "talisman"], y = ["ring", "neck"];`), [["ring", "bracelet", "talisman"]]);
});
