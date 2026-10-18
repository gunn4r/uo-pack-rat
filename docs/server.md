# The server

How Pack Rat's local HTTP server is layered, the rules every route, store and service keeps, where new code goes, and how to add each kind. The module map's Server and HTTP API contract sections list the modules; this page holds what the map cannot. `app/http/CLAUDE.md` is the short version an agent sees first.

Read with: `docs/module-map.md` (Server, HTTP API contract), `docs/change-checklists.md` ("Add an HTTP route", "Change the shape of a data file"), `docs/architecture.md` ("The server's request checks", "Data directory layout").

## Invariants

### The layers

```
app/ui/ (the page)        app/mcp-tools.mts (MCP tools, over loopback)
        │ fetch                    │ fetch
        ▼                          ▼
app/vault-server.mts      startServer: Host/Origin/token checks, dispatch, error → status, close()
        │ builds one ServerContext (app/http/context.mts) and the route table
        ▼
app/http/routes/<area>.mts   parse and check the request, call a store or service, send the answer
        │                         │
        ▼                         ▼
app/services/*.mts  ─────▶  app/store/*.mts  ─────▶  app/store/json-file.mts  ─────▶  the data folder
caches, jobs, work           one data file each        atomic write, bad-file policy,
spanning several stores                                 newer-file refusal, stamps

app/api/*.mts: node-free types for every route's answer and body, read by the routes, the page and the MCP tools.
Domain modules (app/vault-lib.mts, app/organize.mts, app/migrate.mts, …) hold the logic, and any layer imports them.
```

Each import rule and the `scripts/layering.test.mts` rule that enforces it:

| Rule | Enforced by |
| --- | --- |
| Nothing outside `app/ui/` imports from `app/ui/` | rule 1 |
| A browser-shared module (`tsconfig.browser.json`'s include, `app/api/` among them) reaches no `node:` module | rule 2 |
| No import cycles outside `app/ui/` | rule 3 |
| A module the page loads has its own static route in `app/http/routes/static.mts` | rule 4 |
| `app/store/` and `app/services/` import nothing from `app/http/`, type imports included | rule 5 |
| Only `electron/`, `scripts/`, the fixtures and the tests import `app/vault-server.mts` | rule 6 |
| A route module in `app/http/routes/` imports no other route module, type imports included | rule 11 |

Not enforced, kept by review: a service gets the stores and other services it uses as arguments from `startServer`, not by import (`services/builds.mts` imports only the `JobsService` type).

### The rules

1. **A data file is read and written through its store.** A route never opens a file in the data folder itself. Two exceptions remain while W3a (issue #338) moves them: `routes/bridge.mts` appends the bridge queue (#402 gives it one appender) and `routes/houses.mts` creates the house map's folder before its save. Loading a schema at module load and serving the page's own files (`routes/static.mts`) are not data-file access.
2. **No await between a read and its write.** One request runs at a time between awaits, so a read-modify-write with no await in it cannot lose another change. Write it as the store's `update(fn)` (`updater` in `app/store/json-file.mts`): `fn` is synchronous, gets the current state read-only and returns the next one, or undefined to write nothing. Await the body and the inventory before the call, never inside it.
3. **A file a newer Pack Rat made is read-only.** Its reader loads what this build understands and says so in a `readOnly` field (`newerNotice` in `app/migrate.mts`). Every save of it is refused with a 409 (`refuseNewer`), so nothing it could not read is lost. This holds for every kind in `DOC_KINDS`.
4. **A save that could overwrite another page's save is guarded by the file's content stamp** (`fileStamp`, 16 hex digits of its SHA-256). Either the client sends back the stamp it read, as `PUT /api/organize`'s `base`, and a changed file refuses the save with a 409. Or the client sends edits instead of the whole file, as `PATCH /api/profiles` does, and the server redoes them on the newer file (at most three times) and answers the stamps before (`was`) and after.
5. **Route modules keep no state between requests.** A cache or anything long-lived belongs in a service. The one exception is `updateCheckCache` in `routes/setup.mts`. A timer a route starts goes in `ctx.timers`, so `close()` stops it.
6. **Errors answer `{ ok: false, error }`.** A handler sends its 4xx itself, or throws an `HttpError` (an `Error` with a `statusCode`), which `startServer` answers with that status and the message. Anything else is a 500 "internal error" with a `ref` that points at the logged stack.
7. **Every body read has a size cap.** `readBody(req, { limit })` takes a cap (8e3 for a few fields, a document's own constant such as `MAX_SETUP_BYTES` for Organize's setup) and refuses a PUT or POST that does not declare JSON. `asObject` then refuses anything that is not a JSON object. `PUT /api/settings` takes 256 KB, far above its largest valid body.
8. **Every /api route has its entry in the route map, and its 200 answer `satisfies` the entry's type.** The map is `ApiRoutes` in `app/api/routes.mts`, keyed "METHOD /path" with each path parameter written `<name>`. The types live in the family modules beside it, `app/ui/api-types.mts` re-exports them for the page, and the MCP tools read them through `ApiResponse`. No entry is `Untyped` today, and a new one should not be.

## Extend it

### Where does X go

| You are adding | It goes in |
| --- | --- |
| An endpoint | its area's `app/http/routes/<area>.mts`; a new area is a new module added to the route table in `startServer` |
| A new data file | a store `app/store/<name>.mts` on `app/store/json-file.mts`, its path in `ConfigPaths` (`app/config.mts`), a `DOC_KINDS` entry if it carries a version, and a line in `docs/architecture.md`'s data folder layout |
| A cache that outlives one request, a background job, work spanning several stores | a service in `app/services/` |
| A response or body type | the family's `app/api/<family>.mts` (or the domain's `*-types.mts`), plus its `ApiRoutes` entry |
| Something both the page and the server run | a node-free module listed in `tsconfig.browser.json`, with its static route |
| Something a model should reach | a tool in `app/mcp-tools.mts`, which calls the route over loopback |
| A new field of a stored file | `docs/change-checklists.md`, "Change the shape of a data file" |

### Add a route

Best example: `app/http/routes/blacklist.mts`, three routes in about 30 lines covering a capped body read, field checks, `update(fn)`, a 409 and `satisfies` on every answer.

1. Add `{ method, path, handle }` to the area module's `routes(ctx)` list. A RegExp path starts with `^` (the guard requires it) and ends with `$` unless it is meant to match a prefix; a handler that answers `NEXT` passes the request to the next matching route.
2. Read the body with `asObject(await readBody(req, { limit }))` and check every field (`app/guards.mts`) before using it.
3. Reach files through `ctx`'s stores and services. Something new the handler needs goes on `ServerContext` and is built in `startServer`.
4. Answer with `send(res, 200, { ok: true, containers } satisfies BlacklistApiResponse)`, and add the "METHOD /path" entry to `ApiRoutes`.
5. List the route in the module's header comment (what it takes and answers), then work through the rest of "Add an HTTP route" in `docs/change-checklists.md`.

### Add a store

Best example: `app/store/organize.mts` (a versioned document with its newer-file and stamp handling). `app/store/blacklist.mts` is the smallest list store.

1. `create<Name>Store(file)` returns `read`, `write` and, if anything modifies it in place, `update: updater(read, write)`.
2. `read` goes through `readJsonFile` with a `maxBytes` and the bad-file policy the file needs: "empty" (salvage what is valid), "aside" (move a damaged file to `<file>.corrupt` so the next write cannot destroy it) or "skip" (throw, for one file in a folder).
3. `write` goes through `writeJsonFile` (folder made, atomic replace, the data folder's file mode). A versioned file calls `refuseNewer` first.
4. Add the path to `ConfigPaths`, build the store in `startServer`, and put it on `ServerContext`.

### Add a service

Best example: `app/services/inventory.mts`. It caches the fold by the scans folder's signature, takes narrow store shapes (`{ signature(), all() }`) rather than whole stores, and takes its clock as an argument.

1. `create<Name>Service({ … })` takes every store, service and clock it uses as arguments and returns its methods. Export the type the routes see (`<Name>Service`).
2. Keep `node:` I/O to what the cache key needs (a `statSync` for an mtime); files are still read and written through stores.
3. Build it in `startServer`, put it on `ServerContext`, and give it a timer only through the `timers` set.

## Tests

- **Stores**: `app/store/stores.test.mts` pins each store's size cap, its bad-file behavior and the exact bytes it writes. `app/store/json-file.test.mts` covers the base.
- **Services**: `app/services/<name>.test.mts`, over fakes of the stores they take.
- **Routes**: the family's `app/server-<family>.test.mts` (settings, setup, inventory, builder, import, host), `app/organize-server.test.mts`, `app/house-server.test.mts` or `app/mcp.test.mts`; `app/server.test.mts` for what every route shares. Start a real server on a temp data folder with `startTestServer` (`app/server-fixture.mts`). Shared response shapes and helpers live in `app/server-routes-fixture.mts`: add to it rather than copying a shape into a test.
- **Guards**: `scripts/api-routes.test.mts` (map and routes agree both ways, `FAN_OUT` for a handler serving several entries), `scripts/layering.test.mts` (the import rules above), `scripts/module-map.test.mts` (each route module's header lists its routes).

## Traps

- An async function passed to `update(fn)` fails the typecheck, since it returns a Promise. An `await` between a hand-written `read()` and `write()` is not caught by anything, and it loses changes.
- Route order is table order in `startServer`, and the first match that does not answer `NEXT` wins. A broad RegExp placed early swallows a later, more specific route.
- A POST, PUT or PATCH with no fields still needs the JSON content type: `readBody` answers 415 without it. An empty body reads as `{}`, so check required fields yourself.
- `send()` sets the security headers. A streaming route writes its own head with `SSE_HEADERS` and never calls `send()`.
- A route map key's `<name>` is sampled as "123" by `scripts/api-routes.test.mts`, so a parameter with another shape (a UUID, a house id) needs that test's sample widened.
- A handler that serves several methods or paths needs every one of its entries in `FAN_OUT`, or the guard reports entries with no route.
