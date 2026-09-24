# packrat-scanner.py -- ATTENDED one-shot: snapshot everything this character can see for the
# Pack Rat app. Reads every equipped layer, the backpack (nested bags included), the bank box if
# it is already open, and every openable ground container within SCAN_RANGE tiles (recursively:
# bags in chests in chests). Dumps RAW tooltip lines -- the app does all the parsing, so this
# script stays dumb and never needs updating when a new item property shows up.
#
# Output: <data directory>/inbox/razor-enhanced/<Character>-<YYYYmmdd-HHMMSS>.json (one file per
# run). The app's inbox watcher (app/watcher.mjs) picks it up, normalises it and moves it into
# <data directory>/scans/ -- the app folds every scan on disk, newest wins per container, so
# re-scan any chest any time. The data directory is `packrat-paths.json` beside this script, else
# $PACKRAT_DATA, else ~/.pack-rat.
# RUN: stand next to a chest cluster (containers must be within reach to open), start this script
# from the Scripts tab. Repeat at each cluster / on each character. Inventory-only, nothing
# rule-sensitive -- stay attended throughout.
#
# Unverified against a live client -- see README.md's "Status" section for exactly what that
# means and what to check on the first real run.

import json
import os
import re
import time


def data_dir():
    """<script folder>/packrat-paths.json {"dataDir": "..."} -> $PACKRAT_DATA -> ~/.pack-rat"""
    try:
        here = os.path.dirname(os.path.abspath(__file__))
    except NameError:                    # a host that runs the script text without defining __file__
        here = ""
    cfg = os.path.join(here, "packrat-paths.json") if here else ""
    if cfg and os.path.exists(cfg):
        with open(cfg, "r", encoding="utf-8") as f:
            d = json.load(f).get("dataDir")
        if d:
            return os.path.expanduser(d)
    return os.path.expanduser(os.environ.get("PACKRAT_DATA") or "~/.pack-rat")


def write_json_atomic(path, obj):
    out_dir = os.path.dirname(path)
    if not os.path.exists(out_dir):
        os.makedirs(out_dir)
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


ADAPTER_ID = "razor-enhanced"
ADAPTER_VERSION = "1.5.0"
# Keep this literal in sync with capabilities.json -- a test enforces the two never drift apart
# for the TazUO adapter (test_paths.py) and the same discipline applies here by hand until this
# adapter has its own test.
CAPABILITIES = {
    "layers": ["RightHand", "LeftHand", "Shoes", "Pants", "Shirt", "Head", "Gloves", "Ring",
               "Talisman", "Neck", "Waist", "InnerTorso", "Bracelet", "MiddleTorso", "Earrings",
               "Arms", "Cloak", "OuterTorso", "OuterLegs", "InnerLegs"],
    "arms": True, "bank": True, "ground": True, "nested": True, "tooltips": "opl",
    "bridge": ["highlight", "grab", "goto"],
}

# Razor Enhanced's own equip-layer names (Player.GetItemOnLayer / Items.Filter.Layers), not
# TazUO's naming -- Hair and FacialHair are excluded here on purpose: RE lists them as layers too
# (Player.CheckLayer / GetItemOnLayer), but they're not gear (hair style/color, not equipment) and
# Items.Filter.Layers -- RE's own "wearable Items" enumeration -- leaves them out for the same
# reason. See README.md "What this adapter reads" for the full citation.
GEAR_LAYERS = CAPABILITIES["layers"]

SCAN_RANGE = 3            # tiles: ground containers within reach (house chests open only when close)
SCAN_GROUND = True        # False = backpack/bank only, never touch containers on the ground
GROUND_ONLY_AT_HOME = True    # when the bank box is already open (you are at a bank) skip ground containers
CONTENTS_WAIT_MS = 1500   # Items.WaitForContents' own open-and-wait timeout, per container
PROPS_WAIT_MS = 800       # Items.WaitForProps' own request-and-wait timeout, per item
MAX_NEST = 4              # bags in bags in bags
BLACKLIST = set(e["serial"] for e in read_blacklist(os.path.join(data_dir(), "scan-blacklist.json")))
SKIPPED = set()           # blacklisted containers this run never opened
OPENED_HERE = []          # containers this run opened itself, in opening order (close_opened)
OUT_DIR = os.path.join(data_dir(), "inbox", "razor-enhanced")
ALARM_HUE, OK_HUE, INFO_HUE = 33, 68, 88


def sysmsg(msg, hue=OK_HUE):
    # Misc.SendMessage prints to this client's own message area -- never a network speech packet,
    # unlike Player.ChatSay/ChatYell/ChatWhisper (see docs/bridge-protocol.md's "adapters never
    # speak publicly" rule, and README.md's Sources section for the citation on this distinction).
    Misc.SendMessage(msg, hue, False)


def as_int(v, default=0):
    try:
        return int(v)
    except Exception:
        return default


def as_float(v, default=0.0):
    try:
        return float(v)
    except Exception:
        return default


def tooltip_lines(it):
    """RAW tooltip lines for one Item, via Item.Properties (List[Property]; Property.ToString()
    renders one line, per razorenhanced.readthedocs.io/api/Property.html). Requests the read first
    with WaitForProps -- an Item's Properties can be empty/stale until the client has asked the
    server for them at least once."""
    try:
        Items.WaitForProps(it, PROPS_WAIT_MS)
    except Exception:
        pass
    lines = []
    try:
        props = it.Properties or []
    except Exception:
        props = []
    for p in props:
        try:
            line = str(p).strip()
        except Exception:
            continue
        if line:
            lines.append(line)
    return lines


def item_dict(it, lines, container_serial, layer=None):
    d = {
        "serial": as_int(getattr(it, "Serial", 0)),
        "graphic": as_int(getattr(it, "ItemID", 0)),
        "hue": as_int(getattr(it, "Hue", 0)),
        "amount": as_int(getattr(it, "Amount", 1), 1) or 1,
        "name": lines[0] if lines else str(getattr(it, "Name", "") or ""),
        "tooltip": lines,
        "container": container_serial,
        "nameSource": "opl",
    }
    if layer:
        d["layer"] = layer
    return d


# Named like a container (or carrying a bag graphic) but never one: a deed places an addon, a bag of
# sending raises a target cursor, a music box plays. Opening them opens nothing. A book of any kind
# (spellbooks of every school, runebooks, a runic atlas, a tome) is a container to the client, but
# opening one opens a spellbook or runebook window, never a container window.
NOT_A_CONTAINER_RE = re.compile(r"\b(deed(?!\s+box)|sending|music box|\w*book|tome|atlas|compendium)\b", re.I)   # a "Commodity Deed Box" IS one
# The books by graphic too, whatever they are called (ServUO's item classes; the first three seen live).
NOT_A_CONTAINER_GRAPHICS = {0x0EFA, 0x2D50, 0x2D9D, 0x2252, 0x2253, 0x225A, 0x225B, 0x238C, 0x23A0, 0x22C5, 0x9C16}


def is_container(it):
    # Only the client's own IsContainer flag says yes; there is no name fallback, so armour named
    # like a chest ("Platemail Chest") is never taken for one.
    try:
        if bool(getattr(it, "IsCorpse", False)) or as_int(getattr(it, "ItemID", 0)) == 0x2006:
            return False          # corpses are containers to the client; never open them
    except Exception:
        pass
    try:
        if NOT_A_CONTAINER_RE.search(str(getattr(it, "Name", "") or "")):
            return False          # "Wooden Chest deed", "a bag of sending", a spellbook: see NOT_A_CONTAINER_RE
        if as_int(getattr(it, "ItemID", 0)) in NOT_A_CONTAINER_GRAPHICS:
            return False
        return bool(getattr(it, "IsContainer", False))
    except Exception:
        return False


def root_pos(it, kind):
    """World position of a ground container (so the bridge can walk to it later); None for pack/bank."""
    if kind != "ground":
        return None
    try:
        pos = it.Position
        return {"x": as_int(pos.X), "y": as_int(pos.Y), "z": as_int(pos.Z)}
    except Exception:
        return None


def container_entry(cont, root_serial, opened):
    lines = tooltip_lines(cont)
    entry = {"serial": as_int(getattr(cont, "Serial", 0)),
             "name": lines[0] if lines else str(getattr(cont, "Name", "") or ""),
             "parent": as_int(getattr(cont, "Container", 0), root_serial) or root_serial,
             "root": root_serial, "kind": "container", "tooltip": lines}
    if not opened:
        entry["opened"] = False
    return entry


def scan_root(root_item, kind, label, containers, items, seen):
    """Open root_item and every nested container inside it, breadth-first, up to MAX_NEST levels
    deep, listing everything. Returns (item_count, opened) -- opened=False means the root itself
    could not be opened (too far, locked, a slow server): the app's fold then keeps whatever it last
    knew about this root instead of wiping it (see docs/scan-schema.md's Fold rules). A bag INSIDE
    the root that did not open, or sits deeper than MAX_NEST, is recorded with "opened": False, and
    the fold keeps whatever it last knew inside that one bag while the rest of the root updates."""
    root_serial = as_int(getattr(root_item, "Serial", 0))
    queue = [root_item]
    seen_containers = set()
    n_items = 0
    depth = 0
    while queue and depth < MAX_NEST:
        depth += 1
        next_queue = []
        for cont in queue:
            cserial = as_int(getattr(cont, "Serial", 0))
            if cserial in seen_containers:
                continue
            seen_containers.add(cserial)
            note_if_closed(cont)
            try:
                arrived = bool(Items.WaitForContents(cont, CONTENTS_WAIT_MS))
            except Exception:
                arrived = False
            try:
                kids = list(cont.Contains or [])
            except Exception:
                kids = []
            # WaitForContents timed out and the client holds nothing for it: unopened, not empty.
            # (Whether RE answers True for a bag that opened EMPTY is undocumented; if it does not,
            # an empty bag lands here too, which only keeps its -- empty -- old contents.)
            unopened = not arrived and not kids
            if cserial == root_serial:
                if unopened:
                    return 0, False
                containers[root_serial] = {"serial": root_serial, "name": label, "parent": None,
                                           "root": root_serial, "kind": kind, "pos": root_pos(root_item, kind)}
            else:
                containers[cserial] = container_entry(cont, root_serial, not unopened)
                if unopened:
                    note_unopened(containers[cserial], label)
            for kid in kids:
                ks = as_int(getattr(kid, "Serial", 0))
                if ks in seen:
                    continue
                seen.add(ks)
                if ks in BLACKLIST:       # recorded unopened, never opened: the fold keeps what it knew inside
                    SKIPPED.add(ks)
                    containers[ks] = container_entry(kid, root_serial, False)
                    continue
                if is_container(kid):
                    next_queue.append(kid)
                else:
                    items.append(item_dict(kid, tooltip_lines(kid), cserial))
                    n_items += 1
        queue = next_queue
    # Anything still queued here was found (its parent container was already opened) but MAX_NEST
    # was reached before it could be opened itself: recorded as a bag not opened, so the fold keeps
    # what it knew inside it -- the same handling adapters/tazuo/packrat-scanner.py gives the case.
    for cont in queue:
        entry = container_entry(cont, root_serial, False)
        containers[entry["serial"]] = entry
        note_unopened(entry, label)
    return n_items, True


def note_if_closed(cont):
    """Remember a container this run is about to open for the first time, so close_opened() closes
    only windows the run opened. Item.ContainerOpened is RE's documented "the container was opened"
    flag: RE sets it when the contents first arrive and never clears it when the window closes, so a
    container opened any time earlier this session (by the player, or by an earlier scan) counts as
    already open and is left open. That errs on the side of never closing a window the player opened."""
    try:
        if not bool(getattr(cont, "ContainerOpened", False)):
            OPENED_HERE.append(as_int(getattr(cont, "Serial", 0)))
    except Exception:
        pass


def close_opened():
    """Close the container windows this run opened, innermost first, with RE's documented
    Items.Close(serial) ("Close opened container window"). Runs once everything has been read and the
    scan file written, or after the script is stopped or fails, so it never changes what is recorded.
    A build without Items.Close leaves the windows open rather than raising."""
    close = getattr(Items, "Close", None)
    for serial in reversed(OPENED_HERE):
        if close is None:
            break
        try:
            close(serial)
        except Exception:
            pass
    del OPENED_HERE[:]


def note_unopened(entry, label):
    sysmsg("  {0} in {1} was not opened -- its contents are kept from the last scan".format(
        entry["name"] or "a bag", label), ALARM_HUE)


# Razor Enhanced's own skill names (Player.GetRealSkillValue / Player.UseSkill's documented
# argument list). Several differ from the names the game shows and the app reads ("Magic Resist"
# for "Resisting Spells", "Swords" for "Swordsmanship", ...), so each is written under the game's
# name: the app's Resisting Spells resist bonus, for one, looks for exactly that key. Skill names,
# unlike RE's torso layers, map one to one.
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


def main():
    t0 = time.time()
    char = str(Player.Name)
    snap = {
        "schemaVersion": 2, "character": char,
        "scannedAt": rfc3339_now(),
        "adapter": {"id": ADAPTER_ID, "version": ADAPTER_VERSION, "client": "Razor Enhanced",
                    "clientVersion": None, "capabilities": CAPABILITIES},
        "stats": {"str": as_int(Player.Str), "dex": as_int(Player.Dex), "int": as_int(Player.Int)},
        "position": {"x": as_int(Player.Position.X), "y": as_int(Player.Position.Y)},
        "maxes": {"hits": as_int(Player.HitsMax), "stam": as_int(Player.StamMax), "mana": as_int(Player.ManaMax)},
        "resists": {"phys": as_int(Player.AR), "fire": as_int(Player.FireResistance),
                    "cold": as_int(Player.ColdResistance), "poison": as_int(Player.PoisonResistance),
                    "energy": as_int(Player.EnergyResistance)},
        "skills": read_skills(),
        "equipped": [], "roots": [], "containers": {}, "items": [],
    }
    seen = set()

    # 1) equipped layers (arms included -- Player.GetItemOnLayer documents "Arms" as a readable layer)
    for layer in GEAR_LAYERS:
        it = Player.GetItemOnLayer(layer)
        if it is None:
            continue
        s = as_int(getattr(it, "Serial", 0))
        if s in seen:
            continue
        seen.add(s)
        snap["equipped"].append(item_dict(it, tooltip_lines(it), None, layer))
    sysmsg("Pack Rat scan ({0}): {1} equipped pieces read.".format(char, len(snap["equipped"])))

    # 2) roots: backpack, bank (only if already open this session), ground containers in reach
    roots = [(Player.Backpack, "backpack", "Backpack")]
    bank_has_items = False
    try:
        bank_item = Player.Bank
        bank_has_items = bank_item is not None and len(list(bank_item.Contains or [])) > 0
    except Exception:
        bank_item = None
    if bank_has_items:
        roots.append((bank_item, "bank", "Bank box"))
    scan_ground = SCAN_GROUND and not (GROUND_ONLY_AT_HOME and bank_has_items)
    if SCAN_GROUND and bank_has_items and GROUND_ONLY_AT_HOME:
        sysmsg("Bank is open: ground containers skipped (backpack + bank only).", INFO_HUE)
    if scan_ground:
        try:
            f = Items.Filter()
            f.Enabled = True
            f.OnGround = 1
            f.IsContainer = 1
            f.IsCorpse = 0
            f.RangeMax = SCAN_RANGE
            ground = Items.ApplyFilter(f) or []
        except Exception:
            ground = []
        for g in ground:
            if as_int(getattr(g, "Serial", 0)) in BLACKLIST:
                SKIPPED.add(as_int(getattr(g, "Serial", 0)))
                continue
            roots.append((g, "ground", str(getattr(g, "Name", "") or "container")))

    counts = []
    for root_item, kind, label in roots:
        n, opened = scan_root(root_item, kind, label, snap["containers"], snap["items"], seen)
        serial = as_int(getattr(root_item, "Serial", 0))
        snap["roots"].append({"serial": serial, "kind": kind, "name": label, "opened": opened})
        if not opened:
            counts.append("{0}: not opened (skipped)".format(label))
            continue
        counts.append("{0}: {1}".format(label, n) + (" (empty)" if n == 0 else ""))

    safe_char = "".join(c if (c.isalnum() or c in "_-") else "_" for c in char)
    fname = safe_char + time.strftime("-%Y%m%d-%H%M%S") + ".json"
    path = os.path.join(OUT_DIR, fname)
    write_json_atomic(path, snap)
    sysmsg("Pack Rat scan done in {0:.0f}s: {1} items in {2} containers -> {3}".format(
        time.time() - t0, len(snap["items"]), len(snap["roots"]), fname))
    for c in counts:
        sysmsg("  " + c, INFO_HUE)
    if SKIPPED:
        sysmsg("  skipped {0} blacklisted container{1}".format(len(SKIPPED), "s" if len(SKIPPED) != 1 else ""), INFO_HUE)


try:
    main()
finally:
    close_opened()
