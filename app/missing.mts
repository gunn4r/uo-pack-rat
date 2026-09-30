// missing.mts — Missing since last scan (issue #99). For each root container two scans have opened, what its
// previous scan saw in it that its latest scan did not, and that is nowhere in the folded inventory now: sold,
// dropped, stolen, or moved somewhere no scan has seen yet. An item moved to another scanned container, or now
// worn, is in the fold and so not missing. A stack that shrank in place is reported with how many fewer.
// A stack that vanished may have been dropped onto a stack of the same kind (same graphic, hue and name, as
// Organize merges them), and only that other stack's serial lives on. So its amount counts as moved, up to what
// the stacks of that kind could have taken in: the whole amount of each one seen elsewhere since the root's
// previous scan, and what one in the root itself grew by. Only the rest is reported. A sale can therefore be
// under-reported while such a stack exists, but a merge is never reported as missing.
// Pure; app/vault-server.mts runs it beside the fold, over the same scans.
import { parseStamp } from "./scan-schema.mts";
import { stackName, TRASH_RE } from "./vault-lib.mts";
import type { Inventory } from "./vault-lib.mts";
import type { ScanV2 } from "./schema/types.d.mts";

export interface MissingItem { serial: number; name: string; amount: number; fewer?: number; lastSeen: string }
interface Seen { name: string; amount: number; kind: string | null }   // kind: null for a bag, which never merges
interface Stack { root: number | null; amount: number; seenAt: number }

const stampOf = (s: string): number => { const t = parseStamp(s); return Number.isFinite(t) ? t : -Infinity; };
const kindOf = (name: string, graphic: number | null | undefined, hue: number | null | undefined): string => `${graphic ?? 0}\u0000${hue ?? 0}\u0000${name.toLowerCase()}`;

// Everything one scan saw in each of its opened roots, bags included, keyed by root then serial. What sat under
// a trash container is left out: the fold drops it too, and the server empties those on a timer.
function contentsOf(snap: ScanV2): Map<number, Map<number, Seen>> {
  const roots = new Set((snap.roots || []).filter((r) => r.opened !== false).map((r) => +r.serial));
  const bySerial = new Map(Object.values((snap.containers || {}) as Record<string, { serial: number; root: number; parent?: number | null; name?: string; kind?: string | null }>).map((c) => [+c.serial, c]));
  const inTrash = (serial: number): boolean => {
    for (let cur: number | null | undefined = serial, guard = 0; cur != null && guard < 64; guard++) {
      const c = bySerial.get(+cur);
      if (TRASH_RE.test(c?.name || "")) return true;
      cur = c?.parent;
    }
    return false;
  };
  const out = new Map<number, Map<number, Seen>>();
  const add = (root: number, serial: number, seen: Seen): void => {
    let m = out.get(root);
    if (!m) out.set(root, m = new Map());
    m.set(serial, seen);
  };
  for (const c of bySerial.values()) {
    if (c.parent == null || !roots.has(+c.root) || (c.kind != null && c.kind !== "container" && c.kind !== "bag") || inTrash(+c.serial)) continue;
    add(+c.root, +c.serial, { name: c.name || `0x${(+c.serial).toString(16)}`, amount: 1, kind: null });
  }
  for (const raw of snap.items || []) {
    const root = bySerial.has(+raw.container) ? +bySerial.get(+raw.container)!.root : roots.has(+raw.container) ? +raw.container : null;
    if (root == null || !roots.has(root) || inTrash(+raw.container)) continue;
    const amount = raw.amount || 1;
    // The fold's name for it: the first tooltip line with text, its count stripped (parseTooltip).
    const name = stackName((raw.tooltip?.length ? raw.tooltip : [raw.name]).find((l) => stackName(l)), amount) || raw.name || "";
    add(root, +raw.serial, { name, amount, kind: kindOf(name, raw.graphic, raw.hue) });
  }
  return out;
}

export function missingSinceLastScan(snapshots: ScanV2[], inv: Inventory): Record<string, MissingItem[]> {
  // The fold's own order, so "latest" and "previous" mean what the fold took them to mean.
  const sorted = [...snapshots].sort((a, b) => stampOf(a.scannedAt) - stampOf(b.scannedAt));
  const lastTwo = new Map<number, [ScanV2 | null, ScanV2]>();
  for (const snap of sorted) {
    for (const r of snap.roots || []) if (r.opened !== false) lastTwo.set(+r.serial, [lastTwo.get(+r.serial)?.[1] ?? null, snap]);
  }
  const contents = new Map<ScanV2, Map<number, Map<number, Seen>>>();
  const seenIn = (snap: ScanV2, root: number): Map<number, Seen> => {
    let c = contents.get(snap);
    if (!c) contents.set(snap, c = contentsOf(snap));
    return c.get(root) || new Map();
  };
  // Every stack in the fold, by kind; built the first time a vanished item needs it.
  let stacks: Map<string, Stack[]> | null = null;
  const stacksOf = (kind: string): Stack[] => {
    if (!stacks) {
      stacks = new Map();
      for (const it of Object.values(inv.items)) {
        if ((it.amount || 1) < 2) continue;
        const k = kindOf(it.name, it.graphic, it.hue), list = stacks.get(k);
        const s = { root: it.root ?? null, amount: it.amount, seenAt: stampOf(it.seenAt) };
        if (list) list.push(s); else stacks.set(k, [s]);
      }
    }
    return stacks.get(kind) ?? [];
  };
  const out: Record<string, MissingItem[]> = {};   // keyed by a root's serial: always digits, never "__proto__"
  for (const [root, [prev, latest]] of lastTwo) {
    // A root a Forget (or a character's Forget) removed is not in the fold, and has nothing to report.
    const c = inv.containers[root];
    if (!prev || !c || c.parent != null) continue;
    const now = seenIn(latest, root), before = seenIn(prev, root), since = stampOf(prev.scannedAt), list: MissingItem[] = [];
    // What is left, per kind, that this root's vanished stacks could have been merged into.
    const room = new Map<string, number>();
    const roomFor = (kind: string): number => {
      let left = room.get(kind);
      if (left != null) return left;
      left = 0;
      for (const s of stacksOf(kind)) if (s.root !== root && s.seenAt > since) left += s.amount;
      for (const [serial, is] of now) if (is.kind === kind && is.amount > 1) left += Math.max(0, is.amount - (before.get(serial)?.amount ?? 0));
      return left;
    };
    for (const [serial, was] of before) {
      const is = now.get(serial);
      if (is) { if (is.amount < was.amount) list.push({ serial, name: was.name, amount: was.amount, fewer: was.amount - is.amount, lastSeen: prev.scannedAt }); continue; }
      if (inv.items[serial]) continue;
      const left = was.kind ? roomFor(was.kind) : 0, took = Math.min(was.amount, left);
      if (was.kind) room.set(was.kind, left - took);
      if (took < was.amount) list.push({ serial, name: was.name, amount: was.amount, ...(took ? { fewer: was.amount - took } : {}), lastSeen: prev.scannedAt });
    }
    if (list.length) out[root] = list;
  }
  return out;
}
