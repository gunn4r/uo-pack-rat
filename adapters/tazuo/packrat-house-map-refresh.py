# packrat-house-map-refresh.py — ATTENDED one-shot: HOUSE MAP refresh for the Pack Rat app (issue #10).
# Records only the house you stand in, exactly as a full scan's house section does: its tiles (every
# level), the furniture standing in it, and every container on its floor, as far as the client has
# them. Opens nothing and asks the server nothing (no tooltip or property request), so it takes a
# moment and moves nothing in the inventory: the app reads this file for the House map alone.
#
# Helpers below are copied VERBATIM from packrat-scanner.py rather than imported: Legion runs
# a script by exec'ing the file and its `__name__` semantics are unverified, so the proven scanner
# cannot yet carry an `if __name__ == "__main__"` guard (it would either never run or run on
# import). adapters/test_scanners.py keeps the copies identical.
#
# Trash: the scanner also leaves out a container its roots pass learnt is trash from the tooltip.
# This script reads no tooltip, so it knows trash by the client's cached name only (TRASHED stays
# empty), plus the blacklist; a corpse is never a container.
#
# Output: <data directory>/inbox/tazuo/<Character>-<YYYYmmdd-HHMMSS>-house.json, a house-only file
# (`"kind": "house"`, no inventory; docs/scan-schema.md). The app's inbox watcher (app/watcher.mjs)
# picks it up and moves it into <data directory>/scans/ under its own accepted name. Outside a house,
# or on a client build without the multi calls, it writes nothing and says so. The data directory is
# `packrat-paths.json` beside this script, else $PACKRAT_DATA, else ~/.pack-rat.
# RUN: press Play anywhere inside a house. Nothing rule-sensitive — stay attended.

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
ADAPTER_VERSION = "2.14.0"
CAPABILITIES = {
    "layers": ["OneHanded", "TwoHanded", "Shoes", "Pants", "Shirt", "Helmet", "Gloves",
               "Ring", "Talisman", "Necklace", "Waist", "Torso", "Bracelet", "Tunic",
               "Earrings", "Arms", "Cloak", "Robe", "Skirt", "Legs"],
    "arms": True, "bank": True, "ground": True, "nested": True, "tooltips": "opl",
    "bridge": ["highlight", "grab", "goto", "trip", "trip-bags"],
}


HOUSE_RADIUS = 40        # tiles searched around the player for the house's tiles (a castle is about 32 across)
HOUSE_MAX_TILES = 20000  # a capture larger than this is left out rather than bloating the scan
HOUSE_ITEM_REACH = 18    # the server sends ground items within about this many tiles
HOUSE_MULTI_IDS = (0x13EC, 0x147B)   # custom-house multi ids (ServUO HousePlacementTool.cs)
HOUSE_ITEM_CENTRE_RADIUS = 2   # the bounds include steps and the rim, so their centre sits up to about a tile off the multi origin, and an even-sized plot has a .5 centre
HOUSE_MAX_ITEMS = 5000   # the scan schema's cap on house items: past it the nearest are kept, so the scan file still validates
HOUSE_MAX_CONTAINERS = 5000  # the scan schema's cap on the house's containers: past it the nearest are kept
BLACKLIST = set(e["serial"] for e in read_blacklist(os.path.join(data_dir(), "scan-blacklist.json")))
TRASHED = set()          # always empty here: this script reads no tooltip, so trash is known by its cached name alone
HOUSE_LEFT_OUT = set()   # furniture past HOUSE_MAX_ITEMS this run left out of the house section (the farthest from the player)
HOUSE_TOO_LARGE = []     # the tile count of a house this run left out for passing HOUSE_MAX_TILES
OUT_DIR = os.path.join(data_dir(), "inbox", "tazuo")
ALARM_HUE, OK_HUE, INFO_HUE = 33, 68, 88

CONTAINER_RE = re.compile(r"\b(chest|box|toolbox|crate|bag|pouch|basket|trunk|armoire|cabinet|backpack)\b", re.I)
# Named like a container (or carrying a bag graphic) but never one: a deed places an addon, a bag
# of sending raises a target cursor, a music box plays. Double-clicking them opens nothing. A book of
# any kind (spellbooks of every school, runebooks, a runic atlas, a tome) is a container to the
# client, but double-clicking one opens a spellbook or runebook window, never a container window.
NOT_A_CONTAINER_RE = re.compile(r"\b(deed(?!\s+box)|sending|music box|\w*book|tome|atlas|compendium)\b", re.I)   # a "Commodity Deed Box" IS one
# The books by graphic too, whatever they are called (ServUO's item classes; the first three seen live).
NOT_A_CONTAINER_GRAPHICS = {0x0EFA, 0x2D50, 0x2D9D, 0x2252, 0x2253, 0x225A, 0x225B, 0x238C, 0x23A0, 0x22C5, 0x9C16}
# A trash barrel or chest is a real container, but the server deletes its contents on a timer, so
# nothing in one is worth recording. Never opened, never recorded, contents included. By name only:
# a trash barrel has the same graphic as an ordinary barrel.
TRASH_RE = re.compile(r"\btrash\b", re.I)
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


def facet():
    """The map the player stands on (0 Felucca .. 5 Ter Mur), and so every ground root's: they are all
    within reach. None when the client cannot say. GetMap() is looked up with getattr, since the Legion
    stub is sometimes ahead of the running build; anything but 0-5 is left out."""
    get_map = getattr(API, "GetMap", None)
    try:
        m = int(get_map())
    except Exception:
        return None
    return m if 0 <= m <= 5 else None


def house_capture(px, py):
    """The house the player stands in, from the client's own house tiles (issue #10), or None outside a house or on a build without the multi calls. Only the tiles connected to the player's tile are kept (8-connected in x/y, across every z), so a neighbouring house is left out. What stands on the ground inside that footprint is recorded too (both left out when the ground cannot be read): furniture and fixtures as `items`, and every container as `containers` (2.11.0), opened or not, so the map shows a chest from the first scan even when it stood too far away to open; corpses, trash containers and blacklisted ones are left out (trash by name, or because the roots pass, which runs first, read its tooltip; a far trash container whose cached name is generic cannot be told apart without a tooltip query, which this never makes). Names come from tiledata in the app, so this asks the server nothing. A house of more than HOUSE_MAX_TILES tiles is left out and its count noted in HOUSE_TOO_LARGE."""
    at = getattr(API, "GetMultisAt", None)
    area = getattr(API, "GetMultisInArea", None)
    if at is None or area is None:
        return None
    try:
        if not list(at(px, py) or []):
            return None
        found = list(area(px - HOUSE_RADIUS, py - HOUSE_RADIUS, px + HOUSE_RADIUS, py + HOUSE_RADIUS) or [])
    except Exception:
        return None
    cells = {}
    for m in found:
        try:
            t = [int(m.Graphic), int(m.X), int(m.Y), int(m.Z), 1 if bool(getattr(m, "Impassible", False)) else 0]
        except Exception:
            continue
        cells.setdefault((t[1], t[2]), []).append(t)
    if (px, py) not in cells:
        return None
    keep = {(px, py)}
    todo = [(px, py)]
    while todo:
        x, y = todo.pop()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                n = (x + dx, y + dy)
                if n in cells and n not in keep:
                    keep.add(n)
                    todo.append(n)
    tiles = sorted(t for c in keep for t in cells[c])
    if len(tiles) > HOUSE_MAX_TILES:
        HOUSE_TOO_LARGE.append(len(tiles))
        return None
    house = {"capturedAt": rfc3339_now(), "at": {"x": int(px), "y": int(py)}, "tiles": tiles}
    f = facet()
    if f is not None:
        house["facet"] = f
    # The furniture: when the ground cannot be read, items is left out, so the app erases nothing it knew from an earlier capture (an empty list would say the house stands empty).
    on_ground = getattr(API, "GetItemsOnGround", None)
    try:
        ground = list(on_ground(HOUSE_ITEM_REACH) or []) if on_ground is not None else None
    except Exception:
        ground = None
    if ground is None:
        return house
    items, chests = [], []
    for g in ground:
        try:
            if (int(g.X), int(g.Y)) not in keep:
                continue
            row = [int(g.Serial), int(getattr(g, "Graphic", 0) or 0), int(g.X), int(g.Y), int(getattr(g, "Z", 0) or 0)]
            name = str(getattr(g, "Name", "") or "")
            if not is_container(g, name):
                items.append(row)
            elif row[0] not in BLACKLIST and row[0] not in TRASHED and not TRASH_RE.search(name):
                chests.append(row)
        except Exception:
            continue

    def nearest(row):
        return (max(abs(row[2] - px), abs(row[3] - py)), row[0])
    # The house itself is an Item whose graphic is its multi id (ServUO Scripts/Multis/HousePlacementTool.cs: 0x13EC to 0x147B), standing at the plot centre. ServUO's Telescope addon (Scripts/Items/Addons/Telescope.cs) also has a component with graphic 0x147B, so only the one in-range item nearest the centre of the tiles' x/y bounds is dropped (ties to the lowest serial), and only when it is within HOUSE_ITEM_CENTRE_RADIUS of that centre.
    multis = [r for r in items if HOUSE_MULTI_IDS[0] <= r[1] <= HOUSE_MULTI_IDS[1]]
    if multis:
        xs, ys = [c[0] for c in keep], [c[1] for c in keep]
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        best = min(multis, key=lambda r: ((r[2] - cx) ** 2 + (r[3] - cy) ** 2, r[0]))
        if max(abs(best[2] - cx), abs(best[3] - cy)) <= HOUSE_ITEM_CENTRE_RADIUS:
            items.remove(best)
    items.sort(key=nearest)
    HOUSE_LEFT_OUT.update(i[0] for i in items[HOUSE_MAX_ITEMS:])
    house["items"] = sorted(items[:HOUSE_MAX_ITEMS])
    chests.sort(key=nearest)
    house["containers"] = sorted(chests[:HOUSE_MAX_CONTAINERS])
    return house


# ---------------- the house map refresh itself ----------------
def main():
    char = str(API.Player.Name)
    try:
        house = house_capture(int(API.Player.X), int(API.Player.Y))
    except Exception:
        house = None
    if API.StopRequested:
        sysmsg("Pack Rat house map refresh stopped — nothing written.", ALARM_HUE)
        return
    if house is None:
        if HOUSE_TOO_LARGE:
            sysmsg(f"Pack Rat house map refresh: house too large to record ({HOUSE_TOO_LARGE[0]} tiles) — nothing written.", ALARM_HUE)
        else:
            sysmsg("Pack Rat house map refresh: you are not inside a house (or this client cannot read house tiles) — nothing written.", ALARM_HUE)
        return
    snap = {"schemaVersion": 2, "kind": "house", "character": char,
            "scannedAt": rfc3339_now(),
            "adapter": {"id": ADAPTER_ID, "version": ADAPTER_VERSION, "client": "TazUO",
                        "clientVersion": None, "capabilities": CAPABILITIES},
            "stats": {}, "roots": [], "containers": {}, "items": [], "equipped": [],
            "house": house}
    fname = re.sub(r"[^A-Za-z0-9_-]", "_", char) + time.strftime("-%Y%m%d-%H%M%S") + "-house.json"
    write_json_atomic(os.path.join(OUT_DIR, fname), snap)
    n = len(HOUSE_LEFT_OUT)
    left_out = f" ({n} farther {'one' if n == 1 else 'ones'} left out)" if n else ""
    c = len(house.get("containers", []))
    furniture = f"{len(house['items'])} pieces of furniture{left_out}, {c} container{'s' if c != 1 else ''}" if "items" in house else "furniture and containers not read"
    sysmsg(f"Pack Rat house map refresh ({char}) -> {fname}: {len(house['tiles'])} tiles, {furniture}")


main()
