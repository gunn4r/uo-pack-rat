SKILL_NAMES = ["Anatomy", "Archery", "Bushido", "Chivalry", "Discordance", "Evaluating Intelligence", "Fencing", "Focus",
               "Healing", "Imbuing", "Mace Fighting", "Magery", "Meditation", "Musicianship", "Mysticism", "Necromancy",
               "Ninjitsu", "Parry", "Peacemaking", "Provocation", "Resisting Spells", "Spellweaving", "Spirit Speak",
               "Swordsmanship", "Tactics", "Throwing", "Wrestling", "Animal Taming", "Animal Lore", "Veterinary",
               "Lockpicking", "Cartography", "Remove Trap", "Hiding", "Stealth", "Detecting Hidden", "Mining",
               "Lumberjacking", "Fishing", "Tracking", "Camping", "Arms Lore", "Item Identification", "Poisoning",
               "Alchemy", "Blacksmithy", "Carpentry", "Tailoring", "Tinkering", "Inscription", "Bowcraft/Fletching", "Cooking"]


def read_skills():
    out = {}
    for name in SKILL_NAMES:
        try:
            sk = API.GetSkill(name)
            if sk is None:
                continue
            val = float(sk.Value)
            if val <= 0:
                continue
            out[name] = {"value": round(val, 1), "base": round(float(getattr(sk, "Base", val)), 1),
                         "cap": round(float(getattr(sk, "Cap", 0) or 0), 1)}
        except Exception:
            continue
    return out
