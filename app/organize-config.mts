// organize-config.mts — Organize's saved setup (issue #11), <data>/organize.json: which containers are labelled
// (the playing field), the ordered rules (first match wins), the catch-all, and the items that never move.
// Pure (no node: imports), so the page can share the types and the checks. checkOrganizeConfig refuses a
// document with any fault (PUT /api/organize replaces the whole file); salvageOrganizeConfig keeps every part
// of a hand-edited file that still makes sense and names what it dropped (every read).
import type { RuleQuery } from "./item-query.mts";
import type { SpellSchool } from "./vault-lib.mts";

export type Origin = "manual" | `strategy:${string}`;
export interface ContainerLabel { serial: number; name: string; color?: string | undefined; pinned?: boolean | undefined; origin: Origin }
// A rule's filter: the Inventory's item filters (never location, character or age: a rule must keep matching
// an item after it moves) and, optionally, "name is any of" (a substring of the item's name, stack count
// stripped, case-insensitive), and optionally a build (issue #91: the gear By build sorts into it, organize.mts's
// buildOf; never an item that is not gear), and optionally a spell school (issue #134: a spell scroll's, vault-lib's
// spellSchoolOf). All must pass. `skipSuits` (issue #133) leaves out every piece of a saved Suit Builder run, so a
// rule for gear the player never wants (an Undesirables rule) never takes a piece a suit counts on.
export type Build = "caster" | "melee" | "hybrid" | "tank" | "other";
export const BUILDS: readonly Build[] = ["caster", "melee", "hybrid", "tank", "other"];
export const SCHOOLS: readonly SpellSchool[] = ["magery", "necromancy", "mysticism", "spellweaving"];
export interface RuleMatch { query: RuleQuery; names?: string[] | undefined; build?: Build | undefined; school?: SpellSchool | undefined; skipSuits?: boolean | undefined }
// targets: labelled containers in fill order; when the first is full the next takes the overflow.
export interface OrganizeRule { id: string; name: string; match: RuleMatch; targets: number[]; origin: Origin }
// emptyBagsTo (issue #128, optional so every older organize.json still reads): the labelled container the plan
// gathers empty bags into, like a rule's one target; absent or null leaves them where they are.
export interface OrganizeConfig { version: 1; labels: Record<string, ContainerLabel>; rules: OrganizeRule[]; catchAll: number | null; emptyBagsTo?: number | null | undefined; pinnedItems: number[] }

// The ruleId the plan reports the catch-all's moves under, and the gathered empty bags' (issue #128); no rule may
// take either.
export const CATCH_ALL_ID = "catch-all";
export const EMPTY_BAGS_ID = "empty-bags";
export const LIMITS = { labels: 2000, rules: 200, targets: 20, names: 100, pinnedItems: 5000, text: 64, q: 200, list: 50, tags: 10, props: 20 } as const;
// Room for the largest setup LIMITS allows as the server saves it (pretty-printed, about 5.8 MB): the body limit of
// PUT /api/organize and the largest organize.json a read accepts.
export const MAX_SETUP_BYTES = 6e6;
const MAX_SERIAL = 0xFFFFFFFF;
const SERIAL_KEY = /^[1-9]\d{0,9}$/;
const RULE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const STRATEGY = /^strategy:[a-z0-9-]{1,32}$/;
const RULE_QUERY_KEYS = ["q", "slot", "rarity", "rarityMin", "rarityMax", "kind", "slayer", "nogarg", "med", "hideTags", "props"] as const;
// Filters added after rules were first saved, so a rule from before may leave them out.
const OPTIONAL_QUERY_KEYS = ["tags"] as const;

// Issue #150: crafting tools were tools until they got a kind of their own. An Auto setup saved before that (none of
// Auto's rules asks for the crafting kind) reads its rules for tools as taking crafting tools too, until Auto organize
// runs again; organize.json stays as saved, so a re-run compares against it. A player's own rule means what it says.
// The planner claims by this, and the rule editor opens an Auto rule with it, so its count and its save agree.
// Worked out once per rule list (the planner asks for every item; a setup's list is never changed in place).
const PRE_CRAFTING = new WeakMap<readonly OrganizeRule[], boolean>();
export function ruleMatchOf(r: OrganizeRule, rules: readonly OrganizeRule[]): RuleMatch {
  const kind = r.match.query.kind;
  if (r.origin === "manual" || !kind.includes("tool")) return r.match;
  let pre = PRE_CRAFTING.get(rules);
  if (pre === undefined) PRE_CRAFTING.set(rules, pre = !rules.some((x) => x.origin !== "manual" && x.match.query.kind.includes("crafting")));
  return pre ? { ...r.match, query: { ...r.match.query, kind: [...kind, "crafting"] } } : r.match;
}
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
  const bad = extra(q, [...RULE_QUERY_KEYS, ...OPTIONAL_QUERY_KEYS]);
  if (bad) return `${at}.${bad} is not a rule filter (location, character and age filters never belong in a rule)`;
  const missing = RULE_QUERY_KEYS.find((k) => !(k in q));
  if (missing) return `${at}.${missing} is missing`;
  if (typeof q.q !== "string" || q.q.length > LIMITS.q) return `${at}.q must be a string of at most ${LIMITS.q} characters`;
  for (const k of ["rarity", "rarityMin", "rarityMax", "slayer"] as const) {
    const v = q[k];
    if (typeof v !== "string" || v.length > LIMITS.text) return `${at}.${k} must be a string of at most 64 characters`;
  }
  for (const k of ["slot", "kind", "hideTags"] as const) if (!textList(q[k], LIMITS.list)) return `${at}.${k} must be a list of at most 50 names`;
  // A shard has a handful of tags (rules' tagUnits), so the list is capped well below the others.
  if (q.tags !== undefined && !textList(q.tags, LIMITS.tags)) return `${at}.tags must be a list of at most ${LIMITS.tags} tags`;
  for (const k of ["nogarg", "med"] as const) if (typeof q[k] !== "boolean") return `${at}.${k} must be true or false`;
  if (!Array.isArray(q.props) || q.props.length > LIMITS.props) return `${at}.props must be a list of at most ${LIMITS.props} property filters`;
  for (const [i, p] of q.props.entries()) {
    if (!isObj(p) || extra(p, ["key", "min", "op"]) || !isText(p.key) || typeof p.min !== "number" || !Number.isFinite(p.min)
      || (p.op !== undefined && p.op !== "le" && p.op !== "eq")) return `${at}.props[${i}] must be {key, min, op?: "le" | "eq"}`;
  }
  return null;
}

// A rule's filter on its own: what PUT /api/organize checks inside every rule, and POST /api/organize/match
// checks before counting what a filter being edited would take.
export function matchProblem(m: unknown, at = "match"): string | null {
  if (!isObj(m)) return `${at} must be an object`;
  const badM = extra(m, ["query", "names", "build", "school", "skipSuits"]);
  if (badM) return `${at}.${badM} is not a match field`;
  const qp = queryProblem(m.query, `${at}.query`);
  if (qp) return qp;
  if (m.names !== undefined && !textList(m.names, LIMITS.names)) return `${at}.names must be a list of at most ${LIMITS.names} names, each 1 to 64 characters`;
  if (m.build !== undefined && !BUILDS.includes(m.build as Build)) return `${at}.build must be one of ${BUILDS.join(", ")}`;
  if (m.school !== undefined && !SCHOOLS.includes(m.school as SpellSchool)) return `${at}.school must be one of ${SCHOOLS.join(", ")}`;
  if (m.skipSuits !== undefined && typeof m.skipSuits !== "boolean") return `${at}.skipSuits must be true or false`;
  return null;
}

// A rule's target is named with the rule (issue #123: pinning a chest an Auto rule fills is the usual way here, and
// the player knows the rule by its name, not its place in the list).
function containerProblem(v: unknown, labels: Record<string, ContainerLabel>, at: string, rule?: string): string | null {
  if (!isSerial(v) || !labels[String(v)]) return `${at}: ${short(v)} is not a labelled container`;
  if (labels[String(v)]!.pinned) {
    return rule != null ? `The rule "${rule}" puts items into ${labels[String(v)]!.name}, which is pinned: nothing is put into a pinned container. Take it off the rule, or unpin it.`
      : `${at}: ${v} is pinned, and nothing is put into a pinned container`;
  }
  return null;
}

function ruleProblem(r: unknown, i: number, labels: Record<string, ContainerLabel>): string | null {
  const at = `rules[${i}]`;
  if (!isObj(r)) return `${at} must be an object`;
  const bad = extra(r, ["id", "name", "match", "targets", "origin"]);
  if (bad) return `${at}.${bad} is not a rule field`;
  if (typeof r.id !== "string" || !RULE_ID.test(r.id)) return `${at}.id must be 1 to 64 letters, digits, - or _`;
  if (r.id === CATCH_ALL_ID || r.id === EMPTY_BAGS_ID) return `${at}.id "${r.id}" is reserved for the ${r.id === CATCH_ALL_ID ? "catch-all" : "empty bags"}`;
  if (!isText(r.name)) return `${at}.name must be 1 to 64 characters`;
  if (!isOrigin(r.origin)) return `${at}.origin must be "manual" or "strategy:<id>"`;
  const mp = matchProblem(r.match, `${at}.match`);
  if (mp) return mp;
  if (!Array.isArray(r.targets) || r.targets.length > LIMITS.targets) return `${at}.targets must be a list of at most ${LIMITS.targets} containers`;
  for (const t of r.targets) {
    const p = containerProblem(t, labels, `${at}.targets`, r.name);
    if (p) return p;
  }
  if (new Set(r.targets).size !== r.targets.length) return `${at}.targets lists a container twice`;
  return null;
}

const catchAllProblem = (v: unknown, labels: Record<string, ContainerLabel>, at = "catchAll"): string | null => (v === null ? null : containerProblem(v, labels, at));

export function checkOrganizeConfig(doc: unknown): { ok: true; config: OrganizeConfig } | { ok: false; error: string } {
  const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
  if (!isObj(doc)) return fail("an Organize setup must be an object");
  const bad = extra(doc, ["version", "labels", "rules", "catchAll", "emptyBagsTo", "pinnedItems"]);
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
  const cp = catchAllProblem(doc.catchAll, labels) ?? (doc.emptyBagsTo === undefined ? null : catchAllProblem(doc.emptyBagsTo, labels, "emptyBagsTo"));
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
  if (raw.emptyBagsTo !== undefined) {
    const bp = catchAllProblem(raw.emptyBagsTo, config.labels, "emptyBagsTo");
    if (bp) problems.push(`${bp}; empty bags left where they are`); else config.emptyBagsTo = raw.emptyBagsTo as number | null;
  }
  if (Array.isArray(raw.pinnedItems)) {
    config.pinnedItems = [...new Set(raw.pinnedItems.filter(isSerial))].slice(0, LIMITS.pinnedItems);
    const dropped = raw.pinnedItems.length - config.pinnedItems.length;
    if (dropped) problems.push(`pinnedItems: ${dropped} entries dropped (not item serials, or listed twice)`);
  } else if (raw.pinnedItems !== undefined) problems.push("pinnedItems must be a list; every pinned item dropped");
  return { config, problems };
}
