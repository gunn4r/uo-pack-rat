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

Every one of these keys except `tagInfo`, `scrollBinder` and `slayerGroups` is **required** by `app/schema/rules.v1.schema.json` — a rules file missing any of them fails validation and is rejected (`app/rules.mts`'s `loadFile` throws, naming the file path, when `validate()` reports errors). `additionalProperties: true` at the top level, so a rules file may carry extra fields the app doesn't read yet; `caps`, `raceCaps` and `tagUnits` take any keys, but every value must be a number (`raceCaps` one level down), and every `resistSkillBonus.breakpoints` entry must be a pair of numbers, so a string cap or a one-element breakpoint is rejected rather than turning into a `NaN` cap or a string tag penalty downstream.

## Every key

| Key | Type | Meaning |
|---|---|---|
| `schemaVersion` | integer, must be `1` | The rules file format version. |
| `id` | string, 1–40 characters of `a-z`, `0-9` and `-` | The shard's identifier — what a scan's own `shard` field names, what `<data>/settings.json`'s `shard` picks, and what a user override file in `<data>/rules/` must also carry to actually override the matching builtin (see below — the **file's own `id` field** decides the override, not its filename). |
| `name` | string, non-empty | Display name shown in the shard picker (`GET /api/rules`'s `available` list, and the Shard rules `<select>` in Settings › General). |
| `caps` | object, property key → number | The hard ceiling for each optimizer property this shard enforces — resists, HCI/DCI, SSI, DI, LMC, LRC, FC/FCR, regens, casting focus, SDI, etc. A property with no entry here is uncapped. This is what `effectiveProfile()` merges with a profile's own `caps` override, and what `optBuildSpace` (the optimizer core) reads as the hard ceiling past which more of a property is worthless. |
| `raceCaps` | object, race name → partial `caps`-shaped object | Per-race overrides that **raise** (or otherwise change) one or more of the base caps for characters of that race — e.g. uoalive gives an Elf `energyResist: 75` instead of the base 70. Looked up by the character's own `race` field (from their profile, default `"human"` when unset). Only resist keys are meaningfully consumed by `effectiveProfile`/the character sheet today, but the shape allows any capped property. |
| `resistSkillBonus` | object, `{breakpoints}` | The Resisting Spells skill's flat bonus toward each resist cap — see The resist-bonus formula, below. A shard with no such bonus (e.g. `generic-osi`) ships `{"breakpoints": []}`, not an absent key. |
| `tagUnits` | object, tag name (as it appears in a tooltip, any case: `tagUnits()` lower-cases the keys) → number | The penalty **per unit** for a negative property tag — Cursed, Brittle, Antique, Prized are OSI-standard; a shard can add its own (uoalive adds Massive and Unwieldy). An item's tags become a single `tagPenalty` property (`parseTooltip` in `app/vault-lib.mts`, `props.tagPenalty = tags.reduce((a, t) => a + TU[t], 0)`) that the optimizer can weight negatively. |
| `tagInfo` | *optional* object, tag name (any case) → text (1-400 characters) | What each tag means on this shard, in plain player language: the item peek shows it as a tooltip on the tag's chip (hover or focus). A tag with no entry, or a shard with no `tagInfo`, shows a plain chip. uoalive describes all six of its tags (Antique's durability and Powder of Fortifying limits, Cursed's insurance and death rules, and so on). Optional, like `scrollBinder`: every other key in this table is required. |
| `rarity` | array of `{name, colour}`, ascending order | The shard's rarity ladder, from least to most rare. A tooltip line that is exactly one of these names (optionally prefixed "Reforged") is read as the item's rarity. `colour` is the hex color the client's tooltip renders that tier's name in — used to both label and color-rank an item's rarity in the app (`rarityRank`/`rarityColor` in `app/ui/dom.mts`); an item's rank is its array index + 1 (0 = not on the ladder / no rarity line at all). |
| `raceLock` | object, `{gargoyleOnly}` | Whether this shard enforces the gargoyle race lock — gargoyle-only gear (name `Gargish …`, or a `gargoyles only` tooltip flag) is excluded from a non-gargoyle character's optimizer pool by default (`buildPools`'s `excludeGargoyle` option, defaulted from this flag) unless the profile explicitly allows it. |
| `freeSkills` | array of skill names | Skills this shard treats as free — outside the usual skill-point cap (e.g. uoalive's classic secondary-skill list: Lumberjacking, Cartography, Lockpicking, and so on). Shown as a muted line under the Skills block of the character sheet (`app/ui/sheet.mts`, on the Characters tab and in the Suit Builder), filtered to the ones that character actually has points in. Purely informational — nothing in the optimizer reads this list. |
| `scrollBinder` | *optional* object, `{powerScrolls?, statScrolls?, transcendence?}` | The shard's Scroll Binder recipes (issue #181), which the Inventory's Scrolls view rolls up against. `powerScrolls` and `statScrolls` are lists of steps `{from, to, count}` (whole numbers, `count` at least 2): `count` scrolls of the same skill at level `from` bind into one at `to`; every step must go up, and no two may start at the same level. uoalive: 8 × 105 → 110, 12 × 110 → 115, 10 × 115 → 120 for power scrolls, and 6 × +5 → +10, 8 × +10 → +15, 8 × +15 → +20, 5 × +20 → +25 for stat scrolls. `transcendence.usableAt` lists the point totals, rising and in whole tenths, at which a binder of Scrolls of Transcendence of one skill turns into a usable scroll: the binder adds the points up, is usable at exactly the first total, once past it only at exactly the next, and loses anything above the last (uoalive: `[2.0, 5.0]`, so 3.0 cannot be made). A shard without `scrollBinder` still gets the Scrolls view, listing what is held per skill without roll-ups. The view does not show stat scrolls yet: no scan has shown how this shard names them. |
| `slayerGroups` | *optional* list of `{super, slayers}` or `{heading, slayers}` | How the Inventory's Slayer filter lays out its slayers (issue #189). A `super` group names its super slayer (a list, so an old item wording of the same slayer, such as "Undead (Silver)" for a Silver weapon, sits beside it) and its lesser slayers, which the filter indents under it; a `heading` group lists slayers under a small title instead. Names are the slayer names Pack Rat reads off tooltips (`vault-lib.mts`'s `slayersOf`: "Air Elemental" for "Air Elemental Slayer"), matched in any case; a group needs exactly one of `super` and `heading`, and no name may appear twice. uoalive follows the shard wiki's slayer charts (uoalive.com/wiki/Slayer): Demon (also listed as Abyss, the chart's title, and the old Exorcism) › Gargoyle; Elemental › the seven elementals; Fey; Arachnid › Scorpion, Spider, Terathan; Reptile › Dragon, Lizardman, Ophidian, Snake; Repond › Goblin, Orc, Ogre, Troll and Vermin (the chart puts Goblin and Vermin there); Undead (its chart's Mage row is a set of creatures, not a slayer); Eodon › Dinosaur, Eodon Tribes, Myrmidex; then the talisman slayers Bat, Bear, Beetle, Bird, Bovine, Flame, Ice, Mage and Wolf. generic-osi follows ServUO's stock `SlayerGroup`, where Repond has only Ogre, Orc and Troll and Goblin and Vermin are talisman slayers; ServUO keeps Dinosaur, Eodon Tribe and Myrmidex as groups of their own that the Eodon slayer also hits, so they sit under Eodon. A slayer the table lacks is listed under **Other**; a shard without `slayerGroups` gets the plain A–Z list. |

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

At exactly 100 skill, only the first slice applies: `100 × 0.4 = 40`. This bonus is added toward each resist's own cap (paperdoll display, and `effectiveProfile`'s floor/cap adjustment for the optimizer — see `CONTRIBUTING.md`'s "Resist floors and caps are paperdoll values" note; the Suit Builder's buffs are counted the same way, docs/solver.md's Buffs), whether that cap is the shard's or one the player set for a build in the Suit Builder's Resist caps section (`docs/solver.md`, "Resist caps"). It is not itself a property an item can carry, and it's computed fresh from the character's live scanned skill value every time, not stored anywhere.

## Adding your own shard

Drop a rules file into `<data>/rules/` (the directory named by config `paths.rules` — printed by the server, or just `<your data dir>/rules/`), named anything you like ending in `.json` — the file's own `id` field is what matters, not the filename. Two cases:

- **A brand-new shard.** Give it an `id` that doesn't match either builtin (`uoalive`, `generic-osi`). It shows up in the shard picker (`GET /api/rules`'s `available`, tagged `source: "user"`) alongside the builtins, selectable from `<data>/settings.json`'s `shard` field or the picker in Settings › General.
- **Overriding a builtin.** Give it the *same* `id` as a builtin (e.g. `id: "uoalive"`) with your own numbers. `listRules()` and `loadRules()` both prefer a user file over a builtin of the same id — your file wins, the builtin is shadowed entirely, no merging of individual keys.

Either way, the file must validate against `app/schema/rules.v1.schema.json` (every key above, present and correctly typed) or the server refuses to load it — `loadRules()` throws naming the file's path, while `listRules()` (used for the picker's enumeration) leaves out only a file that does not parse as JSON or has no string `id`, rather than crashing the whole picker. A file that parses and has an `id` but is otherwise invalid is still listed, so choosing it fails loudly with its path instead of the shard simply vanishing. Restart the server, or switch shards through the picker in Settings › General (which calls `PUT /api/settings`, reloading the rules in-process, and then reloads the page — `app/ui/shard.mts`'s `changeShard`), to pick up a new or changed rules file.

## Organize and attended play

The file above is about item rules; this note is about the play rules most shards enforce. An Organize trip moves your own items between your own containers, which is not resource, loot or combat gathering. Every trip starts from a click in the app, the bridge refuses a command queued more than 60 seconds earlier, a Stop button halts it between steps, and nothing runs on a timer: Run all queues the next trip only after the last one reports back. Check your own shard's rules before running any script.
