# packrat-bridge.py — ATTENDED bridge between the Pack Rat app and the game. Run it
# while you are at home (or wherever the items are) and leave it running; the app's Highlight /
# Grab / Go to buttons queue commands into the data directory's bridge/tazuo/queue.jsonl and this
# script executes them:
#   highlight : walk to the container if it is not in reach, open the bag chain, flash the item's name
#               above it (local-only overhead text) and mark the chest's tile for a few seconds
#   grab      : same, then move the item into your backpack and verify it landed
#   goto      : walk to the container
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
ADAPTER_VERSION = "2.1.0"
CAPABILITIES = {
    "layers": ["OneHanded", "TwoHanded", "Shoes", "Pants", "Shirt", "Helmet", "Gloves",
               "Ring", "Talisman", "Necklace", "Waist", "Torso", "Bracelet", "Tunic",
               "Earrings", "Arms", "Cloak", "Robe", "Skirt", "Legs"],
    "arms": True, "bank": True, "ground": True, "nested": True, "tooltips": "opl",
    "bridge": ["highlight", "grab", "goto"],
}


BRIDGE_DIR = os.path.join(data_dir(), "bridge", "tazuo")
QUEUE = os.path.join(BRIDGE_DIR, "queue.jsonl")
STATUS = os.path.join(BRIDGE_DIR, "status.json")
POLL_S = 0.5
MAX_HOURS = 8
REACH = 2                 # tiles: containers open only when this close
WALK_TIMEOUT_S = 20
PAUSE_OPEN = 1.0
HIGHLIGHT_S = 8
HIGHLIGHT_HUE = 53        # bright yellow-green
MARK_HUE = 53
ALARM_HUE, OK_HUE, INFO_HUE = 33, 68, 88

# ---- untrusted input ---------------------------------------------------------------------------
# <dataDir>/bridge/<adapter>/queue.jsonl is an ordinary file: the app writes it, but so can any
# other local process, so the bridge validates every line itself instead of trusting that the server
# already did. Everything from here to the end of this section is pure -- no game API, no files --
# so adapters/test_adapters.py can drive it directly, and the block is byte-identical in every
# adapter's bridge (that test asserts it), which is why it is ASCII and uses .format() rather than
# this file's own em dashes and f-strings: Razor Enhanced's IronPython carries the same text.
MAX_CHAIN = 8              # containers one command may open (app/ui/bridge.mts's own chainOf guard)
MAX_NAME = 120             # a name is only ever printed on screen
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


def check_command(cmd, actions, now_s):
    """Validate one parsed queue line against the bridge v1 contract. Returns (command, reason)."""
    if not isinstance(cmd, dict):
        return None, "queue line is not a JSON object"
    cid = cmd.get("id")
    if not isinstance(cid, str) or not cid:
        return None, "command has no id"
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
    queued = parse_rfc3339(cmd.get("queuedAt"))
    if queued is None:
        return None, "queuedAt is missing or unreadable"
    age = now_s - queued
    if age > MAX_AGE_S:
        return None, "expired: queued {0}s ago, not run".format(int(age))
    if age < -CLOCK_SKEW_S:
        return None, "expired: queued in the future, not run"
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


# ---- end of the untrusted-input section --------------------------------------------------------

# Container detection, copied verbatim from packrat-scanner.py (adapters/test_adapters.py asserts
# the two stay identical): the bridge double-clicks whatever `chain` names, and double-click is UO's
# universal "use" verb — a potion drinks, a rune recalls, a deed places. Only containers, and never
# corpses, may be opened.
CONTAINER_RE = re.compile(r"\b(chest|box|crate|bag|pouch|basket|trunk|armoire|cabinet|backpack)\b", re.I)
DEED_RE = re.compile(r"\bdeed\b", re.I)
# Engraved bags and Backpacks match no name pattern — detect by graphic too (probe-verified Aug 2026).
CONTAINER_GRAPHICS = {0x0E75, 0x0E76, 0x0E79, 0x0E7D, 0x09AA, 0x09A8, 0x09A9, 0x09AB,
                      0x0E3C, 0x0E3D, 0x0E3E, 0x0E3F, 0x0E40, 0x0E41, 0x0E42, 0x0E43,
                      0x0E7C, 0x0E7E, 0x0E7F, 0xA32F, 0xA333}

results = {}              # id -> {ok, msg}
counts = {"done": 0, "failed": 0}


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


def sysmsg(msg, hue=OK_HUE):
    API.SysMsg(msg, hue)


def write_status(current=None):
    try:
        keep = dict(list(results.items())[-MAX_RESULTS:])
        write_json_atomic(STATUS, {"alive": rfc3339_now(),
                                    "character": str(API.Player.Name), "current": current,
                                    "results": keep, "counts": counts})
    except Exception as e:
        sysmsg(f"bridge: status write failed: {e}", ALARM_HUE)


def record(cid, ok, msg):
    """One result, trimmed in memory so the final whole-dict status write is bounded too."""
    results[cid] = {"ok": bool(ok), "msg": str(msg), "t": rfc3339_now()}
    for old in list(results.keys())[:-MAX_RESULTS]:
        results.pop(old, None)
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


def walk_to(pos, root_serial):
    """Get within REACH of the container. Uses the live item if the client knows it, else the scanned
    position. A destination further than MAX_WALK_TILES is refused rather than walked to."""
    it = find(root_serial)
    on_ground = it is not None and bool(getattr(it, "OnGround", False))
    if on_ground:
        if dist_to(it.X, it.Y) <= REACH:
            return True
        if not within_walk(API.Player.X, API.Player.Y, it.X, it.Y):
            return False
        API.PathfindEntity(int(root_serial), REACH, True, WALK_TIMEOUT_S)
        return dist_to(it.X, it.Y) <= REACH
    if pos:
        if dist_to(pos["x"], pos["y"]) <= REACH:
            return True
        if not within_walk(API.Player.X, API.Player.Y, pos["x"], pos["y"]):
            return False
        API.Pathfind(int(pos["x"]), int(pos["y"]), int(pos.get("z", 0)), REACH, True, WALK_TIMEOUT_S)
        return dist_to(pos["x"], pos["y"]) <= REACH
    return it is not None and dist_to(it.X, it.Y) <= REACH


def open_chain(chain):
    """Open root, then each nested bag in order. Returns (ok, message)."""
    for i, c in enumerate(chain):
        it = find(c)
        if it is None:
            return False, f"container {i + 1}/{len(chain)} (0x{int(c):x}) is not in view — walk there and try again"
        if not is_container(it, str(getattr(it, "Name", "") or "")):
            return False, f"refused: 0x{int(c):x} is not a container — the bridge only ever opens containers"
        try:
            API.UseObject(int(c))
        except Exception as e:
            return False, f"could not open container: {e}"
        API.Pause(PAUSE_OPEN)
    return True, "opened"


def do_highlight(cmd):
    it = find(cmd["serial"])
    if it is None:
        return False, f"{cmd.get('name', 'item')} is not known to the client here — is this the right place?"
    name = cmd.get("name") or str(getattr(it, "Name", "") or "item")
    root = find(cmd["chain"][0]) if cmd.get("chain") else None
    pos = cmd.get("pos")
    if root is not None and getattr(root, "OnGround", False):
        pos = {"x": int(root.X), "y": int(root.Y), "z": int(getattr(root, "Z", 0) or 0)}
    if pos:
        try:
            API.MarkTile(int(pos["x"]), int(pos["y"]), MARK_HUE)
        except Exception:
            pass
    t_end = time.time() + HIGHLIGHT_S
    while time.time() < t_end and not API.StopRequested:
        try:
            API.HeadMsg(f">>> {name} <<<", int(cmd["serial"]), HIGHLIGHT_HUE)
            if cmd.get("chain"):
                API.HeadMsg(f"[ {name} is in here ]", int(cmd["chain"][-1]), HIGHLIGHT_HUE)
        except Exception:
            pass
        API.Pause(1.5)
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


def run(cmd):
    action = cmd["action"]
    chain = cmd["chain"]
    if action not in CAPABILITIES["bridge"]:
        return False, "unknown action"
    if chain:
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
    pending = []                         # validated commands waiting their turn
    seen = []                            # ids already executed, oldest first
    spent = []                           # when each accepted command was accepted
    flooded = False
    sysmsg(f"Pack Rat bridge up on {API.Player.Name}. Use Highlight / Grab / Go to in the app. Stop the script to end.")
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
                        cmd, why = check_command(parsed, CAPABILITIES["bridge"], time.time())
                        if cmd is None:
                            bad += 1
                            continue
                        if cmd["id"] in seen:
                            continue                     # already executed: a repeat is not a click
                        if not budget_ok(spent, time.time()):
                            record(cmd["id"], False, "too many commands at once — bridge stopping")
                            sysmsg("Pack Rat bridge: the queue is being written faster than a person clicks. Stopping — start it again yourself if this was you.", ALARM_HUE)
                            flooded = True
                            break
                        spent.append(time.time())
                        pending.append(cmd)
                    except Exception:
                        bad += 1
                if bad:
                    # One aggregated result rather than one per junk line, so a flood of garbage
                    # cannot itself flood the status file.
                    record(f"rejected-{rfc3339_now()}", False, f"{bad} queue line(s) ignored (unreadable, stale or not a command)")
        except Exception as e:
            sysmsg(f"bridge: queue read failed: {e}", ALARM_HUE)
        ran = 0
        while pending and ran < MAX_CMDS_PER_POLL and not API.StopRequested and not flooded:
            cmd = pending.pop(0)
            ran += 1
            seen.append(cmd["id"])
            del seen[:-MAX_SEEN_IDS]
            try:
                sysmsg(f"bridge: {cmd['action']} {cmd['name']}", INFO_HUE)
                write_status({"id": cmd["id"], "action": cmd["action"], "name": cmd["name"]})
                try:
                    ok, msg = run(cmd)
                except Exception as e:
                    ok, msg = False, f"error: {e}"
                record(cmd["id"], ok, msg)
                write_status(None)
            except Exception as e:
                sysmsg(f"bridge: {cmd['action']} failed: {e}", ALARM_HUE)
        if time.time() >= next_status:
            write_status(None)
            next_status = time.time() + 2.0
        API.Pause(POLL_S)
    try:
        write_json_atomic(STATUS, {"alive": rfc3339_now(), "character": str(API.Player.Name),
                                    "current": None, "results": results, "counts": counts,
                                    "stopped": True})
    except Exception:
        pass
    sysmsg("Pack Rat bridge stopped.")


main()
