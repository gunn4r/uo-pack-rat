// domain/bridge-features.mts — what the in-game bridge can do, as one set of feature names (the actions it runs and what it does besides), answered from the running bridge's own report, then the newest scan made with that adapter, then the shipped manifest; and the one sentence the page and the MCP tools give when an action can't run.
//
// map: bridge
// owns: `BridgeAction`, `BRIDGE_ACTION_LABELS`, `BRIDGE_OFFLINE`, `FeatureDeclaration`, `bridgeFeatures`, `newestScanAdapter`, `BridgeGate`, `bridgeRefusal`
import { parseStamp, V1_ADAPTER_VERSION } from "../scan-schema.mts";

// "scan" starts one of the client's scan scripts (issue #281): the MCP scan tool sends it, and no button does.
export type BridgeAction = "highlight" | "grab" | "goto" | "scan";
export const BRIDGE_ACTION_LABELS: Record<BridgeAction, string> = { highlight: "Highlight", grab: "Grab", goto: "Go to", scan: "Scan" };
export const BRIDGE_OFFLINE = "Bridge offline. Press Play on packrat-bridge.py in game.";

// What a bridge can do, as one set of feature names: the actions it runs ("highlight", "grab", "goto", "trip", "scan") and what
// it does besides ("trip-bags"). The page, Organize and the MCP tools all ask bridgeFeatures, which answers from the
// running bridge's own report first (status.json's adapter, while it is online), then the newest scan made with that
// adapter, then the manifest this app ships (docs/bridge-protocol.md, Features).
// A manifest (capabilities.json) or a scan's adapter block: its bridge actions and its features. Scripts before TazUO
// 2.16.0 listed "trip-bags" among the actions, so a name counts from either list (compat: trip-bags-action, remove in
// Pack Rat 0.3.0 (docs/architecture.md, Compatibility shims)).
export interface FeatureDeclaration { capabilities?: { bridge?: readonly string[] | undefined } | undefined; features?: readonly string[] | undefined }
export type FeatureSource = "bridge" | "scan" | "app";
const featureNames = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
// The adapter block of the newest scan made with adapter `id`, or null when no character was scanned with it. A v1
// scan's block is left out: upgradeScan made it up, so it says nothing about the installed scripts.
export function newestScanAdapter<A extends FeatureDeclaration & { id: string; version: string }>(characters: Record<string, { scannedAt: string; adapter: A | null }> | null | undefined, id: string | null | undefined): A | null {
  let best: { at: number; adapter: A } | null = null;
  for (const c of Object.values(characters ?? {})) {
    if (!c.adapter || c.adapter.id !== id || c.adapter.version === V1_ADAPTER_VERSION) continue;
    const at = parseStamp(c.scannedAt);
    if (!best || at > best.at) best = { at, adapter: c.adapter };
  }
  return best?.adapter ?? null;
}
// The feature names and where they came from (null: nothing to go on, so the bridge can do nothing). `running` is the
// online bridge's report (every action and feature in one list), or null when it is offline or too old to report itself.
export function bridgeFeatures(from: { running?: { features?: unknown } | null | undefined; scan?: FeatureDeclaration | null | undefined; manifest?: FeatureDeclaration | null | undefined }): { features: Set<string>; source: FeatureSource | null } {
  if (from.running && Array.isArray(from.running.features)) return { features: new Set(featureNames(from.running.features)), source: "bridge" };
  if (from.scan) return { features: new Set([...featureNames(from.scan.capabilities?.bridge), ...featureNames(from.scan.features)]), source: "scan" };
  if (from.manifest) return { features: new Set([...featureNames(from.manifest.capabilities?.bridge), ...featureNames(from.manifest.features)]), source: "app" };
  return { features: new Set(), source: null };
}
// What the refusal below knows of the bridge: the client it routes to (null: none set up), what it can do
// (bridgeFeatures), whether its heartbeat is fresh, and whether the target's root has a scanned position (Go to walks there).
export interface BridgeGate { adapter: { id: string; name?: string | undefined } | null; features: ReadonlySet<string>; online: boolean; hasPos: boolean }
// Why one bridge action cannot run on one target right now, in words, or null when it can: the page's disabled
// buttons (ui/bridge.mts) and the MCP tools refuse with the same sentence.
export function bridgeRefusal(action: BridgeAction, it: { equippedBy?: string | null | undefined }, gate: BridgeGate): string | null {
  if (it.equippedBy) return `${it.equippedBy} is wearing it.`;
  const a = gate.adapter;
  if (!a) return "No game client is set up. Choose one in Settings.";
  if (!gate.features.has(action)) return `${a.name || a.id} can't ${BRIDGE_ACTION_LABELS[action]} from Pack Rat.`;
  if (action === "goto" && !gate.hasPos) return "Go to needs a container on the ground whose position was scanned.";
  if (!gate.online) return BRIDGE_OFFLINE;
  return null;
}
