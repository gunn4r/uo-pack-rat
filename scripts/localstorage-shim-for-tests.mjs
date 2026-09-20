// localstorage-shim-for-tests.mjs — a minimal globalThis.localStorage stub, side-
// exports). Import statements are hoisted above every other top-level statement in an ES module, so a
// plain `globalThis.localStorage = ...` line written ABOVE a static `import` in the same file still
// runs AFTER that import's module graph has already evaluated — too late for app/ui/store.mjs's own
// module-scope `localStorage.getItem` read. Importing this file FIRST (as its own module, with no
// dependencies of its own) puts the stub in place before anything that imports it afterward evaluates.
// See app/bridge-adapter-fallback.test.mjs for the case this exists for.
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
