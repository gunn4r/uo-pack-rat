# Shard rules

Everything that is shard-specific rather than OSI-standard — property caps, the Resisting Spells resist minimum, race-specific overrides, tag penalties, the rarity ladder, the gargoyle race lock, and which skills are "free" (outside the 720-point cap) — lives in one JSON file per shard, never hardcoded in the app. This document explains every key, how to add your own shard (or override a builtin one) without touching the app's code, and works the resist minimum formula by hand.

Ground truth: `app/schema/rules.v1.schema.json` (the contract every rules file is checked against), `app/rules/uoalive.json` and `app/rules/generic-osi.json` (the two builtins), `app/rules.mts` (the loader), and `app/vault-lib.mts` (`minResistAt`, `resistMinimum`, `effectiveProfile`, `tagUnits`, `setRules`/`getRules` — the consumers).

## File shape

```json
{
  "schemaVersion": 1,
  "id": "uoalive",
  "name": "UO Alive",
  "caps": { "physResist": 70, "...": "..." },
  "raceCaps": { "elf": { "energyResist": 75 } },
  "resistMinimum": { "kind": "servuo" },
  "tagUnits": { "cursed": 10.0, "brittle": 4.0, "antique": 1.5, "prized": 0.5 },
  "tagInfo": { "prized": "Costs more to insure, and can't be blessed." },
  "rarity": [
    { "name": "Minor Magic Item", "colour": "#a0a0a0" }
  ],
  "raceLock": { "gargoyleOnly": true },
  "freeSkills": ["Lumberjacking", "Cartography"],
  "scrollBinder": {
    "powerScrolls": [{ "from": 105, "to": 110, "count": 8 }],
    "statScrolls": [{ "from": 5, "to": 10, "count": 6 }],
    "transcendence": { "usableAt": [2.0, 5.0] }
  },
  "slayerGroups": [
    { "super": ["Reptile"], "slayers": ["Dragon", "Lizardman", "Ophidian", "Snake"] },
    { "heading": "Talisman slayers", "slayers": ["Bat", "Bear"] }
  ]
}
```

Every one of these keys except `resistMinimum`, `tagInfo`, `scrollBinder` and `slayerGroups` is **required** by `app/schema/rules.v1.schema.json` — a rules file missing any of them fails validation and is rejected (`app/rules.mts`'s `loadFile` throws, naming the file path, when `validate()` reports errors). `additionalProperties: true` at the top level, so a rules file may carry extra fields the app doesn't read yet; `caps`, `raceCaps` and `tagUnits` take any keys, but every value must be a number (`raceCaps` one level down), and `resistMinimum.kind` must be a kind the app knows, so a string cap or an unknown minimum is rejected rather than turning into a `NaN` cap or a string tag penalty downstream.

## Every key

| Key | Type | Meaning |
|---|---|---|
| `schemaVersion` | integer, must be `1` | The rules file format version. |
| `id` | string, 1–40 characters of `a-z`, `0-9` and `-` | The shard's identifier — what a scan's own `shard` field names, what `<data>/settings.json`'s `shard` picks, and what a user override file in `<data>/rules/` must also carry to actually override the matching builtin (see below — the **file's own `id` field** decides the override, not its filename). |
| `name` | string, non-empty | Display name shown in the shard picker (`GET /api/rules`'s `available` list, and the Shard rules `<select>` in Settings › General). |
| `caps` | object, property key → number | The hard ceiling for each optimizer property this shard enforces — resists, HCI/DCI, SSI, DI, LMC, LRC, FC/FCR, regens, casting focus, SDI, etc. A property with no entry here is uncapped. This is what `effectiveProfile()` merges with a profile's own `caps` override, and what `optBuildSpace` (the optimizer core) reads as the hard ceiling past which more of a property is worthless. `fc` is the cap for Magery, Necromancy and Mysticism casters; the casting school can raise it to 4 (`docs/solver.md`, "Faster Casting cap"). |
| `raceCaps` | object, race name → partial `caps`-shaped object | Per-race overrides that **raise** (or otherwise change) one or more of the base caps for characters of that race — e.g. uoalive gives an Elf `energyResist: 75` instead of the base 70. Looked up by the character's own `race` field (from their profile, default `"human"` when unset). Only resist keys are meaningfully consumed by `effectiveProfile`/the character sheet today, but the shape allows any capped property. |
| `resistMinimum` | *optional* object, `{kind}` | The level the Resisting Spells skill holds each resist at: no resist falls below it, and it adds nothing to what gear gives — see The resist minimum, below. `kind: "servuo"` is ServUO's formula; both builtins use it. A shard without the key has no minimum. A rules file from before still carrying the old `resistSkillBonus` loads with no minimum: the server logs a warning and Settings › General says what to add. |
| `tagUnits` | object, tag name (as it appears in a tooltip, any case: `tagUnits()` lower-cases the keys) → number | The penalty **per unit** for a negative property tag — Cursed, Brittle, Antique, Prized are OSI-standard; a shard can add its own (uoalive adds Massive and Unwieldy). An item's tags become a single `tagPenalty` property (`parseTooltip` in `app/vault-lib.mts`, `props.tagPenalty = tags.reduce((a, t) => a + TU[t], 0)`) that the optimizer can weight negatively. |
| `tagInfo` | *optional* object, tag name (any case) → text (1-400 characters) | What each tag means on this shard, in plain player language: the item peek shows it as a tooltip on the tag's chip (hover or focus). A tag with no entry, or a shard with no `tagInfo`, shows a plain chip. uoalive describes all six of its tags (Antique's durability and Powder of Fortifying limits, Cursed's insurance and death rules, and so on). Optional, like `scrollBinder`: every other key in this table is required. |
| `rarity` | array of `{name, colour}`, ascending order | The shard's rarity ladder, from least to most rare. A tooltip line that is exactly one of these names (optionally prefixed "Reforged") is read as the item's rarity. `colour` is the hex color the client's tooltip renders that tier's name in — used to both label and color-rank an item's rarity in the app (`rarityRank`/`rarityColor` in `app/ui/dom.mts`); an item's rank is its array index + 1 (0 = not on the ladder / no rarity line at all). |
| `raceLock` | object, `{gargoyleOnly}` | Whether this shard enforces the gargoyle race lock — gargoyle-only gear (name `Gargish …`, or a `gargoyles only` tooltip flag) is excluded from a non-gargoyle character's optimizer pool by default (`buildPools`'s `excludeGargoyle` option, defaulted from this flag) unless the profile explicitly allows it. |
| `freeSkills` | array of skill names | Skills this shard treats as free — outside the usual skill-point cap (e.g. uoalive's classic secondary-skill list: Lumberjacking, Cartography, Lockpicking, and so on). Shown as a muted line under the Skills block of the character sheet (`app/ui/sheet.mts`, on the Characters tab and in the Suit Builder), filtered to the ones that character actually has points in. Purely informational — nothing in the optimizer reads this list. |
| `scrollBinder` | *optional* object, `{powerScrolls?, statScrolls?, transcendence?}` | The shard's Scroll Binder recipes (issue #181), which the Inventory's Scrolls view rolls up against. `powerScrolls` and `statScrolls` are lists of steps `{from, to, count}` (whole numbers, `count` at least 2): `count` scrolls of the same skill at level `from` bind into one at `to`; every step must go up, and no two may start at the same level. uoalive: 8 × 105 → 110, 12 × 110 → 115, 10 × 115 → 120 for power scrolls, and 6 × +5 → +10, 8 × +10 → +15, 8 × +15 → +20, 5 × +20 → +25 for stat scrolls. `transcendence.usableAt` lists the point totals, rising and in whole tenths, at which a binder of Scrolls of Transcendence of one skill turns into a usable scroll: the binder adds the points up, is usable at exactly the first total, once past it only at exactly the next, and loses anything above the last (uoalive: `[2.0, 5.0]`, so 3.0 cannot be made). A shard without `scrollBinder` still gets the Scrolls view, listing what is held per skill without roll-ups. The view does not show stat scrolls yet: no scan has shown how this shard names them. |
| `slayerGroups` | *optional* list of `{super, slayers}` or `{heading, slayers}` | How the Inventory's Slayer filter lays out its slayers (issue #189). A `super` group names its super slayer (a list, so an old item wording of the same slayer, such as "Undead (Silver)" for a Silver weapon, sits beside it) and its lesser slayers, which the filter indents under it; a `heading` group lists slayers under a small title instead. Names are the slayer names Pack Rat reads off tooltips (`vault-lib.mts`'s `slayersOf`: "Air Elemental" for "Air Elemental Slayer"), matched in any case; a group needs exactly one of `super` and `heading`, and no name may appear twice. uoalive follows the shard wiki's slayer charts (uoalive.com/wiki/Slayer): Demon (also listed as Abyss, the chart's title, and the old Exorcism) › Gargoyle; Elemental › the seven elementals; Fey; Arachnid › Scorpion, Spider, Terathan; Reptile › Dragon, Lizardman, Ophidian, Snake; Repond › Goblin, Orc, Ogre, Troll and Vermin (the chart puts Goblin and Vermin there); Undead (its chart's Mage row is a set of creatures, not a slayer); Eodon › Dinosaur, Eodon Tribes, Myrmidex; then the talisman slayers Bat, Bear, Beetle, Bird, Bovine, Flame, Ice, Mage and Wolf. generic-osi follows ServUO's stock `SlayerGroup`, where Repond has only Ogre, Orc and Troll and Goblin and Vermin are talisman slayers; ServUO keeps Dinosaur, Eodon Tribe and Myrmidex as groups of their own that the Eodon slayer also hits, so they sit under Eodon. A slayer the table lacks is listed under **Other**; a shard without `slayerGroups` gets the plain A–Z list. |

## The resist minimum

Resisting Spells does not add to a resist. It sets a floor each resist cannot fall below, and gear above that floor counts as usual: armor giving 30 with a minimum of 40 reads 40, armor giving 45 reads 45. `minResistAt(value)` (`app/vault-lib.mts`) is ServUO's `PlayerMobile.GetMinResistance`, with `fixed` the skill times 10 and integer division:

```js
export function minResistAt(value) {
  if (!getRules().resistMinimum) return null;
  const fixed = Math.floor(value * 10 + 1e-6);
  if (fixed >= 1000) return 40 + Math.floor((fixed - 1000) / 50);
  return fixed >= 400 ? Math.floor((fixed - 400) / 15) : null;
}
```

| Skill | below 40 | 40 | 44.5 | 50 | 55 | 70 | 85 | 100 | 110 | 120 |
|---|---|---|---|---|---|---|---|---|---|---|
| Minimum | none | 0 | 3 | 6 | 10 | 20 | 30 | 40 | 42 | 44 |

At **120**: `fixed = 1200`, `40 + (1200 − 1000) / 50 = 44`. At **55**: `(550 − 400) / 15 = 10`. The shard wiki's own table gives 5 at 44.5, where the formula gives 3; the app follows the formula. Below 40 there is no minimum at all, so a resist a buff takes below 0 stays there.

ServUO reads the skill's value with item bonuses (`Skills[].Value`). The scan's `value` carries the bonuses of the suit worn at scan time, so `resistMinimum(skills, bonus)` starts from the scan's `base` (`resistSkillOf`; its `value` when there is no base) and adds the Resisting Spells bonus of the suit being shown (`sk:resisting spells`): the worn suit's for the sheet, a result's for a result. The Suit Builder's searches use the base alone (`docs/solver.md`). A paperdoll resist is `max(min(total, cap), minimum)`, the minimum applied after the buffs and the cap (`paperdollResist`). The Suit Builder counts it the same way (`docs/solver.md`, "The Resisting Spells minimum"); Protection lowers the skill, and with it the minimum. It is not a property an item can carry, and it's computed fresh from the character's live scanned skill value every time, not stored anywhere.

## Adding your own shard

Drop a rules file into `<data>/rules/` (the directory named by config `paths.rules` — printed by the server, or just `<your data dir>/rules/`), named anything you like ending in `.json` — the file's own `id` field is what matters, not the filename. Two cases:

- **A brand-new shard.** Give it an `id` that doesn't match either builtin (`uoalive`, `generic-osi`). It shows up in the shard picker (`GET /api/rules`'s `available`, tagged `source: "user"`) alongside the builtins, selectable from `<data>/settings.json`'s `shard` field or the picker in Settings › General.
- **Overriding a builtin.** Give it the *same* `id` as a builtin (e.g. `id: "uoalive"`) with your own numbers. `listRules()` and `loadRules()` both prefer a user file over a builtin of the same id — your file wins, the builtin is shadowed entirely, no merging of individual keys.

Either way, the file must validate against `app/schema/rules.v1.schema.json` (every key above, present and correctly typed) or the server refuses to load it — `loadRules()` throws naming the file's path, while `listRules()` (used for the picker's enumeration) leaves out only a file that does not parse as JSON or has no string `id`, rather than crashing the whole picker. A file that parses and has an `id` but is otherwise invalid is still listed, so choosing it fails loudly with its path instead of the shard simply vanishing. Restart the server, or switch shards through the picker in Settings › General (which calls `PUT /api/settings`, reloading the rules in-process, and then reloads the page — `app/ui/shard.mts`'s `changeShard`), to pick up a new or changed rules file.

## Organize and attended play

The file above is about item rules; this note is about the play rules most shards enforce. An Organize trip moves your own items between your own containers, which is not resource, loot or combat gathering. Every trip starts from a click in the app, the bridge refuses a command queued more than 60 seconds earlier, a Stop button halts it between steps, and nothing runs on a timer: Run all queues the next trip only after the last one reports back. Check your own shard's rules before running any script.

## How the app loads and applies rules

Everything that is shard-specific rather than OSI-standard lives in a rules file, `app/rules/<id>.json`: property caps (`caps`), the Resisting Spells resist minimum (`resistMinimum`, ServUO's formula; `minResistAt` in `vault-lib.mts`; a shard without the key has none), race cap overrides (`raceCaps`, e.g. `{elf: {energyResist: 75}}`), tag-penalty units (`tagUnits`, e.g. Cursed/Brittle/Antique/Prized — a shard can add its own, e.g. uoalive's Massive/Unwieldy), the rarity ladder (`rarity`: `[{name, colour}, ...]` in ascending order — rank is the array index + 1), the gargoyle race-lock policy (`raceLock.gargoyleOnly`), and the free-skill list shown on Characters-tab cards (`freeSkills`). Two ship with the app: `uoalive` (the default) and `generic-osi` (no Massive/Unwieldy tags, empty free-skill list). `app/schema/rules.v1.schema.json` is the contract every rules file is checked against.

`app/rules.mts` (Node-only — it reads files, so `vault-lib.mts` never imports it) is the loader: `loadRules(id, {userRulesDir})` looks in `userRulesDir/<id>.json` first (when given), then the builtin `app/rules/<id>.json`, validates, and throws naming the file path on failure; `listRules({userRulesDir})` enumerates every builtin plus every file in `userRulesDir`, keyed by each file's own `id` field (not its filename) so a user file overrides a builtin of the same id. `<data>/rules/` (config `paths.rules`) is where a user drops a custom or overriding shard file without touching the app.

`vault-lib.mts` never reads a rules file itself — it only exposes `setRules(rules)` / `getRules()` (the latter throws `"rules not loaded"` until the former has run, so a forgotten call is loud, not silently wrong). The server loads rules once at startup (from `<data>/settings.json`'s `shard`, defaulting to `uoalive` if the file doesn't exist yet — `ensureLayout()` writes it) and calls `setRules()` then and again on every shard change, on the one `vault-lib` instance every server module (organize, buffs, missing, the MCP tools…) shares; a page load fetches `GET /api/settings` and `GET /api/rules` first and calls `setRules()` itself, so caps/rarity/tag-units/gargoyle-lock are all correct before the inventory or profiles load. `GET|PUT /api/settings` reads/writes `<data>/settings.json` (`{schemaVersion, shard, setupDone?, client?: {adapter, scriptsDir} | null, retention?, autoUpdateCheck?}`); `PUT` accepts any subset of `shard`, `setupDone`, `client`, `retention` and `autoUpdateCheck`, validates every field it carries before writing any (an unknown shard id or adapter is a 400, a client folder goes through `validateScriptsDir` and the resolved path is stored), and reloads the rules on a shard change. A write merges only the fields its request carried into what `settings.json` already holds: when startup fell back to the default shard (the named shard's rules would not load) or ignored a client whose adapter this install does not ship, those fallbacks stay in memory and are never written over the player's own values by an unrelated save. `GET /api/rules` returns `{shard, rules, available}`. The shard picker in Settings › General (and the wizard's shard step, both through `ui/shard.mts`'s `changeShard`) lists `available`, `PUT`s on change, and reloads the page — simplest way to re-apply a new shard's rules everywhere (caps, rarity colours, tag units, pool gargoyle filtering) rather than hot-swapping every consumer.

`profiles.json`'s own `caps` key (schemaVersion 1) moved out into the rules file at schemaVersion 2 — `migrateProfiles()` drops it on read; nothing in the page or the optimizer reads `profiles.caps` any more.
