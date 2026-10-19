// domain/fold.mts — the inventory: its shapes (Item, Container, Character, Inventory) and the fold that builds it from the scans in time order (a scan replaces everything under each root it lists, and a character's worn set whole), each item read, classified and kinded on the way; plus where an item is, a container's path, label and capacity, and items grouped by name.
//
// map: scan
// owns: `Item`, `Container`, `Character`, `Inventory`, `ScanSummary`, `ItemLocation`, `containerChain`, `foldSnapshots`, `locationOf`, `containerPath`, `bagLabel`, `capacityOf`, `TRASH_RE`, `BlacklistEntry`, `groupByName`
import { isPseudoCharacter, parseStamp } from "../scan-schema.mts";
import type { ScanV2, ScanV2Adapter, ScanV2Appearance } from "../schema/types.d.mts";
import type { ExtrasMap, PropMap } from "./properties.mts";
import { displayName, parseTooltip, stripHtml } from "./tooltip.mts";
import { classify, SPELLBOOK_RE } from "./slots.mts";
import { kindOf, medableOf, NO_KIND_OVERRIDES, overriddenKind, slayersOf, type KindOverrides } from "./kinds.mts";

// ---------------------------------------------------------------------------
// Shared shapes. Declared once here — the inventory/item types every later task (the server, the
// page's modules) imports.
// ---------------------------------------------------------------------------

// The location a folded item currently reports, computed by locationOf() once the whole fold is
// done (every item needs every container to be folded first, since a path can cross several).
export interface ItemLocation {
  kind: string | null | undefined;
  character: string;
  text: string;
  root: number | null;
  rootName?: string | undefined;
}

// The enriched item shape every fold entry becomes (enrich()'s return, plus `location`, set in a
// second pass by foldSnapshots once the whole container tree is known — see the comment there).
export interface Item {
  serial: number;
  name: string;
  graphic?: number | null | undefined;
  hue?: number | null | undefined;
  amount: number;
  props: PropMap;
  setBonus: PropMap;
  extras: ExtrasMap;
  flags: string[];
  tags: string[];
  strReq: number;
  rarity: string | null;
  weight: number | null;
  skillReq: string | null;
  lines: string[];
  gargoyle: boolean;
  slayers: string[];
  medable: boolean;
  slot: string | null;
  twoHanded: boolean;
  gear: boolean;
  kind: string;
  root: number | null;
  container: number | null;
  equippedBy: string | null;
  layer: string | null;
  seenAt: string;
  scannedBy: string;
  location?: ItemLocation | undefined;
}

// A folded container entry: a raw scan container plus the two stamps every fold adds.
export interface Container {
  serial: number;
  kind?: string | null | undefined;
  name?: string | undefined;
  parent?: number | null | undefined;
  root: number;
  tooltip?: string[] | undefined;
  pos?: Record<string, number> | null | undefined;
  // Its fill from the tooltip's Contents line (capacityOf), or null when the tooltip has none. Set by every fold.
  capacity?: ContainerCapacity | null | undefined;
  // false when the newest scan saw this bag but could not open it: what the fold keeps under it is from an
  // older scan (see foldSnapshots). Organize never moves anything out of one.
  opened?: boolean | undefined;
  // Its item graphic and hue (issue #174), for its art; absent from scans made before the adapters recorded them.
  graphic?: number | null | undefined;
  hue?: number | null | undefined;
  // The container's segment in location text: its bagLabel, plus a distinguishing suffix when another
  // container with the same label sits beside it (labelContainers). Set by every fold.
  label?: string | undefined;
  scannedBy: string;
  scannedAt: string;
}

// A container's fill as its tooltip states it. `stones` is null when the line gives no weight, `maxStones`
// when the container has no weight cap (house containers have none).
export interface ContainerCapacity { items: number; maxItems: number; stones: number | null; maxStones: number | null }

export interface Character {
  name: string;
  stats: Record<string, unknown>;
  scannedAt: string;
  position: Record<string, unknown> | null;
  maxes: Record<string, unknown> | null;
  resists: Record<string, unknown> | null;
  skills: Record<string, unknown>;
  adapter: ScanV2Adapter | null;
  // The look from the newest scan that had one (issue #57), or null: a scan without it keeps what an earlier one said.
  appearance: ScanV2Appearance | null;
}

export interface ScanSummary {
  character: string;
  scannedAt: string;
  items: number;
  roots: number[];
}

export interface Inventory {
  characters: Record<string, Character>;
  containers: Record<string, Container>;
  items: Record<string, Item>;
  scans: ScanSummary[];
}
// The containers a bridge command opens to reach something inside `container`: its root first, then each bag down to
// `container` itself (at most 8, the bridge protocol's chain limit). The Highlight / Grab / Go to buttons and the MCP
// tools both send it.
export function containerChain(containers: Record<string, Container>, container: number | null): number[] {
  const chain: number[] = []; let cur = container != null ? containers[container] : null, guard = 0;
  while (cur && guard++ < 8) { chain.unshift(+cur.serial); cur = cur.parent != null ? containers[cur.parent] : null; }
  return chain;
}

// ---------------------------------------------------------------------------
// Snapshot folding. Snapshots are immutable facts written by packrat-scanner.py; the
// inventory is the fold of all of them in time order: a later scan of a root container replaces
// everything previously known under that root, and a character's equipped set is replaced whole.
// ---------------------------------------------------------------------------

// scan.containers is Record<string, unknown> in the generated schema (deliberately loose — see
// scan.v2.schema.json's own $comment on why `containers`/`stats`/etc. aren't walked field by
// field). Every scan actually writes container entries shaped like this; narrowed once here, at
// the fold's read boundary, rather than scattered as `as` down every line that reads `c.foo`.
interface ScanContainerRaw {
  serial: number;
  kind?: string | null | undefined;
  name?: string | undefined;
  parent?: number | null | undefined;
  root: number;
  tooltip?: string[] | undefined;
  opened?: boolean | undefined;
}

// The minimal shape enrich()'s `raw` argument needs — satisfied by a ScanV2ItemsItem, a
// ScanV2EquippedItem, or the bag literal foldSnapshots builds for a container-turned-item.
interface EnrichRaw {
  serial: number;
  name?: string | undefined;
  tooltip?: string[] | undefined;
  graphic?: number | null | undefined;
  hue?: number | null | undefined;
  amount?: number | undefined;
}
interface EnrichLoc {
  root: number | null;
  container: number | null;
  equippedBy: string | null;
  layer: string | null;
  seenAt: string;
  scannedBy: string;
}

// A container the player blacklisted: one entry of <data>/scan-blacklist.json, which the app (POST
// /api/blacklist) and the TazUO script packrat-blacklist.py both write. Scanners never open one.
export interface BlacklistEntry { serial: number; name: string; addedAt: string; where?: string | undefined }

// `overrides`: the player's kinds from <data>/item-kinds.json (issue #150, app/item-kinds.mts), applied as each item is
// enriched, so a fresh scan honours them the same as a refold does.
export function foldSnapshots(snapshots: ScanV2[], overrides: KindOverrides = NO_KIND_OVERRIDES): Inventory {
  // Null-prototype dictionaries, not `{}`: every key below comes from the scan (a container's own
  // serial, the character's name), and `obj["__proto__"] = value` on an ordinary object invokes the
  // inherited setter and REPLACES that object's prototype — the entry silently disappears and an
  // attacker-controlled inherited key becomes readable off the map. JSON.stringify and every
  // Object.keys/values/entries read below behave identically on a null-prototype object (Phase 7
  // security review, Area 2, Minor 1).
  const inv: Inventory = { characters: Object.create(null), containers: Object.create(null), items: Object.create(null), scans: [] };
  // validateScan refuses a scannedAt that is not a real instant, but a scan folded from before that
  // check could still carry one: it sorts first, because a NaN comparator result reads as "equal" and
  // would let an older scan of a root fold after a newer one.
  const stampOf = (s: string): number => { const t = parseStamp(s); return Number.isFinite(t) ? t : -Infinity; };
  const sorted = [...snapshots].sort((a, b) => stampOf(a.scannedAt) - stampOf(b.scannedAt));
  for (const snap of sorted) {
    if (snap.schemaVersion !== 2) throw new Error("foldSnapshots needs v2 scans — call upgradeScan first");
    if (snap.kind !== undefined) continue;   // a house-only file (TazUO's packrat-house-map-refresh.py) is for the house map alone: it must not replace a card or a worn set; any other kind is from a newer adapter
    const char = snap.character;
    if (isPseudoCharacter(char)) forgetCharacter(inv, (snap as ScanV2 & { forgetCharacter?: unknown }).forgetCharacter);
    // A root with opened:false (open failed — too far, locked) is still listed in snap.roots, but
    // carries no items; it must be treated exactly like a root the snapshot didn't mention at all —
    // i.e. excluded from the replace-per-root set below — so the fold keeps whatever it last knew
    // about that root instead of wiping it. Only opened:true roots (the historical v1→v2 upgrade
    // stamps every root opened:true, so old scans are unaffected) participate in replace-per-root.
    const roots = new Set((snap.roots || []).filter((r) => r.opened !== false).map((r) => +r.serial));
    // A container INSIDE a root that the scan saw but could not open (`opened: false` on its
    // containers entry: a bag that did not open, or one nested deeper than the adapter reads) is not
    // evidence it is empty. Everything the fold knew inside it — items and bags, however deep — is
    // kept, with its old seenAt; the rest of the root is replaced as usual. The bag may have moved
    // (another chest, another character's), so what is kept moves with it: its root becomes the
    // bag's new root and scannedBy this scanner, or the next scan of the old root would delete it.
    const unopened = new Map(Object.values((snap.containers || {}) as Record<string, { serial: number; root: number; opened?: unknown }>)
      .filter((c) => c.opened === false && roots.has(+c.root)).map((c) => [+c.serial, +c.root]));
    const unopenedRootAbove = (serial: number | null | undefined): number | null => {
      for (let cur = serial, guard = 0; cur != null && guard < 64; guard++) {
        if (unopened.has(+cur)) return unopened.get(+cur)!;
        cur = inv.containers[cur]?.parent;
      }
      return null;
    };
    const keptItems = new Set<string>(), keptContainers = new Set<string>();
    if (unopened.size) {
      const moves: [{ root: number | null; scannedBy: string }, number][] = [];
      for (const [serial, it] of Object.entries(inv.items)) {
        const root = unopenedRootAbove(it.container);
        if (root != null) { keptItems.add(serial); moves.push([it, root]); }
      }
      for (const [serial, c] of Object.entries(inv.containers)) {
        const root = unopenedRootAbove(c.parent);
        if (root != null) { keptContainers.add(serial); moves.push([c, root]); }
      }
      for (const [kept, root] of moves) { kept.root = root; kept.scannedBy = char; }
    }
    // An item this scan records with no name and no tooltip (its tooltip never arrived, issue #298): it keeps the last known name and properties, and takes what the client did report (graphic, hue, amount) and its new place.
    const replaced = new Map<string, Item>();
    for (const [serial, it] of Object.entries(inv.items)) {
      if ((it.equippedBy === char) || (it.root != null && roots.has(+it.root) && !keptItems.has(serial))) { replaced.set(serial, it); delete inv.items[serial]; }
    }
    const foldItem = (raw: EnrichRaw, loc: EnrichLoc): Item => {
      const known = !raw.name && !raw.tooltip?.length ? inv.items[raw.serial] ?? replaced.get(String(raw.serial)) : undefined;
      if (!known) return enrich(raw, loc, overrides);
      return { ...known, ...(raw.graphic != null ? { graphic: raw.graphic } : {}), ...(raw.hue != null ? { hue: raw.hue } : {}), ...(raw.amount ? { amount: raw.amount } : {}), ...loc };
    };
    for (const [serial, c] of Object.entries(inv.containers)) if (roots.has(+c.root) && !keptContainers.has(serial)) delete inv.containers[serial];
    const snapContainers = (snap.containers || {}) as Record<string, ScanContainerRaw>;
    // Indexed once per snapshot, by the entry's own serial — nothing requires snap.containers' KEYS
    // to be serials at all, and the old per-item `Object.values(...).find(...)` fallback for a key
    // that didn't match cost items x containers (2.3 s for 20,000 items across 2,000 containers,
    // every fold and every restart). Strictly faster for an honest scan too.
    const bySerial = new Map<number, ScanContainerRaw>(Object.values(snapContainers).map((c) => [+c.serial, c]));
    // A root the scan lists but left out of `containers` is built from its roots entry when anything
    // sits in it (an item filed directly in it, or a bag under it), or those items would have no
    // container to resolve their root through and be dropped, and the bags' location would read
    // "unknown". One holding nothing stays absent: that is how a Forget tombstone clears a root.
    const occupied = new Set([...(snap.items || []).map((it) => +it.container), ...Object.values(snapContainers).map((c) => +c.root)]);
    for (const r of snap.roots || []) {
      if (roots.has(+r.serial) && !bySerial.has(+r.serial) && occupied.has(+r.serial)) bySerial.set(+r.serial, { serial: +r.serial, root: +r.serial, parent: null, kind: r.kind, name: r.name });
    }
    for (const c of bySerial.values()) {
      if (!roots.has(+c.root)) continue;
      inv.containers[c.serial] = { ...c, capacity: capacityOf(c.tooltip), scannedBy: char, scannedAt: snap.scannedAt };
    }
    for (const c of Object.values(snapContainers)) {
      if (c.parent == null || !roots.has(+c.root)) continue;   // roots (chests, backpack, bank) are places, not things
      if (c.kind != null && c.kind !== "container" && c.kind !== "bag") continue;   // old scans said "bag"; a later scanner says "container"
      const bag = enrich({ serial: c.serial, name: bagLabel(c), tooltip: [bagLabel(c), ...(c.tooltip || [c.name]).slice(1)] as string[], amount: 1 },
        { root: +c.root, container: +c.parent, equippedBy: null, layer: null, seenAt: snap.scannedAt, scannedBy: char }, overrides);
      if (!SPELLBOOK_RE.test(c.name || "") && !/runebook|runic atlas/i.test(c.name || "")) {   // a bag engraved "DEXXER armor" is still a bag
        bag.gear = false; bag.slot = null; bag.kind = "container";
      }
      inv.items[c.serial] = bag;
    }
    for (const raw of snap.items || []) {
      const c = bySerial.get(+raw.container);
      const root = c ? +c.root : null;
      if (root == null || !roots.has(root)) continue;
      inv.items[raw.serial] = foldItem(raw, { root, container: +raw.container, equippedBy: null, layer: null, seenAt: snap.scannedAt, scannedBy: char });
    }
    for (const raw of snap.equipped || []) {
      inv.items[raw.serial] = foldItem(raw, { root: null, container: null, equippedBy: char, layer: raw.layer || null, seenAt: snap.scannedAt, scannedBy: char });
    }
    if (!isPseudoCharacter(char)) {
      inv.characters[char] = { name: char, stats: snap.stats || {}, scannedAt: snap.scannedAt, position: snap.position || null,
        maxes: snap.maxes || null, resists: snap.resists || null, skills: snap.skills || {}, adapter: snap.adapter || null,
        appearance: snap.appearance ?? inv.characters[char]?.appearance ?? null };
    }
    inv.scans.push({ character: char, scannedAt: snap.scannedAt, items: (snap.items || []).length, roots: [...roots] });
  }
  dropTrash(inv);
  labelContainers(inv);
  for (const it of Object.values(inv.items)) it.location = locationOf(it, inv);
  return inv;
}

// A trash barrel or chest: the server deletes what is put in one on a timer, so whatever an older scan
// recorded inside one is long gone. Scanners never open one (TRASH_RE in each adapter); what they
// recorded before that is dropped here, the container itself and everything under it included.
export const TRASH_RE = /\btrash\b/i;
function dropTrash(inv: Inventory): void {
  const trash = new Set(Object.values(inv.containers).filter((c) => TRASH_RE.test(c.name || "")).map((c) => +c.serial));
  if (!trash.size) return;
  const inTrash = (serial: number | null | undefined): boolean => {
    for (let cur = serial, guard = 0; cur != null && guard < 64; guard++) {
      if (trash.has(+cur)) return true;
      cur = inv.containers[cur]?.parent;
    }
    return false;
  };
  for (const [serial, it] of Object.entries(inv.items)) if (inTrash(+serial) || inTrash(it.container)) delete inv.items[serial];
  for (const serial of Object.keys(inv.containers).filter((s) => inTrash(+s))) delete inv.containers[serial];
}

// A character tombstone (POST /api/forget-character: a `_vault` scan carrying `forgetCharacter`)
// removes what only that character's scans ever put there: its card, its worn set, and its backpack
// and bank roots with everything under them. Ground containers it scanned stay: they belong to a
// house, and another character's scan may be the one keeping them current. A later scan of the
// character brings it back, by the fold's usual newest-wins order.
function forgetCharacter(inv: Inventory, name: unknown): void {
  if (typeof name !== "string" || !name) return;
  const roots = new Set(Object.values(inv.containers).filter((c) => c.parent == null && c.scannedBy === name && (c.kind === "backpack" || c.kind === "bank")).map((c) => +c.root));
  for (const [serial, it] of Object.entries(inv.items)) {
    if (it.equippedBy === name || (it.root != null && roots.has(+it.root))) delete inv.items[serial];
  }
  for (const [serial, c] of Object.entries(inv.containers)) if (roots.has(+c.root)) delete inv.containers[serial];
  delete inv.characters[name];
}

// Each container's segment in location text. Location text is what the Location filter, the group
// view's per-place counts and the builder's Fetch list key on, and a house full of chests called
// "Metal Chest" (or three "A Bag"s in one backpack) would otherwise merge into one place. Containers
// that share a label and sit side by side (the same parent; for ground roots, every ground root) get
// their serial as a suffix: unlike a position, it never changes when another same-named container is
// added or moved, so a saved filter or a remembered location keeps meaning the same chest. A backpack or bank root
// is never shown by its own name (locationOf names it after its owner), so those roots are left out.
function labelContainers(inv: Inventory): void {
  const groups = new Map<string, Container[]>();
  for (const c of Object.values(inv.containers)) {
    const scope = c.parent != null ? `in ${c.parent}` : c.kind === "backpack" || c.kind === "bank" ? `own ${c.serial}` : "ground";
    const key = `${scope}\u0000${bagLabel(c)}`;
    const list = groups.get(key);
    if (list) list.push(c); else groups.set(key, [c]);
  }
  for (const list of groups.values()) {
    for (const c of list) c.label = list.length === 1 ? bagLabel(c) : `${bagLabel(c)} (0x${(+c.serial).toString(16)})`;
  }
}

function enrich(raw: EnrichRaw, loc: EnrichLoc, overrides: KindOverrides): Item {
  const parsed = parseTooltip(raw.tooltip && raw.tooltip.length ? raw.tooltip : [raw.name], raw.amount);
  const cls = classify(parsed.name || raw.name, parsed, loc.layer, raw.graphic);
  const shipped = cls.gear ? "gear" : kindOf(parsed.name || raw.name, parsed, raw.graphic);
  const name = displayName(parsed) || raw.name || "";
  return {
    serial: +raw.serial, name, graphic: raw.graphic, hue: raw.hue, amount: raw.amount || 1,
    props: parsed.props, setBonus: parsed.setBonus, extras: parsed.extras, flags: parsed.flags, tags: parsed.tags, strReq: parsed.strReq,
    rarity: parsed.rarity, weight: parsed.weight, skillReq: parsed.skillReq, lines: parsed.lines,
    gargoyle: /\bgargish\b/i.test(parsed.name || raw.name || "") || parsed.flags.includes("gargoyles only"),
    slayers: slayersOf(parsed.flags),
    medable: medableOf(parsed.name || raw.name || "", cls.slot, cls.gear, parsed.flags),
    slot: cls.slot, twoHanded: cls.twoHanded, gear: cls.gear, kind: shipped === "gear" ? shipped : (overriddenKind(overrides, name, null) ?? overriddenKind(overrides, parsed.name || raw.name, raw.graphic)) ?? shipped, ...loc,
  };
}

export function containerPath(serial: number | null, inv: Inventory): string[] {
  const names = [];
  // A null serial (an item whose location was never resolved to a real container) looks up
  // inv.containers["null"] the same way the pre-TypeScript code did by indexing with `null`
  // directly — never matches, `cur` comes back undefined, and the loop below simply doesn't run.
  let cur: Container | null | undefined = inv.containers[serial as number], guard = 0;
  while (cur && guard++ < 8) {
    names.unshift(cur.label || bagLabel(cur));
    cur = cur.parent != null ? inv.containers[cur.parent] : null;
  }
  return names;
}

interface BagLabelSource {
  tooltip?: string[] | undefined;
  name?: string | undefined;
  serial: number;
}
export function bagLabel(c: BagLabelSource): string {
  const eng = (c.tooltip || []).map(stripHtml).find((l) => /engraved|^\[.*\]$/i.test(l));
  if (eng) return eng.replace(/^engraved:?\s*/i, "").trim();
  return c.name || `0x${(+c.serial).toString(16)}`;
}

// A container's fill from its tooltip's Contents line (ServUO's clilocs): "Contents: 13/125 Items, 95 Stones" on
// a house container, "Contents: 1/1 Items, 49/50 Stones" on one with a weight cap. Null when no line reads that
// way: a backpack or bank root, a ground root from a scan older than root tooltips (TazUO 2.9.0, Razor Enhanced
// 1.9.0), or a line with no maximum. Organize (issue #11) never plans a put into a container whose capacity is null.
const CONTENTS_RE = /^contents:\s*(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*items?\b(?:\s*,\s*(\d[\d,]*)(?:\s*\/\s*(\d[\d,]*))?\s*stones?\b)?/i;
export function capacityOf(tooltip: string[] | null | undefined): ContainerCapacity | null {
  for (const line of (tooltip || []).map(stripHtml)) {
    const m = line.match(CONTENTS_RE);
    if (!m) continue;
    const n = (s: string | undefined): number | null => (s == null ? null : +s.replace(/,/g, ""));
    return { items: n(m[1])!, maxItems: n(m[2])!, stones: n(m[3]), maxStones: n(m[4]) };
  }
  return null;
}

export function locationOf(it: Item, inv: Inventory): ItemLocation {
  if (it.equippedBy) return { kind: "equipped", character: it.equippedBy, text: `Worn by ${it.equippedBy}`, root: null };
  // Same null-as-string-key quirk as containerPath above: it.root can be null, and the lookup just
  // misses (root comes back undefined), which the ternaries below already treat as "unknown/?".
  const root = inv.containers[it.root as number];
  const path = containerPath(it.container, inv);
  const kind = root ? root.kind : "unknown";
  const owner = root ? root.scannedBy : "?";
  let text;
  if (kind === "backpack") text = `${owner}'s backpack` + (path.length > 1 ? " › " + path.slice(1).join(" › ") : "");
  else if (kind === "bank") text = `${owner}'s bank` + (path.length > 1 ? " › " + path.slice(1).join(" › ") : "");
  else text = path.join(" › ") || "unknown";
  return { kind, character: owner, text, root: it.root, rootName: root ? root.label || bagLabel(root) : "?" };
}

// Group rows by name (+kind): total pieces, stack count, and where they are.
export interface ItemGroup {
  name: string;
  kind: string;
  slot: string | null;
  amount: number;
  stacks: number;
  locations: Map<string, number>;
  items: Item[];
}
export function groupByName(items: Item[]): ItemGroup[] {
  const g = new Map<string, ItemGroup>();
  for (const it of items) {
    const key = `${it.name}|${it.kind}`;
    const row: ItemGroup = g.get(key) || { name: it.name, kind: it.kind, slot: it.slot, amount: 0, stacks: 0, locations: new Map(), items: [] };
    row.amount += it.amount || 1; row.stacks++; row.items.push(it);
    const loc = it.location?.text || "?";
    row.locations.set(loc, (row.locations.get(loc) || 0) + (it.amount || 1));
    g.set(key, row);
  }
  return [...g.values()];
}
