// missing.mts — Missing since last scan (issue #99). For each root container two scans have opened, what its
// previous scan saw in it that its latest scan did not, and that is nowhere in the folded inventory now: sold,
// dropped, stolen, or moved somewhere no scan has seen yet. An item moved to another scanned container, or now
// worn, is in the fold and so not missing. Stacks compare by serial: one that shrank in place is reported with
// how many fewer. Pure; app/vault-server.mts runs it beside the fold, over the same scans.
import { parseStamp } from "./scan-schema.mts";
import { stackName, TRASH_RE } from "./vault-lib.mts";
import type { Inventory } from "./vault-lib.mts";
import type { ScanV2 } from "./schema/types.d.mts";

export interface MissingItem { serial: number; name: string; amount: number; fewer?: number; lastSeen: string }
interface Seen { name: string; amount: number }

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
    add(+c.root, +c.serial, { name: c.name || `0x${(+c.serial).toString(16)}`, amount: 1 });
  }
  for (const raw of snap.items || []) {
    const root = bySerial.has(+raw.container) ? +bySerial.get(+raw.container)!.root : roots.has(+raw.container) ? +raw.container : null;
    if (root == null || !roots.has(root) || inTrash(+raw.container)) continue;
    const amount = raw.amount || 1;
    add(root, +raw.serial, { name: stackName(raw.tooltip?.[0] ?? raw.name, amount) || raw.name || "", amount });
  }
  return out;
}

export function missingSinceLastScan(snapshots: ScanV2[], inv: Inventory): Record<string, MissingItem[]> {
  // The fold's own order, so "latest" and "previous" mean what the fold took them to mean.
  const stampOf = (s: string): number => { const t = parseStamp(s); return Number.isFinite(t) ? t : -Infinity; };
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
  const out: Record<string, MissingItem[]> = {};   // keyed by a root's serial: always digits, never "__proto__"
  for (const [root, [prev, latest]] of lastTwo) {
    // A root a Forget (or a character's Forget) removed is not in the fold, and has nothing to report.
    const c = inv.containers[root];
    if (!prev || !c || c.parent != null) continue;
    const now = seenIn(latest, root), list: MissingItem[] = [];
    for (const [serial, was] of seenIn(prev, root)) {
      const is = now.get(serial);
      if (is) { if (is.amount < was.amount) list.push({ serial, name: was.name, amount: was.amount, fewer: was.amount - is.amount, lastSeen: prev.scannedAt }); }
      else if (!inv.items[serial]) list.push({ serial, name: was.name, amount: was.amount, lastSeen: prev.scannedAt });
    }
    if (list.length) out[root] = list;
  }
  return out;
}
