// forget.mts — POST /api/forget and POST /api/forget-character.
//
// The routes, what each takes and answers:
// - `POST /api/forget` {root} (drop a container from the inventory: writes a tombstone scan; 409 under --demo, which must never write into the committed app/fixtures/)
// - `POST /api/forget-character` {character} (drop a character's card, worn set, backpack and bank: a `_vault` tombstone carrying forgetCharacter; 409 under --demo)
//
// map: server
// owns: `routes`
import { isBoundedString, MAX_SERIAL, short } from "../../guards.mts";
import { readBody } from "../../read-body.mts";
import { isPseudoCharacter } from "../../scan-schema.mts";
import { send, asObject } from "../respond.mts";
import type { Route } from "../router.mts";
import type { ForgetApiResponse } from "../../api/inventory.mts";
import type { ServerContext } from "../context.mts";

export function routes(ctx: ServerContext): Route[] {
  const { config: CONFIG, scanStore, eventBus, getInventory } = ctx;
  return [
    { method: "POST", path: "/api/forget", handle: async (req, res) => {
      // A tombstone scan: a root with no items, dated now, so the fold drops everything under it.
      // Written as v2 directly (schemaVersion:2, adapter.id "app") — a plain UTC toISOString() is
      // valid RFC 3339, and now that the fold orders by epoch (parseStamp) rather than string
      // comparison of scannedAt, a UTC stamp here sorts correctly against a naive-local adapter
      // scan regardless of this machine's timezone.
      // --demo points SCANS at app/fixtures/ (repo data, committed) — Forget must never write a
      // tombstone there, or a demo session leaves a stray file in the working tree.
      if (CONFIG.demo) return send(res, 409, { ok: false, error: "demo data is read-only" });
      // Four small scalar fields — no reason for this route to accept the 50 MB default, which is
      // what let a 200,000-character `name` become a 200 KB scan file (post-review fix, Important 4).
      const { root, name = "forgotten" } = asObject(await readBody(req, { limit: 8e3 }));
      // A non-numeric root used to pass this check (only truthiness was tested), writing a
      // tombstone whose roots[0].serial serializes to null — every later read then logs a schema
      // violation and the file accumulates forever while the user believes it worked (post-review
      // fix). root is a number or a string of decimal digits, nothing else: a bare +root coercion
      // let `true` through as serial 1, and 2**60 or "1e300" past the integer check into the
      // tombstone's own schema check, which is the 500 path. The ceiling is the scan contract's own.
      const serial = typeof root === "number" ? root : typeof root === "string" && /^\d{1,10}$/.test(root) ? Number(root) : NaN;
      if (!Number.isInteger(serial) || serial <= 0 || serial > MAX_SERIAL) return send(res, 400, { ok: false, error: "root required (positive integer serial)" });
      // `name` is the container's display label and goes straight into the document's roots[0].name,
      // which the scan contract requires to be a string — so a non-string used to write a file that
      // every later fold re-read and re-rejected ("/roots/0/name expected string"), for the life of
      // the install, while the user's Forget silently did nothing (post-review fix, Important 4).
      if (typeof name !== "string") return send(res, 400, { ok: false, error: "name must be a string" });
      const label = name.slice(0, 64).trim() || "forgotten";   // a display label, and the schema wants a non-empty one
      // One file per forgotten root, not one per click: the name used to carry the millisecond
      // timestamp, so a loop of Forget calls (or a user who forgets the same container twice) grew
      // <data>/scans/ without bound and slowed every later fold, since scanStore.all() parses the whole
      // directory. Re-forgetting a root now replaces its tombstone with a newer scannedAt, which is
      // exactly what the fold wants anyway (newest scan of a root wins, by parseStamp — the file
      // name has never been what orders them). The store throws on an invalid tombstone: that is
      // this app's own bug, so it takes the 500-with-a-ref path and no file is written.
      scanStore.writeTombstone(`_forget-${serial.toString(16)}.json`, { roots: [{ serial, kind: "ground", name: label, opened: true }] });
      eventBus.broadcast("changed", { what: "inventory", by: req.headers["x-client-id"], at: Date.now() });
      return send(res, 200, { ok: true } satisfies ForgetApiResponse);
    } },
    { method: "POST", path: "/api/forget-character", handle: async (req, res) => {
      // A character tombstone: a `_vault` scan naming the character in `forgetCharacter`, which the
      // fold (vault-lib.mts's forgetCharacter) handles by dropping the character's card, worn set,
      // backpack and bank. Same demo refusal as /api/forget above.
      if (CONFIG.demo) return send(res, 409, { ok: false, error: "demo data is read-only" });
      const { character } = asObject(await readBody(req, { limit: 8e3 }));
      if (!isBoundedString(character, 64) || isPseudoCharacter(character)) return send(res, 400, { ok: false, error: "character required (a scanned character's name)" });
      // Only a character the inventory has: a tombstone per arbitrary name would pile up in scans/.
      if (!Object.hasOwn((await getInventory()).inv.characters, character)) return send(res, 404, { ok: false, error: `no scanned character named ${short(character)}` });
      // One file per forgotten character (hex of the name: any name is a safe file name that way),
      // replaced with a newer stamp if the character is forgotten again.
      scanStore.writeTombstone(`_forget-char-${Buffer.from(character).toString("hex")}.json`, { character });
      eventBus.broadcast("changed", { what: "inventory", by: req.headers["x-client-id"], at: Date.now() });
      return send(res, 200, { ok: true } satisfies ForgetApiResponse);
    } },
  ];
}
