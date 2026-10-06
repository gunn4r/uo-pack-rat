// organize.mts — Organize: GET|PUT /api/organize, GET /api/organize/presets, POST /api/organize/match and /api/organize/propose, GET /api/organize/plan and POST /api/organize/trip.
import { isBoundedInt, isBoundedString, MAX_SERIAL } from "../../guards.mts";
import { checkOrganizeConfig, LIMITS, matchProblem, MAX_SETUP_BYTES, type RuleMatch } from "../../organize-config.mts";
import { PRESETS } from "../../organize-presets.mts";
import { proposeOrganize, STRATEGY_IDS, type StrategyId } from "../../organize-strategies.mts";
import type { OrganizePlanApiResponse, ProposeResult } from "../../organize-types.mts";
import { matchCount } from "../../organize.mts";
import { readBody } from "../../read-body.mts";
import { send, asObject } from "../respond.mts";
import type { Route } from "../router.mts";
import type { ServerContext } from "../context.mts";

export function routes(ctx: ServerContext): Route[] {
  const { appSettings, blacklistStore, getInventory, organizeService, organizeStore } = ctx;
  return [
    { method: "GET", path: "/api/organize", handle: (_req, res) => send(res, 200, { ok: true, ...organizeStore.read() }) },
    { method: "PUT", path: "/api/organize", handle: async (req, res) => {
      const checked = checkOrganizeConfig(await readBody(req, { limit: MAX_SETUP_BYTES, tooLargeMsg: "the Organize setup is too large" }));
      if (!checked.ok) return send(res, 400, { ok: false, error: checked.error });
      // A blacklisted container is never opened by a scan, so a label on one could only plan from stale contents.
      const black = new Set(blacklistStore.read().map((e) => e.serial));
      const listed = Object.values(checked.config.labels).find((l) => black.has(l.serial));
      if (listed) return send(res, 400, { ok: false, error: `container ${listed.serial} is blacklisted and cannot be labeled` });
      organizeStore.write(checked.config);
      return send(res, 200, { ok: true });
    } },
    { method: "GET", path: "/api/organize/presets", handle: (_req, res) => send(res, 200, { ok: true, presets: PRESETS }) },
    { method: "POST", path: "/api/organize/match", handle: async (req, res) => {
      // Room for the largest filter a rule may carry (100 names, three 50-name lists, 10 tags, 20 property rules).
      const { match } = asObject(await readBody(req, { limit: 64e3 }));
      const problem = matchProblem(match);
      if (problem) return send(res, 400, { ok: false, error: problem });
      const { inv } = await getInventory();
      const counted = matchCount(inv, organizeStore.read().config, match as RuleMatch, { now: Date.now(), rarity: appSettings.rules().rarity, suitPieces: organizeService.suitsFor([match as RuleMatch]), blacklist: blacklistStore.read().map((e) => e.serial) });
      return send(res, 200, { ok: true, ...counted });
    } },
    { method: "POST", path: "/api/organize/propose", handle: async (req, res) => {
      // Auto organize (spec §5): what a strategy would set up over the chests the player ticked (every one it ticks
      // by default when `containers` is left out). Read-only: Accept saves the proposal's config with PUT
      // /api/organize. Refused, like trips, while organize.json needed salvage: the player sees what was dropped first.
      const { strategy, containers } = asObject(await readBody(req, { limit: 64e3 }));
      if (!STRATEGY_IDS.includes(strategy as StrategyId)) return send(res, 400, { ok: false, error: `strategy must be ${STRATEGY_IDS.map((s) => `"${s}"`).join(" or ")}` });
      if (containers !== undefined && !(Array.isArray(containers) && containers.length <= LIMITS.labels && containers.every((v) => isBoundedInt(v, 1, MAX_SERIAL)))) {
        return send(res, 400, { ok: false, error: "containers must be a list of container serials" });
      }
      const { fold, config, state, problems, features } = await organizeService.organizeNow();
      if (problems.length) return send(res, 409, { ok: false, error: `organize.json was hand-edited and parts of it were dropped (${problems[0]}); open Organize and save the setup first` });
      // `features`: what the bridge can do, as the plan Organize then shows decides it.
      const r = proposeOrganize(fold, config, state.moves, { strategy: strategy as StrategyId, containers: containers as number[] | undefined, now: Date.now(), rarity: appSettings.rules().rarity, suitPieces: organizeService.suitsFor(config.rules.map((r) => r.match)), blacklist: blacklistStore.read().map((e) => e.serial), seen: state.seen, features });
      return send(res, r.ok ? 200 : 409, r satisfies ProposeResult);
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
      if (problems.length) return send(res, 409, { ok: false, error: `organize.json was hand-edited and parts of it were dropped (${problems[0]}); open Organize and save the setup first` });
      const waiting = state.pending[0];
      if (waiting) return send(res, 409, { ok: false, error: `trip ${waiting.index} has not reported back yet` });
      if (stamp !== plan.stamp) return send(res, 409, { ok: false, error: "the plan has changed since it was shown; reload it", stamp: plan.stamp });
      const trip = plan.trips.find((t) => t.index === index);
      if (!trip) return send(res, 404, { ok: false, error: `the plan has no trip ${index}` });
      const first = plan.trips.find((t) => t.site === trip.site)!;
      if (first.index !== index) return send(res, 409, { ok: false, error: `run trip ${first.index} first: this trip counts on the room it makes` });
      const queued = organizeService.queuePlanTrip(adapter, fold, state, plan, index);
      if (!queued.ok) return send(res, 409, { ok: false, error: queued.error });
      return send(res, 200, { ok: true, id: queued.id, index });
    } },
  ];
}
