# Shard rules

Everything that is shard-specific rather than OSI-standard — property caps, the Resisting Spells resist bonus, race-specific overrides, tag penalties, the rarity ladder, the gargoyle race lock, and which skills are "free" (outside the 720-point cap) — lives in one JSON file per shard, never hardcoded in the app. This document explains every key, how to add your own shard (or override a builtin one) without touching the app's code, and works the resist-bonus formula by hand.

Ground truth: `app/schema/rules.v1.schema.json` (the contract every rules file is checked against), `app/rules/uoalive.json` and `app/rules/generic-osi.json` (the two builtins), `app/rules.mts` (the loader), and `app/vault-lib.mts` (`resistSkillBonus`, `effectiveProfile`, `tagUnits`, `setRules`/`getRules` — the consumers).

## File shape

```json
{
  "schemaVersion": 1,
  "id": "uoalive",
  "name": "UO Alive",
  "caps": { "physResist": 70, "...": "..." },
  "raceCaps": { "elf": { "energyResist": 75 } },
  "resistSkillBonus": { "breakpoints": [[100, 0.4], [120, 0.2]] },
  "tagUnits": { "cursed": 10.0, "brittle": 4.0, "antique": 1.5, "prized": 0.5 },
  "rarity": [
    { "name": "Minor Magic Item", "colour": "#a0a0a0" }
  ],
  "raceLock": { "gargoyleOnly": true },
  "freeSkills": ["Lumberjacking", "Cartography"]
}
```

Every one of these keys is **required** by `app/schema/rules.v1.schema.json` — a rules file missing any of them fails validation and is rejected (`app/rules.mts`'s `loadFile` throws, naming the file path, when `validate()` reports errors). `additionalProperties: true` at the top level, so a rules file may carry extra fields the app doesn't read yet; only `caps`, `raceCaps`, `tagUnits` themselves are unconstrained-shape objects (the schema checks they're objects, not their individual keys — same tradeoff `scan.v2.schema.json` makes for `containers`).

## Every key

| Key | Type | Meaning |
|---|---|---|
| `schemaVersion` | integer, must be `1` | The rules file format version. |
| `id` | string, non-empty | The shard's identifier — what a scan's own `shard` field names, what `<data>/settings.json`'s `shard` picks, and what a user override file in `<data>/rules/` must also carry to actually override the matching builtin (see below — the **file's own `id` field** decides the override, not its filename). |
| `name` | string, non-empty | Display name shown in the shard picker (`GET /api/rules`'s `available` list, and the header `<select>`). |
| `caps` | object, property key → number | The hard ceiling for each optimizer property this shard enforces — resists, HCI/DCI, SSI, DI, LMC, LRC, FC/FCR, regens, casting focus, SDI, etc. A property with no entry here is uncapped. This is what `effectiveProfile()` merges with a profile's own `caps` override, and what `optBuildSpace` (the optimizer core) reads as the hard ceiling past which more of a property is worthless. |
| `raceCaps` | object, race name → partial `caps`-shaped object | Per-race overrides that **raise** (or otherwise change) one or more of the base caps for characters of that race — e.g. uoalive gives an Elf `energyResist: 75` instead of the base 70. Looked up by the character's own `race` field (from their profile, default `"human"` when unset). Only resist keys are meaningfully consumed by `effectiveProfile`/the character sheet today, but the shape allows any capped property. |
| `resistSkillBonus` | object, `{breakpoints}` | The Resisting Spells skill's flat bonus toward each resist cap — see The resist-bonus formula, below. A shard with no such bonus (e.g. `generic-osi`) ships `{"breakpoints": []}`, not an absent key. |
| `tagUnits` | object, tag name (lowercase, as it appears in a tooltip) → number | The penalty **per unit** for a negative property tag — Cursed, Brittle, Antique, Prized are OSI-standard; a shard can add its own (uoalive adds Massive and Unwieldy). An item's tags become a single `tagPenalty` property (`parseTooltip` in `app/vault-lib.mts`, `props.tagPenalty = tags.reduce((a, t) => a + TU[t], 0)`) that the optimizer can weight negatively. |
| `rarity` | array of `{name, colour}`, ascending order | The shard's rarity ladder, from least to most rare. `colour` is the hex colour the client's tooltip renders that tier's name in — used to both label and colour-rank an item's rarity in the app (`rarityRank`/`rarityColor` in `app/ui/dom.mjs`); an item's rank is its array index + 1 (0 = not on the ladder / no rarity line at all). |
| `raceLock` | object, `{gargoyleOnly}` | Whether this shard enforces the gargoyle race lock — gargoyle-only gear (name `Gargish …`, or a `gargoyles only` tooltip flag) is excluded from a non-gargoyle character's optimizer pool by default (`buildPools`'s `excludeGargoyle` option, defaulted from this flag) unless the profile explicitly allows it. |
| `freeSkills` | array of skill names | Skills this shard treats as free — outside the usual skill-point cap (e.g. uoalive's classic secondary-skill list: Lumberjacking, Cartography, Lockpicking, and so on). Shown as a muted footer line on each character's card in the Characters tab, filtered to the ones that character actually has points in. Purely informational — nothing in the optimizer reads this list. |

## The resist-bonus formula, worked for 120 → 44

`resistSkillBonus(skills)` (`app/vault-lib.mts`) reads a character's Resisting Spells value and walks the shard's `resistSkillBonus.breakpoints` — a list of `[to, rate]` pairs, each describing the bonus rate that applies to the *slice* of skill between the previous breakpoint's `to` and this one's, given in ascending `to` order:

```js
export function resistSkillBonus(skills) {
  const v = skills?.["Resisting Spells"]?.value || 0;
  let prev = 0, bonus = 0;
  for (const [to, rate] of getRules().resistSkillBonus.breakpoints) {
    bonus += rate * Math.max(0, Math.min(v, to) - prev);
    prev = to;
  }
  return Math.floor(bonus);
}
```

uoalive's breakpoints are `[[100, 0.4], [120, 0.2]]`: +0.4 per point of skill from 0 to 100, then +0.2 per point from 100 to 120. At **120** skill:

- First breakpoint's slice: `min(120, 100) − 0 = 100` points at rate `0.4` → `100 × 0.4 = 40`.
- Second breakpoint's slice: `min(120, 120) − 100 = 20` points at rate `0.2` → `20 × 0.2 = 4`.
- Total: `40 + 4 = 44`, floored (already an integer here) → **44**.

At exactly 100 skill, only the first slice applies: `100 × 0.4 = 40`. This bonus is added toward each resist's own cap (paperdoll display, and `effectiveProfile`'s floor/cap adjustment for the optimizer — see `CONTRIBUTING.md`'s "Resist floors and caps are paperdoll values" note) — it is not itself a property an item can carry, and it's computed fresh from the character's live scanned skill value every time, not stored anywhere.

## Adding your own shard

Drop a rules file into `<data>/rules/` (the directory named by config `paths.rules` — printed by the server, or just `<your data dir>/rules/`), named anything you like ending in `.json` — the file's own `id` field is what matters, not the filename. Two cases:

- **A brand-new shard.** Give it an `id` that doesn't match either builtin (`uoalive`, `generic-osi`). It shows up in the shard picker (`GET /api/rules`'s `available`, tagged `source: "user"`) alongside the builtins, selectable from `<data>/settings.json`'s `shard` field or the header dropdown.
- **Overriding a builtin.** Give it the *same* `id` as a builtin (e.g. `id: "uoalive"`) with your own numbers. `listRules()` and `loadRules()` both prefer a user file over a builtin of the same id — your file wins, the builtin is shadowed entirely, no merging of individual keys.

Either way, the file must validate against `app/schema/rules.v1.schema.json` (every key above, present and correctly typed) or the server refuses to load it — `loadRules()` throws naming the file's path, and `listRules()` (used for the picker's enumeration) just silently leaves a broken file out of the list rather than crashing the whole picker. Restart the server, or switch shards through the header picker (which calls `PUT /api/settings` and reloads the rules in-process), to pick up a new or changed rules file.
