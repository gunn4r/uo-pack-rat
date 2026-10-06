SKILL_NAMES = [
    "Alchemy", "Anatomy", "Animal Lore", "Item ID", "Arms Lore", "Parry", "Begging", "Blacksmith",
    "Fletching", "Peacemaking", "Camping", "Carpentry", "Cartography", "Cooking", "Detect Hidden",
    "Discordance", "EvalInt", "Healing", "Fishing", "Forensics", "Herding", "Hiding", "Provocation",
    "Inscribe", "Lockpicking", "Magery", "Magic Resist", "Mysticism", "Tactics", "Snooping",
    "Musicianship", "Poisoning", "Archery", "Spirit Speak", "Stealing", "Tailoring", "Animal Taming",
    "Taste ID", "Tinkering", "Tracking", "Veterinary", "Swords", "Macing", "Fencing", "Wrestling",
    "Lumberjacking", "Mining", "Meditation", "Stealth", "Remove Trap", "Necromancy", "Focus",
    "Chivalry", "Bushido", "Ninjitsu", "Spell Weaving", "Imbuing", "Throwing",
]
GAME_SKILL_NAME = {
    "Item ID": "Item Identification", "Blacksmith": "Blacksmithy", "Fletching": "Bowcraft/Fletching",
    "Detect Hidden": "Detecting Hidden", "EvalInt": "Evaluating Intelligence", "Inscribe": "Inscription",
    "Magic Resist": "Resisting Spells", "Taste ID": "Taste Identification", "Swords": "Swordsmanship",
    "Macing": "Mace Fighting", "Spell Weaving": "Spellweaving",
}


def read_skills():
    # Same three fields as TazUO's adapter, same meaning: "value" is Player.GetSkillValue,
    # documented as "the value of the skill, with modifiers" -- the effective, item-bonused number
    # the paperdoll shows (e.g. Resisting Spells' gear bonus is folded in). "base" is
    # Player.GetRealSkillValue, documented as "the base/real value" -- the trained skill with no
    # gear added. "cap" is Player.GetSkillCap. Gate on the effective value, same as TazUO's own
    # `sk.Value` gate, so a skill with real value 0 but a positive item bonus (rare, but possible)
    # still gets reported. A name this RE build does not know is skipped, not fatal.
    out = {}
    for name in SKILL_NAMES:
        try:
            val = as_float(Player.GetSkillValue(name), -1.0)
            if val <= 0:
                continue
            base = as_float(Player.GetRealSkillValue(name), val)
            cap = as_float(Player.GetSkillCap(name), 0.0)
        except Exception:
            continue
        out[GAME_SKILL_NAME.get(name, name)] = {"value": round(val, 1), "base": round(base, 1), "cap": round(cap, 1)}
    return out
