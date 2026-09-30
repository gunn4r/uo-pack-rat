# packrat-bridge.py — ATTENDED bridge between the Pack Rat app and the game. Run it
# while you are at home (or wherever the items are) and leave it running; the app's Highlight /
# Grab / Go to buttons queue commands into the data directory's bridge/tazuo/queue.jsonl and this
# script executes them:
#   highlight : walk to the container if it is not in reach, open the bag chain, flash the item's name
#               above it (local-only overhead text) and mark the chest's tile for a few seconds
#   grab      : same, then move the item into your backpack and verify it landed
#   goto      : walk to the container
#   trip      : Organize. Take up to 20 items from your labelled containers into your backpack, then
#               put each one into the container it belongs in, reporting every step; an item whose
#               container can be reached from the same spot goes straight there instead
# Status (alive timestamp + last results) goes to bridge/tazuo/status.json for the app's indicator.
# The data directory is `packrat-paths.json` beside this script, else $PACKRAT_DATA, else
# ~/.pack-rat.
# Inventory-only: nothing is attacked, looted or gathered. Bounded by MAX_HOURS; Stop ends it cleanly.
# Commands written before this script started are ignored (it starts reading at the end of the file).
#
# The queue file is an ordinary file that any local process can write, so this script trusts nothing
# in it: every line is re-validated here (see "untrusted input", below), stale and duplicate commands
# are refused, only containers are ever opened, grabs only ever pull from your own backpack/bank or
# from the container chain the same command just opened, and a queue being written faster than a
# person clicks stops the bridge outright.
# A trip may only put away items this bridge took itself (or is taking right now, for a direct
# move), never into your own pack, a corpse, a pack
# a mobile carries, a trash container or a blacklisted one, and it halts between steps when the app
# writes the stop flag.

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
ADAPTER_VERSION = "2.9.0"
CAPABILITIES = {
    "layers": ["OneHanded", "TwoHanded", "Shoes", "Pants", "Shirt", "Helmet", "Gloves",
               "Ring", "Talisman", "Necklace", "Waist", "Torso", "Bracelet", "Tunic",
               "Earrings", "Arms", "Cloak", "Robe", "Skirt", "Legs"],
    "arms": True, "bank": True, "ground": True, "nested": True, "tooltips": "opl",
    "bridge": ["highlight", "grab", "goto", "trip", "trip-bags"],
}
# The actions a queue line may name. "trip-bags" is not one: it tells the app this bridge's trips check a bag
# is empty before taking it (issue #128), so an older bridge is never sent one.
ACTIONS = [a for a in CAPABILITIES["bridge"] if a != "trip-bags"]


BRIDGE_DIR = os.path.join(data_dir(), "bridge", "tazuo")
QUEUE = os.path.join(BRIDGE_DIR, "queue.jsonl")
STATUS = os.path.join(BRIDGE_DIR, "status.json")
STOP_FLAG = os.path.join(data_dir(), "bridge", "stop")   # POST /api/bridge/stop writes it; every trip clears it first
BLACKLIST_PATH = os.path.join(data_dir(), "scan-blacklist.json")   # read at the start of every trip
POLL_S = 0.5
MAX_HOURS = 8
REACH = 2                 # tiles: containers open only when this close
DIRECT_TRIES = 6          # tiles in reach of both containers a direct move tries to path to (stand_by_both)
WALK_TIMEOUT_S = 20
WALK_POLL_S = 0.5
PAUSE_OPEN = 1.0          # after double-clicking a container: the most it waits for the window (wait_opened)
OPEN_FLOOR_S = 0.6        # ...and the least: the server refuses a use or lift within 0.5 s of a use (ServUO ActionDelay)
OPEN_POLL_S = 0.05        # how often it looks whether the window opened
MOVE_WAIT_S = 1.5         # a trip's move that has not landed by then bounced
MOVE_POLL_S = 0.05        # how often a trip looks whether its move landed
LATE_LOOK_S = 0.5         # ...and how long after MOVE_WAIT_S it looks once more before calling a put bounced
EMPTY_RECHECK_S = 0.3     # between the two reads that must both find a bag empty before a trip takes it
CONTENTS_RE = re.compile(r"contents:\s*(\d+)", re.I)   # a container tooltip's "Contents: 3/125 Items, ..." line
MOVE_GAP_S = 0.35         # least time between two of a trip's moves, in case the shard throttles drag and drop
STATUS_EVERY_S = 2.0      # heartbeat: the app calls the bridge offline once `alive` is 8 s old
HIGHLIGHT_S = 8
HIGHLIGHT_HUE = 53        # bright yellow-green
MARK_HUE = 53
ALARM_HUE, OK_HUE, INFO_HUE = 33, 68, 88
PACK_MAX_ITEMS = 125      # a backpack's item cap (ServUO's Container default MaxItems)
TAKE_DROP = (60, 90)      # where a trip drops what it takes, inside the backpack window: a drop at a spot never stacks

# ---- untrusted input ---------------------------------------------------------------------------
# <dataDir>/bridge/<adapter>/queue.jsonl is an ordinary file: the app writes it, but so can any
# other local process, so the bridge validates every line itself instead of trusting that the server
# already did. Everything from here to the end of this section is pure -- no game API, no files --
# so adapters/test_adapters.py can drive it directly, and the block is byte-identical in every
# adapter's bridge (that test asserts it), which is why it is ASCII and uses .format() rather than
# this file's own em dashes and f-strings: Razor Enhanced's IronPython carries the same text.
MAX_CHAIN = 8              # containers one command may open (app/ui/bridge.mts's own chainOf guard)
MAX_NAME = 120             # a name is only ever printed on screen
MAX_ID = 64                # the app's ids are 36-character UUIDs; a result is keyed by one
MAX_AGE_S = 60             # a command is a click: anything older is a replayed backlog
CLOCK_SKEW_S = 5           # same machine, but the clocks still tick apart
BUDGET_WINDOW_S = 60       # rolling window for MAX_CMDS_PER_WINDOW
MAX_CMDS_PER_WINDOW = 40   # a 20-piece "Grab all" is legitimate; a flood is not
MAX_CMDS_PER_POLL = 4      # the rest waits for the next poll -- deferred, never dropped
MAX_PENDING = 64           # stop reading the queue file while this many are still waiting
MAX_READ_BYTES = 262144    # bytes consumed from the queue file per poll
MAX_LINE_BYTES = 16384     # bytes in one command line
MAX_RESULTS = 30           # the status file's rolling window, bounded in memory too
MAX_SEEN_IDS = 500         # executed ids kept for duplicate suppression
MAX_WALK_TILES = 24        # the client's own view range: never walk off toward a far-away tile
MAP_MAX_X = 7168           # the widest UO facet (Britannia); every other facet is smaller
MAP_MAX_Y = 4096
MAP_MIN_Z = -128
MAP_MAX_Z = 127
MAX_FACET = 5              # 0 Felucca, 1 Trammel, 2 Ilshenar, 3 Malas, 4 Tokuno, 5 Ter Mur
MAX_TRIP_TAKES = 20        # app/organize.mts's tripItems default: one trip is one click
MAX_TRIP_PUTS = 40         # this trip's own puts plus leftovers from a stopped one ("Put them away")
MAX_TRIP_NAME = 40         # app/bridge-trip.mts cuts every name in a trip to this
MAX_TRIP_INDEX = 10000     # the trip's number in its plan, only ever printed on screen


def days_from_civil(y, m, d):
    """Days from 1970-01-01 to y-m-d, proleptic Gregorian (Howard Hinnant's days_from_civil)."""
    if m <= 2:
        y -= 1
    era = (y if y >= 0 else y - 399) // 400
    yoe = y - era * 400
    mp = m - 3 if m > 2 else m + 9
    doy = (153 * mp + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def parse_rfc3339(text):
    """'2026-01-01T12:00:00.000Z' or '...+02:00' -> epoch seconds UTC; None when unreadable."""
    try:
        s = str(text).strip()
        if len(s) < 20 or s[4] != "-" or s[7] != "-" or s[10] not in ("T", "t", " "):
            return None
        y, mo, d = int(s[0:4]), int(s[5:7]), int(s[8:10])
        hh, mi, ss = int(s[11:13]), int(s[14:16]), int(s[17:19])
        rest = s[19:]
        if rest[:1] == ".":
            i = 1
            while i < len(rest) and rest[i].isdigit():
                i += 1
            rest = rest[i:]
        if rest in ("Z", "z"):
            off = 0
        elif len(rest) == 6 and rest[0] in ("+", "-") and rest[3] == ":":
            off = int(rest[1:3]) * 3600 + int(rest[4:6]) * 60
            if rest[0] == "-":
                off = -off
        else:
            return None
        return days_from_civil(y, mo, d) * 86400 + hh * 3600 + mi * 60 + ss - off
    except Exception:
        return None


def is_serial(v):
    """A JSON integer that could be an object serial. Bools are ints in Python, so exclude them."""
    return isinstance(v, int) and not isinstance(v, bool) and v > 0


def check_pos(pos):
    """None, or {x, y, z} integers on the map with an optional facet. Returns (pos, reason)."""
    if pos is None:
        return None, ""
    if not isinstance(pos, dict):
        return None, "pos is not an object"
    out = {}
    for key, low, high in (("x", 0, MAP_MAX_X), ("y", 0, MAP_MAX_Y), ("z", MAP_MIN_Z, MAP_MAX_Z)):
        v = pos.get(key)
        if not isinstance(v, int) or isinstance(v, bool):
            return None, "pos." + key + " is not an integer"
        if v < low or v > high:
            return None, "pos." + key + " is off the map"
        out[key] = v
    facet = pos.get("facet")
    if facet is not None:
        if not isinstance(facet, int) or isinstance(facet, bool) or facet < 0 or facet > MAX_FACET:
            return None, "pos.facet is not a known map"
        out["facet"] = facet
    for key in pos:
        if key not in ("x", "y", "z", "facet"):
            return None, "pos carries an unknown field"
    return out, ""


def check_id(cmd):
    """The command's id, or why it has none the page could match a result to. Returns (id, reason)."""
    cid = cmd.get("id")
    if not isinstance(cid, str) or not cid:
        return None, "command has no id"
    if len(cid) > MAX_ID:
        return None, "command id is longer than {0} characters".format(MAX_ID)
    return cid, ""


def check_age(queued_at, now_s):
    """"" when a queuedAt stamp is fresh enough to run, else why not."""
    queued = parse_rfc3339(queued_at)
    if queued is None:
        return "queuedAt is missing or unreadable"
    age = now_s - queued
    if age > MAX_AGE_S:
        return "expired: queued {0}s ago, not run".format(int(age))
    if age < -CLOCK_SKEW_S:
        return "expired: queued in the future, not run"
    return ""


def check_command(cmd, actions, now_s):
    """Validate one parsed queue line against the bridge v1 contract. Returns (command, reason)."""
    if not isinstance(cmd, dict):
        return None, "queue line is not a JSON object"
    cid, why = check_id(cmd)
    if why:
        return None, why
    if cmd.get("action") not in actions:
        return None, "unknown action"
    if not is_serial(cmd.get("serial")):
        return None, "serial is not an item serial"
    chain = cmd.get("chain")
    if chain is None:
        chain = []
    if not isinstance(chain, list):
        return None, "chain is not a list"
    if len(chain) > MAX_CHAIN:
        return None, "chain is longer than {0} containers".format(MAX_CHAIN)
    for c in chain:
        if not is_serial(c):
            return None, "chain holds something that is not a container serial"
    pos, why = check_pos(cmd.get("pos"))
    if why:
        return None, why
    name = cmd.get("name")
    if name is None:
        name = ""
    if not isinstance(name, str):
        return None, "name is not a string"
    why = check_age(cmd.get("queuedAt"), now_s)
    if why:
        return None, why
    return {"id": cid, "action": cmd["action"], "serial": int(cmd["serial"]),
            "name": name[:MAX_NAME], "chain": [int(c) for c in chain], "pos": pos}, ""


def split_lines(raw, saturated):
    """Split a byte chunk into whole lines. Returns (lines, bytes consumed). A trailing partial
    line is left for the next poll, and an over-long line comes back as None (a refusal, never a
    silent drop). `saturated` says the read filled MAX_READ_BYTES, so a chunk with no newline in it
    at all is a line longer than one whole read rather than an append still in progress."""
    cut = raw.rfind(b"\n")
    if cut < 0:
        return ([None], len(raw)) if saturated else ([], 0)
    lines = []
    for part in raw[:cut].split(b"\n"):
        if not part.strip():
            continue
        lines.append(None if len(part) > MAX_LINE_BYTES else part.decode("utf-8", "replace"))
    return lines, cut + 1


def budget_ok(stamps, now_s):
    """Rolling-window command budget: drops stamps that aged out, True when one more fits."""
    while stamps and now_s - stamps[0] > BUDGET_WINDOW_S:
        stamps.pop(0)
    return len(stamps) < MAX_CMDS_PER_WINDOW


def within_walk(px, py, x, y):
    """A destination the character could plausibly walk to from where it is standing right now."""
    return max(abs(int(x) - int(px)), abs(int(y) - int(py))) <= MAX_WALK_TILES


def resolve_root(serial, find_fn):
    """The outermost container above `serial` that the client can resolve. The walk stops at a
    parent that is not an item (a mobile: you, or another player), so what comes back is always a
    container serial, never a mobile's. `find_fn(serial)` returns an item-like object, or None."""
    cur = int(serial)
    for _ in range(MAX_CHAIN + 1):
        it = find_fn(cur)
        if it is None:
            return cur
        try:
            parent = int(getattr(it, "Container", 0) or 0)
        except Exception:
            parent = 0
        if not parent or parent == cur or find_fn(parent) is None:
            return cur
        cur = parent
    return cur


def chain_problem(chain, i, it, own):
    """Why chain[i] must not be opened, or "" when it may. `it` is the live item for chain[i] and
    `own` the serials of the player's own backpack and bank. The root has to be one of those or lie
    on the ground -- never a container another mobile carries -- and every later entry has to sit
    directly inside the entry before it, so a chain only ever leads down into its own root."""
    c = int(chain[i])
    if i == 0:
        if c in own or bool(getattr(it, "OnGround", False)):
            return ""
        return "refused: 0x{0:x} is not on the ground, your backpack or your open bank box".format(c)
    try:
        parent = int(getattr(it, "Container", 0) or 0)
    except Exception:
        parent = 0
    if parent != int(chain[i - 1]):
        return "refused: 0x{0:x} is not inside 0x{1:x} -- rescan and try again".format(c, int(chain[i - 1]))
    return ""


def check_path(path, what):
    """A container path [root, ...bags]: 1 to MAX_CHAIN serials. Returns (path, reason)."""
    if not isinstance(path, list) or not path:
        return None, what + " is not a list of containers"
    if len(path) > MAX_CHAIN:
        return None, "{0} is longer than {1} containers".format(what, MAX_CHAIN)
    for c in path:
        if not is_serial(c):
            return None, what + " holds something that is not a container serial"
    return [int(c) for c in path], ""


def check_steps(entries, key, limit, roots, what):
    """A trip's takes (key "chain") or puts (key "dest"): at most `limit` objects {serial, name, key},
    no serial twice, each path starting at a container `roots` places. Returns (steps, reason)."""
    if not isinstance(entries, list):
        return None, what + " is not a list"
    if len(entries) > limit:
        return None, "{0} has more than {1} entries".format(what, limit)
    out = []
    seen = set()
    for e in entries:
        if not isinstance(e, dict):
            return None, what + " holds something that is not an object"
        if not is_serial(e.get("serial")):
            return None, what + " holds a serial that is not an item serial"
        serial = int(e["serial"])
        if serial in seen:
            return None, "{0} names 0x{1:x} twice".format(what, serial)
        seen.add(serial)
        path, why = check_path(e.get(key), what + " " + key)
        if why:
            return None, why
        if path[0] not in roots:
            return None, "{0} {1} starts at 0x{2:x}, which roots does not place".format(what, key, path[0])
        name = e.get("name")
        if name is None:
            name = ""
        if not isinstance(name, str):
            return None, what + " holds a name that is not a string"
        out.append({"serial": serial, "name": name[:MAX_TRIP_NAME], key: path})
    return out, ""


def check_trip(cmd, now_s):
    """Validate one parsed trip line (app/schema/bridge-trip.v1.schema.json). Returns (trip, reason);
    roots come back keyed by int serial, every name cut to MAX_TRIP_NAME, and queuedAt as `queued`
    (epoch seconds, fraction dropped) for the stop flag's age check."""
    if not isinstance(cmd, dict):
        return None, "queue line is not a JSON object"
    cid, why = check_id(cmd)
    if why:
        return None, why
    if cmd.get("action") != "trip":
        return None, "unknown action"
    index = cmd.get("index")
    if not isinstance(index, int) or isinstance(index, bool) or index < 1 or index > MAX_TRIP_INDEX:
        return None, "index is not a trip number"
    stamp = cmd.get("stamp")
    if not isinstance(stamp, str) or not stamp or len(stamp) > MAX_ID:
        return None, "stamp is not a plan stamp"
    raw = cmd.get("roots")
    if not isinstance(raw, dict) or len(raw) > MAX_TRIP_TAKES + MAX_TRIP_PUTS:
        return None, "roots is not an object of at most {0} containers".format(MAX_TRIP_TAKES + MAX_TRIP_PUTS)
    roots = {}
    for key in raw:
        if not isinstance(key, str) or not key or len(key) > 10 or [ch for ch in key if ch not in "0123456789"]:
            return None, "roots has a key that is not a container serial"
        if not is_serial(int(key)):
            return None, "roots has a key that is not a container serial"
        pos, why = check_pos(raw[key])
        if why:
            return None, "roots: " + why
        if pos is None:
            return None, "roots gives 0x{0:x} no position".format(int(key))
        roots[int(key)] = pos
    takes, why = check_steps(cmd.get("takes"), "chain", MAX_TRIP_TAKES, roots, "takes")
    if why:
        return None, why
    puts, why = check_steps(cmd.get("puts"), "dest", MAX_TRIP_PUTS, roots, "puts")
    if why:
        return None, why
    if not takes and not puts:
        return None, "trip has nothing to do"
    why = check_age(cmd.get("queuedAt"), now_s)
    if why:
        return None, why
    return {"id": cid, "action": "trip", "index": index, "stamp": stamp, "name": "#{0}".format(index),
            "queued": parse_rfc3339(cmd.get("queuedAt")), "roots": roots, "takes": takes, "puts": puts}, ""


def check_line(cmd, actions, now_s):
    """A trip goes to check_trip on a bridge that runs trips; everything else, and a trip on a bridge
    that does not, goes to check_command, which refuses an action the bridge lacks."""
    if isinstance(cmd, dict) and cmd.get("action") == "trip" and "trip" in actions:
        return check_trip(cmd, now_s)
    return check_command(cmd, actions, now_s)


# ---- end of the untrusted-input section --------------------------------------------------------

# Container detection, copied verbatim from packrat-scanner.py (adapters/test_adapters.py asserts
# the two stay identical): the bridge double-clicks whatever `chain` names, and double-click is UO's
# universal "use" verb — a potion drinks, a rune recalls, a deed places. Only containers, and never
# corpses, may be opened.
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

results = {}              # id -> {ok, msg}
# The ids in the order they were recorded: the client's Python does not keep a dict in insertion order
# (issue #140), so trimming or writing by dict order could drop the newest result.
result_order = []
counts = {"done": 0, "failed": 0}
last_status = {"current": None, "at": 0.0, "character": ""}
pending = []              # validated commands waiting their turn (module-level so write_stopped sees them)
carried = set()           # serials this bridge took on a trip and has not yet put away: a put may only name one
# Containers the running trip has double-clicked since its last walk, and when its last move went out.
# Opening a container once is enough: the client keeps the contents it has been sent after the window
# closes, and the server checks only reach when an item is lifted or dropped (walk_to sees to that). A
# walk empties the set, since a container left behind can fall out of the client's view and forget its
# contents; so does the start of every trip, and so does finding the character on another tile than
# when the set was last filled (the player walked by hand mid-trip, out of range and back perhaps). The
# one walk that keeps it is stand_by_both's step of a tile or two, which forgets only the containers
# whose root it left out of reach. Keyed by container, each entry holds its chain's root.
trip_opened = {}
trip_spot = {"at": None}  # the character's tile when trip_opened was last added to
last_move = {"at": 0.0}


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


def tooltip_lines(serial):
    try:
        data = API.ItemNameAndProps(int(serial), True)
    except Exception:
        data = None
    return [ln.strip() for ln in str(data or "").splitlines() if ln.strip()]


def is_trash(serial, name):
    """A container is trash by its tooltip name ("A Trash Barrel"): the client's own cached name for the
    art may be just "barrel". The cached name is the fallback when the tooltip reads nothing."""
    lines = tooltip_lines(serial)
    return bool(TRASH_RE.search(lines[0] if lines else name or ""))


def sysmsg(msg, hue=OK_HUE):
    API.SysMsg(msg, hue)


def write_status(current=None):
    last_status["current"], last_status["at"] = current, time.time()
    try:
        keep = {cid: results[cid] for cid in result_order}
        last_status["character"] = str(API.Player.Name)
        write_json_atomic(STATUS, {"alive": rfc3339_now(),
                                    "character": last_status["character"], "current": current,
                                    "results": keep, "counts": counts})
    except Exception as e:
        sysmsg(f"bridge: status write failed: {e}", ALARM_HUE)


def heartbeat():
    """Rewrite the status file during a long action (a highlight, a walk) so the app keeps seeing the
    bridge online and keeps its buttons working; cheap to call often."""
    if time.time() - last_status["at"] >= STATUS_EVERY_S:
        write_status(last_status["current"])


def record(cid, ok, msg, extra=None):
    """One result, trimmed in memory so the final whole-dict status write is bounded too. A trip adds
    `extra` ({steps, partial, stopped})."""
    results[cid] = {"ok": bool(ok), "msg": str(msg), "t": rfc3339_now()}
    if extra:
        results[cid].update(extra)
    if cid in result_order:
        result_order.remove(cid)
    result_order.append(cid)
    while len(result_order) > MAX_RESULTS:
        results.pop(result_order.pop(0), None)
    counts["done" if ok else "failed"] += 1
    sysmsg(f"bridge: {msg}", OK_HUE if ok else ALARM_HUE)


def dist_to(x, y):
    return max(abs(int(x) - int(API.Player.X)), abs(int(y) - int(API.Player.Y)))


def find(serial):
    try:
        return API.FindItem(int(serial))
    except Exception:
        return None


def own_roots(chain):
    """The containers a grab may legitimately pull from: your backpack, your bank, and the chain
    this very command just walked and opened."""
    allowed = set(int(c) for c in (chain or []))
    for prop in ("Backpack", "Bank"):
        try:
            s = int(getattr(API, prop))
        except Exception:
            s = 0
        if s:
            allowed.add(s)
    return allowed


def wait_for_walk(started, arrived):
    """Poll a non-blocking pathfind until it arrives, gives up, or WALK_TIMEOUT_S passes, keeping the
    status heartbeat going throughout (a blocking pathfind would leave the app calling the bridge
    offline for up to the whole timeout)."""
    if started is False:
        return arrived()                 # no path at all
    busy = getattr(API, "Pathfinding", None)
    deadline = time.time() + WALK_TIMEOUT_S
    while time.time() < deadline and not API.StopRequested:
        API.Pause(WALK_POLL_S)
        heartbeat()
        if arrived():
            return True
        if busy is not None and not busy():
            break
    cancel = getattr(API, "CancelPathfinding", None)
    if busy is not None and busy():
        if cancel is not None:
            cancel()
        # A build with no CancelPathfinding has no way to stop its pathfinder: the character may walk
        # on until the client's own timeout (WALK_TIMEOUT_S, passed to the call) ends it. The command
        # is still reported failed and `current` cleared right after, so the page does not show it as
        # running.
    return arrived()


def walk_to(pos, root_serial):
    """Get within REACH of the container. Uses the live item if the client knows it, else the scanned
    position. A destination further than MAX_WALK_TILES is refused rather than walked to. Your own
    backpack and bank need no walk: they are on you, and a worn container's X/Y is not your position."""
    if int(root_serial) in own_roots([]):
        return True
    it = find(root_serial)
    on_ground = it is not None and bool(getattr(it, "OnGround", False))
    if on_ground:
        if dist_to(it.X, it.Y) <= REACH:
            return True
        if not within_walk(API.Player.X, API.Player.Y, it.X, it.Y):
            return False
        trip_opened.clear()
        started = API.PathfindEntity(int(root_serial), REACH, False, WALK_TIMEOUT_S)
        return wait_for_walk(started, lambda: dist_to(it.X, it.Y) <= REACH)
    if pos:
        if dist_to(pos["x"], pos["y"]) <= REACH:
            return True
        if not within_walk(API.Player.X, API.Player.Y, pos["x"], pos["y"]):
            return False
        trip_opened.clear()
        started = API.Pathfind(int(pos["x"]), int(pos["y"]), int(pos.get("z", 0)), REACH, False, WALK_TIMEOUT_S)
        return wait_for_walk(started, lambda: dist_to(pos["x"], pos["y"]) <= REACH)
    return it is not None and dist_to(it.X, it.Y) <= REACH


def wait_opened(serial):
    """After a double-click: wait OPEN_FLOOR_S, then until the client says the container's window
    opened, PAUSE_OPEN at most. The client sets Opened on the server's open-container packet, which the
    contents packet follows at once, so an empty container is as quick as a full one; one already open
    reads Opened at once and waits just the floor. The floor is not about the client: stock ServUO
    refuses a double-click or a lift that reaches it within ActionDelay (500 ms) of the last
    double-click, so the next bag's open or the first take must not go sooner. A container that never
    opens (locked, out of reach) costs the whole cap, as before."""
    started = time.time()
    API.Pause(OPEN_FLOOR_S)
    while time.time() - started < PAUSE_OPEN and not API.StopRequested:
        try:                  # a build without Opened reads False: the old flat PAUSE_OPEN
            if bool(getattr(find(serial), "Opened", False)):
                return
        except Exception:
            pass
        API.Pause(OPEN_POLL_S)


def open_chain(chain, own=None, check=None, opened=None):
    """Open root, then each nested bag in order. Returns (ok, message). Each entry is checked against
    the live client before it is double-clicked: the root must be on the ground or one of `own` (your
    backpack and bank unless the caller says otherwise; a trip's put passes none), each bag must really
    sit inside the one opened before it (chain_problem), and `check(i, item)` may refuse an entry for a
    reason of the caller's own. A trip passes `opened` (trip_opened): an entry already in it passes the
    same checks but is not double-clicked again, and every entry opened is added to it."""
    own = own_roots([]) if own is None else own
    if opened is not None:
        here = (int(API.Player.X), int(API.Player.Y))
        if trip_spot["at"] != here:
            opened.clear()
            trip_spot["at"] = here
    for i, c in enumerate(chain):
        it = find(c)
        if it is None:
            return False, f"container {i + 1}/{len(chain)} (0x{int(c):x}) is not in view — walk there and try again"
        why = chain_problem(chain, i, it, own) or (check(i, it) if check else "")
        if why:
            return False, why
        if not is_container(it, str(getattr(it, "Name", "") or "")):
            return False, f"refused: 0x{int(c):x} is not a container — the bridge only ever opens containers"
        if opened is not None and int(c) in opened:
            continue
        try:
            API.UseObject(int(c))
        except Exception as e:
            return False, f"could not open container: {e}"
        wait_opened(int(c))
        heartbeat()
        if opened is not None:
            opened[int(c)] = int(chain[0])
    return True, "opened"


def do_highlight(cmd):
    it = find(cmd["serial"])
    if it is None:
        if not cmd.get("chain"):         # a container highlighted as itself: nothing was walked to or opened
            return False, f"{cmd.get('name', 'item')} is not in view — stand where you can see it and try again"
        return False, f"{cmd.get('name', 'item')} is not known to the client here — is this the right place?"
    name = cmd.get("name") or str(getattr(it, "Name", "") or "item")
    # The tile to mark: the root's live one when the client sees it on the ground (the target itself when
    # there is no chain), else the scanned one.
    root = find(cmd["chain"][0]) if cmd.get("chain") else it
    pos = cmd.get("pos")
    if root is not None and getattr(root, "OnGround", False):
        pos = {"x": int(root.X), "y": int(root.Y), "z": int(getattr(root, "Z", 0) or 0)}
    if pos:
        try:
            API.MarkTile(int(pos["x"]), int(pos["y"]), MARK_HUE)
        except Exception:
            pass
    try:
        t_end = time.time() + HIGHLIGHT_S
        while time.time() < t_end and not API.StopRequested:
            try:
                API.HeadMsg(f">>> {name} <<<", int(cmd["serial"]), HIGHLIGHT_HUE)
                if cmd.get("chain"):
                    API.HeadMsg(f"[ {name} is in here ]", int(cmd["chain"][-1]), HIGHLIGHT_HUE)
            except Exception:
                pass
            API.Pause(1.5)
            heartbeat()
    finally:
        if pos:
            try:
                API.RemoveMarkedTile(int(pos["x"]), int(pos["y"]))
            except Exception:
                pass
    return True, f"highlighted {name}"


def do_grab(cmd):
    it = find(cmd["serial"])
    if it is None:
        return False, f"{cmd.get('name', 'item')} is not known to the client here"
    name = cmd.get("name") or str(getattr(it, "Name", "") or "item")
    # The destination is your own backpack and is never a protocol field — see
    # docs/bridge-protocol.md. The SOURCE is checked here: the piece has to be sitting in your own
    # backpack or bank, or inside the container chain this command itself just opened. Anything else
    # (a guild chest someone left open nearby, a stranger's pack, an item lying on the ground) is a
    # serial the client happens to know and the app never scanned — refused, not moved.
    pack = int(API.Backpack)
    root = resolve_root(int(cmd["serial"]), find)
    if root not in own_roots(cmd.get("chain")):
        return False, f"refused: {name} is not in your backpack, your bank, or the container this command opened"
    API.MoveItem(int(cmd["serial"]), pack)
    API.Pause(1.2)
    it2 = find(cmd["serial"])
    if it2 is not None and int(getattr(it2, "Container", 0) or 0) == pack:
        return True, f"grabbed {name} — it is in your backpack"
    return False, f"move bounced for {name} (too far, or backpack full?)"


def stop_requested():
    """The Script Manager's Stop, or Organize's Stop button (the flag POST /api/bridge/stop writes)."""
    return bool(API.StopRequested) or os.path.isfile(STOP_FLAG)   # a directory there cannot be cleared: ignored


def clear_stop():
    try:
        os.remove(STOP_FLAG)
    except OSError:
        pass


def pack_count(pack):
    """Items in the backpack, nested ones included, the way the server counts them toward its cap."""
    count = getattr(API, "Contents", None)       # the Legion stub can be ahead of the running client
    if count is not None:
        try:
            return int(count(pack))
        except Exception:
            pass
    try:
        return len(API.ItemsInContainer(pack, True) or [])
    except Exception:
        return 0


def stones_of(it):
    """What taking `it` adds to the character's load: tiledata weight times amount. Tiledata stores a
    fraction of a stone (arrows, reagents) as 0 and an unknown weight as 255; neither is guessed, so
    such a take is left to the server, whose refusal the landed-in-the-pack check still catches (#117)."""
    try:
        per = int(getattr(it.GetItemData(), "Weight", 0) or 0)
    except Exception:
        per = 0
    if per <= 0 or per >= 255:
        return 0
    try:
        amount = max(1, int(getattr(it, "Amount", 1) or 1))
    except Exception:
        amount = 1
    return per * amount


def room_for(it, pack):
    """Whether the backpack takes one more item and the character one more load, read live. A client
    that reports no weight leaves only the item cap."""
    if pack_count(pack) + 1 > PACK_MAX_ITEMS:
        return False
    try:
        most = int(API.Player.WeightMax)
        now = int(API.Player.Weight)
    except Exception:
        return True
    return most <= 0 or stones_of(it) <= most - now


def refuse_dest(dest, i, it, blacklist):
    """Why a put must not open or fill dest[i], beyond open_chain's own checks: blacklisted (the player
    told Pack Rat to leave it alone), not a container (a corpse), or trash (the server deletes what
    goes in). A trash barrel's cached name can be plain "barrel", so a tooltip that reads nothing is
    refused too rather than trusted."""
    c = dest[i]
    name = str(getattr(it, "Name", "") or "")
    if c in blacklist:
        return f"refused: 0x{c:x} is blacklisted — Pack Rat never opens it"
    if not is_container(it, name):
        return f"refused: 0x{c:x} is not a container — the bridge only ever opens containers"
    if not tooltip_lines(c):
        return f"refused: 0x{c:x}'s name did not load, so it may be a trash container — try again"
    if is_trash(c, name):
        return f"refused: 0x{c:x} is a trash container — the server deletes what goes in"
    return ""


def stackable(it):
    """Whether `it` can merge onto a stack: the tiledata stackable flag. A client that cannot say is
    taken to mean yes, which only costs the stack bookkeeping below."""
    try:
        return bool(getattr(it.GetItemData(), "IsStackable", True))
    except Exception:
        return True


def stack_total(container, graphic, hue):
    """The summed amount of the stacks directly in `container` a dropped item could merge onto (same
    graphic and hue), 0 when there is none: a drop with no spot stacks, and the dropped item's own serial
    then disappears. Every read of a live item is a trip to the client's main thread, so FindTypeAll picks
    the matches there; it also matches items in bags inside `container`, which the Container read drops.
    A client without it falls back to reading every child."""
    find_all = getattr(API, "FindTypeAll", None)   # the Legion stub can be ahead of the running client
    kids = None
    if find_all is not None:
        try:
            kids = [k for k in (find_all(graphic, container=int(container), hue=hue) or [])
                    if int(getattr(k, "Container", 0) or 0) == int(container)]
        except Exception:
            kids = None
    if kids is None:
        try:
            kids = [k for k in (API.ItemsInContainer(int(container), False) or [])
                    if int(k.Graphic) == graphic and int(getattr(k, "Hue", 0) or 0) == hue]
        except Exception:
            return 0
    total = 0
    for k in kids:
        try:
            total += max(1, int(getattr(k, "Amount", 1) or 1))
        except Exception:
            pass
    return total


def inside(it, container):
    """Whether the live item `it` (None when the client does not know it) sits directly in `container`."""
    return it is not None and int(getattr(it, "Container", 0) or 0) == int(container)


def trip_move(serial, dest, landed, *spot):
    """A trip's MoveItem: sent at least MOVE_GAP_S after the trip's previous one, then the live item is
    looked up every MOVE_POLL_S until `landed(item)` says it arrived, for at most MOVE_WAIT_S. Returns the
    item as last seen (None once the client no longer knows it), for the caller's own verdict."""
    gap = MOVE_GAP_S - (time.time() - last_move["at"])
    if gap > 0:
        API.Pause(gap)
    API.MoveItem(serial, dest, *spot)
    last_move["at"] = time.time()
    deadline = last_move["at"] + MOVE_WAIT_S
    it = find(serial)
    for _ in range(int(MOVE_WAIT_S / MOVE_POLL_S) + 1):
        if landed(it) or time.time() >= deadline:
            break
        API.Pause(MOVE_POLL_S)
        it = find(serial)
    return it


def bag_is_empty(serial):
    """Whether an opened bag holds nothing, on every sign the client gives. Opened comes with the server's
    open-container packet and the contents packet follows it, so the contents are read only after another
    OPEN_FLOOR_S, twice EMPTY_RECHECK_S apart, and a read that answers nothing at all (None, or a failed
    call) counts as not empty. A tooltip Contents line, when the bag has one, must read 0 items too."""
    if not bool(getattr(find(serial), "Opened", False)):
        return False
    API.Pause(OPEN_FLOOR_S)
    for i in range(2):
        if i:
            API.Pause(EMPTY_RECHECK_S)
        try:
            kids = API.ItemsInContainer(int(serial), False)
            if kids is None or len(list(kids)):
                return False
        except Exception:
            return False
    for ln in tooltip_lines(serial):
        m = CONTENTS_RE.search(ln)
        if m and int(m.group(1)) != 0:
            return False
    return True


def take_source(t, roots, blacklist, beside=None):
    """A take up to its move: the grab path's walk, opening and checks. Returns (item, why): the live
    item, sitting directly in the chain's last container, or None and why the take fails. `beside` is
    the root of the item's put when it may go there directly: the walk then first tries a tile in reach
    of both (stand_by_both)."""
    serial, chain = t["serial"], t["chain"]
    name = t["name"] or "item"
    for c in chain:
        if c in blacklist:
            return None, f"refused: 0x{c:x} is blacklisted — Pack Rat never opens it"
    # A take starts on the ground, never in your own backpack or bank: an item taken there joins the
    # carried set, and a put could then move anything you carry into any chest in reach.
    root = find(chain[0])
    why = chain_problem(chain, 0, root, set()) if root is not None else ""
    if why:
        return None, why
    if not (beside is not None and stand_by_both(chain[0], beside)) and not walk_to(roots.get(chain[0]), chain[0]):
        return None, "could not reach the container (not in view / too far / no path) — walk closer and retry"
    ok, msg = open_chain(chain, own=set(), opened=trip_opened)
    if not ok:
        return None, msg
    it = find(serial)
    if it is None:
        return None, f"{name} is not in that container any more — rescan"
    if not inside(it, chain[-1]):
        return None, f"refused: {name} is not inside the container the plan named — rescan"
    # A container is taken only when it is empty (Organize gathering empty bags, issue #128), read live: it
    # is opened like the chain above it (a bag's contents reach the client only once it opens, so an unopened
    # one proves nothing), and must then pass bag_is_empty.
    if is_container(it, str(getattr(it, "Name", "") or "")):
        ok, msg = open_chain(chain + [serial], own=set(), opened=trip_opened)
        if not ok:
            return None, msg
        if not bag_is_empty(serial):
            return None, f"refused: {name} did not open or is not empty — Pack Rat only moves empty bags"
    return it, ""


def do_take(t, it):
    """One take, after take_source: dropped at an explicit spot in the backpack. Returns (ok, msg, full),
    full meaning the backpack or the character cannot take it, which ends the trip's takes."""
    serial = t["serial"]
    name = t["name"] or "item"
    pack = int(API.Backpack)
    if not room_for(it, pack):
        return False, f"your backpack cannot take {name} — trip cut short", True
    # Dropped at a spot, a stack never merges into a matching stack already in the pack, so it keeps
    # the serial this trip's put names.
    it2 = trip_move(serial, pack, lambda x: inside(x, pack), 0, TAKE_DROP[0], TAKE_DROP[1])
    if inside(it2, pack):
        carried.add(serial)
        return True, f"took {name}", False
    return False, f"move bounced for {name} (too far, or backpack full?)", False


def do_put(p, roots, blacklist):
    """One put, the only step that moves an item somewhere other than your backpack, so it is fenced:
    only an item this bridge took (the carried set), from the top of your backpack, into a container
    chain whose root lies on the ground (open_chain with no own roots: never your pack, never a pack a
    mobile carries), none of it blacklisted, a corpse or trash (refuse_dest), checked before any walk
    where the client already knows the root."""
    serial, dest = p["serial"], p["dest"]
    name = p["name"] or "item"
    if serial not in carried:
        return False, f"refused: {name} was not taken by this bridge — put it away by hand"
    pack = int(API.Backpack)
    it = find(serial)
    if it is None or int(getattr(it, "Container", 0) or 0) != pack:
        carried.discard(serial)
        return False, f"{name} is no longer at the top of your backpack"
    for c in dest:
        if c in blacklist:
            return False, f"refused: 0x{c:x} is blacklisted — Pack Rat never opens it"
    root = find(dest[0])
    if root is not None:
        why = chain_problem(dest, 0, root, set()) or refuse_dest(dest, 0, root, blacklist)
        if why:
            return False, why
    if not walk_to(roots.get(dest[0]), dest[0]):
        return False, "could not reach the container (not in view / too far / no path) — walk closer and retry"
    ok, msg = open_dest(dest, blacklist)
    if not ok:
        return False, msg
    ok, msg = drop_into(serial, it, dest, name)
    if ok:
        carried.discard(serial)
        return True, msg
    return False, msg + " — it is still in your backpack"


def open_dest(dest, blacklist):
    """Open a put's destination chain from where the character stands, every entry checked first
    (open_chain with no own roots, and refuse_dest). Returns (ok, message)."""
    return open_chain(dest, own=set(), check=lambda i, x: refuse_dest(dest, i, x, blacklist), opened=trip_opened)


def drop_into(serial, it, dest, name):
    """A put's move of the live item `it` into dest's last container, and its verdict. Returns (ok, msg)."""
    # An item that cannot stack has landed only once it is in the container; the stack bookkeeping reads
    # the container's contents, a cost that grows with every item already there (#122).
    stacks = stackable(it)
    graphic, hue = int(getattr(it, "Graphic", 0) or 0), int(getattr(it, "Hue", 0) or 0)
    if not stacks:
        it2 = trip_move(serial, dest[-1], lambda x: inside(x, dest[-1]))
        if inside(it2, dest[-1]):
            return True, f"put {name} away"
    else:
        # Landed: in the container, or gone onto a stack there that grew. Only the verdict below decides, as
        # before; the stack's growth only ends the wait early.
        before = stack_total(dest[-1], graphic, hue)
        it2 = trip_move(serial, dest[-1], lambda x: inside(x, dest[-1]) or (x is None and stack_total(dest[-1], graphic, hue) > before))
        if inside(it2, dest[-1]):
            return True, f"put {name} away"
        if it2 is None and stack_total(dest[-1], graphic, hue) > 0:
            return True, f"put {name} away (onto a stack)"
    # One late look before calling it bounced: a drop the server applied can reach the client after the wait,
    # and an item taken for bounced is lifted again (a direct move's falls back to the backpack path).
    API.Pause(LATE_LOOK_S)
    it2 = find(serial)
    if inside(it2, dest[-1]):
        return True, f"put {name} away"
    if stacks and it2 is None and stack_total(dest[-1], graphic, hue) > 0:
        return True, f"put {name} away (onto a stack)"
    return False, f"{name} bounced (full, or refused)"


def near(serial):
    """Whether the container `serial` lies on the ground within REACH of where the character stands."""
    it = find(serial)
    return it is not None and bool(getattr(it, "OnGround", False)) and dist_to(it.X, it.Y) <= REACH


def stand_by_both(a, b):
    """Stand within REACH of both ground containers `a` and `b`, for a direct move (#130). True at once
    when the character already does; else, when the two are at most 2 x REACH apart (so tiles in reach
    of both exist), it walks to the nearest such tile the client's pathfinder finds a way to (of equally
    near ones, the one nearest the two containers, then the lowest x and y, so the choice is fixed). Which
    tiles can be stood on is the pathfinder's to know, not the bridge's: one it finds no path to (a
    chest, a wall) is passed over, DIRECT_TRIES at most. False sends the take the usual way. Both must
    be on the ground where the client sees them, so the tile comes from live positions, never the queue.
    The step keeps the containers this trip opened whose root is still in reach (trip_opened)."""
    ia, ib = find(a), find(b)
    if ia is None or ib is None or not getattr(ia, "OnGround", False) or not getattr(ib, "OnGround", False):
        return False
    ax, ay, bx, by = int(ia.X), int(ia.Y), int(ib.X), int(ib.Y)

    def both():
        return dist_to(ax, ay) <= REACH and dist_to(bx, by) <= REACH
    if both():
        return True
    if max(abs(ax - bx), abs(ay - by)) > 2 * REACH:
        return False
    px, py = int(API.Player.X), int(API.Player.Y)

    def tiles_to(x, y, x2, y2):
        return max(abs(x - x2), abs(y - y2))
    tiles = sorted(((x, y) for x in range(max(ax, bx) - REACH, min(ax, bx) + REACH + 1)
                    for y in range(max(ay, by) - REACH, min(ay, by) + REACH + 1)
                    if (x, y) not in ((ax, ay), (bx, by)) and within_walk(px, py, x, y)),
                   key=lambda t: (tiles_to(t[0], t[1], px, py), tiles_to(t[0], t[1], ax, ay) + tiles_to(t[0], t[1], bx, by), t))
    z = int(getattr(ia, "Z", 0) or 0)
    for x, y in tiles[:DIRECT_TRIES]:
        started = API.Pathfind(x, y, z, 0, False, WALK_TIMEOUT_S)
        if started is False:
            continue
        arrived = wait_for_walk(started, both)
        for c in [c for c, root in trip_opened.items() if not near(root)]:
            del trip_opened[c]
        trip_spot["at"] = (int(API.Player.X), int(API.Player.Y))
        return arrived
    return False


def do_direct(p, it, blacklist):
    """A direct move (#130): the take's item, already checked where it lies, dropped straight into its
    put's destination, one lift instead of two, while that destination is in reach too. The put runs
    every check a put runs except the carried set: the item is the one this trip's own take has just
    found in its planned container, which is all a take would have added to that set. Returns the put's
    message when the item landed, else None: the destination would not open from here (nothing moved),
    or the server refused the drop, which bounces an item back where it was lifted from. The caller then
    takes it into the backpack as before, so it is carried and its put runs later."""
    if not open_dest(p["dest"], blacklist)[0]:
        return None
    ok, msg = drop_into(p["serial"], it, p["dest"], p["name"] or "item")
    return msg + ", straight from where it was" if ok else None


def ms_since(t0, t1=None):
    return max(0, int(round(((time.time() if t1 is None else t1) - t0) * 1000)))


def asked_to_stop():
    """stop_requested, read after an interrupt: a client call failing then counts as the Stop it most likely is."""
    try:
        return stop_requested()
    except BaseException:
        return True


def settle(op, s, p, t0):
    """The step a Stop or an error cut short (`op` "take" or "put" for the trip step `s`, `p` a take's direct put
    or None), as its item now lies, read once with every call guarded: after the client's Stop any of them may
    fail. A take whose item is in the backpack took it (it is carried); a take's item in its direct put's
    container, or a put's in its own, was moved there; anything else is reported failed, so the app keeps the
    item where it last knew it and the message says to look. Returns the steps to report."""
    serial, name = s["serial"], s["name"] or "item"

    def step(o, msg, ok=True):
        return {"op": o, "serial": serial, "ok": ok, "msg": msg, "ms": ms_since(t0)}
    dest = s["dest"] if op == "put" else (p["dest"] if p else None)
    try:
        it, pack = find(serial), int(API.Backpack)
        in_pack, in_dest = inside(it, pack), bool(dest) and inside(it, dest[-1])
    except BaseException:
        in_pack = in_dest = False
    if op == "take" and in_pack:
        carried.add(serial)
        return [step("take", f"took {name}")]
    if in_dest and op == "put":
        carried.discard(serial)
        return [step("put", f"put {name} away")]
    if in_dest:
        return [step("take", f"took {name}"), step("put", f"put {name} away, straight from where it was")]
    return [step(op, f"{name}: cut short — check the game and rescan", False)]


def direct_put(cmd, k, puts, blacklist):
    """The put that takes[k]'s item may go straight into (#130), or None. The planner fits every put after
    every take (app/organize.mts's attempt: a chest that is both a source and a target frees its room
    before anything goes in), so a put may run early only when no take still to come frees room in a
    container on its way; that put waits for the backpack path, as before. One with a blacklisted
    container on its way is left to do_put to refuse, as before: nothing of it is walked to or opened."""
    p = puts.get(cmd["takes"][k]["serial"])
    if p is None or any(c in p["dest"] for t in cmd["takes"][k + 1:] for c in t["chain"]) or any(c in blacklist for c in p["dest"]):
        return None
    return p


def do_trip(cmd):
    """Organize: every take, then every put, one step at a time, the stop flag checked before each. A
    take whose put's destination is in reach, or can be brought in reach with a step (stand_by_both),
    goes straight there and reports its take and its put together (a direct move, #130); its put is not
    run again. A take the backpack cannot hold ends the takes (partial), and a put of an item this trip
    meant to take but did not is skipped. Every step and the trip carry `ms`, the milliseconds they took.
    Returns (ok, msg, {"steps", "partial", "stopped", "ms"})."""
    started = time.time()
    trip_opened.clear()
    # A flag written after this trip was queued is a Stop pressed while the trip waited its turn, and
    # is honoured; an older one is left over from before and only cleared. `queued` is whole seconds,
    # so a Stop pressed up to a second before the trip was queued also counts: the safe side.
    try:
        stopped = os.path.isfile(STOP_FLAG) and os.path.getmtime(STOP_FLAG) >= cmd["queued"]
    except OSError:
        stopped = False
    clear_stop()
    blacklist = set(e["serial"] for e in read_blacklist(BLACKLIST_PATH))
    serials = set(t["serial"] for t in cmd["takes"]) | set(p["serial"] for p in cmd["puts"])
    sysmsg(f"Pack Rat organize: trip {cmd['index']}, {len(serials)} items", INFO_HUE)
    roots = cmd["roots"]
    steps, took, direct = [], set(), set()
    puts = {p["serial"]: p for p in cmd["puts"]}
    partial = False
    error = ""
    doing = None              # the step under way: (op, take or put, its direct put or None, t0)
    try:
        for k, t in enumerate(cmd["takes"]):
            if stopped or stop_requested():
                stopped = True
                break
            t0 = time.time()
            p = direct_put(cmd, k, puts, blacklist)
            doing = ("take", t, p, t0)
            it, msg = take_source(t, roots, blacklist, p["dest"][0] if p else None)
            ok, full = False, False
            if it is not None and p is not None and near(p["dest"][0]):
                t1 = time.time()
                put = do_direct(p, it, blacklist)
                if put is not None:
                    steps.append({"op": "take", "serial": t["serial"], "ok": True, "msg": f"took {t['name'] or 'item'}", "ms": ms_since(t0, t1)})
                    steps.append({"op": "put", "serial": t["serial"], "ok": True, "msg": put, "ms": ms_since(t1)})
                    doing = None
                    heartbeat()
                    took.add(t["serial"])
                    direct.add(t["serial"])
                    continue
                it = find(t["serial"])
                if not inside(it, t["chain"][-1]):
                    it, msg = None, f"{t['name'] or 'item'} did not land in its container and is not back where it was — check the game and rescan"
            if it is not None:
                ok, msg, full = do_take(t, it)
            steps.append({"op": "take", "serial": t["serial"], "ok": bool(ok), "msg": msg, "ms": ms_since(t0)})
            doing = None
            heartbeat()
            if ok:
                took.add(t["serial"])
            if full:
                partial = True
                break
        planned = set(t["serial"] for t in cmd["takes"])
        for p in cmd["puts"]:
            if stopped or stop_requested():
                stopped = True
                break
            if p["serial"] in direct:
                continue
            if p["serial"] in planned and p["serial"] not in took:
                steps.append({"op": "put", "serial": p["serial"], "ok": False, "msg": "skipped: not taken on this trip", "ms": 0})
                continue
            t0 = time.time()
            doing = ("put", p, None, t0)
            ok, msg = do_put(p, roots, blacklist)
            steps.append({"op": "put", "serial": p["serial"], "ok": bool(ok), "msg": msg, "ms": ms_since(t0)})
            doing = None
            heartbeat()
    except BaseException as e:   # noqa: B036 -- the client's Stop interrupts at an API.Pause; the steps so far must still be reported
        if isinstance(e, Exception) and not asked_to_stop():
            error = str(e) or type(e).__name__
        else:
            stopped = True
        if doing is not None:
            steps.extend(settle(*doing))
    put_away = sum(1 for s in steps if s["op"] == "put" and s["ok"])
    failed = sum(1 for s in steps if not s["ok"])
    msg = f"trip {cmd['index']}: {put_away} put away, {failed} step{'' if failed == 1 else 's'} failed"
    if partial:
        msg += " — backpack full, trip cut short"
    if stopped:
        msg += " — stopped"
    if error:
        msg += f" — error: {error}"
    return failed == 0 and not partial and not stopped and not error, msg, {"steps": steps, "partial": partial, "stopped": stopped, "ms": ms_since(started)}


def run(cmd):
    action = cmd["action"]
    if action not in ACTIONS:
        return False, "unknown action"
    if action == "trip":
        return do_trip(cmd)
    chain = cmd["chain"]
    if chain:
        root = find(chain[0])
        why = chain_problem(chain, 0, root, own_roots([])) if root is not None else ""
        if why:
            return False, why                # never walk toward a container someone else carries
        if not walk_to(cmd.get("pos"), chain[0]):
            return False, "could not reach the container (not in view / too far / no path) — walk closer and retry"
        if action == "goto":
            return True, "you are at the container"
        ok, msg = open_chain(chain)
        if not ok:
            return False, msg
    elif action == "goto":
        return False, "no container position known for this item"
    if action == "highlight":
        return do_highlight(cmd)
    if action == "grab":
        return do_grab(cmd)
    return False, "nothing to do"


def read_queue(offset):
    """Consume at most MAX_READ_BYTES of new queue bytes. Returns (offset, line texts)."""
    if not os.path.isfile(QUEUE):
        return 0, []                     # deleted: empty until the app writes the next command
    size = os.path.getsize(QUEUE)
    if size < offset:
        offset = 0                       # file was truncated/reset by the server
    if size <= offset:
        return offset, []
    with open(QUEUE, "rb") as f:         # binary: byte offsets stay exact on every Python
        f.seek(offset)
        raw = f.read(MAX_READ_BYTES)
    lines, consumed = split_lines(raw, len(raw) >= MAX_READ_BYTES)
    return offset + consumed, lines


def main():
    os.makedirs(BRIDGE_DIR, exist_ok=True)
    if not os.path.exists(QUEUE):
        open(QUEUE, "a").close()
    offset = os.path.getsize(QUEUE)      # ignore anything queued before we started
    deadline = time.time() + MAX_HOURS * 3600
    next_status = 0
    seen = []                            # ids already executed, oldest first
    spent = []                           # when each accepted command was accepted
    flooded = False
    last_status["character"] = str(API.Player.Name)
    sysmsg(f"Pack Rat bridge up on {last_status['character']}. Use Highlight / Grab / Go to in the app. Stop the script to end.")
    while not API.StopRequested and time.time() < deadline and not flooded:
        API.ProcessCallbacks()
        try:
            if len(pending) < MAX_PENDING:
                offset, texts = read_queue(offset)
                bad = 0
                for text in texts:
                    # Per LINE, not per chunk: a junk line must never strand the commands queued
                    # behind it in the same read.
                    try:
                        if text is None:
                            bad += 1
                            continue
                        try:
                            parsed = json.loads(text)
                        except Exception:
                            bad += 1
                            continue
                        cmd, why = check_line(parsed, ACTIONS, time.time())
                        cid = parsed.get("id") if isinstance(parsed, dict) else None
                        if not isinstance(cid, str) or not cid or len(cid) > MAX_ID:
                            bad += 1                     # no id the page could match a result to
                            continue
                        if cid in seen:
                            continue                     # already accepted: a repeat is not a click
                        if not budget_ok(spent, time.time()):
                            record(cid, False, "too many commands at once — bridge stopping")
                            sysmsg("Pack Rat bridge: the queue is being written faster than a person clicks. Stopping — start it again yourself if this was you.", ALARM_HUE)
                            flooded = True
                            break
                        spent.append(time.time())
                        seen.append(cid)
                        del seen[:-MAX_SEEN_IDS]
                        if cmd is None:
                            # Refused (stale, malformed): recorded under the command's own id, so the
                            # page that queued it toasts the reason instead of waiting forever.
                            record(cid, False, why)
                            continue
                        pending.append(cmd)
                    except Exception:
                        bad += 1
                if bad:
                    # One aggregated result rather than one per junk line, so a flood of garbage
                    # cannot itself flood the status file.
                    record(f"rejected-{rfc3339_now()}-{counts['failed']}", False, f"{bad} queue line(s) ignored (unreadable or not a command)")
        except Exception as e:
            sysmsg(f"bridge: queue read failed: {e}", ALARM_HUE)
        ran = 0
        while pending and ran < MAX_CMDS_PER_POLL and not API.StopRequested and not flooded:
            cmd = pending.pop(0)
            ran += 1
            try:
                sysmsg(f"bridge: {cmd['action']} {cmd['name']}", INFO_HUE)
                write_status({"id": cmd["id"], "action": cmd["action"], "name": cmd["name"]})
                try:
                    out = run(cmd)
                except Exception as e:
                    out = (False, f"error: {e}")
                record(cmd["id"], *out)
                write_status(None)
            except Exception as e:
                sysmsg(f"bridge: {cmd['action']} failed: {e}", ALARM_HUE)
        if time.time() >= next_status:
            write_status(None)
            next_status = time.time() + 2.0
        API.Pause(POLL_S)


def write_stopped():
    """The last status write, `stopped: true`: the app shows the bridge offline and the installer
    stops waiting out the 30 s heartbeat. Called from a finally because the client's Stop interrupts
    the script at its next API.Pause, so nothing after main()'s loop runs then. Every client call
    here is guarded: after that interrupt any of them may fail, and the file must still be written."""
    for cmd in pending:
        try:                  # one at a time: record's SysMsg failing must not skip the rest
            record(cmd["id"], False, "not run — the bridge stopped first")
        except Exception:
            pass
    try:
        write_json_atomic(STATUS, {"alive": rfc3339_now(), "character": last_status["character"],
                                    "current": None, "results": results, "counts": counts,
                                    "stopped": True})
    except Exception:
        pass
    try:
        sysmsg("Pack Rat bridge stopped.")
    except Exception:
        pass


try:
    main()
finally:
    write_stopped()
