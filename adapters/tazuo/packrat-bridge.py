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

import API
import json
import os
import time


def data_dir():
    """<script folder>/packrat-paths.json {"dataDir": "..."} → $PACKRAT_DATA → ~/.pack-rat"""
    here = os.path.dirname(os.path.abspath(__file__))
    cfg = os.path.join(here, "packrat-paths.json")
    if os.path.exists(cfg):
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
ADAPTER_VERSION = "2.0.0"
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

results = {}              # id -> {ok, msg}
counts = {"done": 0, "failed": 0}


def sysmsg(msg, hue=OK_HUE):
    API.SysMsg(msg, hue)


def write_status(current=None):
    try:
        keep = dict(list(results.items())[-30:])
        write_json_atomic(STATUS, {"alive": rfc3339_now(),
                                    "character": str(API.Player.Name), "current": current,
                                    "results": keep, "counts": counts})
    except Exception as e:
        sysmsg(f"bridge: status write failed: {e}", ALARM_HUE)


def dist_to(x, y):
    return max(abs(int(x) - int(API.Player.X)), abs(int(y) - int(API.Player.Y)))


def find(serial):
    try:
        return API.FindItem(int(serial))
    except Exception:
        return None


def walk_to(pos, root_serial):
    """Get within REACH of the container. Uses the live item if the client knows it, else the scanned position."""
    it = find(root_serial)
    on_ground = it is not None and bool(getattr(it, "OnGround", False))
    if on_ground:
        if dist_to(it.X, it.Y) <= REACH:
            return True
        API.PathfindEntity(int(root_serial), REACH, True, WALK_TIMEOUT_S)
        return dist_to(it.X, it.Y) <= REACH
    if pos:
        if dist_to(pos["x"], pos["y"]) <= REACH:
            return True
        API.Pathfind(int(pos["x"]), int(pos["y"]), int(pos.get("z", 0)), REACH, True, WALK_TIMEOUT_S)
        return dist_to(pos["x"], pos["y"]) <= REACH
    return it is not None and dist_to(it.X, it.Y) <= REACH


def open_chain(chain):
    """Open root, then each nested bag in order. Returns (ok, message)."""
    for i, c in enumerate(chain):
        it = find(c)
        if it is None:
            return False, f"container {i + 1}/{len(chain)} (0x{int(c):x}) is not in view — walk there and try again"
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
    API.MoveItem(int(cmd["serial"]), int(API.Backpack))
    API.Pause(1.2)
    it2 = find(cmd["serial"])
    if it2 is not None and int(getattr(it2, "Container", 0) or 0) == int(API.Backpack):
        return True, f"grabbed {name} — it is in your backpack"
    return False, f"move bounced for {name} (too far, or backpack full?)"


def run(cmd):
    action = cmd.get("action")
    chain = [int(c) for c in cmd.get("chain") or []]
    if action not in CAPABILITIES["bridge"]:
        return False, "unknown action"
    if chain:
        if not walk_to(cmd.get("pos"), chain[0]):
            return False, "could not reach the container (not in view / no path) — walk closer and retry"
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
    os.makedirs(BRIDGE_DIR, exist_ok=True)
    if not os.path.exists(QUEUE):
        open(QUEUE, "a").close()
    offset = os.path.getsize(QUEUE)          # ignore anything queued before we started
    deadline = time.time() + MAX_HOURS * 3600
    next_status = 0
    sysmsg(f"Pack Rat bridge up on {API.Player.Name}. Use Highlight / Grab / Go to in the app. Stop the script to end.")
    while not API.StopRequested and time.time() < deadline:
        API.ProcessCallbacks()
        try:
            size = os.path.getsize(QUEUE)
            if size < offset:
                offset = 0                   # file was truncated/reset by the server
            if size > offset:
                with open(QUEUE, "rb") as f:          # binary: byte offsets stay exact on every Python
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
                    sysmsg(f"bridge: {cmd.get('action')} {cmd.get('name', '')}", INFO_HUE)
                    write_status({"id": cid, "action": cmd.get("action"), "name": cmd.get("name")})
                    try:
                        ok, msg = run(cmd)
                    except Exception as e:
                        ok, msg = False, f"error: {e}"
                    results[cid] = {"ok": bool(ok), "msg": str(msg), "t": rfc3339_now()}
                    counts["done" if ok else "failed"] += 1
                    sysmsg(f"bridge: {msg}", OK_HUE if ok else ALARM_HUE)
                    write_status(None)
                    if API.StopRequested:
                        break
        except Exception as e:
            sysmsg(f"bridge: queue read failed: {e}", ALARM_HUE)
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
