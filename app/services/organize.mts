// organize.mts — the Organize service (issues #11, #127, #131): finished trips read back into the results overlay, what a plan starts from, the plan, a trip queued for the bridge, and Put away's requests from the in-game panel.
import { lstatSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR_MODE, DATA_FILE_MODE, type ConfigPaths } from "../config.mts";
import { writeFileAtomic } from "../atomic-write.mts";
import { isBoundedString } from "../guards.mts";
import { readBridgeStatus } from "../bridge-status.mts";
import { queueTrip } from "../bridge-trip.mts";
import { ancestry, applyOverlay, packKept, planOrganize, stampMs, tripCommand, type Plan, type PutAway } from "../organize.mts";
import { harvestTrips, noteSeen, pruneOverlay, PENDING_GRACE_MS, type BridgeView, type OrganizeState } from "../organize-state.mts";
import { checkPutAwayRequest, nothingDetail, requestId, tripMsg, FRESH_MARGIN_MS, MAX_REQUEST_BYTES, PUT_AWAY_REPLY, type PutAwayReply, type PutAwayRequest } from "../put-away.mts";
import { suitPieces, type SavedRun } from "../runs-lib.mts";
import type { OrganizeConfig, RuleMatch } from "../organize-config.mts";
import { bridgeFeatures, newestScanAdapter, type BlacklistEntry, type FeatureDeclaration, type Inventory } from "../vault-lib.mts";
import type { RulesV1 } from "../schema/types.d.mts";

// `getInventory` is the inventory service's; `rules` the current shard's rules; `bridgeAdapter` the client the bridge
// commands go to; `manifest` what an adapter's shipped capabilities.json declares; `log` appends one line to the server log.
export function createOrganizeService({ paths, getInventory, organizeStore, organizeStateStore, blacklistStore, runStore, rules, bridgeAdapter, manifest, events, log }: {
  paths: Pick<ConfigPaths, "bridgeFor" | "bridgeQueueFor" | "bridgeStatusFor">;
  getInventory: () => Promise<{ fold: Inventory }>;
  organizeStore: { read(): { config: OrganizeConfig; problems: string[] } };
  organizeStateStore: { read(): OrganizeState; write(state: OrganizeState): void };
  blacklistStore: { read(): BlacklistEntry[] };
  runStore: { all(): SavedRun[] };
  rules: () => RulesV1;
  bridgeAdapter: () => string;
  manifest: (adapter: string) => FeatureDeclaration | null;
  events: { broadcast(event: string, data: unknown): void };
  log: (line: string) => void;
}) {
  // Every saved suit's pieces, for Organize (issue #133), read only when a rule asks to skip them: the live count
  // asks on every pause in typing, and few setups have such a rule.
  function suitsFor(matches: RuleMatch[]): Set<number> | undefined { return matches.some((m) => m.skipSuits) ? suitPieces(runStore.all()) : undefined; }
  // What harvestTrips needs of one adapter's status.json (GET /api/bridge/status reads the same file for the page).
  // `current` counts only while the bridge's heartbeat is under PENDING_GRACE_MS (90 s) old either way, a longer wait
  // than "online" (8 s): a trip in flight is not given up on for a missed heartbeat, but a client that quit mid-trip
  // leaves its last `current` in the file for good, which would otherwise hold Organize's one trip in flight forever.
  function bridgeView(adapter: string, now: number): BridgeView {
    const { status, aliveMs } = readBridgeStatus(paths.bridgeStatusFor(adapter), now);
    if (!status) return { results: {}, current: null };
    const live = Math.abs(now - aliveMs) <= PENDING_GRACE_MS;
    const id = live && status.current ? (status.current as { id?: unknown }).id : null;
    return { results: status.results, current: typeof id === "string" ? id : null, character: isBoundedString(status.character, 64) ? status.character : null };
  }
  // What an adapter's bridge can do (vault-lib.mts's bridgeFeatures): the running bridge's own report while it is
  // online, else the newest scan made with that adapter, else what this app ships.
  function featuresOf(adapter: string, fold: Inventory, now: number): Set<string> {
    const live = readBridgeStatus(paths.bridgeStatusFor(adapter), now);
    return bridgeFeatures({ running: live.online ? live.status?.adapter : null, scan: newestScanAdapter(fold.characters, adapter), manifest: manifest(adapter) }).features;
  }
  // Finished trips read out of their bridges' status files into the overlay. Runs on every getInventory() and on the
  // page's bridge status poll (every 2.5 s while any page is open), so a trip that reports back moves its items in
  // every view even with Organize closed; when it brought moves in, the state file is rewritten and every open page
  // told to reload its inventory. A Grab is harvested the same way. With nothing pending it only reads the state file.
  function harvestNow(now: number): { state: OrganizeState; bridges: Record<string, BridgeView> } {
    const before = organizeStateStore.read();
    if (!before.pending.length && !before.grabs.length) return { state: before, bridges: {} };
    const bridges = Object.fromEntries([...new Set([...before.pending, ...before.grabs].map((p) => p.adapter))].map((a) => [a, bridgeView(a, now)]));
    const state = harvestTrips(before, bridges, now);
    if (JSON.stringify(state) !== JSON.stringify(before)) organizeStateStore.write(state);
    if (JSON.stringify(state.moves) !== JSON.stringify(before.moves)) events.broadcast("changed", { what: "inventory", at: now });
    return { state, bridges };
  }
  // What a plan starts from now: finished trips harvested, entries a newer scan has settled dropped, labels' last-seen
  // times refreshed (the state file is rewritten only when that changed something). Organize works on the fold alone
  // and applies the overlay itself. organizeNow adds the plan; Put away plans its own (planOf with a source).
  async function organizeInputs(adapter = bridgeAdapter()): Promise<{ fold: Inventory; config: OrganizeConfig; state: OrganizeState; problems: string[]; bridges: Record<string, BridgeView>; features: Set<string> }> {
    const { fold } = await getInventory();
    const { config, problems } = organizeStore.read();
    const now = Date.now();
    const { state: harvested, bridges } = harvestNow(now);
    const state = noteSeen(pruneOverlay(harvested, fold, now), config, fold);
    if (JSON.stringify(state) !== JSON.stringify(harvested)) organizeStateStore.write(state);
    return { fold, config, state, problems, bridges, features: featuresOf(adapter, fold, now) };
  }
  const planOf = (fold: Inventory, config: OrganizeConfig, state: OrganizeState, features: ReadonlySet<string>, putAway?: PutAway): Plan =>
    planOrganize(fold, config, state.moves, { now: Date.now(), rarity: rules().rarity, suitPieces: suitsFor(config.rules.map((r) => r.match)), blacklist: blacklistStore.read().map((e) => e.serial), seen: state.seen, features, putAway });
  async function organizeNow(): Promise<{ fold: Inventory; config: OrganizeConfig; state: OrganizeState; plan: Plan; problems: string[]; bridges: Record<string, BridgeView>; features: Set<string> }> {
    const got = await organizeInputs();
    return { ...got, plan: planOf(got.fold, got.config, got.state, got.features) };
  }

  // Trip `index` of `plan` queued with queueTrip and recorded as pending, so its result is read back into the
  // overlay (harvestTrips). A Put away trip from the pack carries putAway, the picked container (docs/bridge-protocol.md, Put away).
  function queuePlanTrip(adapter: string, fold: Inventory, state: OrganizeState, plan: Plan, index: number, putAway?: number): { ok: true; id: string } | { ok: false; error: string } {
    const input = tripCommand(applyOverlay(fold, state.moves).inv, plan, index);
    if (!input) return { ok: false, error: `trip ${index} cannot be built from the current scans` };
    const now = new Date();
    const queued = queueTrip(paths, adapter, putAway ? { ...input, putAway } : input, now);
    if (!queued.ok) return queued;
    const steps = plan.moves.filter((m) => m.trip === index).map(({ serial, name, from, to }) => ({ serial, name, from, to }));
    organizeStateStore.write({ ...state, pending: [...state.pending, { id: queued.id, adapter, index, stamp: plan.stamp, queuedAt: now.toISOString(), steps }] });
    return queued;
  }
  // Put away (issue #131, app/put-away.mts): the TazUO panel's request, handed over by the watcher of the inbox it was
  // dropped in, in its turn after the scan the panel ran first. The file is removed before anything else and read as
  // untrusted; the answer, whatever it is, goes to <data>/bridge/<adapter>/putaway.json for the panel.
  async function putAway(adapter: string, path: string): Promise<void> {
    let raw: unknown = null;
    try {
      const st = lstatSync(path);
      if (st.isFile() && st.size <= MAX_REQUEST_BYTES) raw = JSON.parse(readFileSync(path, "utf8"));
    } catch { /* refused below as not a request */ }
    try { unlinkSync(path); } catch { /* gone already */ }
    const checked = checkPutAwayRequest(raw, Date.now());
    let answer: Omit<PutAwayReply, "id" | "t">;
    try { answer = checked.ok ? await putAwayRun(adapter, checked.request) : { ok: false, msg: "Put away was refused.", detail: checked.error }; }
    catch (e) {
      const ref = randomUUID().slice(0, 8);
      log(`${new Date().toISOString()} ${ref} put away\n${(e as Error)?.stack ?? e}\n`);
      answer = { ok: false, msg: "Put away failed.", detail: `See server.log (${ref}).` };
    }
    const reply: PutAwayReply = { id: requestId(raw), ...answer, t: new Date().toISOString() };
    try {
      mkdirSync(paths.bridgeFor(adapter), { recursive: true, mode: DATA_DIR_MODE });
      writeFileAtomic(join(paths.bridgeFor(adapter), PUT_AWAY_REPLY), JSON.stringify(reply) + "\n", DATA_FILE_MODE);
    } catch (e) { log(`${reply.t} put away: could not write the answer: ${(e as Error).message}\n`); }
  }
  // One Put away step: the first trip of a plan whose only source is what lies directly in the container the player
  // picked (their backpack or a bag in it, put into the house they stand in, or a container in a labelled chest).
  // The panel asks again after each trip until nothing is left.
  async function putAwayRun(adapter: string, req: PutAwayRequest): Promise<Omit<PutAwayReply, "id" | "t">> {
    const { fold, config, state, problems, features } = await organizeInputs(adapter);
    if (!features.has("trip")) return { ok: false, msg: "This client's bridge cannot run Put away." };
    if (problems.length) return { ok: false, msg: "Organize's setup was hand-edited.", detail: "Open Organize in the app and save it." };
    if (state.pending[0]) return { ok: false, msg: `Trip ${state.pending[0].index} has not reported back yet.` };
    // The picked container: the character's backpack or a bag at any depth in it, or a container in a labelled ground
    // chest (the chest itself included). Only what lies directly in it moves.
    const picked = fold.containers[String(req.container)];
    const chain = picked ? ancestry(fold, +picked.serial) : null;
    const root = chain ? fold.containers[String(chain.at(-1))] : undefined;
    // Planned only from a scan made for this run (the panel's refresh or scan), never from an older one, and never from
    // a bag that scan could not open (the fold keeps older contents there).
    if (!picked || !chain || !root || picked.opened === false || stampMs(picked.scannedAt) < stampMs(req.clickedAt) - FRESH_MARGIN_MS) {
      return { ok: false, msg: "Pack Rat has not read that container yet.", detail: "Stand next to it and try again." };
    }
    let source: PutAway;
    if (root.kind === "backpack" && root.scannedBy === req.character) source = { from: "pack", container: +picked.serial, at: req.at };
    else if (root.kind === "ground" && config.labels[String(root.serial)]) source = { from: "ground", container: +picked.serial };
    else return { ok: false, msg: root.kind === "ground" ? "That container is not labeled for Organize." : "Pick your backpack, a container in it,", detail: root.kind === "ground" ? "Label it in the app first." : "or a container in a labeled one on the ground." };
    const black = new Set(blacklistStore.read().map((e) => e.serial));
    if (chain.some((s) => black.has(s))) return { ok: false, msg: "That container is blacklisted.", detail: "Pack Rat never opens it." };
    if (chain.some((s) => config.labels[String(s)]?.pinned)) return { ok: false, msg: "That container is pinned.", detail: "Organize never takes items out of it." };
    const plan = planOf(fold, config, state, features, source);
    if (source.from === "ground" && !plan.sites.some((s) => s.roots.includes(+root.serial))) {
      const why = plan.warnings.find((w) => w.serial === +root.serial);
      return { ok: false, msg: "That container cannot be used.", detail: why?.detail ?? "It needs a scan with its position." };
    }
    const trip = plan.trips[0];
    const kept = source.from === "pack" ? packKept(fold, source.container, new Set(config.pinnedItems)) : undefined;
    const where = +picked.serial === +root.serial && source.from === "pack" ? "your pack" : "that container";
    if (!trip) return { ok: true, msg: "Nothing to put away.", detail: nothingDetail(plan, where, kept) };
    const queued = queuePlanTrip(adapter, fold, state, plan, trip.index, source.from === "pack" ? source.container : undefined);
    if (!queued.ok) return { ok: false, msg: "The trip could not be queued.", detail: queued.error };
    return { ok: true, msg: tripMsg(trip.puts.length, plan.moves.length - trip.puts.length), trip: queued.id };
  }
  return { harvestNow, organizeNow, queuePlanTrip, putAway, suitsFor };
}
export type OrganizeService = ReturnType<typeof createOrganizeService>;
