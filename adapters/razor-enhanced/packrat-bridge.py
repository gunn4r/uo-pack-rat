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
ADAPTER_VERSION = "1.0.0"
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

results = {}                # id -> {ok, msg, t}
counts = {"done": 0, "failed": 0}


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
        keep = dict(items[-30:])
        write_json_atomic(STATUS, {"alive": rfc3339_now(), "character": str(Player.Name),
                                    "current": current, "results": keep, "counts": counts})
    except Exception as e:
        sysmsg("bridge: status write failed: {0}".format(e), ALARM_HUE)


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
    rather than assuming it either blocks or returns instantly -- safe either way."""
    it = Items.FindBySerial(as_int(root_serial))
    if it is not None:
        if in_reach_of_item(it):
            return True
        try:
            p = it.Position
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
    return it is not None and in_reach_of_item(it)


def open_chain(chain):
    """Open root, then each nested bag in order. Returns (ok, message)."""
    for i, c in enumerate(chain):
        it = Items.FindBySerial(as_int(c))
        if it is None:
            return False, "container {0}/{1} (0x{2:x}) is not in view -- walk there and try again".format(i + 1, len(chain), as_int(c))
        try:
            Items.WaitForContents(it, CONTENTS_WAIT_MS)
        except Exception as e:
            return False, "could not open container: {0}".format(e)
    return True, "opened"


def do_highlight(cmd):
    it = Items.FindBySerial(as_int(cmd["serial"]))
    if it is None:
        return False, "{0} is not known to the client here -- is this the right place?".format(cmd.get("name", "item"))
    name = cmd.get("name") or str(getattr(it, "Name", "") or "item")
    targets = [it]
    if cmd.get("chain"):
        # chain[-1] is the item's IMMEDIATE parent, not chain[0] (the outer root) -- matches
        # adapters/tazuo/packrat-bridge.py's do_highlight, which marks the item itself plus
        # `chain[-1]` ("is in here"). In a deeply nested chest, recoloring the outer root instead
        # would tell the player almost nothing about which of several bags inside it to open next.
        parent = Items.FindBySerial(as_int(cmd["chain"][-1]))
        if parent is not None:
            targets.append(parent)
    original_hues = {}
    for t in targets:
        s = as_int(getattr(t, "Serial", 0))
        original_hues[s] = as_int(getattr(t, "Hue", 0))
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
            Items.SetColor(s, original_hues.get(s, -1))
        except Exception:
            pass
    return True, "highlighted {0}".format(name)


def do_grab(cmd):
    it = Items.FindBySerial(as_int(cmd["serial"]))
    if it is None:
        return False, "{0} is not known to the client here".format(cmd.get("name", "item"))
    name = cmd.get("name") or str(getattr(it, "Name", "") or "item")
    try:
        Items.Move(as_int(cmd["serial"]), as_int(Player.Backpack.Serial), -1)
    except Exception as e:
        return False, "move failed: {0}".format(e)
    Misc.Pause(GRAB_SETTLE_MS)
    it2 = Items.FindBySerial(as_int(cmd["serial"]))
    if it2 is not None and as_int(getattr(it2, "Container", 0)) == as_int(Player.Backpack.Serial):
        return True, "grabbed {0} -- it is in your backpack".format(name)
    return False, "move bounced for {0} (too far, or backpack full?)".format(name)


def run(cmd):
    action = cmd.get("action")
    chain = [as_int(c) for c in (cmd.get("chain") or [])]
    if action not in CAPABILITIES["bridge"]:
        return False, "unknown action"
    if chain:
        if not walk_to(cmd.get("pos"), chain[0]):
            return False, "could not reach the container (not in view / no path) -- walk closer and retry"
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


def main():
    if not os.path.exists(BRIDGE_DIR):
        os.makedirs(BRIDGE_DIR)
    if not os.path.exists(QUEUE):
        open(QUEUE, "a").close()
    offset = os.path.getsize(QUEUE)           # ignore anything queued before we started
    deadline = time.time() + MAX_HOURS * 3600
    next_status = 0
    sysmsg("Pack Rat bridge up on {0}. Use Highlight / Grab / Go to in the app. Stop the script to end.".format(Player.Name))
    # Player.Connected (not a literal True) bounds the loop -- it ends on logout even without an
    # explicit Stop; see README.md's "Stopping the bridge" for what this does and doesn't cover.
    while Player.Connected and time.time() < deadline:
        try:
            size = os.path.getsize(QUEUE)
            if size < offset:
                offset = 0                     # file was truncated/reset by the server
            if size > offset:
                with open(QUEUE, "rb") as f:   # binary: byte offsets stay exact
                    f.seek(offset)
                    raw = f.read()
                offset += len(raw)
                chunk = raw.decode("utf-8", "replace")
                for line in chunk.splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        cmd = json.loads(line)
                    except Exception:
                        continue
                    cid = str(cmd.get("id", ""))
                    sysmsg("bridge: {0} {1}".format(cmd.get("action"), cmd.get("name", "")), INFO_HUE)
                    write_status({"id": cid, "action": cmd.get("action"), "name": cmd.get("name")})
                    try:
                        ok, msg = run(cmd)
                    except Exception as e:
                        ok, msg = False, "error: {0}".format(e)
                    results[cid] = {"ok": bool(ok), "msg": str(msg), "t": rfc3339_now()}
                    counts["done" if ok else "failed"] += 1
                    sysmsg("bridge: {0}".format(msg), OK_HUE if ok else ALARM_HUE)
                    write_status(None)
        except Exception as e:
            sysmsg("bridge: queue read failed: {0}".format(e), ALARM_HUE)
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
