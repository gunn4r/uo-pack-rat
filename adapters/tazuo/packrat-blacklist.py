# packrat-blacklist.py — ATTENDED one-shot: click a container (a chest on the ground or a bag inside
# one) and Pack Rat's scans never open it again. Esc cancels. It adds {serial, name, addedAt, where} to
# <data directory>/scan-blacklist.json, the list the app's Blacklist action and Settings use; the
# scanner and refresh read it when they start. Opens nothing, moves nothing.

import API
import json
import os
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


TARGET_S = 30            # how long the target cursor waits for a click
ALARM_HUE, OK_HUE, INFO_HUE = 33, 68, 88


def name_of(serial):
    try:
        lines = [ln.strip() for ln in str(API.ItemNameAndProps(int(serial), True) or "").splitlines() if ln.strip()]
    except Exception:
        lines = []
    return lines[0] if lines else ""


def main():
    path = os.path.join(data_dir(), "scan-blacklist.json")
    listed = read_blacklist(path)
    API.SysMsg("Pack Rat: click a container to blacklist it (Esc cancels).", INFO_HUE)
    serial = int(API.RequestTarget(TARGET_S) or 0)
    if not serial:
        API.SysMsg("Pack Rat: cancelled, nothing blacklisted.", INFO_HUE)
        return
    it = API.FindItem(serial)
    own = set()
    for root in ("Backpack", "Bank"):
        try:
            own.add(int(getattr(API, root) or 0))
        except Exception:
            pass
    if it is None or serial in own or not bool(getattr(it, "IsContainer", False)) or bool(getattr(it, "IsCorpse", False)):
        API.SysMsg("Pack Rat: that is not a container a scan can skip (your backpack and bank are always read).", ALARM_HUE)
        return
    # 60, not 64: the app bounds names in UTF-16 units, and this keeps any name inside the bound.
    name = (name_of(serial) or str(getattr(it, "Name", "") or "") or "container")[:60]
    if any(e["serial"] == serial for e in listed):
        API.SysMsg(f"Pack Rat: {name} is already blacklisted.", INFO_HUE)
        return
    if bool(getattr(it, "OnGround", False)):
        where = f"{int(it.X)}, {int(it.Y)}"
    else:
        pname = name_of(int(getattr(it, "Container", 0) or 0))
        where = ("in " + pname)[:60] if pname else ""
    entry = {"serial": serial, "name": name, "addedAt": rfc3339_now()}
    if where:
        entry["where"] = where
    write_json_atomic(path, listed + [entry])
    API.SysMsg(f"Pack Rat: {name} blacklisted. Scans skip it from now on; unblacklist it in the app's Settings.", OK_HUE)


main()
