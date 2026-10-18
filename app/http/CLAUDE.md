# The server: routes, stores and services

The short guide to `app/http/`, `app/store/` and `app/services/`. `docs/server.md` has the full version: the layer picture, each rule's reason, the "where does X go" table and the three recipes.

## Read with:

`docs/server.md`; `docs/module-map.md` (Server, HTTP API contract); `docs/change-checklists.md` ("Add an HTTP route", "Change the shape of a data file").

## Invariants

- A route reads and writes data files only through its store in `app/store/`. A store or service imports nothing from `app/http/` (layering rule 5).
- A read-modify-write has no await between the read and the write. Use the store's `update(fn)` with a synchronous `fn`, and await the body before it.
- A file a newer Pack Rat made is read-only: its reader says `readOnly`, and every save of it answers 409 (`refuseNewer`).
- A save that could overwrite another one names the content stamp it read (Organize's `base`), or sends edits the server redoes on the newer file (`PATCH /api/profiles`).
- Route modules keep no state between requests (the one exception is `updateCheckCache`). Caches and jobs go in a service, and timers go in `ctx.timers`.
- Errors answer `{ ok: false, error }`; a thrown `HttpError` carries its status.
- Every body read passes a `limit` to `readBody`, then `asObject`, then a check of each field.
- Every /api route has its `ApiRoutes` entry in `app/api/routes.mts`, and its 200 answer `satisfies` that entry's type.

## Extend it

- A route: the area's module in `app/http/routes/`; copy `app/http/routes/blacklist.mts`.
- A data file: a new store on `app/store/json-file.mts`; copy `app/store/organize.mts` (versioned) or `app/store/blacklist.mts` (a list).
- Anything cached or long-lived: a service; copy `app/services/inventory.mts`.
- Wire the new store or service in `startServer` (`app/vault-server.mts`) and put it on `ServerContext` (`app/http/context.mts`).

## Tests

- Stores: `app/store/stores.test.mts`. Services: `app/services/<name>.test.mts`.
- Routes: the family's `app/server-<family>.test.mts` (or `app/organize-server.test.mts`, `app/house-server.test.mts`, `app/mcp.test.mts`), on a real server from `startTestServer`.
- Guards: `scripts/api-routes.test.mts`, `scripts/layering.test.mts`, `scripts/module-map.test.mts` (a route module's header lists its routes).

## Traps

- Route order is table order; a broad RegExp early in the table swallows later routes.
- A POST, PUT or PATCH with no fields still needs the JSON content type (415 otherwise).
- A handler that answers several methods or paths needs a `FAN_OUT` entry in `scripts/api-routes.test.mts`.
- A streaming route writes `SSE_HEADERS` itself; `send()` is for everything else.
