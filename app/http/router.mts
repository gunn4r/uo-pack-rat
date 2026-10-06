// router.mts — the route table: each route a method and a path (a string matched exactly, or a RegExp), tried in table order. A route's handler may answer NEXT to pass the request on, as the old if-chain fell through; a request no route answers is the server's 404 "not found" (never a 405).
import type http from "node:http";
import type { ServerContext } from "./context.mts";

// What a handler returns to pass the request to the next matching route.
export const NEXT: unique symbol = Symbol("next route");
export type Handled = void | typeof NEXT;

export interface Route {
  method: string;   // "*" matches any method
  path: string | RegExp;
  // `match` is the RegExp's match, or [pathname] for a string path.
  handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, match: RegExpMatchArray, ctx: ServerContext): Handled | Promise<Handled>;
}

// Runs the first route whose method and path match and that does not answer NEXT. False when none answered.
export async function dispatch(routes: Route[], req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: ServerContext): Promise<boolean> {
  for (const route of routes) {
    if (route.method !== "*" && route.method !== req.method) continue;
    const match = typeof route.path === "string" ? (url.pathname === route.path ? [url.pathname] as RegExpMatchArray : null) : url.pathname.match(route.path);
    if (!match) continue;
    if (await route.handle(req, res, url, match, ctx) !== NEXT) return true;
  }
  return false;
}
