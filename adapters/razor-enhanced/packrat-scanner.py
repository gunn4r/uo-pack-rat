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
import time


def data_dir():
    """<script folder>/packrat-paths.json {"dataDir": "..."} -> $PACKRAT_DATA -> ~/.pack-rat"""
    here = os.path.dirname(os.path.abspath(__file__))
    cfg = os.path.join(here, "packrat-paths.json")
    if os.path.exists(cfg):
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


ADAPTER_ID = "razor-enhanced"
ADAPTER_VERSION = "1.1.0"
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


def is_container(it):
    try:
        if bool(getattr(it, "IsCorpse", False)):
            return False          # corpses are containers to the client; never open them
    except Exception:
        pass
    try:
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


def scan_root(root_item, kind, label, containers, items, seen):
    """Open root_item and every nested container inside it, breadth-first, up to MAX_NEST levels
    deep, listing everything. Returns (item_count, opened) -- opened=False means the root itself
    could not be opened (too far, locked): the app's fold then keeps whatever it last knew about
    this root instead of wiping it (see docs/scan-schema.md's Fold rules)."""
    root_serial = as_int(getattr(root_item, "Serial", 0))
    queue = [(root_item, None)]
    seen_containers = set()
    n_items = 0
    depth = 0
    while queue and depth < MAX_NEST:
        depth += 1
        next_queue = []
        for cont, _parent_unused in queue:
            cserial = as_int(getattr(cont, "Serial", 0))
            if cserial in seen_containers:
                continue
            seen_containers.add(cserial)
            try:
                Items.WaitForContents(cont, CONTENTS_WAIT_MS)
            except Exception:
                continue
            if cserial != root_serial:
                lines = tooltip_lines(cont)
                parent = as_int(getattr(cont, "Container", 0), root_serial) or root_serial
                containers[cserial] = {"serial": cserial, "name": lines[0] if lines else str(getattr(cont, "Name", "") or ""),
                                       "parent": parent, "root": root_serial, "kind": "container",
                                       "tooltip": lines}
            try:
                kids = list(cont.Contains or [])
            except Exception:
                kids = []
            for kid in kids:
                ks = as_int(getattr(kid, "Serial", 0))
                if ks in seen:
                    continue
                seen.add(ks)
                if is_container(kid):
                    next_queue.append((kid, cserial))
                else:
                    lines = tooltip_lines(kid)
                    items.append(item_dict(kid, lines, cserial))
                    n_items += 1
        queue = next_queue
    # Anything still queued here was found (its parent container was already opened) but MAX_NEST
    # was reached before it could be opened itself. Record it as an ordinary (unopened) item, its
    # own tooltip intact, instead of silently dropping it and everything that would have been
    # inside it -- matches adapters/tazuo/packrat-scanner.py's handling of the same case (an
    # over-deep bag becomes an item, not a hole in the scan).
    for cont, parent in queue:
        lines = tooltip_lines(cont)
        items.append(item_dict(cont, lines, parent))
        n_items += 1
    opened = root_serial in seen_containers
    if opened:
        containers[root_serial] = {"serial": root_serial, "name": label, "parent": None,
                                   "root": root_serial, "kind": kind, "pos": root_pos(root_item, kind)}
    return n_items, opened


# Razor Enhanced's own skill names (Player.GetRealSkillValue / Player.UseSkill's documented
# argument list) -- these differ from TazUO's ("EvalInt" not "Evaluating Intelligence", "Magic
# Resist" not "Resisting Spells", "Macing" not "Mace Fighting", "Blacksmith" not "Blacksmithy",
# "Inscribe" not "Inscription", "Spell Weaving" not "Spellweaving", "Detect Hidden" not "Detecting
# Hidden", "Item ID" not "Item Identification"). docs/scan-schema.md's `skills` field says "Keys
# are skill names as the client shows them" -- these are what this client shows.
SKILL_NAMES = [
    "Alchemy", "Anatomy", "Animal Lore", "Item ID", "Arms Lore", "Parry", "Begging", "Blacksmith",
    "Fletching", "Peacemaking", "Camping", "Carpentry", "Cartography", "Cooking", "Detect Hidden",
    "Discordance", "EvalInt", "Healing", "Fishing", "Forensics", "Herding", "Hiding", "Provocation",
    "Inscribe", "Lockpicking", "Magery", "Magic Resist", "Mysticism", "Tactics", "Snooping",
    "Musicianship", "Poisoning", "Archery", "Spirit Speak", "Stealing", "Tailoring", "Animal Taming",
    "Taste ID", "Tinkering", "Tracking", "Veterinary", "Swords", "Macing", "Fencing", "Wrestling",
    "Lumberjacking", "Mining", "Meditation", "Stealth", "Remove Trap", "Necromancy", "Focus",
    "Chivalry", "Bushido", "Ninjitsu", "Spell Weaving", "Imbuing",
]


def read_skills():
    # Same three fields as TazUO's adapter, same meaning: "value" is Player.GetSkillValue,
    # documented as "the value of the skill, with modifiers" -- the effective, item-bonused number
    # the paperdoll shows (e.g. Resisting Spells' gear bonus is folded in). "base" is
    # Player.GetRealSkillValue, documented as "the base/real value" -- the trained skill with no
    # gear added. "cap" is Player.GetSkillCap. Gate on the effective value, same as TazUO's own
    # `sk.Value` gate, so a skill with real value 0 but a positive item bonus (rare, but possible)
    # still gets reported.
    out = {}
    for name in SKILL_NAMES:
        val = as_float(Player.GetSkillValue(name), -1.0)
        if val <= 0:
            continue
        base = as_float(Player.GetRealSkillValue(name), val)
        cap = as_float(Player.GetSkillCap(name), 0.0)
        out[name] = {"value": round(val, 1), "base": round(base, 1), "cap": round(cap, 1)}
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


main()
