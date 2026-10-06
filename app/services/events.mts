// events.mts — Server-Sent Events: one event written to a stream, and the shared bus behind GET /api/events that tells every open page what changed (a scan accepted or rejected, the inventory or the runs changed).
import type http from "node:http";

export function sse(res: http.ServerResponse, event: string, data: unknown): void { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }

// Every response currently attached to GET /api/events, so a later accept/reject can broadcast to all of them.
export function createEventBus() {
  const clients = new Set<http.ServerResponse>();
  return {
    add: (res: http.ServerResponse): void => { clients.add(res); },
    remove: (res: http.ServerResponse): void => { clients.delete(res); },
    broadcast(event: string, data: unknown): void { for (const c of clients) sse(c, event, data); },
    // Ends every open stream (server.close() waits for each otherwise).
    close(): void { for (const c of clients) c.end(); clients.clear(); },
  };
}
export type EventBus = ReturnType<typeof createEventBus>;
