# packrat-refresh.py — ATTENDED one-shot: QUICK character refresh for the Pack Rat
# app without a full scan. Reads this character's stats, skills, maxes, resists, position, every
# equipped layer and the BACKPACK (nested bags included) — nothing else. Bank and ground
# containers are never opened, so the app keeps whatever it last knew about them.
#
# Why the backpack is walked at all: the app's fold (app/vault-lib.mjs foldSnapshots) replaces a
# character's worn set whole and everything under each root the snapshot lists. A snapshot with no
# roots would delete a piece you just took off (it was "worn") without putting it anywhere — listing
# the backpack as the one root makes that piece reappear in the backpack instead of vanishing.
#
# Helpers below are copied VERBATIM from packrat-scanner.py rather than imported: Legion runs
# a script by exec'ing the file and its `__name__` semantics are unverified, so the proven scanner
# cannot yet carry an `if __name__ == "__main__"` guard (it would either never run or run on
# import). This script records str(__name__) in the snapshot's "meta" to settle that for next time;
# the fold ignores unknown top-level keys, so "meta" is inert for the app.
#
# Output: <data directory>/inbox/tazuo/<Character>-<YYYYmmdd-HHMMSS>-quick.json. The app's inbox
# watcher (app/watcher.mjs) picks it up, normalises it and moves it into <data directory>/scans/
# under its own accepted name — the app reads every *.json there and folds by scannedAt. The data
# directory is `packrat-paths.json` beside this script, else $PACKRAT_DATA, else
# ~/.pack-rat. RUN: press Play anywhere.
# Inventory-only, nothing rule-sensitive — stay attended.

import API
import json
import os
import re
import time


def data_dir():
    """<script folder>/packrat-paths.json {"dataDir": "..."} → $PACKRAT_DATA → ~/.pack-rat"""
    here = os.path.dirname(os.path.abspath(__file__))
    cfg = os.path.join(here, "packrat-paths.json")
    if os.path.exists(cfg):
        with open(cfg, "r", encoding="utf-8") as f:
            d = json.load(f).get("dataDir")
        if d:
            return os.path.expanduser(d)
    return os.path.expanduser(os.environ.get("PACKRAT_DATA") or "~/.pack-rat")


def write_json_atomic(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, path)


def rfc3339_now():
    t = time.localtime()
    off = time.strftime("%z", t)
    tz = "Z" if not off else off if ":" in off else off[:3] + ":" + off[3:]
    return time.strftime("%Y-%m-%dT%H:%M:%S", t) + tz


ADAPTER_ID = "tazuo"
ADAPTER_VERSION = "2.0.0"
CAPABILITIES = {
    "layers": ["OneHanded", "TwoHanded", "Shoes", "Pants", "Shirt", "Helmet", "Gloves",
               "Ring", "Talisman", "Necklace", "Waist", "Torso", "Bracelet", "Tunic",
               "Earrings", "Arms", "Cloak", "Robe", "Skirt", "Legs"],
    "arms": True, "bank": True, "ground": True, "nested": True, "tooltips": "opl",
    "bridge": ["highlight", "grab", "goto"],
}


PAUSE_OPEN = 1.2         # after UseObject on a container (raise on laggy connections)
MAX_NEST = 4             # bags in bags in bags
OUT_DIR = os.path.join(data_dir(), "inbox", "tazuo")
ALARM_HUE, OK_HUE, INFO_HUE = 33, 68, 88

ALL_LAYERS = ["OneHanded", "TwoHanded", "Shoes", "Pants", "Shirt", "Helmet", "Gloves",
              "Ring", "Talisman", "Necklace", "Waist", "Torso", "Bracelet", "Tunic",
              "Earrings", "Arms", "Cloak", "Robe", "Skirt", "Legs"]
CONTAINER_RE = re.compile(r"\b(chest|box|crate|bag|pouch|basket|trunk|armoire|cabinet|backpack)\b", re.I)
# Engraved bags and Backpacks match no name pattern — detect by graphic too (probe-verified Aug 2026).
CONTAINER_GRAPHICS = {0x0E75, 0x0E76, 0x0E79, 0x0E7D, 0x09AA, 0x09A8, 0x09A9, 0x09AB,
                      0x0E3C, 0x0E3D, 0x0E3E, 0x0E3F, 0x0E40, 0x0E41, 0x0E42, 0x0E43,
                      0x0E7C, 0x0E7E, 0x0E7F, 0xA32F, 0xA333}


def sysmsg(msg, hue=OK_HUE):
    API.SysMsg(msg, hue)


def tooltip_lines(serial):
    try:
        data = API.ItemNameAndProps(int(serial), True)
    except Exception:
        data = None
    return [ln.strip() for ln in str(data or "").splitlines() if ln.strip()]


def is_container(item, name):
    try:
        if bool(getattr(item, "IsCorpse", False)) or int(getattr(item, "Graphic", 0) or 0) == 0x2006:
            return False          # corpses are containers to the client; never open them
    except Exception:
        pass
    try:
        if bool(getattr(item, "IsContainer", False)):
            return True
    except Exception:
        pass
    try:
        if int(item.Graphic) in CONTAINER_GRAPHICS:
            return True
    except Exception:
        pass
    return bool(CONTAINER_RE.search(name or ""))


def item_dict(it, lines, container, layer=None):
    d = {"serial": int(it.Serial), "graphic": int(getattr(it, "Graphic", 0) or 0),
         "hue": int(getattr(it, "Hue", 0) or 0), "amount": int(getattr(it, "Amount", 1) or 1),
         "name": lines[0] if lines else str(getattr(it, "Name", "") or ""),
         "tooltip": lines, "container": container, "nameSource": "opl"}
    if layer:
        d["layer"] = layer
    return d


def root_pos(serial, kind):
    """World position of a ground container (so the bridge can walk to it later); None for pack/bank."""
    if kind != "ground":
        return None
    try:
        it = API.FindItem(int(serial))
        if it is None:
            return None
        return {"x": int(it.X), "y": int(it.Y), "z": int(getattr(it, "Z", 0) or 0)}
    except Exception:
        return None


def scan_root(root_serial, kind, label, containers, items, seen):
    """Open root + every nested container, list everything. Returns item count (0 = nothing/unopened)."""
    root_serial = int(root_serial)
    opened, to_open, listing = set(), [root_serial], []
    for _ in range(MAX_NEST):
        fresh = [c for c in to_open if c not in opened]
        if not fresh:
            break
        for c in fresh:
            if API.StopRequested:
                return 0
            try:
                API.UseObject(c)
            except Exception:
                pass
            API.Pause(PAUSE_OPEN)
            opened.add(c)
        listing = API.ItemsInContainer(root_serial, True) or []
        for it in listing:
            try:
                nm = str(it.Name or "")
            except Exception:
                nm = ""
            s = int(it.Serial)
            if is_container(it, nm) and s not in opened and s not in to_open:
                to_open.append(s)
    if not listing:
        # Opened-but-empty is a fact worth recording (the app then clears whatever it last knew about
        # this container). Not opened (too far, locked) is not: return -1 so the app keeps its memory.
        try:
            it = API.FindItem(root_serial)
            if it is not None and bool(getattr(it, "Opened", False)):
                containers[root_serial] = {"serial": root_serial, "name": label, "parent": None,
                                           "root": root_serial, "kind": kind, "pos": root_pos(root_serial, kind)}
                return 0
        except Exception:
            pass
        return -1
    try:
        API.RequestOPLData([int(it.Serial) for it in listing])
        API.Pause(0.5)
    except Exception:
        pass
    containers[root_serial] = {"serial": root_serial, "name": label, "parent": None,
                               "root": root_serial, "kind": kind, "pos": root_pos(root_serial, kind)}
    n = 0
    for it in listing:
        s = int(it.Serial)
        if s in seen:
            continue
        seen.add(s)
        lines = tooltip_lines(s)
        parent = int(getattr(it, "Container", root_serial) or root_serial)
        if s in opened:
            containers[s] = {"serial": s, "name": lines[0] if lines else str(it.Name or ""),
                             "parent": parent, "root": root_serial, "kind": "container",
                             "tooltip": lines}
            continue
        items.append(item_dict(it, lines, parent))
        n += 1
    return n


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


# ---------------- the refresh itself ----------------
def main():
    t0 = time.time()
    p = API.Player
    char = str(p.Name)
    snap = {"schemaVersion": 2, "character": char,
            "scannedAt": rfc3339_now(),
            "adapter": {"id": ADAPTER_ID, "version": ADAPTER_VERSION, "client": "TazUO",
                        "clientVersion": None, "capabilities": CAPABILITIES},
            "meta": {"mode": "quick", "name": str(__name__), "roots": ["backpack"]},
            "stats": {"str": int(p.Strength), "dex": int(p.Dexterity), "int": int(p.Intelligence)},
            "position": {"x": int(p.X), "y": int(p.Y)},
            "maxes": {"hits": int(getattr(p, "HitsMax", 0) or 0), "stam": int(getattr(p, "StaminaMax", 0) or 0),
                      "mana": int(getattr(p, "ManaMax", 0) or 0)},
            "resists": {"phys": int(getattr(p, "PhysicalResistance", 0) or 0), "fire": int(getattr(p, "FireResistance", 0) or 0),
                        "cold": int(getattr(p, "ColdResistance", 0) or 0), "poison": int(getattr(p, "PoisonResistance", 0) or 0),
                        "energy": int(getattr(p, "EnergyResistance", 0) or 0)},
            "skills": read_skills(),
            "equipped": [], "roots": [], "containers": {}, "items": []}
    seen = set()

    # 1) equipped layers (arms included — Legion reads every layer)
    for layer in ALL_LAYERS:
        it = API.FindLayer(layer)
        if it is None:
            continue
        s = int(it.Serial)
        if s in seen:
            continue
        seen.add(s)
        snap["equipped"].append(item_dict(it, tooltip_lines(s), None, layer))

    # 2) the ONE root: the backpack (nested bags walked exactly like the full scanner does)
    backpack = int(API.Backpack)
    n = scan_root(backpack, "backpack", "Backpack", snap["containers"], snap["items"], seen)
    if API.StopRequested:
        sysmsg("Pack Rat refresh stopped.", ALARM_HUE)
        return
    if n < 0:
        # The backpack could not be listed: writing a snapshot now would still replace the worn set,
        # so a taken-off piece would vanish. Write nothing and say so.
        sysmsg(f"Pack Rat refresh ({char}): backpack could not be read — nothing written.", ALARM_HUE)
        return
    snap["roots"].append({"serial": backpack, "kind": "backpack", "name": "Backpack", "opened": True})

    fname = re.sub(r"[^A-Za-z0-9_-]", "_", char) + time.strftime("-%Y%m%d-%H%M%S") + "-quick.json"
    path = os.path.join(OUT_DIR, fname)
    write_json_atomic(path, snap)
    bags = sum(1 for c in snap["containers"].values() if c.get("kind") == "container")
    sysmsg(f"Pack Rat refresh ({char}) done in {time.time() - t0:.0f}s: {len(snap['equipped'])} worn, "
           f"{n} backpack items in {bags} bags, {len(snap['skills'])} skills -> {fname}")
    sysmsg(f"  bank and ground containers untouched (app keeps its last scan of them)", INFO_HUE)


main()
