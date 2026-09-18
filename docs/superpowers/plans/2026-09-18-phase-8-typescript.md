# Phase 8 — TypeScript Migration (stub, not started)

> **Status: a stub.** This file records the approach and the constraints, so the shape is agreed before anyone starts. No migration work has been done.

**Goal:** move the codebase from plain JavaScript to TypeScript, incrementally, with the suite green at every step and no behaviour change — so the contracts this project already enforces by test and by hand are enforced by the compiler too.

**Why:** the app has grown into several modules with shared shapes — the scan document, the adapter capabilities, the bridge protocol, the optimizer's inputs and outputs, the settings file. Those shapes are currently kept honest by JSON Schema at the edges, by tests, and by review. A type checker catches the class of mistake that has actually cost this project time: a field renamed on one side of a handoff, a shape that drifted between a writer and its reader, a function returning a different thing than its caller assumed. `scripts/optimizer-core.ts` is already TypeScript, compiled by `scripts/build-core.mjs` through Node's own type stripping, so the pattern exists.

**Spec:** `docs/superpowers/specs/2026-09-12-desktop-app-public-release-design.md` §12 row 8.

## Constraints that shape the approach

- **The zero-dependency rule stands.** The runtime keeps exactly one dependency. TypeScript is a devDependency; nothing ships a compiler or a runtime shim to a player.
- **No build step for the browser.** The page loads `app/ui/*.mjs` directly from the server with no bundler, and that simplicity is worth keeping. Either the page's modules stay JavaScript with types supplied another way, or they are compiled ahead of time the way the optimizer core already is — that decision is the first thing to settle.
- **Node's own type stripping is the existing pattern.** It runs `.ts` directly, which is how the core and its tests work today. The migration should extend that rather than introduce a second toolchain.
- **Behaviour does not change.** A migration commit that fixes a bug hides the bug in the noise. Fixes go in their own commits, before or after.
- **The suite stays green at every commit**, and the test files migrate with the code they cover.

## Open questions to settle before starting

1. **The page.** Compile `app/ui/*.mjs` to JavaScript for serving, serve `.ts` through the existing type-stripping path, or leave the page in JavaScript with types from JSDoc and a checked build? Each trades simplicity for coverage differently.
2. **Strictness.** Start strict and fix everything, or start permissive and ratchet? Ratcheting is safer for a working app but tends to stall.
3. **The generated types.** The scan, bridge, rules and profile schemas are JSON Schema today. Types could be written by hand and checked against the schemas, or generated from them. Hand-written types that drift from their schema would be worse than none.
4. **The adapter scripts stay Python.** Not in scope; named here so nobody wonders.
5. **Order.** The shared contracts first (they are what the rest depends on), then the server, then the shell, then the page — or the leaves first, to learn on something small.

## Rough shape of the work

- Settle the five questions above, in a short design pass, before any file changes.
- Add the TypeScript devDependency, the compiler configuration, and a type-check step in CI that fails on an error.
- Migrate in dependency order, one coherent group per commit, tests moving with their code.
- Replace hand-maintained shape assertions with types where a type is genuinely stronger, and keep the runtime validation at the trust boundaries regardless — a type does nothing to a file written by a game client.
- End with the type check in CI on all three platforms, and a note in `CONTRIBUTING.md` about how to run it locally.

## Done when

- Every source file the project ships is TypeScript, or has a recorded reason to stay JavaScript.
- `npm test` and the type check both pass on all three platforms in CI.
- No new runtime dependency, and the page still loads without a bundler.
- No behaviour changed: the migration's commits are refactors, and anything else is its own commit.
