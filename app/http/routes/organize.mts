// organize.mts — Organize: GET|PUT /api/organize, GET /api/organize/presets, POST /api/organize/match and /api/organize/propose, GET /api/organize/plan and POST /api/organize/trip; and Move to (issue #270), which runs as Organize trips: POST /api/move/plan and /api/move/trip.
//
// The routes, what each takes and answers:
// - `GET|PUT /api/organize` (`<data>/organize.json`, Organize's labels, rules, catch-all and pinned items: app/organize-config.mts; GET salvages a hand-edited file and lists what it dropped in `problems`; GET answers the file's `stamp` (a hash of its content, `none` for no file) and PUT takes it back as `base`: a setup saved by anyone else since is refused with 409, code `stale` and the current `stamp`, and nothing is written (issue #280); a PUT without `base` is still taken; a save broadcasts `changed` {what: "inventory"})
// - `GET /api/organize/presets` (app/organize-presets.mts's PRESETS, the rule filters the Organize page offers to start a rule from; read-only)
// - `POST /api/organize/match` {match} -> {count, pieces, sample} (the movable items in labelled roots that one rule filter takes, ignoring the other rules: the rule editor's live count; read-only)
// - `POST /api/organize/propose` {strategy: "simple"|"detailed"|"build", containers?: [serial…]} -> {proposal, stamp} (Auto organize: app/organize-strategies.mts's proposeOrganize over the ticked ground chests, or every one it ticks by default; the proposal carries the whole next setup, which the page saves with PUT /api/organize, naming `stamp`, the setup's when the proposal was worked out, as its base; read-only; 409 when organize.json needed salvage or the proposal would not save)
// - `GET /api/organize/plan` (app/organize.mts's planOrganize over the fold, organize.json, the blacklist and the results overlay `<data>/organize-state.json`, after reading finished trips out of the bridge's status.json; `running` = {id, index, queuedAt, picked} for the trip not reported back yet, or null)
// - `POST /api/organize/trip` {index, stamp} (queues that trip of the CURRENT plan with app/bridge-trip.mts's queueTrip; 409 when the client's bridge has no "trip", organize.json needed salvage, a trip has not reported back (while its bridge's heartbeat is fresh), stamp is not the plan's, or the trip is not its site's first)
// - `POST /api/move/plan` {selection, to?} or {back} (Move to, issue #270, app/move.mts; read-only: the selection's count, its worn items and how many of it sit directly in each container; `movable`, how many a trip can take, and `left`, the others by why they stay (worn, pack, bag, unreachable, gone; issue #271's Gather into a bag names them); with `to`, the plan into that container (`moving`, `serials` (the items that move, which the page then sends for the whole run), `trips`, `already`, `noRoom`, `left` by reason, and `against`, the moved items an Organize rule would take out again) or the `problem` that keeps it from being filled; with `back`, how many items Move back would return and which it skips). `selection` is `{serials?, query?, except?}`: serials, and every item matching an Inventory query string less the serials in `except`
// - `POST /api/move/trip` {selection, to} or {back: {serials, trips}} (plans the Move now and queues its first trip like POST /api/organize/trip, recorded as pending; `id` null when nothing is left to move; `noRoom` names the items no container on their way has room for; 409 when the client's bridge has no "trip", a trip has not reported back, or `to` cannot be filled. Move back sends each item to the container the overlay says that Move's trips took it from, while it is still where they put it)
// - Put away (issue #131; no route: the TazUO panel drops `inbox/<adapter>/putaway-request.json`, the watcher hands it to putAway, which queues the first trip of the plan for the container the player picked like POST /api/organize/trip and answers in `bridge/<adapter>/putaway.json`; app/put-away.mts)
//
// map: server
// owns: `routes`
import { isBoundedInt, isBoundedString, MAX_SERIAL } from "../../guards.mts";
import { againstRules, backSteps, destProblem, leftReason, MAX_SELECTION, planMoves, resolveSelection, type LeftReason, type MoveStep, type Selection } from "../../move.mts";
import { applyOverlay } from "../../organize.mts";
import { checkOrganizeConfig, LIMITS, matchProblem, MAX_SETUP_BYTES, salvagedRefusal, type RuleMatch } from "../../organize-config.mts";
import { PRESETS } from "../../organize-presets.mts";
import { proposeOrganize, STRATEGY_IDS, type StrategyId } from "../../organize-strategies.mts";
import type { OrganizePlanApiResponse, OrganizeProposeApiResponse, ProposeResult, OrganizeApiResponse, OrganizePutApiResponse, OrganizePresetsApiResponse, OrganizeMatchApiResponse, OrganizeTripApiResponse, MoveBackApiResponse, MovePlanApiResponse, MoveTripApiResponse } from "../../organize-types.mts";
import { matchCount } from "../../organize.mts";
import { readBody } from "../../read-body.mts";
import { send, asObject } from "../respond.mts";
import type { Route } from "../router.mts";
import type { ServerContext } from "../context.mts";

const serialList = (v: unknown): v is number[] => Array.isArray(v) && v.length <= MAX_SELECTION && v.every((s) => isBoundedInt(s, 1, MAX_SERIAL));
// A Move's selection as the page sends it (move.mts's Selection), or why it is refused.
function selectionOf(v: unknown): Selection | string {
  const o = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  const ok = (o.serials === undefined || serialList(o.serials)) && (o.query === undefined || isBoundedString(o.query, 8000)) && (o.except === undefined || serialList(o.except));
  if (ok && ((o.serials as number[] | undefined)?.length || o.query !== undefined)) return { serials: o.serials as number[] | undefined, query: o.query as string | undefined, except: o.except as number[] | undefined };
  return `selection must name serials (at most ${MAX_SELECTION}), an Inventory query, or both, with the serials a query leaves out in except`;
}

// Move back's request: the serials a Move moved and its trip ids, or why it is refused.
function backOf(v: unknown): { serials: number[]; trips: string[] } | string {
  const b = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  if (serialList(b.serials) && b.serials.length && Array.isArray(b.trips) && b.trips.length && b.trips.length <= MAX_SELECTION && b.trips.every((t) => isBoundedString(t, 64))) return { serials: b.serials, trips: b.trips as string[] };
  return "back must be {serials: [the moved serials], trips: [the Move's trip ids]}";
}

export function routes(ctx: ServerContext): Route[] {
  const { appSettings, eventBus, getInventory, organizeService, organizeStore, houseService, houseClaimsStore } = ctx;
  const blacklist = (): number[] => [...organizeService.blacklisted()];
  return [
    { method: "GET", path: "/api/organize", handle: (_req, res) => send(res, 200, { ok: true, ...organizeStore.read(), stamp: organizeStore.stamp() } satisfies OrganizeApiResponse) },
    { method: "PUT", path: "/api/organize", handle: async (req, res) => {
      // `base`: the stamp GET answered with. A setup saved by someone else since is refused (409, code "stale", with the
      // current stamp) and the file is left alone; a PUT without one (a page from an older build) is still taken.
      // compat: organize-put-no-base, remove in Pack Rat 0.3.0 (docs/architecture.md, Compatibility shims)
      const { base, ...doc } = asObject(await readBody(req, { limit: MAX_SETUP_BYTES, tooLargeMsg: "the Organize setup is too large" }));
      if (base !== undefined && !isBoundedString(base, 64)) return send(res, 400, { ok: false, error: "base must be the stamp GET /api/organize answered with" });
      const checked = checkOrganizeConfig(doc);
      if (!checked.ok) return send(res, 400, { ok: false, error: checked.error });
      // A blacklisted container is never opened by a scan, so a label on one could only plan from stale contents.
      const black = organizeService.blacklisted();
      const listed = Object.values(checked.config.labels).find((l) => black.has(l.serial));
      if (listed) return send(res, 400, { ok: false, error: `container ${listed.serial} is blacklisted and cannot be labeled` });
      const saved = organizeStore.write(checked.config, base as string | undefined);
      if (!saved.ok) return send(res, 409, { ok: false, code: "stale", error: "the Organize setup was changed elsewhere since it was read; reload it", stamp: saved.stamp });
      // Every other open page reloads the setup only, not the inventory (the page that saved sent its own id).
      eventBus.broadcast("changed", { what: "organize", by: req.headers["x-client-id"], at: Date.now() });
      return send(res, 200, { ok: true, stamp: saved.stamp } satisfies OrganizePutApiResponse);
    } },
    { method: "GET", path: "/api/organize/presets", handle: (_req, res) => send(res, 200, { ok: true, presets: PRESETS } satisfies OrganizePresetsApiResponse) },
    { method: "POST", path: "/api/organize/match", handle: async (req, res) => {
      // Room for the largest filter a rule may carry (100 names, three 50-name lists, 10 tags, 20 property rules).
      const { match } = asObject(await readBody(req, { limit: 64e3 }));
      const problem = matchProblem(match);
      if (problem) return send(res, 400, { ok: false, error: problem });
      const { inv } = await getInventory();
      const counted = matchCount(inv, organizeStore.read().config, match as RuleMatch, { now: Date.now(), rarity: appSettings.rules().rarity, suitPieces: organizeService.suitsFor([match as RuleMatch]), blacklist: blacklist() });
      return send(res, 200, { ok: true, ...counted } satisfies OrganizeMatchApiResponse);
    } },
    { method: "POST", path: "/api/organize/propose", handle: async (req, res) => {
      // Auto organize (spec §5): what a strategy would set up over the chests the player ticked (every one it ticks
      // by default when `containers` is left out). Read-only: Accept saves the proposal's config with PUT
      // /api/organize, naming as its base the `stamp` of the setup the proposal was worked out from. Refused, like trips, while organize.json needed salvage: the player sees what was dropped first.
      const { strategy, containers } = asObject(await readBody(req, { limit: 64e3 }));
      if (!STRATEGY_IDS.includes(strategy as StrategyId)) return send(res, 400, { ok: false, error: `strategy must be ${STRATEGY_IDS.map((s) => `"${s}"`).join(" or ")}` });
      if (containers !== undefined && !(Array.isArray(containers) && containers.length <= LIMITS.labels && containers.every((v) => isBoundedInt(v, 1, MAX_SERIAL)))) {
        return send(res, 400, { ok: false, error: "containers must be a list of container serials" });
      }
      const { fold, config, stamp, state, problems, features } = await organizeService.organizeNow();
      if (problems.length) return send(res, 409, { ok: false, error: salvagedRefusal(problems) });
      // `features`: what the bridge can do, as the plan Organize then shows decides it.
      const r = proposeOrganize(fold, config, state.moves, { strategy: strategy as StrategyId, containers: containers as number[] | undefined, ...organizeService.planContext(config, state), features });
      return r.ok ? send(res, 200, { ...r, stamp } satisfies OrganizeProposeApiResponse) : send(res, 409, r satisfies ProposeResult);
    } },
    { method: "GET", path: "/api/organize/plan", handle: async (_req, res) => {
      // `running`: the trip in flight, if any, so a page reloaded (or opened in a second window) mid-trip follows it.
      const { state, plan, bridges } = await organizeService.organizeNow();
      const p = state.pending[0];
      return send(res, 200, { ok: true, plan, running: p ? { id: p.id, index: p.index, queuedAt: p.queuedAt, picked: bridges[p.adapter]?.current === p.id } : null } satisfies OrganizePlanApiResponse);
    } },
    { method: "POST", path: "/api/organize/trip", handle: async (req, res) => {
      // One trip of the CURRENT plan, built here and queued with queueTrip: the page names the trip and the plan it
      // was shown (stamp), never the moves. A plan that changed since — a new scan, an edited rule, a trip that
      // reported back and renumbered the rest — is refused, and so is any trip but its site's first, which may
      // count on room an earlier trip makes.
      const { index, stamp } = asObject(await readBody(req, { limit: 8e3 }));
      if (!isBoundedInt(index, 1, 10000) || !isBoundedString(stamp, 64)) return send(res, 400, { ok: false, error: "index (a trip number) and stamp (the plan's) are required" });
      const adapter = appSettings.bridgeAdapter();
      const { fold, state, plan, problems, features } = await organizeService.organizeNow();
      if (!features.has("trip")) return send(res, 409, { ok: false, error: `the ${adapter} bridge cannot run Organize trips` });
      // A salvaged setup lost rules or targets, and their items may now fall through to another rule or the
      // catch-all: nothing moves until the player has seen that and saved the setup again.
      if (problems.length) return send(res, 409, { ok: false, error: salvagedRefusal(problems) });
      const waiting = state.pending[0];
      if (waiting) return send(res, 409, { ok: false, error: `trip ${waiting.index} has not reported back yet` });
      if (stamp !== plan.stamp) return send(res, 409, { ok: false, error: "the plan has changed since it was shown; reload it", stamp: plan.stamp });
      const trip = plan.trips.find((t) => t.index === index);
      if (!trip) return send(res, 404, { ok: false, error: `the plan has no trip ${index}` });
      const first = plan.trips.find((t) => t.site === trip.site)!;
      if (first.index !== index) return send(res, 409, { ok: false, error: `run trip ${first.index} first: this trip counts on the room it makes` });
      const queued = organizeService.queuePlanTrip(adapter, fold, state.moves, plan, index);
      if (!queued.ok) return send(res, 409, { ok: false, error: queued.error });
      return send(res, 200, { ok: true, id: queued.id, index } satisfies OrganizeTripApiResponse);
    } },
    { method: "POST", path: "/api/move/plan", handle: async (req, res) => {
      // What Move to would do with the selection (issue #270): how many items it holds and how many are worn, how many of
      // them sit directly in each container (the picker's "already here"), and, with `to`, the plan into that container:
      // how many move (and which: `serials`, what the page then sends so the run moves only what was shown) and in how many trips, which stay and why, and which of the moved ones Organize would take out again.
      // With `back` instead (Move back's request), how many items would go back and which are skipped. Read-only.
      const { selection, to, back } = asObject(await readBody(req, { limit: 256e3 }));
      if (back !== undefined) {
        const b = backOf(back);
        if (typeof b === "string") return send(res, 400, { ok: false, error: b });
        const { fold, state } = await organizeService.organizeInputs();
        const { steps, skipped } = backSteps(fold, state.moves, b.serials, b.trips);
        return send(res, 200, { ok: true, back: { movable: steps.length, skipped: skipped.map((x) => x.name) } } satisfies MoveBackApiResponse);
      }
      const sel = selectionOf(selection);
      if (typeof sel === "string") return send(res, 400, { ok: false, error: sel });
      if (to !== undefined && !isBoundedInt(to, 1, MAX_SERIAL)) return send(res, 400, { ok: false, error: "to must be a container serial" });
      const { inv, houses } = await getInventory();
      const items = resolveSelection(inv, sel, appSettings.rules().rarity, organizeStore.read().config.labels, houseService.houseOfContainers(inv, houses, houseClaimsStore.read()));
      const worn = items.filter((it) => it.equippedBy);
      // `movable`: the items a trip can take (in its destination's house or not); `here` counts only those; `left` counts the
      // others by why they stay (worn ones too, which `worn` also counts).
      const black = new Set(blacklist()), here: Record<string, number> = {}, left: Partial<Record<LeftReason, number>> = {};
      let movable = 0;
      for (const it of items) {
        const why = leftReason(inv, it, black);
        if (why) { left[why] = (left[why] ?? 0) + 1; continue; }
        movable++;
        here[it.container!] = (here[it.container!] ?? 0) + 1;
      }
      const base = { ok: true, selected: items.length, worn: worn.length, wornNames: worn.slice(0, 3).map((it) => it.name), movable, here, left };
      if (to === undefined) return send(res, 200, base satisfies MovePlanApiResponse);
      const { fold, config, state } = await organizeService.organizeInputs();
      const view = applyOverlay(fold, state.moves).inv;
      const problem = destProblem(view, to, blacklist());
      if (problem) return send(res, 200, { ...base, problem, plan: null } satisfies MovePlanApiResponse);
      const plan = planMoves(fold, state.moves, items.map((it) => ({ serial: +it.serial, to })), { blacklist: blacklist() });
      const planLeft: Partial<Record<LeftReason, number>> = {};
      for (const l of plan.left) planLeft[l.why] = (planLeft[l.why] ?? 0) + 1;
      const moved = plan.moves.map((m) => m.serial);
      const against = againstRules(view, config, moved, to, organizeService.planContext(config, state));
      return send(res, 200, { ...base, problem: null, plan: { moving: moved.length, serials: moved, trips: plan.trips.length, already: plan.already.length, noRoom: plan.noRoom.length, left: planLeft, against } } satisfies MovePlanApiResponse);
    } },
    { method: "POST", path: "/api/move/trip", handle: async (req, res) => {
      // The next trip of a Move, planned now and queued like an Organize trip: `selection` and `to` (Move to), or `back`, the
      // serials a Move moved and its trip ids (Move back: each item to the container the overlay says that Move took it from).
      // The page asks again after each trip that reports back clean, until nothing is left to move (`id` null).
      const { selection, to, back } = asObject(await readBody(req, { limit: 256e3 }));
      let steps: MoveStep[], skipped: Array<{ serial: number; name: string }> = [];
      const adapter = appSettings.bridgeAdapter();
      const { fold, state, features } = await organizeService.organizeInputs();
      if (back !== undefined) {
        const b = backOf(back);
        if (typeof b === "string") return send(res, 400, { ok: false, error: b });
        ({ steps, skipped } = backSteps(fold, state.moves, b.serials, b.trips));
      } else {
        const sel = selectionOf(selection);
        if (typeof sel === "string") return send(res, 400, { ok: false, error: sel });
        if (!isBoundedInt(to, 1, MAX_SERIAL)) return send(res, 400, { ok: false, error: "to must be a container serial" });
        const problem = destProblem(applyOverlay(fold, state.moves).inv, to, blacklist());
        if (problem) return send(res, 409, { ok: false, error: problem });
        const { inv, houses } = await getInventory();
        steps = resolveSelection(inv, sel, appSettings.rules().rarity, organizeStore.read().config.labels, houseService.houseOfContainers(inv, houses, houseClaimsStore.read())).map((it) => ({ serial: +it.serial, to }));
      }
      if (!features.has("trip")) return send(res, 409, { ok: false, error: `the ${adapter} bridge cannot run Organize trips` });
      const waiting = state.pending[0];
      if (waiting) return send(res, 409, { ok: false, error: `trip ${waiting.index} has not reported back yet` });
      const plan = planMoves(fold, state.moves, steps, { blacklist: blacklist() });
      const trip = plan.trips[0];
      // `noRoom`: the items no container on their way has room for (Move back's sources filled up since).
      const noRoom = plan.noRoom.map((serial) => ({ serial, name: fold.items[serial]?.name ?? `0x${serial.toString(16)}` }));
      if (!trip) return send(res, 200, { ok: true, id: null, remaining: 0, skipped, noRoom } satisfies MoveTripApiResponse);
      const queued = organizeService.queuePlanTrip(adapter, fold, state.moves, plan, trip.index);
      if (!queued.ok) return send(res, 409, { ok: false, error: queued.error });
      const names = Object.fromEntries(plan.moves.filter((m) => m.trip === trip.index).map((m) => [m.serial, m.name]));
      return send(res, 200, { ok: true, id: queued.id, index: trip.index, names, remaining: plan.moves.length, skipped, noRoom } satisfies MoveTripApiResponse);
    } },
  ];
}
