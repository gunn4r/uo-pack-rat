// config.mts — every path the server, bench and adapters agree on, resolved once.
//   data dir: --data <dir>  →  PACKRAT_DATA  →  ~/.pack-rat
//   port:     --port N      →  PACKRAT_PORT  →  8765
//   token:    --token <t>   →  PACKRAT_TOKEN →  null (no auth — the bare loopback server's default)
//   adapters: --adapters <dir> → PACKRAT_ADAPTERS_DIR → <repo>/adapters (real ones; tests point elsewhere)
//   --demo   serve app/fixtures instead of <data>/scans     --open   open the browser after listening
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_SHARD } from "./rules.mts";

export const APP_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = dirname(APP_DIR);
export const DEFAULT_PORT = 8765;

// The paths every caller agrees on, computed once by resolveConfig(). bridgeFor/bridgeQueueFor/
// bridgeStatusFor and inboxFor are per-adapter resolvers (see the comments on bridgeRoot/inbox
// below, inside resolveConfig); every other key is a single fixed path.
export interface ConfigPaths {
  scans: string;
  profiles: string;
  defaultProfiles: string;
  settings: string;
  rules: string;
  runs: string;
  bridge: string;
  bridgeQueue: string;
  bridgeStatus: string;
  bridgeFor: (adapter: string) => string;
  bridgeQueueFor: (adapter: string) => string;
  bridgeStatusFor: (adapter: string) => string;
  logs: string;
  log: string;
  core: string;
  adaptersDir: string;
  inbox: string;
  inboxFor: (adapter: string) => string;
}

export interface Config {
  dataDir: string;
  port: number;
  demo: boolean;
  open: boolean;
  token: string | null;
  paths: ConfigPaths;
}

function flag(argv: string[], name: string): string | null { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null; }

// corePath: where the optimizer core module lives — scripts/optimizer-core.mts by default (Node runs
// it straight from source, no build step; see CONTRIBUTING.md), or PACKRAT_CORE when a caller wants
// to point at an alternate build without touching this file. Its own exported function, not inlined
// into resolveConfig's return, so every caller that needs the path before a full config object exists
// (tests, the bench) resolves it the same one way `paths.core` below does.
export function corePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PACKRAT_CORE ? resolve(env.PACKRAT_CORE) : join(ROOT_DIR, "scripts", "optimizer-core.mts");
}

export function resolveConfig(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env, home: string = homedir()): Config {
  const dataDir = resolve(flag(argv, "--data") || env.PACKRAT_DATA || join(home, ".pack-rat"));
  const rawPort = flag(argv, "--port") || env.PACKRAT_PORT || DEFAULT_PORT;
  const port = Number.parseInt(rawPort as string, 10);   // rawPort can be the number DEFAULT_PORT; parseInt ToString-coerces a non-string argument at runtime regardless, so this cast is compiler-only
  // 0 is a valid port: it asks the OS to assign a free one (read back from server.address().port).
  if (!Number.isInteger(port) || port < 0 || port > 65535 || String(rawPort).trim() !== String(port)) {
    throw new Error(`invalid port "${rawPort}" — use --port N or PACKRAT_PORT with 0..65535`);
  }
  const demo = argv.includes("--demo"), open = argv.includes("--open");
  const token = flag(argv, "--token") || env.PACKRAT_TOKEN || null;
  // Sibling of app/ at the repo root by default (every adapters/<id>/ directory that ships a
  // capabilities.json is one adapter the server watches/offers) — overridable the same way
  // PACKRAT_CORE is, so a test can point a real running server at a throwaway folder of fixture
  // adapters instead of the repo's real ones.
  const adaptersDir = resolve(flag(argv, "--adapters") || env.PACKRAT_ADAPTERS_DIR || join(APP_DIR, "..", "adapters"));
  // bridgeRoot/bridgeFor: each adapter gets its own <dataDir>/bridge/<adapter>/ directory, the same
  // shape as inbox/inboxFor just below — a Razor Enhanced player's packrat-bridge.py already reads
  // and writes bridge/razor-enhanced/ on its own (its own header literal, verified against the real
  // script, not assumed), so the app-side routes just need to point at the SAME adapter's directory
  // instead of a fixed one (Phase 6 final review follow-up: the bridge queue/status routes were
  // hard-coded to "tazuo" regardless of which client was actually configured, so a Razor Enhanced
  // player's Highlight/Grab/Go-to buttons queued commands into a folder that adapter's bridge script
  // never reads — a silent no-op, exactly what capability-driven buttons exist to prevent).
  const bridgeRoot = join(dataDir, "bridge");
  // bridge/bridgeQueue/bridgeStatus: kept as their own top-level keys, unchanged in value, for
  // whatever still reads them directly — they are exactly bridgeFor("tazuo")'s own paths (this is
  // also why an existing TazUO player needs no data migration: "tazuo" was always the literal
  // component this path used, so a per-adapter resolver keyed by adapter id reproduces the identical
  // path for that one adapter without moving anything on disk).
  const bridge = join(bridgeRoot, "tazuo");
  const logs = join(dataDir, "logs");
  const inbox = join(dataDir, "inbox");
  return {
    dataDir, port, demo, open, token,
    paths: {
      scans: demo ? join(APP_DIR, "fixtures") : join(dataDir, "scans"),
      profiles: join(dataDir, "profiles.json"),
      defaultProfiles: join(APP_DIR, "data", "profiles.default.json"),
      settings: join(dataDir, "settings.json"),
      rules: join(dataDir, "rules"),   // user-defined/overriding shard rules files; app/rules/ is the builtin set
      runs: join(dataDir, "runs"),
      bridge, bridgeQueue: join(bridge, "queue.jsonl"), bridgeStatus: join(bridge, "status.json"),
      // bridgeFor(adapter): the directory; bridgeQueueFor/bridgeStatusFor: the two files inside it.
      // Callers (app/vault-server.mjs's bridge routes, and POST /api/setup/install's running-bridge
      // guard) resolve these against whichever adapter is actually relevant to that request, not a
      // constant captured once at server startup.
      bridgeFor: (adapter: string) => join(bridgeRoot, adapter),
      bridgeQueueFor: (adapter: string) => join(bridgeRoot, adapter, "queue.jsonl"),
      bridgeStatusFor: (adapter: string) => join(bridgeRoot, adapter, "status.json"),
      logs, log: join(logs, "server.log"),   // logs = the directory (ensureLayout creates it); log = the one file 500s append to
      core: corePath(env),
      adaptersDir,
      // inbox: where each adapter drops raw scan files (temp-then-rename) for the watcher to
      // normalise into paths.scans. The per-adapter dead-letter spot a file lands in after it keeps
      // failing to parse/validate is computed by app/watcher.mjs itself (join(inboxDir, "rejected")),
      // not exposed here — nothing outside the watcher needs it.
      inbox, inboxFor: (adapter: string) => join(inbox, adapter),
    },
  };
}

export function ensureLayout(config: Config): Config {
  for (const p of [config.dataDir, config.paths.runs, config.paths.bridge, config.paths.logs]) mkdirSync(p, { recursive: true });
  if (!config.demo) mkdirSync(config.paths.scans, { recursive: true });
  mkdirSync(config.paths.inboxFor("tazuo"), { recursive: true });
  if (!existsSync(config.paths.settings)) writeFileSync(config.paths.settings, JSON.stringify({ schemaVersion: 1, shard: DEFAULT_SHARD }, null, 2) + "\n");
  return config;
}
