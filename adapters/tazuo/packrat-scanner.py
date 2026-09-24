# packrat-scanner.py — ATTENDED one-shot: snapshot everything this character can see for
# the Pack Rat app. Reads every equipped layer, the backpack (nested bags included), the
# bank box if it is open, and every openable container within SCAN_RANGE tiles (recursively: bags
# in chests in chests). Dumps RAW tooltips — the app does all parsing, so this script stays dumb
# and never needs updating when a new property shows up. When done (or stopped) it closes the
# container windows it opened itself; one you already had open stays open.
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


def read_blacklist(path):
    """The valid entries of <data directory>/scan-blacklist.json, the containers the player blacklisted
    ({serial, name, addedAt, where?}). A bad entry is dropped, and a missing, unreadable or oversized
    file reads as none: the list can only ever make a scan skip containers."""
    try:
        if os.path.getsize(path) > 256 * 1024:
            return []
        with open(path, "r", encoding="utf-8") as f:
            doc = json.load(f)
        return [e for e in doc if isinstance(e, dict) and type(e.get("serial")) is int and 0 < e["serial"] <= 0xFFFFFFFF]
    except Exception:
        return []


ADAPTER_ID = "tazuo"
ADAPTER_VERSION = "2.5.0"
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
OPENED_HERE = []         # container windows this run opened itself, in opening order (close_opened)
BLACKLIST = set(e["serial"] for e in read_blacklist(os.path.join(data_dir(), "scan-blacklist.json")))
SKIPPED = set()          # blacklisted containers this run never opened
STOP_CLOSE_S = 1.5       # after a Stop, stop closing windows after this long: the client gives a stopped script 2 s
OUT_DIR = os.path.join(data_dir(), "inbox", "tazuo")
ALARM_HUE, OK_HUE, INFO_HUE = 33, 68, 88

ALL_LAYERS = ["OneHanded", "TwoHanded", "Shoes", "Pants", "Shirt", "Helmet", "Gloves",
              "Ring", "Talisman", "Necklace", "Waist", "Torso", "Bracelet", "Tunic",
              "Earrings", "Arms", "Cloak", "Robe", "Skirt", "Legs"]
CONTAINER_RE = re.compile(r"\b(chest|box|toolbox|crate|bag|pouch|basket|trunk|armoire|cabinet|backpack)\b", re.I)
# Named like a container (or carrying a bag graphic) but never one: a deed places an addon, a bag
# of sending raises a target cursor, a music box plays. Double-clicking them opens nothing. A book of
# any kind (spellbooks of every school, runebooks, a runic atlas, a tome) is a container to the
# client, but double-clicking one opens a spellbook or runebook window, never a container window.
NOT_A_CONTAINER_RE = re.compile(r"\b(deed(?!\s+box)|sending|music box|\w*book|tome|atlas|compendium)\b", re.I)   # a "Commodity Deed Box" IS one
# The books by graphic too, whatever they are called (ServUO's item classes; the first three seen live).
NOT_A_CONTAINER_GRAPHICS = {0x0EFA, 0x2D50, 0x2D9D, 0x2252, 0x2253, 0x225A, 0x225B, 0x238C, 0x23A0, 0x22C5, 0x9C16}
# A piece of armour or clothing is never a container, however its name reads ("Platemail Chest"). No
# "gargish" here: a Gargish Chest is a real container; gargoyle armour is caught by the client's
# own wearable flag instead.
WEARABLE_RE = re.compile(r"\b(plate\w*|chain\w*|ring\s*mail|studded|leather|armou?r)\b", re.I)
# Engraved bags and Backpacks match no name pattern — detect by graphic too (probe-verified Aug 2026).
CONTAINER_GRAPHICS = {0x0E75, 0x0E76, 0x0E79, 0x0E7D, 0x09AA, 0x09A8, 0x09A9, 0x09AB,
                      0x0E3C, 0x0E3D, 0x0E3E, 0x0E3F, 0x0E40, 0x0E41, 0x0E42, 0x0E43,
                      0x0E7C, 0x0E7E, 0x0E7F, 0xA32F, 0xA333,
                      0x4025, 0x4026}   # Gargish Chest: UO Alive's tiledata does not flag it


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
        graphic = int(getattr(item, "Graphic", 0) or 0)
    except Exception:
        graphic = 0
    try:
        if bool(getattr(item, "IsCorpse", False)) or graphic == 0x2006:
            return False          # corpses are containers to the client; never open them
    except Exception:
        pass
    if NOT_A_CONTAINER_RE.search(name or "") or graphic in NOT_A_CONTAINER_GRAPHICS:
        return False              # "Wooden Chest deed", "a bag of sending", a spellbook: see NOT_A_CONTAINER_RE
    try:
        if bool(getattr(item, "IsContainer", False)):
            return True
    except Exception:
        pass
    if graphic in CONTAINER_GRAPHICS:
        return True
    # Last, the name, which the client's own flags have not vouched for: never for armour or clothing
    # ("Platemail Chest", "Gargish Stone Chest"), by its name or by the client's tiledata calling it
    # wearable.
    if WEARABLE_RE.search(name or ""):
        return False
    try:
        get_data = getattr(item, "GetItemData", None)
        if get_data is not None and bool(getattr(get_data(), "IsWearable", False)):
            return False
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


def note_if_closed(serial):
    """Remember a container whose window is not open yet, just before this run opens it, so
    close_opened() closes exactly the windows the run opened and never one the player had open. The
    client's own item object is kept rather than the serial: once Stop is pressed the client cancels
    the script's lookups (FindItem answers nothing), while an item object still reaches its window."""
    try:
        it = API.FindItem(int(serial))
        if it is not None and not bool(getattr(it, "Opened", False)):
            OPENED_HERE.append(it)
    except Exception:
        pass


def scan_root(root_serial, kind, label, containers, items, seen):
    """Open root + every nested container, list everything. Returns the item count, or -1 when the
    root must not be recorded at all (it did not open, or Stop was pressed): the app's fold replaces a
    whole root at once, so a partial read would erase what it knew. A bag INSIDE the root that did not
    open, or sits deeper than MAX_NEST, is recorded with "opened": False, and the fold keeps whatever
    it last knew inside that one bag."""
    root_serial = int(root_serial)
    opened, to_open, listing = set(), [root_serial], []
    for _ in range(MAX_NEST):
        fresh = [c for c in to_open if c not in opened]
        if not fresh:
            break
        for c in fresh:
            if API.StopRequested:
                return -1
            note_if_closed(c)
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
            if is_container(it, nm) and s not in opened and s not in to_open and s not in BLACKLIST:
                to_open.append(s)
    if BLACKLIST:
        listing = without_blacklisted(listing)
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
    # contents lagged) cannot be told apart from an empty one, and nor can one found past MAX_NEST.
    parents = set(int(getattr(it, "Container", 0) or 0) for it in listing)
    unopened = set(c for c in opened if c != root_serial and c not in parents and not was_opened(c))
    unopened.update(c for c in to_open if c not in opened)
    listed = set(int(it.Serial) for it in listing if int(it.Serial) in BLACKLIST)
    SKIPPED.update(listed)
    unopened.update(listed)       # never opened: the fold keeps what it last knew inside a blacklisted bag
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
        if s in opened or s in unopened:
            cname = lines[0] if lines else str(it.Name or "")
            containers[s] = {"serial": s, "name": cname, "parent": parent, "root": root_serial,
                             "kind": "container", "tooltip": lines}
            if s in unopened:
                containers[s]["opened"] = False
            if s in unopened and s not in BLACKLIST:
                sysmsg(f"  {cname or 'a bag'} in {label} was not opened — its contents are kept from the last scan", ALARM_HUE)
            continue
        items.append(item_dict(it, lines, parent))
        n += 1
    return n


def without_blacklisted(listing):
    """A root's listing minus everything inside a blacklisted bag: the client may still hold its contents
    from an earlier open. The bag itself stays, and scan_root records it unopened."""
    parent = dict((int(it.Serial), int(getattr(it, "Container", 0) or 0)) for it in listing)
    out = []
    for it in listing:
        s = parent.get(int(it.Serial))
        for _ in range(MAX_NEST + 2):
            if s is None or s in BLACKLIST:
                break
            s = parent.get(s)
        if s not in BLACKLIST:
            out.append(it)
    return out


def close_opened():
    """Close the container windows this run opened, innermost first. Runs once everything has been
    read and the scan file written, or after a Stop or an error, so it never changes what is recorded.
    Every call is looked up with getattr: a client build without GetContainerGump() or Dispose()
    leaves the window open rather than raising. API.CloseGump(serial) is no fallback, since it finds
    gumps by their server gump id and a container window has none.

    A container showing a name plate cannot be closed this way. GetContainerGump() asks
    UIManager.GetGump(serial), which walks the gump list from its Last node and returns the first gump
    of ANY kind with that serial, then checks it is a container window. UIManager.Add() puts a window
    in front (AddFirst), but a name plate is added with front=false (AddLast), behind every window, so
    while the item has a plate the lookup finds the plate and answers None, whenever it is asked. Such
    windows stay open and are counted in a message. Upstream: PlayTazUO/TazUO#1087 and PR #1088.

    After a Stop the loop is bounded by STOP_CLOSE_S. Stop sets StopRequested, cancels the script's
    token and interrupts its thread (a ThreadInterruptedException at the next blocking call, such as
    API.Pause, which is why this finally still runs), and the client detaches a stopped script's
    thread after 2 s. Each GetContainerGump() waits on the client's main thread, so a long list could
    outlive that and leave the script unable to restart: whatever is not closed in time stays open."""
    started, left = time.time(), 0
    for it in reversed(OPENED_HERE):
        if API.StopRequested and time.time() - started >= STOP_CLOSE_S:
            break
        try:
            get_gump = getattr(it, "GetContainerGump", None)
            gump = get_gump() if get_gump is not None else None
            dispose = getattr(gump, "Dispose", None) if gump is not None else None
            if dispose is not None:
                dispose()
                continue
            if not bool(getattr(it, "Opened", True)):
                continue          # it never opened (locked, out of reach): there is no window
        except Exception:
            pass
        left += 1
    del OPENED_HERE[:]
    if left:
        try:
            sysmsg(f"Pack Rat: {left} container window{'s' if left != 1 else ''} this run opened could not be "
                   f"closed (TazUO cannot find a window while its name plate shows) - close by hand.", INFO_HUE)
        except Exception:
            pass


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
            if int(g.Serial) in BLACKLIST:
                SKIPPED.add(int(g.Serial))
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
    if SKIPPED:
        sysmsg(f"  skipped {len(SKIPPED)} blacklisted container{'s' if len(SKIPPED) != 1 else ''}", INFO_HUE)


try:
    main()
finally:
    close_opened()
