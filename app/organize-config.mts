// organize-config.mts — Organize's saved setup (issue #11), <data>/organize.json: which containers are labelled
// (the playing field), the ordered rules (first match wins), the catch-all, and the items that never move.
// Pure (no node: imports), so the page can share the types and the checks. checkOrganizeConfig refuses a
// document with any fault (PUT /api/organize replaces the whole file); salvageOrganizeConfig keeps every part
// of a hand-edited file that still makes sense and names what it dropped (every read).
import type { RuleQuery } from "./item-query.mts";

export type Origin = "manual" | `strategy:${string}`;
export interface ContainerLabel { serial: number; name: string; color?: string | undefined; pinned?: boolean | undefined; origin: Origin }
// A rule's filter: the Inventory's item filters (never location, character or age: a rule must keep matching
// an item after it moves) and, optionally, "name is any of" (a substring of the item's name, stack count
// stripped, case-insensitive). Both must pass.
export interface RuleMatch { query: RuleQuery; names?: string[] | undefined }
// targets: labelled containers in fill order; when the first is full the next takes the overflow.
export interface OrganizeRule { id: string; name: string; match: RuleMatch; targets: number[]; origin: Origin }
export interface OrganizeConfig { version: 1; labels: Record<string, ContainerLabel>; rules: OrganizeRule[]; catchAll: number | null; pinnedItems: number[] }

// The ruleId the plan reports the catch-all's moves under; no rule may take it.
export const CATCH_ALL_ID = "catch-all";
export const LIMITS = { labels: 2000, rules: 200, targets: 20, names: 100, pinnedItems: 5000, text: 64, q: 200, list: 50, props: 20 } as const;
// Room for the largest setup LIMITS allows as the server saves it (pretty-printed, about 5.6 MB): the body limit of
// PUT /api/organize and the largest organize.json a read accepts.
export const MAX_SETUP_BYTES = 6e6;
const MAX_SERIAL = 0xFFFFFFFF;
const SERIAL_KEY = /^[1-9]\d{0,9}$/;
const RULE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const STRATEGY = /^strategy:[a-z0-9-]{1,32}$/;
const RULE_QUERY_KEYS = ["q", "slot", "rarity", "rarityMin", "rarityMax", "kind", "slayer", "nogarg", "med", "hideTags", "props"] as const;

export function emptyOrganizeConfig(): OrganizeConfig { return { version: 1, labels: {}, rules: [], catchAll: null, pinnedItems: [] }; }
export function emptyRuleQuery(): RuleQuery {
  return { q: "", slot: [], rarity: "", rarityMin: "", rarityMax: "", kind: [], slayer: "", nogarg: false, med: false, hideTags: [], props: [] };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isSerial = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_SERIAL;
const isText = (v: unknown, max: number = LIMITS.text): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const isOrigin = (v: unknown): v is Origin => v === "manual" || (typeof v === "string" && STRATEGY.test(v));
const textList = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length <= max && v.every((s) => isText(s));
const extra = (o: Record<string, unknown>, allowed: readonly string[]): string | undefined => Object.keys(o).find((k) => !allowed.includes(k));
const short = (v: unknown): string => String(v).slice(0, 32);

function labelProblem(key: string, v: unknown): string | null {
  if (!SERIAL_KEY.test(key) || Number(key) > MAX_SERIAL) return `labels key ${JSON.stringify(key.slice(0, 20))} is not a container serial`;
  const at = `labels.${key}`;
  if (!isObj(v)) return `${at} must be an object`;
  const bad = extra(v, ["serial", "name", "color", "pinned", "origin"]);
  if (bad) return `${at}.${bad} is not a label field`;
  if (v.serial !== Number(key)) return `${at}.serial must be ${key}`;
  if (!isText(v.name)) return `${at}.name must be 1 to 64 characters`;
  if (v.color !== undefined && !(typeof v.color === "string" && COLOR.test(v.color))) return `${at}.color must be a #rrggbb colour`;
  if (v.pinned !== undefined && typeof v.pinned !== "boolean") return `${at}.pinned must be true or false`;
  if (!isOrigin(v.origin)) return `${at}.origin must be "manual" or "strategy:<id>"`;
  return null;
}

function queryProblem(q: unknown, at: string): string | null {
  if (!isObj(q)) return `${at} must be an object`;
  const bad = extra(q, RULE_QUERY_KEYS);
  if (bad) return `${at}.${bad} is not a rule filter (location, character and age filters never belong in a rule)`;
  const missing = RULE_QUERY_KEYS.find((k) => !(k in q));
  if (missing) return `${at}.${missing} is missing`;
  if (typeof q.q !== "string" || q.q.length > LIMITS.q) return `${at}.q must be a string of at most ${LIMITS.q} characters`;
  for (const k of ["rarity", "rarityMin", "rarityMax", "slayer"] as const) {
    const v = q[k];
    if (typeof v !== "string" || v.length > LIMITS.text) return `${at}.${k} must be a string of at most 64 characters`;
  }
  for (const k of ["slot", "kind", "hideTags"] as const) if (!textList(q[k], LIMITS.list)) return `${at}.${k} must be a list of at most 50 names`;
  for (const k of ["nogarg", "med"] as const) if (typeof q[k] !== "boolean") return `${at}.${k} must be true or false`;
  if (!Array.isArray(q.props) || q.props.length > LIMITS.props) return `${at}.props must be a list of at most ${LIMITS.props} property filters`;
  for (const [i, p] of q.props.entries()) {
    if (!isObj(p) || extra(p, ["key", "min", "op"]) || !isText(p.key) || typeof p.min !== "number" || !Number.isFinite(p.min)
      || (p.op !== undefined && p.op !== "le" && p.op !== "eq")) return `${at}.props[${i}] must be {key, min, op?: "le" | "eq"}`;
  }
  return null;
}

function containerProblem(v: unknown, labels: Record<string, ContainerLabel>, at: string): string | null {
  if (!isSerial(v) || !labels[String(v)]) return `${at}: ${short(v)} is not a labelled container`;
  if (labels[String(v)]!.pinned) return `${at}: ${v} is pinned, and nothing is put into a pinned container`;
  return null;
}

function ruleProblem(r: unknown, i: number, labels: Record<string, ContainerLabel>): string | null {
  const at = `rules[${i}]`;
  if (!isObj(r)) return `${at} must be an object`;
  const bad = extra(r, ["id", "name", "match", "targets", "origin"]);
  if (bad) return `${at}.${bad} is not a rule field`;
  if (typeof r.id !== "string" || !RULE_ID.test(r.id)) return `${at}.id must be 1 to 64 letters, digits, - or _`;
  if (r.id === CATCH_ALL_ID) return `${at}.id "${CATCH_ALL_ID}" is reserved for the catch-all`;
  if (!isText(r.name)) return `${at}.name must be 1 to 64 characters`;
  if (!isOrigin(r.origin)) return `${at}.origin must be "manual" or "strategy:<id>"`;
  const m = r.match;
  if (!isObj(m)) return `${at}.match must be an object`;
  const badM = extra(m, ["query", "names"]);
  if (badM) return `${at}.match.${badM} is not a match field`;
  const qp = queryProblem(m.query, `${at}.match.query`);
  if (qp) return qp;
  if (m.names !== undefined && !textList(m.names, LIMITS.names)) return `${at}.match.names must be a list of at most ${LIMITS.names} names, each 1 to 64 characters`;
  if (!Array.isArray(r.targets) || r.targets.length > LIMITS.targets) return `${at}.targets must be a list of at most ${LIMITS.targets} containers`;
  for (const t of r.targets) {
    const p = containerProblem(t, labels, `${at}.targets`);
    if (p) return p;
  }
  if (new Set(r.targets).size !== r.targets.length) return `${at}.targets lists a container twice`;
  return null;
}

const catchAllProblem = (v: unknown, labels: Record<string, ContainerLabel>): string | null => (v === null ? null : containerProblem(v, labels, "catchAll"));

export function checkOrganizeConfig(doc: unknown): { ok: true; config: OrganizeConfig } | { ok: false; error: string } {
  const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
  if (!isObj(doc)) return fail("an Organize setup must be an object");
  const bad = extra(doc, ["version", "labels", "rules", "catchAll", "pinnedItems"]);
  if (bad) return fail(`${bad} is not an Organize field`);
  if (doc.version !== 1) return fail("version must be 1");
  if (!isObj(doc.labels) || Object.keys(doc.labels).length > LIMITS.labels) return fail(`labels must be an object of at most ${LIMITS.labels} labels`);
  for (const [key, v] of Object.entries(doc.labels)) {
    const p = labelProblem(key, v);
    if (p) return fail(p);
  }
  const labels = doc.labels as Record<string, ContainerLabel>;
  if (!Array.isArray(doc.rules) || doc.rules.length > LIMITS.rules) return fail(`rules must be a list of at most ${LIMITS.rules} rules`);
  const ids = new Set<string>();
  for (const [i, r] of doc.rules.entries()) {
    const p = ruleProblem(r, i, labels);
    if (p) return fail(p);
    const id = (r as OrganizeRule).id;
    if (ids.has(id)) return fail(`rules[${i}].id "${id}" is used twice`);
    ids.add(id);
  }
  const cp = catchAllProblem(doc.catchAll, labels);
  if (cp) return fail(cp);
  const pinned = doc.pinnedItems;
  if (!Array.isArray(pinned) || pinned.length > LIMITS.pinnedItems || !pinned.every(isSerial) || new Set(pinned).size !== pinned.length) {
    return fail(`pinnedItems must be a list of at most ${LIMITS.pinnedItems} distinct item serials`);
  }
  return { ok: true, config: doc as unknown as OrganizeConfig };
}

export function salvageOrganizeConfig(raw: unknown): { config: OrganizeConfig; problems: string[] } {
  const config = emptyOrganizeConfig();
  if (!isObj(raw) || raw.version !== 1) return { config, problems: ["organize.json is not a version 1 Organize file; Organize starts empty"] };
  const problems: string[] = [];
  if (isObj(raw.labels)) {
    for (const [key, v] of Object.entries(raw.labels).slice(0, LIMITS.labels)) {
      const p = labelProblem(key, v);
      if (p) problems.push(`${p}; label dropped`); else config.labels[key] = v as ContainerLabel;
    }
    if (Object.keys(raw.labels).length > LIMITS.labels) problems.push(`labels past the first ${LIMITS.labels} dropped`);
  } else if (raw.labels !== undefined) problems.push("labels must be an object; every label dropped");
  if (Array.isArray(raw.rules)) {
    for (const [i, entry] of raw.rules.slice(0, LIMITS.rules).entries()) {
      // A target that is no longer a usable label (its label was dropped above, say) costs the rule that target,
      // not the whole rule.
      let r = entry;
      if (isObj(r) && Array.isArray(r.targets)) {
        const bad = r.targets.map((t) => containerProblem(t, config.labels, `rules[${i}].targets`)).filter((p): p is string => p !== null);
        for (const p of bad) problems.push(`${p}; target dropped`);
        if (bad.length) r = { ...r, targets: r.targets.filter((t) => !containerProblem(t, config.labels, "")) };
      }
      const p = ruleProblem(r, i, config.labels) ?? (config.rules.some((x) => x.id === (r as OrganizeRule).id) ? `rules[${i}].id is used twice` : null);
      if (p) problems.push(`${p}; rule dropped`); else config.rules.push(r as OrganizeRule);
    }
    if (raw.rules.length > LIMITS.rules) problems.push(`rules past the first ${LIMITS.rules} dropped`);
  } else if (raw.rules !== undefined) problems.push("rules must be a list; every rule dropped");
  const cp = raw.catchAll === undefined ? null : catchAllProblem(raw.catchAll, config.labels);
  if (cp) problems.push(`${cp}; catch-all cleared`); else config.catchAll = (raw.catchAll ?? null) as number | null;
  if (Array.isArray(raw.pinnedItems)) {
    config.pinnedItems = [...new Set(raw.pinnedItems.filter(isSerial))].slice(0, LIMITS.pinnedItems);
    const dropped = raw.pinnedItems.length - config.pinnedItems.length;
    if (dropped) problems.push(`pinnedItems: ${dropped} entries dropped (not item serials, or listed twice)`);
  } else if (raw.pinnedItems !== undefined) problems.push("pinnedItems must be a list; every pinned item dropped");
  return { config, problems };
}
