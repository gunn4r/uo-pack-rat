// packrat-scanner.ts — ATTENDED one-shot: snapshot everything this character can see, for the Pack
// Rat app's paste transport. This sandbox (the ClassicUO web client's scripting panel) cannot write
// files, so this script does not touch disk at all — it builds one schema-v2 scan document in memory
// and prints it to the console area below the scripting window, wrapped in the markers the app's
// Import tab (Task 1) looks for. Run it, then select-all in the console pane, copy, and paste the
// whole thing into Pack Rat's Import tab. It reads equipped items, the backpack (nested bags
// included), and ground containers whose graphic this script already knows to look for (see "What
// this script cannot see" below) — nothing else. It never walks, fights, loots, or waits; it runs
// once, prints, and stops. Inventory-only, attended-only, like every Pack Rat adapter.
//
// == What this script cannot see (verified against the client's own published API surface,
//    https://www.classicuo.org/scripting/, namespaces Player/Item/Client/Skill — fetched and
//    cross-checked 2026-09-17; no game client was available to run this script live, so every
//    "cannot see" claim below is a property this script has no way to read, not a guess) ==
//
// - THE BANK BOX. `Player` (`namespaces/Player/`) exposes `backpack: undefined | Item` but no bank
//   equivalent anywhere in the documented Player/Mobile surface — there is no serial, no handle, no
//   method that opens or names it. A scan from this adapter never lists a `kind: "bank"` root, ever
//   (not even an unopened one — listing a root this script never actually saw would be dishonest, so
//   it's left out entirely rather than faked as `opened: false`).
// - THE EQUIPPED ARMS LAYER, PROBABLY. The documented `Player.equippedItems` object DOES list an
//   `arms` member (type `Item`) — so this script still attempts to read it, the same as every other
//   layer, and includes it in `capabilities.layers`. But a related project's own live testing of this
//   exact client (a different UO shard, same ClassicUO web client — see this repo's contract test
//   commentary and `adapters/classicuo-web/README.md`) found `equippedItems.arms` came back empty at
//   runtime even while worn, despite the type surface promising it. That is real prior operational
//   evidence, not an assumption, so `capabilities.json` ships `"arms": false` — the conservative,
//   honest reading — and this script never crashes if `equippedItems.arms` is undefined; it just
//   omits that piece and moves on. Task 6's first live run is what actually settles this one way or
//   the other on THIS deployment. (Nothing in `docs/scan-schema.md` currently defines what
//   `capabilities.layers` means when a layer it lists isn't backed by a `true` per-layer capability
//   flag — read it here as "attempted", not "readable"; `arms` is the one layer in this adapter's
//   list where those two differ.)
// - ANY GROUND CONTAINER WHOSE GRAPHIC ISN'T IN `CONTAINER_GRAPHICS` BELOW. The published API has no
//   "list every object within N tiles" call (TazUO's Legion Script has `GetItemsOnGround(range)`,
//   which returns literally everything nearby for client-side filtering; this sandbox's closest
//   equivalents are `client.findType`/`findAllOfType(graphic, hue, source, amount, range)`, which all
//   require the caller to already know the graphic id being searched for). So ground scanning here
//   is a curated allowlist of known chest/bag/crate graphics, not a true "everything nearby" scan —
//   an unusual or custom container graphic this list doesn't carry will be invisible to this script.
// - A CONTAINER'S CONTENTS CAN THROW. `Item.contents` (`namespaces/Item/`) is documented as
//   `undefined | Item[]`, read with no separate "open" call (`player.backpack.contents` is the
//   documented example — there is no `player.use()`/open method in the published Player surface
//   either, so this script never tries to open anything explicitly). A related project's live testing
//   of the same client found a locked/trapped container's `.contents` getter can throw instead of
//   just returning `undefined`. Every `.contents` read here is wrapped in try/catch for exactly that.
//   For a ROOT, that's recorded honestly as `opened: false` with no items under it. For a NESTED
//   item, the script has no way to tell "this is a container I can't read" apart from "this isn't a
//   container at all" — both read back as `undefined` from `safeContents()` — so a nested item whose
//   contents throw or come back empty is simply recorded as an ordinary item, not flagged as an
//   unreadable container and not left out of the scan.
// - DEEPLY NESTED BAGS STOP RECURSING AFTER `MAX_NEST` LEVELS (4). A bag past that depth is recorded
//   as a plain item (its own contents are never read), the same as the "can't tell a container from
//   an item" case just above — this is a deliberate, silent cap (mirroring
//   `adapters/tazuo/packrat-scanner.py`'s own `MAX_NEST`), not a client limitation.
// - ITEM NAMES OFF THE BARE OBJECT CAN BE UNRELIABLE. `Entity.name` is documented as returning an
//   empty string "if not known to the client yet" — so this script never trusts `.name` alone for
//   anything it reports; every item and container is named from `client.queryItemOPL(serial)`'s own
//   `name`/`properties` fields (the full tooltip), falling back to the bare `.name` only when the OPL
//   query itself comes back empty (recorded as `nameSource: "label"` for that one item, per the scan
//   schema — see `docs/scan-schema.md`).
// - THIS SANDBOX'S COMPUTE LIMITS ARE UNDOCUMENTED. Nothing in the published API docs mentions a CPU
//   watchdog or execution-time cap for a running script. A related project found the SAME client
//   family (different shard) kills a script for sustained tight-loop compute. That has not been
//   verified against THIS deployment, but this script paces itself defensively anyway (see
//   `YIELD_EVERY`/`sleep()` below) on the assumption that "yield often" costs little and "assume no
//   limit and get killed mid-scan" costs the whole run.
//
// == Attended-only statement (docs/adapter-guide.md) ==
// This script reads what the character can currently see and prints one document. It does not wait,
// loop forever, or act on anything in the world; it runs once and stops. It never fights, loots a
// corpse, or gathers a resource. Its only communication with the player is `client.sysMsg`, which is
// local chat-log text (per the same related project's testing, `client.headMsg` on this client family
// renders as public overhead speech everyone nearby can see — this script never calls it).

// ---------------------------------------------------------------------------------------------
// Ambient declarations for the globals the sandbox injects at runtime (client, player, log, sleep —
// see https://www.classicuo.org/scripting/globals). Declared here, not imported, since this sandbox
// has no import system and every adapter script is self-contained; kept minimal to what this file
// actually calls rather than transcribing the whole documented surface.
// ---------------------------------------------------------------------------------------------
declare const client: any;
declare const player: any;
declare function log(...args: any[]): void;
declare function sleep(ms: number): void;

// ---------------------------------------------------------------------------------------------
// Paste markers — must match app/import.mjs's PASTE_BEGIN/PASTE_END byte-for-byte.
// ---------------------------------------------------------------------------------------------
const PASTE_BEGIN = "-----BEGIN PACK RAT SCAN-----";
const PASTE_END = "-----END PACK RAT SCAN-----";

// ---------------------------------------------------------------------------------------------
// The adapter's contract. Must match capabilities.json's `capabilities` object exactly — the
// contract test (app/contracts.test.mjs, once this adapter ships a fixture) compares them.
// ---------------------------------------------------------------------------------------------
const ADAPTER_ID = "classicuo-web";
const ADAPTER_VERSION = "1.0.0";
const CAPABILITIES = {
  layers: ["OneHanded", "TwoHanded", "Shoes", "Pants", "Shirt", "Helmet", "Gloves",
    "Ring", "Talisman", "Necklace", "Waist", "Torso", "Bracelet", "Tunic",
    "Earrings", "Arms", "Cloak", "Robe", "Skirt", "Legs"],
  arms: false,
  bank: false,
  ground: true,
  nested: true,
  tooltips: "opl",
  bridge: [] as string[],
};

// ---------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------
const SCAN_RANGE = 3;          // tiles: how far findAllOfType looks for ground containers
const MAX_NEST = 4;            // bags in bags in bags
const OPL_TIMEOUT_MS = 1500;   // client.queryItemOPL's own timeout
const YIELD_EVERY = 4;         // sleep after this many container/tooltip reads (defensive pacing)
const YIELD_MS = 150;
// The print loop (step 6, below) gets its own, much lighter cadence than YIELD_EVERY/YIELD_MS
// above. Those numbers were picked for tooltip/container reads, which are genuinely slow network
// round trips — sleeping 150ms every 4th one costs little next to the read itself. Printing an
// already-built line, by contrast, is a local, near-instant operation: reusing the scan cadence
// there would turn a ~500-line scan (a well-geared character) into roughly 125 sleeps of 150ms —
// about 19 seconds of the console visibly doing nothing, long enough that a player watching it is
// likely to interrupt the script and lose the whole scan, the exact failure this pacing exists to
// avoid. The print loop still needs occasional yield points for the same undocumented-watchdog
// risk (see the header comment), just far fewer of them: every 25 lines costs 20 sleeps of 50ms on
// that same ~500-line scan, about 1 second total.
const PRINT_YIELD_EVERY = 25;  // lines
const PRINT_YIELD_MS = 50;

// webClient equippedItems key -> canonical layer name (docs/adapter-guide.md's full-coverage list,
// matching adapters/tazuo/capabilities.json's own 20 entries one-for-one). `equippedItems` also
// carries beard/face/hair/mount, which aren't gear layers in the scan schema's sense and are skipped.
const LAYER_MAP: Record<string, string> = {
  oneHanded: "OneHanded", twoHanded: "TwoHanded", shoes: "Shoes", pants: "Pants", shirt: "Shirt",
  helmet: "Helmet", gloves: "Gloves", ring: "Ring", talisman: "Talisman", necklace: "Necklace",
  waist: "Waist", torso: "Torso", bracelet: "Bracelet", tunic: "Tunic", earrings: "Earrings",
  arms: "Arms", cloak: "Cloak", robe: "Robe", skirt: "Skirt", legs: "Legs",
};

// Known chest/bag/crate/pouch graphics — the same curated set adapters/tazuo/packrat-scanner.py
// uses (graphic ids are a client-independent UO fact, not something specific to either adapter).
// This is the ceiling of what ground scanning can find here — see the header comment above.
const CONTAINER_GRAPHICS = [
  0x0e75, 0x0e76, 0x0e79, 0x0e7d, 0x09aa, 0x09a8, 0x09a9, 0x09ab,
  0x0e3c, 0x0e3d, 0x0e3e, 0x0e3f, 0x0e40, 0x0e41, 0x0e42, 0x0e43,
  0x0e7c, 0x0e7e, 0x0e7f, 0xa32f, 0xa333,
];

const SKILL_NAMES = ["Alchemy", "Anatomy", "Animal Lore", "Animal Taming", "Arms Lore", "Archery",
  "Begging", "Blacksmithy", "Bowcraft/Fletching", "Bushido", "Camping", "Carpentry", "Cartography",
  "Chivalry", "Cooking", "Detecting Hidden", "Discordance", "Evaluating Intelligence", "Fencing",
  "Fishing", "Focus", "Forensics", "Healing", "Herding", "Hiding", "Imbuing", "Inscription",
  "Item Identification", "Lockpicking", "Lumberjacking", "Mace Fighting", "Magery", "Meditation",
  "Mining", "Musicianship", "Mysticism", "Necromancy", "Ninjitsu", "Parry", "Peacemaking",
  "Poisoning", "Provocation", "Remove Trap", "Resisting Spells", "Spellweaving", "Spirit Speak",
  "Stealing", "Stealth", "Swordsmanship", "Tactics", "Tailoring", "Taste Identification", "Throwing",
  "Tinkering", "Tracking", "Veterinary", "Wrestling"];

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function rfc3339Now(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const off = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const tz = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:` +
    `${pad(d.getMinutes())}:${pad(d.getSeconds())}${tz}`;
}

// Documented as `undefined | Item[]`; a related project's live testing found the getter can also
// THROW on a locked/trapped container. Never let either form crash the scan.
function safeContents(item: any): any[] | undefined {
  try {
    const c = item?.contents;
    return Array.isArray(c) ? c : undefined;
  } catch {
    return undefined;
  }
}

// yieldTick — sleep every YIELD_EVERY calls, so a long recursive scan gives the sandbox a break
// between chunks of work instead of running one uninterrupted tight loop (see header comment on the
// undocumented/unverified CPU watchdog).
let _yieldCount = 0;
function yieldTick(): void {
  _yieldCount++;
  if (_yieldCount % YIELD_EVERY === 0) sleep(YIELD_MS);
}

// printYieldTick — the print loop's own, lighter version of yieldTick (see the PRINT_YIELD_EVERY/
// PRINT_YIELD_MS comment above for why it needs a different cadence rather than reusing this one).
let _printYieldCount = 0;
function printYieldTick(): void {
  _printYieldCount++;
  if (_printYieldCount % PRINT_YIELD_EVERY === 0) sleep(PRINT_YIELD_MS);
}

// tooltipOf — the full on-paperdoll-line read. Falls back to the bare (possibly blank) `.name` only
// when queryItemOPL itself comes back empty; every caller records which happened via nameSource.
function tooltipOf(serial: number): { lines: string[]; name: string; nameSource: "opl" | "label" } {
  try {
    const opl: any = client.queryItemOPL(serial, OPL_TIMEOUT_MS);
    if (opl) {
      const lines: string[] = [];
      if (Array.isArray(opl.properties)) {
        for (const p of opl.properties) {
          if (p == null) continue;
          const text = typeof p === "string" ? p : String((p as any).text ?? (p as any).value ?? p);
          if (text) lines.push(text);
        }
      }
      const name = String(opl.name || lines[0] || "");
      if (lines.length > 0) return { lines, name, nameSource: "opl" };
      if (name) return { lines: [name], name, nameSource: "label" };
    }
  } catch {
    // fall through to the bare object below
  }
  return { lines: [], name: "", nameSource: "label" };
}

function itemEntry(it: any, container: number | null, layer?: string): any {
  const serial = Number(it.serial);
  const t = tooltipOf(serial);
  const name = t.name || String(it.name || "");
  const entry: any = {
    serial,
    graphic: it.graphic != null ? Number(it.graphic) : null,
    hue: it.hue != null ? Number(it.hue) : null,
    amount: it.amount != null ? Number(it.amount) : 1,
    name,
    nameSource: t.nameSource,
    tooltip: t.lines,
  };
  if (container !== null) entry.container = container;
  if (layer) entry.layer = layer;
  return entry;
}

// ---------------------------------------------------------------------------------------------
// Container walk — no explicit "open" call exists in the published API (contents just populates,
// or throws/comes back undefined; see header comment), so this only ever reads, never clicks.
// ---------------------------------------------------------------------------------------------

function walk(rootSerial: number, containerItem: any, containers: Record<string, any>,
  items: any[], seen: Set<number>, depth: number): number {
  const kids = safeContents(containerItem);
  yieldTick();
  if (kids === undefined) return -1; // not readable — too far, locked/trapped, or not yet loaded
  let n = 0;
  for (const kid of kids) {
    const s = Number(kid.serial);
    if (seen.has(s)) continue;
    seen.add(s);
    const kidContents = depth < MAX_NEST ? safeContents(kid) : undefined;
    if (kidContents !== undefined) {
      // A nested container: record it in `containers`, then recurse into it.
      const t = tooltipOf(s);
      containers[String(s)] = {
        serial: s,
        kind: "container",
        name: t.name || String(kid.name || ""),
        parent: Number(containerItem.serial),
        root: rootSerial,
        tooltip: t.lines,
      };
      walk(rootSerial, kid, containers, items, seen, depth + 1);
      continue;
    }
    items.push(itemEntry(kid, Number(containerItem.serial)));
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

function main(): void {
  const p: any = player;
  const char = String(p.name || "Unknown");
  client.sysMsg(`Pack Rat scan (${char}): starting...`, 88);

  const seen = new Set<number>();
  const roots: any[] = [];
  const containers: Record<string, any> = {};
  const items: any[] = [];
  const equipped: any[] = [];

  // 1) Equipped layers. `arms` is attempted like every other layer — see the header comment on why
  // capabilities.json still says `arms: false` regardless of what this run actually sees.
  const eq: any = p.equippedItems || {};
  for (const webKey of Object.keys(LAYER_MAP)) {
    const it = eq[webKey];
    if (!it || !it.serial) continue;
    const s = Number(it.serial);
    if (seen.has(s)) continue;
    seen.add(s);
    equipped.push(itemEntry(it, null, LAYER_MAP[webKey]));
    yieldTick();
  }
  client.sysMsg(`  equipped: ${equipped.length} pieces read`, 88);

  // 2) Backpack (always attempted; nested bags included). No bank root — see header comment, there
  // is no handle to it in the published API at all.
  const backpack = p.backpack;
  if (backpack && backpack.serial) {
    const bs = Number(backpack.serial);
    seen.add(bs);
    containers[String(bs)] = { serial: bs, kind: "backpack", name: "Backpack", parent: null, root: bs };
    const n = walk(bs, backpack, containers, items, seen, 0);
    roots.push({ serial: bs, kind: "backpack", name: "Backpack", opened: n >= 0 });
    client.sysMsg(`  backpack: ${n >= 0 ? n + " items" : "not opened"}`, 88);
  } else {
    client.sysMsg("  backpack: not found (unexpected — is a character logged in?)", 33);
  }

  // 3) Ground containers within SCAN_RANGE tiles, by known graphic only — see header comment.
  const groundCandidates: any[] = [];
  const groundSeen = new Set<number>();
  for (const graphic of CONTAINER_GRAPHICS) {
    let found: any[] = [];
    try {
      found = client.findAllOfType(graphic, undefined, "world", undefined, SCAN_RANGE) || [];
    } catch {
      found = [];
    }
    for (const g of found) {
      const s = Number(g?.serial || 0);
      if (!s || groundSeen.has(s) || seen.has(s)) continue;
      groundSeen.add(s);
      groundCandidates.push(g);
    }
    yieldTick();
  }
  for (const g of groundCandidates) {
    const s = Number(g.serial);
    if (seen.has(s)) continue;
    seen.add(s);
    const t = tooltipOf(s);
    const name = t.name || String(g.name || "container");
    containers[String(s)] = { serial: s, kind: "ground", name, parent: null, root: s,
      pos: { x: Number(g.x || 0), y: Number(g.y || 0), z: Number(g.z || 0) }, tooltip: t.lines };
    const n = walk(s, g, containers, items, seen, 0);
    roots.push({ serial: s, kind: "ground", name, opened: n >= 0 });
  }
  client.sysMsg(`  ground: ${roots.filter((r) => r.kind === "ground").length} container(s) found ` +
    `within ${SCAN_RANGE} tiles`, 88);

  // 4) Skills — player.getAllSkills() values are ×10 (74.6 skill reads as 746), per the published
  // Player.getSkill()/getAllSkills() docs.
  const skills: Record<string, { value: number; cap: number }> = {};
  try {
    const all: any[] = p.getAllSkills ? p.getAllSkills() || [] : [];
    for (const sk of all) {
      const name = String(sk?.name || "");
      if (!name || !SKILL_NAMES.includes(name)) continue;
      const value = Number(sk.value || 0) / 10;
      if (value <= 0) continue;
      skills[name] = { value: Math.round(value * 10) / 10, cap: Math.round((Number(sk.cap || 0) / 10) * 10) / 10 };
    }
  } catch {
    // leave skills empty rather than fail the whole scan over one bad read
  }

  // 5) Assemble the v2 document.
  const doc: any = {
    schemaVersion: 2,
    character: char,
    scannedAt: rfc3339Now(),
    adapter: {
      id: ADAPTER_ID,
      version: ADAPTER_VERSION,
      client: "ClassicUO (web)",
      clientVersion: null,
      capabilities: CAPABILITIES,
    },
    stats: { str: Number(p.strength || 0), dex: Number(p.dexterity || 0), int: Number(p.intelligence || 0) },
    position: { x: Number(p.x || 0), y: Number(p.y || 0), z: Number(p.z || 0) },
    maxes: { hits: Number(p.maxHits || 0), stam: Number(p.maxStamina || 0), mana: Number(p.maxMana || 0) },
    resists: {
      phys: Number(p.physicalResistance || 0), fire: Number(p.fireResistance || 0),
      cold: Number(p.coldResistance || 0), poison: Number(p.poisonResistance || 0),
      energy: Number(p.energyResistance || 0),
    },
    skills,
    roots,
    containers,
    items,
    equipped,
  };

  // 6) Print the marked block, one console line at a time (it is unverified whether this client's
  // console area preserves embedded newlines inside a single log() call — printing line-by-line
  // sidesteps that entirely, at the cost of one log() call per line). This is the single largest
  // burst of calls anywhere in the script on a well-geared character, so it still gets defensive
  // yielding for the same undocumented-watchdog risk as the scan phase — losing the print loop
  // partway is worse than losing a scan loop partway: app/import.mjs only recognizes the marked
  // form when BOTH markers are present, so a print that dies after BEGIN but before END falls back
  // to parsing the raw (truncated) text and fails outright, discarding the whole scan rather than
  // just its tail. It uses `printYieldTick()`, not `yieldTick()`, on purpose — see the
  // PRINT_YIELD_EVERY/PRINT_YIELD_MS comment above.
  const text = JSON.stringify(doc, null, 2);
  log(PASTE_BEGIN);
  for (const line of text.split("\n")) {
    log(line);
    printYieldTick();
  }
  log(PASTE_END);

  client.sysMsg(`Pack Rat scan done: ${items.length} items in ${roots.length} container(s), ` +
    `${equipped.length} equipped, ${Object.keys(skills).length} skills. Copy the console output ` +
    "between the BEGIN/END markers and paste it into Pack Rat's Import tab.", 68);
}

main();
