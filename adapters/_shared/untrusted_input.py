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
    (epoch seconds, fraction dropped) for the stop flag's age check. putAway (Put away from the pack) comes
    back as the picked container's serial or None, and a putAway trip takes nothing."""
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
    put_away = cmd.get("putAway")
    if put_away is not None and not is_serial(put_away):
        return None, "putAway is not a container serial"
    if put_away and takes:
        return None, "a Put away trip takes nothing"
    why = check_age(cmd.get("queuedAt"), now_s)
    if why:
        return None, why
    return {"id": cid, "action": "trip", "index": index, "stamp": stamp, "name": "#{0}".format(index),
            "queued": parse_rfc3339(cmd.get("queuedAt")), "roots": roots, "takes": takes, "puts": puts,
            "putAway": put_away}, ""


def check_line(cmd, actions, now_s):
    """A trip goes to check_trip on a bridge that runs trips; everything else, and a trip on a bridge
    that does not, goes to check_command, which refuses an action the bridge lacks."""
    if isinstance(cmd, dict) and cmd.get("action") == "trip" and "trip" in actions:
        return check_trip(cmd, now_s)
    return check_command(cmd, actions, now_s)


# ---- end of the untrusted-input section --------------------------------------------------------
