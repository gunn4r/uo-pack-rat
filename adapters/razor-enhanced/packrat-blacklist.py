# packrat-blacklist.py -- ATTENDED one-shot: click a container (a chest on the ground or a bag inside
# one) and Pack Rat's scans never open it again. Esc cancels. It adds {serial, name, addedAt, where} to
# <data directory>/scan-blacklist.json, the list the app's Blacklist action and Settings use; the
# scanner and refresh read it when they start. Opens nothing, moves nothing. The same script as
# adapters/tazuo/packrat-blacklist.py, on Razor Enhanced's API; helpers copied VERBATIM from
# packrat-scanner.py (adapters/test_scanners.py keeps the copies identical).
#
# Unverified against a live client, like the rest of this adapter (README.md's "Status" section).

import json
import os
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


PROPS_WAIT_MS = 800       # Items.WaitForProps' own request-and-wait timeout, per item
ALARM_HUE, OK_HUE, INFO_HUE = 33, 68, 88


def sysmsg(msg, hue=OK_HUE):
    # Misc.SendMessage prints to this client's own message area, never a network speech packet.
    Misc.SendMessage(msg, hue, False)


def as_int(v, default=0):
    try:
        return int(v)
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


def name_of(it):
    """An item's tooltip name ("A Trash Barrel"), which the client's own cached Name may not carry
    (just "barrel" for that art); the cached Name is the fallback when the tooltip reads nothing."""
    lines = tooltip_lines(it)
    return lines[0] if lines else str(getattr(it, "Name", "") or "")


def main():
    path = os.path.join(data_dir(), "scan-blacklist.json")
    listed = read_blacklist(path)
    # Target.PromptTarget(message, color) raises a target cursor, shows the hint and returns the
    # serial of what was clicked (razorenhanced.github.io/doc/api/Target.html). What it returns on
    # Esc is undocumented (-1 or 0 by the usual RE convention), so anything not a valid serial is a cancel.
    try:
        serial = as_int(Target.PromptTarget("Pack Rat: click a container to blacklist it (Esc cancels).", INFO_HUE))
    except Exception:
        serial = 0
    if not 0 < serial <= 0xFFFFFFFF:
        sysmsg("Pack Rat: cancelled, nothing blacklisted.", INFO_HUE)
        return
    it = Items.FindBySerial(serial)
    own = set()
    for root in ("Backpack", "Bank"):
        try:
            own.add(as_int(getattr(getattr(Player, root), "Serial", 0)))
        except Exception:
            pass
    if it is None or serial in own or not bool(getattr(it, "IsContainer", False)) or bool(getattr(it, "IsCorpse", False)):
        sysmsg("Pack Rat: that is not a container a scan can skip (your backpack and bank are always read).", ALARM_HUE)
        return
    # 60, not 64: the app bounds names in UTF-16 units, and this keeps any name inside the bound.
    name = (name_of(it) or "container")[:60]
    if any(e["serial"] == serial for e in listed):
        sysmsg("Pack Rat: {0} is already blacklisted.".format(name), INFO_HUE)
        return
    if bool(getattr(it, "OnGround", False)):
        where = "{0}, {1}".format(as_int(it.Position.X), as_int(it.Position.Y))
    else:
        parent = Items.FindBySerial(as_int(getattr(it, "Container", 0)))
        pname = name_of(parent) if parent is not None else ""
        where = ("in " + pname)[:60] if pname else ""
    entry = {"serial": serial, "name": name, "addedAt": rfc3339_now()}
    if where:
        entry["where"] = where
    write_json_atomic(path, listed + [entry])
    sysmsg("Pack Rat: {0} blacklisted. Scans skip it from now on; unblacklist it in the app's Settings.".format(name), OK_HUE)


main()
