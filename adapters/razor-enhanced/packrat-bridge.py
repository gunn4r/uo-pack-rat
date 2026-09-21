# packrat-bridge.py -- ATTENDED bridge between the Pack Rat app and the game. Run it while you
# are at home (or wherever the items are) and leave it running; the app's Highlight / Grab / Go to
# buttons queue commands into the data directory's bridge/razor-enhanced/queue.jsonl and this
# script executes them:
#   highlight : walk to the container if it is not in reach, open the bag chain, then recolor the
#               item (and its containing chest) for a few seconds and print a local message --
#               local-only, nothing another player can see. Nothing is moved.
#   grab      : same, then move the item into your backpack and verify it landed there
#   goto      : walk to the container
# Status (alive timestamp + last results) goes to bridge/razor-enhanced/status.json for the app's
# indicator.
# The data directory is `packrat-paths.json` beside this script, else $PACKRAT_DATA, else
# ~/.pack-rat.
# Inventory-only: nothing is attacked, looted or gathered. Bounded by MAX_HOURS; Stop ends it, or
# it ends on its own if the client disconnects (see README.md's "Stopping the bridge" for what is
# and is not verified about that).
# Commands written before this script started are ignored (it starts reading at the end of the
# file) -- see docs/bridge-protocol.md's "The offset rule".
#
# The queue file is an ordinary file that any local process can write, so this script trusts nothing
# in it: every line is re-validated here (see "untrusted input", below), stale and duplicate commands
# are refused, only containers are ever opened, grabs only ever pull from your own backpack/bank or
# from the container chain the same command just opened, and a queue being written faster than a
# person clicks stops the bridge outright.
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
# Keep this literal in sync with capabilities.json and packrat-scanner.py's own copy.
CAPABILITIES = {
    "layers": ["RightHand", "LeftHand", "Shoes", "Pants", "Shirt", "Head", "Gloves", "Ring",
               "Talisman", "Neck", "Waist", "InnerTorso", "Bracelet", "MiddleTorso", "Earrings",
               "Arms", "Cloak", "OuterTorso", "OuterLegs", "InnerLegs"],
    "arms": True, "bank": True, "ground": True, "nested": True, "tooltips": "opl",
    "bridge": ["highlight", "grab", "goto"],
}


BRIDGE_DIR = os.path.join(data_dir(), "bridge", "razor-enhanced")
QUEUE = os.path.join(BRIDGE_DIR, "queue.jsonl")
STATUS = os.path.join(BRIDGE_DIR, "status.json")
POLL_MS = 500
MAX_HOURS = 8
REACH = 2                  # tiles: containers open only when this close
WALK_TIMEOUT_S = 20
WALK_POLL_MS = 500
CONTENTS_WAIT_MS = 1200
GRAB_SETTLE_MS = 1200
HIGHLIGHT_MS = 8000
HIGHLIGHT_HUE = 53         # bright yellow-green
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

results = {}                # id -> {ok, msg, t}
counts = {"done": 0, "failed": 0}


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


def write_status(current=None):
    try:
        items = list(results.items())
        keep = dict(items[-MAX_RESULTS:])
        write_json_atomic(STATUS, {"alive": rfc3339_now(), "character": str(Player.Name),
                                    "current": current, "results": keep, "counts": counts})
    except Exception as e:
        sysmsg("bridge: status write failed: {0}".format(e), ALARM_HUE)


def record(cid, ok, msg):
    """One result, trimmed in memory so the final whole-dict status write is bounded too."""
    results[cid] = {"ok": bool(ok), "msg": str(msg), "t": rfc3339_now()}
    for old in list(results.keys())[:-MAX_RESULTS]:
        results.pop(old, None)
    counts["done" if ok else "failed"] += 1
    sysmsg("bridge: {0}".format(msg), OK_HUE if ok else ALARM_HUE)


def find(serial):
    try:
        return Items.FindBySerial(as_int(serial))
    except Exception:
        return None


def own_roots(chain):
    """The containers a grab may legitimately pull from: your backpack, your bank, and the chain
    this very command just walked and opened."""
    allowed = set(as_int(c) for c in (chain or []))
    for holder in ("Backpack", "Bank"):
        try:
            allowed.add(as_int(getattr(getattr(Player, holder), "Serial", 0)))
        except Exception:
            pass
    allowed.discard(0)
    return allowed


def dist_to_xy(x, y):
    p = Player.Position
    return max(abs(as_int(x) - as_int(p.X)), abs(as_int(y) - as_int(p.Y)))


def in_reach_of_item(it):
    try:
        return as_int(Player.DistanceTo(it)) <= REACH
    except Exception:
        return False


def walk_to(pos, root_serial):
    """Get within REACH of the container. Prefers the live Item (current position, via
    Player.DistanceTo) when the client already knows it; falls back to the scanned pos dict
    otherwise. Player.PathFindTo's own blocking behaviour is undocumented, so this polls afterward
    rather than assuming it either blocks or returns instantly -- safe either way. A destination
    further than MAX_WALK_TILES is refused rather than walked to."""
    it = find(root_serial)
    if it is not None:
        if in_reach_of_item(it):
            return True
        try:
            p = it.Position
            if not within_walk(Player.Position.X, Player.Position.Y, p.X, p.Y):
                return False
            Player.PathFindTo(as_int(p.X), as_int(p.Y), as_int(getattr(p, "Z", 0)))
        except Exception:
            return False
        deadline = time.time() + WALK_TIMEOUT_S
        while time.time() < deadline and Player.Connected:
            Misc.Pause(WALK_POLL_MS)
            if in_reach_of_item(it):
                return True
        return in_reach_of_item(it)
    if pos:
        if dist_to_xy(pos["x"], pos["y"]) <= REACH:
            return True
        if not within_walk(Player.Position.X, Player.Position.Y, pos["x"], pos["y"]):
            return False
        try:
            Player.PathFindTo(as_int(pos["x"]), as_int(pos["y"]), as_int(pos.get("z", 0)))
        except Exception:
            return False
        deadline = time.time() + WALK_TIMEOUT_S
        while time.time() < deadline and Player.Connected:
            Misc.Pause(WALK_POLL_MS)
            if dist_to_xy(pos["x"], pos["y"]) <= REACH:
                return True
        return dist_to_xy(pos["x"], pos["y"]) <= REACH
    return False


def open_chain(chain):
    """Open root, then each nested bag in order. Returns (ok, message)."""
    for i, c in enumerate(chain):
        it = find(c)
        if it is None:
            return False, "container {0}/{1} (0x{2:x}) is not in view -- walk there and try again".format(i + 1, len(chain), as_int(c))
        # Items.WaitForContents is an open-the-container call, and opening is a double-click: on a
        # non-container that is UO's universal "use" verb (a potion drinks, a rune recalls, a deed
        # places). Same restraint the scanner already applies, and corpses are refused with it.
        if not is_container(it):
            return False, "refused: 0x{0:x} is not a container -- the bridge only ever opens containers".format(as_int(c))
        try:
            Items.WaitForContents(it, CONTENTS_WAIT_MS)
        except Exception as e:
            return False, "could not open container: {0}".format(e)
    return True, "opened"


def do_highlight(cmd):
    it = find(cmd["serial"])
    if it is None:
        return False, "{0} is not known to the client here -- is this the right place?".format(cmd.get("name", "item"))
    name = cmd.get("name") or str(getattr(it, "Name", "") or "item")
    targets = [it]
    if cmd.get("chain"):
        # chain[-1] is the item's IMMEDIATE parent, not chain[0] (the outer root) -- matches
        # adapters/tazuo/packrat-bridge.py's do_highlight, which marks the item itself plus
        # `chain[-1]` ("is in here"). In a deeply nested chest, recoloring the outer root instead
        # would tell the player almost nothing about which of several bags inside it to open next.
        parent = find(cmd["chain"][-1])
        if parent is not None:
            targets.append(parent)
    for t in targets:
        s = as_int(getattr(t, "Serial", 0))
        try:
            Items.SetColor(s, HIGHLIGHT_HUE)
        except Exception:
            pass
    try:
        Player.HeadMessage(HIGHLIGHT_HUE, "Pack Rat: {0}".format(name))
    except Exception:
        pass
    Misc.Pause(HIGHLIGHT_MS)
    for t in targets:
        s = as_int(getattr(t, "Serial", 0))
        try:
            # -1 is Items.SetColor's own documented sentinel for "reset original color" (razorenhanced
            # readthedocs, Items.SetColor: "color: Int32 Color as number. (default: -1, reset original
            # color)") -- restoring this way, instead of reading Hue before the highlight and setting
            # it back by hand, means the client's own true original color always wins, including a
            # case a captured `Hue` read could get wrong (e.g. an unreadable Hue defaulting to 0 and
            # then being written back as if 0 -- no hue -- really were the item's original color).
            Items.SetColor(s, -1)
        except Exception:
            pass
    return True, "highlighted {0}".format(name)


def do_grab(cmd):
    it = find(cmd["serial"])
    if it is None:
        return False, "{0} is not known to the client here".format(cmd.get("name", "item"))
    name = cmd.get("name") or str(getattr(it, "Name", "") or "item")
    # The destination is your own backpack and is never a protocol field -- see
    # docs/bridge-protocol.md. The SOURCE is checked here: the piece has to be sitting in your own
    # backpack or bank, or inside the container chain this command itself just opened. Anything else
    # (a guild chest someone left open nearby, a stranger's pack, an item lying on the ground) is a
    # serial the client happens to know and the app never scanned -- refused, not moved.
    pack = as_int(Player.Backpack.Serial)
    root = resolve_root(as_int(cmd["serial"]), find)
    if root not in own_roots(cmd.get("chain")):
        return False, "refused: {0} is not in your backpack, your bank, or the container this command opened".format(name)
    try:
        Items.Move(as_int(cmd["serial"]), pack, -1)
    except Exception as e:
        return False, "move failed: {0}".format(e)
    Misc.Pause(GRAB_SETTLE_MS)
    it2 = find(cmd["serial"])
    if it2 is not None and as_int(getattr(it2, "Container", 0)) == pack:
        return True, "grabbed {0} -- it is in your backpack".format(name)
    return False, "move bounced for {0} (too far, or backpack full?)".format(name)


def run(cmd):
    action = cmd["action"]
    chain = cmd["chain"]
    if action not in CAPABILITIES["bridge"]:
        return False, "unknown action"
    if chain:
        if not walk_to(cmd.get("pos"), chain[0]):
            return False, "could not reach the container (not in view / too far / no path) -- walk closer and retry"
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
        offset = 0                     # file was truncated/reset by the server
    if size <= offset:
        return offset, []
    with open(QUEUE, "rb") as f:       # binary: byte offsets stay exact
        f.seek(offset)
        raw = f.read(MAX_READ_BYTES)
    lines, consumed = split_lines(raw, len(raw) >= MAX_READ_BYTES)
    return offset + consumed, lines


def main():
    if not os.path.exists(BRIDGE_DIR):
        os.makedirs(BRIDGE_DIR)
    if not os.path.exists(QUEUE):
        open(QUEUE, "a").close()
    offset = os.path.getsize(QUEUE)           # ignore anything queued before we started
    deadline = time.time() + MAX_HOURS * 3600
    next_status = 0
    pending = []                              # validated commands waiting their turn
    seen = []                                 # ids already executed, oldest first
    spent = []                                # when each accepted command was accepted
    flooded = False
    sysmsg("Pack Rat bridge up on {0}. Use Highlight / Grab / Go to in the app. Stop the script to end.".format(Player.Name))
    # Player.Connected (not a literal True) bounds the loop -- it ends on logout even without an
    # explicit Stop; see README.md's "Stopping the bridge" for what this does and doesn't cover.
    while Player.Connected and time.time() < deadline and not flooded:
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
                            record(cmd["id"], False, "too many commands at once -- bridge stopping")
                            sysmsg("Pack Rat bridge: the queue is being written faster than a person clicks. Stopping -- start it again yourself if this was you.", ALARM_HUE)
                            flooded = True
                            break
                        spent.append(time.time())
                        pending.append(cmd)
                    except Exception:
                        bad += 1
                if bad:
                    # One aggregated result rather than one per junk line, so a flood of garbage
                    # cannot itself flood the status file.
                    record("rejected-{0}".format(rfc3339_now()), False,
                           "{0} queue line(s) ignored (unreadable, stale or not a command)".format(bad))
        except Exception as e:
            sysmsg("bridge: queue read failed: {0}".format(e), ALARM_HUE)
        ran = 0
        while pending and ran < MAX_CMDS_PER_POLL and Player.Connected and not flooded:
            cmd = pending.pop(0)
            ran += 1
            seen.append(cmd["id"])
            del seen[:-MAX_SEEN_IDS]
            try:
                sysmsg("bridge: {0} {1}".format(cmd["action"], cmd["name"]), INFO_HUE)
                write_status({"id": cmd["id"], "action": cmd["action"], "name": cmd["name"]})
                try:
                    ok, msg = run(cmd)
                except Exception as e:
                    ok, msg = False, "error: {0}".format(e)
                record(cmd["id"], ok, msg)
                write_status(None)
            except Exception as e:
                sysmsg("bridge: {0} failed: {1}".format(cmd["action"], e), ALARM_HUE)
        if time.time() >= next_status:
            write_status(None)
            next_status = time.time() + 2.0
        Misc.Pause(POLL_MS)
    try:
        write_json_atomic(STATUS, {"alive": rfc3339_now(), "character": str(Player.Name),
                                    "current": None, "results": results, "counts": counts,
                                    "stopped": True})
    except Exception:
        pass
    sysmsg("Pack Rat bridge stopped.")


main()
