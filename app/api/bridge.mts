// bridge.mts — what the bridge routes answer (app/http/routes/bridge.mts): GET /api/bridge/status, the command a POST /api/bridge queued, and POST /api/bridge/stop's acknowledgement. Types only and node-free, so the routes `satisfies` these, the page re-exports them (app/ui/api-types.mts) and the route map names them (app/api/routes.mts).
//
// map: api
// owns: `BridgeCurrentCommand`, `TripStepResult`, `BridgeResultEntry`, `BridgeAdapterReport`, `BridgeStatusApiResponse`, `BridgeQueueApiResponse`

// GET /api/bridge/status: the bridge's status.json as app/bridge-status.mts reads it (the running command and each result
// checked to their shapes in bridge.v1.schema.json) with the `online` and `age` the server works out from it, or just
// {ok, online: false} with no status file.
export interface BridgeCurrentCommand {
  id?: string | undefined;           // the running command's id (a trip's, while Organize waits on it)
  action?: string | undefined;
  name?: string | undefined;
}
// One step of a trip's result (the bridge's trip action: every take and put it tried, in order).
// `op` is "take" or "put"; a newer bridge may name another, which the readers skip.
export interface TripStepResult { op: string; serial: number; ok: boolean; msg: string; ms?: number | undefined }
export interface BridgeResultEntry {
  ok: boolean;
  msg: string;
  t?: string | undefined;
  partial?: boolean | undefined;     // a trip whose take phase ended early (too heavy or too full)
  stopped?: boolean | undefined;     // a trip halted by the stop flag (POST /api/bridge/stop)
  steps?: TripStepResult[] | undefined;
  ms?: number | undefined;           // how long a trip took, in milliseconds (TazUO 2.9.0 onward)
}
// The running bridge itself (status.json's adapter; left out by bridges before TazUO 2.16.0 / Razor Enhanced 1.12.0).
export interface BridgeAdapterReport {
  id: string;
  version: string;
  protocol: number;
  features: string[];          // every action and feature it has
}
export interface BridgeStatusApiResponse {
  ok: boolean;
  online: boolean;
  age?: number | undefined;   // seconds since the bridge last wrote status.json
  character?: string | undefined;
  adapter?: BridgeAdapterReport | undefined;
  current?: BridgeCurrentCommand | null | undefined;
  results?: Record<string, BridgeResultEntry> | undefined;
}
// POST /api/bridge: the queued command's id.
export interface BridgeQueueApiResponse {
  ok: boolean;
  id: string;
}
