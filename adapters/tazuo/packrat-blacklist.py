# packrat-blacklist.py — ATTENDED one-shot: blacklist a container so Pack Rat's scans never open or
# record it again (a trash barrel, a guild chest, a vendor's stock). Press Play, then click the
# container with the target cursor: a chest on the ground or a bag inside one. Esc cancels and
# changes nothing. Unblacklist it in the app's Settings; the next scan reads it again.
#
# Output: adds {serial, name, addedAt, where} to <data directory>/scan-blacklist.json, the same list
# the app's Blacklist action writes. The app reads it on its next request; packrat-scanner.py and
# packrat-refresh.py read it when they start. The data directory is `packrat-paths.json` beside
# this script, else $PACKRAT_DATA, else ~/.pack-rat. Opens nothing, moves nothing.

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
    """<data directory>/scan-blacklist.json, the containers the player blacklisted (the app's
    Containers view, or packrat-blacklist.py): a list of {serial, name, addedAt, where?}, at most
    1000 of them in 256 KB. [] when there is no file; None when it is unreadable or not that shape,
    which a scan reads as an empty list -- the file can only ever make a scan skip containers."""
    try:
        if not os.path.exists(path):
            return []
        if os.path.getsize(path) > 256 * 1024:
            return None
        with open(path, "r", encoding="utf-8") as f:
            doc = json.load(f)
    except Exception:
        return None
    def ok_str(v, n):
        return isinstance(v, str) and 0 < len(v) <= n
    if not isinstance(doc, list) or len(doc) > 1000:
        return None
    for e in doc:
        if not (isinstance(e, dict) and type(e.get("serial")) is int and 0 < e["serial"] <= 0xFFFFFFFF
                and ok_str(e.get("name"), 64) and ok_str(e.get("addedAt"), 40)
                and ("where" not in e or (isinstance(e["where"], str) and len(e["where"]) <= 64))):
            return None
    return doc


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
    if listed is None:
        API.SysMsg("Pack Rat: scan-blacklist.json cannot be read - fix or delete it first. Nothing changed.", ALARM_HUE)
        return
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
    if it is None or serial in own:
        API.SysMsg("Pack Rat: that is not a container a scan can skip (your backpack and bank are always read).", ALARM_HUE)
        return
    name = (name_of(serial) or str(getattr(it, "Name", "") or "") or "container")[:64]
    if any(e["serial"] == serial for e in listed):
        API.SysMsg(f"Pack Rat: {name} is already blacklisted.", INFO_HUE)
        return
    if len(listed) >= 1000:
        API.SysMsg("Pack Rat: the blacklist is full (1000 containers). Unblacklist some in the app first.", ALARM_HUE)
        return
    parent = int(getattr(it, "Container", 0) or 0)
    if not parent:
        where = f"{int(it.X)}, {int(it.Y)}"
    else:
        pname = name_of(parent)
        where = ("in " + pname)[:64] if pname else ""
    entry = {"serial": serial, "name": name, "addedAt": rfc3339_now()}
    if where:
        entry["where"] = where
    write_json_atomic(path, listed + [entry])
    API.SysMsg(f"Pack Rat: {name} blacklisted. Scans skip it from now on; unblacklist it in the app's Settings.", OK_HUE)


main()
