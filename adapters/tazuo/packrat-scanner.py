# packrat-scanner.py — ATTENDED one-shot: snapshot everything this character can see for
# the Pack Rat app. Reads every equipped layer, the backpack (nested bags included), the
# bank box if it is open, and every openable container within SCAN_RANGE tiles (recursively: bags
# in chests in chests). Dumps RAW tooltips — the app does all parsing, so this script stays dumb
# and never needs updating when a new property shows up.
#
# Output: <data directory>/inbox/tazuo/<Character>-<YYYYmmdd-HHMMSS>.json (one file per run). The
# app's inbox watcher (app/watcher.mjs) picks it up, normalises it and moves it into <data
# directory>/scans/ under its own accepted name — the app folds all of those, newest wins per
# container, so re-scan any chest any time. The data directory is `packrat-paths.json` beside
# this script, else $PACKRAT_DATA, else ~/.pack-rat.
# RUN: stand next to a chest cluster (containers must be within reach to open), press Play. Repeat
# at each cluster / on each character. Inventory-only, nothing rule-sensitive — stay attended.

import API
import json
import os
import re
import time


def data_dir():
    """<script folder>/packrat-paths.json {"dataDir": "..."} → $PACKRAT_DATA → ~/.pack-rat"""
    try:
        here = os.path.dirname(os.path.abspath(__file__))
    except NameError:                    # a host that runs the script text without defining __file__
        try:
            here = str(API.ScriptPath)
        except Exception:
            here = ""
    cfg = os.path.join(here, "packrat-paths.json") if here else ""
    if cfg and os.path.exists(cfg):
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
ADAPTER_VERSION = "2.2.0"
CAPABILITIES = {
    "layers": ["OneHanded", "TwoHanded", "Shoes", "Pants", "Shirt", "Helmet", "Gloves",
               "Ring", "Talisman", "Necklace", "Waist", "Torso", "Bracelet", "Tunic",
               "Earrings", "Arms", "Cloak", "Robe", "Skirt", "Legs"],
    "arms": True, "bank": True, "ground": True, "nested": True, "tooltips": "opl",
    "bridge": ["highlight", "grab", "goto"],
}


SCAN_RANGE = 3           # tiles: ground containers within reach (house chests open only when close)
SCAN_GROUND = True       # False = backpack/bank only, never touch containers on the ground
GROUND_ONLY_AT_HOME = True   # when the bank box is open (you are at a bank) skip ground containers entirely
PAUSE_OPEN = 1.2         # after UseObject on a container (raise on laggy connections)
MAX_NEST = 4             # bags in bags in bags
OUT_DIR = os.path.join(data_dir(), "inbox", "tazuo")
ALARM_HUE, OK_HUE, INFO_HUE = 33, 68, 88

ALL_LAYERS = ["OneHanded", "TwoHanded", "Shoes", "Pants", "Shirt", "Helmet", "Gloves",
              "Ring", "Talisman", "Necklace", "Waist", "Torso", "Bracelet", "Tunic",
              "Earrings", "Arms", "Cloak", "Robe", "Skirt", "Legs"]
CONTAINER_RE = re.compile(r"\b(chest|box|crate|bag|pouch|basket|trunk|armoire|cabinet|backpack)\b", re.I)
DEED_RE = re.compile(r"\bdeed\b", re.I)
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
    if DEED_RE.search(name or ""):
        return False              # "Wooden Chest deed": double-clicking it raises a placement cursor
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


def dist(item):
    try:
        return max(abs(int(item.X) - int(API.Player.X)), abs(int(item.Y) - int(API.Player.Y)))
    except Exception:
        return 999


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


def was_opened(serial):
    """The client's own word that a container's contents arrived (its gump opened)."""
    try:
        it = API.FindItem(int(serial))
        return it is not None and bool(getattr(it, "Opened", False))
    except Exception:
        return False


def scan_root(root_serial, kind, label, containers, items, seen):
    """Open root + every nested container, list everything. Returns the item count, or -1 when the
    root must not be recorded at all (it or a bag inside it did not open, or Stop was pressed): the
    app's fold replaces a whole root at once, so a partial read would erase what it knew."""
    root_serial = int(root_serial)
    opened, to_open, listing = set(), [root_serial], []
    for _ in range(MAX_NEST):
        fresh = [c for c in to_open if c not in opened]
        if not fresh:
            break
        for c in fresh:
            if API.StopRequested:
                return -1
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
    if API.StopRequested:
        return -1
    if not listing:
        # Opened-but-empty is a fact worth recording (the app then clears whatever it last knew about
        # this container). Not opened (too far, locked) is not: return -1 so the app keeps its memory.
        if was_opened(root_serial):
            containers[root_serial] = {"serial": root_serial, "name": label, "parent": None,
                                       "root": root_serial, "kind": kind, "pos": root_pos(root_serial, kind)}
            return 0
        return -1
    # The same test for every bag inside: one that lists nothing and never opened (locked, or its
    # contents lagged) cannot be told apart from an empty one, so the whole root goes unrecorded.
    parents = set(int(getattr(it, "Container", 0) or 0) for it in listing)
    for c in opened:
        if c != root_serial and c not in parents and not was_opened(c):
            sysmsg(f"  a bag inside {label} did not open — {label} not recorded, the app keeps what it knew", ALARM_HUE)
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


def main():
    t0 = time.time()
    p = API.Player
    char = str(p.Name)
    snap = {"schemaVersion": 2, "character": char,
            "scannedAt": rfc3339_now(),
            "adapter": {"id": ADAPTER_ID, "version": ADAPTER_VERSION, "client": "TazUO",
                        "clientVersion": None, "capabilities": CAPABILITIES},
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
    sysmsg(f"Pack Rat scan ({char}): {len(snap['equipped'])} equipped pieces read.")

    # 2) roots: backpack, bank (if open), ground containers in reach
    roots = [(int(API.Backpack), "backpack", "Backpack")]
    try:
        bank = int(API.Bank)
        if bank and (API.ItemsInContainer(bank) or []):
            roots.append((bank, "bank", "Bank box"))
    except Exception:
        pass
    bank_open = any(r[1] == "bank" for r in roots)
    scan_ground = SCAN_GROUND and not (GROUND_ONLY_AT_HOME and bank_open)
    ground = (API.GetItemsOnGround(SCAN_RANGE) or []) if scan_ground else []
    if SCAN_GROUND and bank_open and GROUND_ONLY_AT_HOME:
        sysmsg("Bank is open: ground containers skipped (backpack + bank only).", INFO_HUE)
    for g in ground:
        try:
            if dist(g) > SCAN_RANGE:
                continue
            lines = tooltip_lines(g.Serial)
            gname = lines[0] if lines else str(getattr(g, "Name", "") or "")
            if is_container(g, gname):
                roots.append((int(g.Serial), "ground", gname or "container"))
        except Exception:
            continue

    counts = []
    for serial, kind, label in roots:
        if API.StopRequested:
            sysmsg("Pack Rat scan stopped — nothing written.", ALARM_HUE)
            return
        n = scan_root(serial, kind, label, snap["containers"], snap["items"], seen)
        opened = n >= 0
        # Could not open it (too far / locked): still listed, but opened:False and no items, so the
        # app's fold keeps whatever it last knew about this root instead of wiping it.
        snap["roots"].append({"serial": int(serial), "kind": kind, "name": label, "opened": opened})
        if not opened:
            counts.append(f"{label}: not opened (skipped)")
            continue
        counts.append(f"{label}: {n}" + (" (empty)" if n == 0 else ""))
    if API.StopRequested:
        # Stop landed while the last root was opening: that root reads as not opened, but a stopped
        # scan is not a scan the player asked for. Write nothing.
        sysmsg("Pack Rat scan stopped — nothing written.", ALARM_HUE)
        return

    fname = re.sub(r"[^A-Za-z0-9_-]", "_", char) + time.strftime("-%Y%m%d-%H%M%S") + ".json"
    path = os.path.join(OUT_DIR, fname)
    write_json_atomic(path, snap)
    sysmsg(f"Pack Rat scan done in {time.time() - t0:.0f}s: {len(snap['items'])} items in "
           f"{len(snap['roots'])} containers -> {fname}")
    for c in counts:
        sysmsg("  " + c, INFO_HUE)


main()
