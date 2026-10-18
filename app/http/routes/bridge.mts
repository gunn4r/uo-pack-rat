// bridge.mts — the in-game bridge: POST /api/bridge, POST /api/bridge/stop and GET /api/bridge/status.
//
// The routes, what each takes and answers:
// - `POST /api/bridge` {action, serial, name, chain: [root…parent], pos|null} (queue for packrat-bridge.py)
// - `GET /api/bridge/status`
// - `POST /api/bridge/stop` {} (Organize's Stop: writes `<data>/bridge/stop`, which packrat-bridge.py checks between a trip's steps)
//
// map: server
// owns: `routes`
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRIDGE_PROTOCOL } from "../../bridge-contract.mts";
import { readBridgeStatus } from "../../bridge-status.mts";
import { isBoundedString } from "../../guards.mts";
import { addGrab } from "../../organize-state.mts";
import { readBody } from "../../read-body.mts";
import { appendCommand, writeStop } from "../../store/bridge.mts";
import { validate, type ValidatorSchema } from "../../schema/validate.mts";
import { send, asObject } from "../respond.mts";
import { APP_DIR } from "../../config.mts";
import type { Route } from "../router.mts";
import type { OkApiResponse } from "../../api/routes.mts";
import type { BridgeQueueApiResponse, BridgeStatusApiResponse } from "../../api/bridge.mts";
import type { ServerContext } from "../context.mts";

const HERE = APP_DIR;
const BRIDGE_SCHEMA = JSON.parse(readFileSync(join(HERE, "schema", "bridge.v1.schema.json"), "utf8")) as { command: ValidatorSchema; scan: ValidatorSchema };

export function routes(ctx: ServerContext): Route[] {
  const { config: CONFIG, appSettings, organizeService, organizeStateStore } = ctx;
  return [
    { method: "POST", path: "/api/bridge", handle: async (req, res) => {
      // queue a command for packrat-bridge.py: {action, serial, name, chain: [root…parent], pos|null}, or {action: "scan", script}
      const cmd = asObject(await readBody(req, { limit: 64e3, tooLargeMsg: "bridge command too large" }));
      // A scan (issue #281) starts one of the client's scan scripts: no item, so a line of its own shape, queued like
      // every other command below.
      if (cmd.action === "scan") {
        const line = { id: randomUUID(), action: "scan", script: cmd.script, queuedAt: new Date().toISOString(), protocol: BRIDGE_PROTOCOL };
        const { ok, errors } = validate(BRIDGE_SCHEMA.scan, line);
        if (!ok) return send(res, 400, { ok: false, error: `${errors[0]!.path} ${errors[0]!.msg}`, errors });
        const adapter = appSettings.bridgeAdapter();
        appendCommand(CONFIG.paths, adapter, JSON.stringify(line));
        return send(res, 200, { ok: true, id: line.id } satisfies BridgeQueueApiResponse);
      }
      // Cheap bounded checks in front of the schema (post-review fix, Minor 9): a 500,000-character
      // name once took queue.jsonl to half a megabyte in one request. These are loose outer bounds on
      // what is even worth assembling; the contract's own, tighter limits (name maxLength 120, chain
      // maxItems 8 — the adapters' MAX_NAME/MAX_CHAIN) are enforced by the validate() call below,
      // now that app/schema/validate.mts implements both keywords.
      if (!isBoundedString(cmd.name, 200)) return send(res, 400, { ok: false, error: "name must be a string of at most 200 characters" });
      if (cmd.chain != null && (!Array.isArray(cmd.chain) || cmd.chain.length > 16)) return send(res, 400, { ok: false, error: "chain must be an array of at most 16 serials" });
      const id = randomUUID();
      // Copy exactly the documented fields into the queue line — the page may send extras (e.g. a
      // human-readable location string) that the bridge does not need and should not carry forward.
      const line = { id, action: cmd.action, serial: cmd.serial, name: cmd.name, chain: cmd.chain || [], pos: cmd.pos ?? null, queuedAt: new Date().toISOString(), protocol: BRIDGE_PROTOCOL };
      // Enforce the bridge contract at the only place the app writes it (post-review fix): a page
      // bug, or any other local caller, could otherwise queue a line that violates
      // BRIDGE_SCHEMA.command (unknown action, non-integer serial/chain entries, missing name) —
      // packrat-bridge.py refuses an unknown action itself, but the contract is the
      // deliverable, and it was unenforced at the only place the app writes it.
      const { ok, errors } = validate(BRIDGE_SCHEMA.command, line);
      if (!ok) return send(res, 400, { ok: false, error: `${errors[0]!.path} ${errors[0]!.msg}`, errors });
      // Queue into the CONFIGURED client's own bridge directory (appSettings.bridgeAdapter(), above) — not a
      // fixed "tazuo" — so a Razor Enhanced player's Highlight/Grab/Go-to buttons reach the bridge
      // script that's actually reading commands (Phase 6 final review follow-up).
      // pos is `object|null` in the contract with no shape of its own, so the assembled line is
      // size-checked once at the end — the only bound the field-level checks above can't give.
      const text = JSON.stringify(line);
      if (text.length + 1 > 4096) return send(res, 400, { ok: false, error: "bridge command too large" });   // with its newline
      const adapter = appSettings.bridgeAdapter();
      appendCommand(CONFIG.paths, adapter, text);
      // A Grab is remembered like a trip (issue #148), so when it reports back the item reads as in the backpack
      // and the container it left has that slot free again (harvestTrips), until a scan says otherwise.
      if (line.action === "grab") {
        organizeStateStore.update((state) => addGrab(state, { id, adapter, serial: line.serial as number, name: line.name as string, from: (line.chain as number[]).at(-1) ?? null, queuedAt: line.queuedAt }));
      }
      return send(res, 200, { ok: true, id } satisfies BridgeQueueApiResponse);
    } },
    { method: "POST", path: "/api/bridge/stop", handle: async (req, res) => {
      // Organize's Stop: the flag packrat-bridge.py checks between the steps of a trip. No fields;
      // the body is still read so the content-type and shape checks apply like every other POST.
      asObject(await readBody(req, { limit: 8e3 }));
      writeStop(CONFIG.paths);
      return send(res, 200, { ok: true } satisfies OkApiResponse);
    } },
    { method: "GET", path: "/api/bridge/status", handle: (_req, res) => {
      organizeService.harvestNow(Date.now());
      // readBridgeStatus is the one reader of status.json: a missing, unreadable or off-schema file reads as offline.
      const { status, online, age } = readBridgeStatus(CONFIG.paths.bridgeStatusFor(appSettings.bridgeAdapter()), Date.now());
      if (!status) return send(res, 200, { ok: true, online: false } satisfies BridgeStatusApiResponse);
      // The file's own fields go first, so a stray ok/online/age in a hand-edited or foreign file can never override
      // what this server computed.
      return send(res, 200, { ...status, ok: true, online, age: Math.round(age) } satisfies BridgeStatusApiResponse);
    } },
  ];
}
