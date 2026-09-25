# packrat-panel.py — ATTENDED in-game control panel for Pack Rat. A small window whose buttons run the
# other Pack Rat scripts, so nobody has to find them in the Script Manager:
#   Scan here               packrat-scanner.py
#   Quick refresh           packrat-refresh.py
#   Start / Stop bridge     packrat-bridge.py (the label follows whether it is running)
#   Blacklist a container   packrat-blacklist.py
#   Close                   hides the window; the hotkey shows it again
# Below the buttons: which Pack Rat scripts are running, whether the bridge is on, and how long ago this
# character's last scan file was saved. The panel reads only local files and the client's own script
# list; it never touches the world. Every world action still comes from a click.
#
# The script names are fixed siblings of this file. Their folder (top level, or a group folder in the
# Script Manager) is read off this script's own entry in API.ListRunningScripts(); nothing read from
# a file ever becomes a script name or path.
#
# The show/hide hotkey (default Ctrl+Shift+P) is set in the Pack Rat app, which writes it to
# <data directory>/tazuo-panel.json; the panel re-reads that file every few seconds, validates it and
# falls back to the default on anything it does not accept.
#
# While it runs it rewrites <data directory>/bridge/tazuo/panel.json every 2 s, the heartbeat the
# app's installer checks before replacing scripts. Bounded by MAX_HOURS; Stop, -stopall or logout
# ends it. Start it with a single click, a hotkey or `-playlscript packrat-panel.py`: the Script
# Manager's Play button is a toggle, and a double click starts and at once stops it.

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
ADAPTER_VERSION = "2.7.0"

SELF = "packrat-panel.py"
SCANNER, REFRESH, BRIDGE, BLACKLIST = "packrat-scanner.py", "packrat-refresh.py", "packrat-bridge.py", "packrat-blacklist.py"
LABELS = {SCANNER: "scan", REFRESH: "quick refresh", BRIDGE: "bridge", BLACKLIST: "blacklist"}

DATA = data_dir()
HEARTBEAT = os.path.join(DATA, "bridge", "tazuo", "panel.json")
PREFS = os.path.join(DATA, "tazuo-panel.json")
SCAN_DIRS = (os.path.join(DATA, "inbox", "tazuo"), os.path.join(DATA, "scans"))

MAX_HOURS = 24            # idle UI: a whole play session, then it says how to reopen it
POLL_S = 0.1              # callbacks only run inside ProcessCallbacks, so the loop stays quick
STATUS_EVERY_S = 2.0      # status lines and the heartbeat
PREFS_EVERY_S = 3.0       # the hotkey file
START_CHECK_S = 1.5       # a started script not seen running by then did not start
WINDOW_TRIES = 3
MAX_PREFS_BYTES = 4096
MAX_DIR_ENTRIES = 5000    # names looked at per folder per refresh
DEFAULT_HOTKEY = "CTRL+SHIFT+P"
HOTKEY_MODS = ("CTRL", "ALT", "SHIFT")
HOTKEY_KEY_RE = re.compile(r"[A-Z0-9]|F[1-9]|F1[0-2]")    # used with fullmatch
W, H = 380, 272
TITLE_HUE, TEXT_HUE, OK_HUE = 1153, 996, 68

state = {"done": False, "prefix": "", "character": "", "pending": {}, "was_running": set(),
         "hotkey": None, "window": None}
ui = {}
shown = {}


def gumps(name):
    g = getattr(API, "Gumps", None)
    return getattr(g, name, None) if g is not None else None


def call(fn, *args):
    """A client call looked up with getattr: None when missing or when it raises."""
    if fn is None:
        return None
    try:
        return fn(*args)
    except Exception:
        return None


def set_text(key, text):
    c = ui.get(key)
    if c is None or shown.get(key) == text:
        return
    try:
        c.Text = text
        shown[key] = text
    except Exception:
        pass


def say(line1, line2=""):
    set_text("msg", line1)
    set_text("msg2", line2)


def rel(name):
    return state["prefix"] + name


def is_running(name):
    return bool(call(getattr(API, "IsScriptRunning", None), rel(name)))


def own_prefix():
    """This script's folder relative to LegionScripts ('' or 'Group/'): PlayScript and IsScriptRunning
    match on that relative path exactly, and a bare name misses a script inside a group folder."""
    for p in call(getattr(API, "ListRunningScripts", None)) or []:
        p = str(p).replace("\\", "/")
        if p == SELF or p.endswith("/" + SELF):
            return p[: len(p) - len(SELF)]
    return ""


def start(name):
    if is_running(name):
        say("The %s is already running." % LABELS[name])
        return
    call(getattr(API, "PlayScript", None), rel(name))
    state["pending"][name] = time.time() + START_CHECK_S
    say("Starting the %s..." % LABELS[name])


def watch_pending():
    """PlayScript is silent when the Script Manager has not loaded the file, or while the script's
    previous run is still shutting down, so a start is confirmed by seeing it run."""
    for name, until in list(state["pending"].items()):
        if is_running(name):
            del state["pending"][name]
            state["was_running"].add(name)
            say("The %s is running." % LABELS[name])
        elif time.time() >= until:
            del state["pending"][name]
            say("Didn't start. Try again in a moment;", "if it persists, open Script Manager or relog.")


def on_bridge():
    if is_running(BRIDGE):
        call(getattr(API, "StopScript", None), rel(BRIDGE))
        say("Stopping the bridge...")
    else:
        start(BRIDGE)


def on_close():
    try:
        state["window"].IsVisible = False
    except Exception:
        pass


def on_disposed(g):
    if state["window"] is g:   # closed with its own X: the hotkey builds a new one
        state["window"] = None


def toggle():
    g = state["window"]
    if g is None or bool(getattr(g, "IsDisposed", False)):
        state["window"] = build_window()
        return
    try:
        g.IsVisible = not bool(g.IsVisible)
    except Exception:
        pass


def read_hotkey():
    """<data>/tazuo-panel.json's hotkey as "CTRL+SHIFT+P", or the default for anything not accepted.
    A letter or digit needs a modifier: a bare one would fire whenever it is typed in chat."""
    try:
        if os.path.getsize(PREFS) > MAX_PREFS_BYTES:
            return DEFAULT_HOTKEY
        with open(PREFS, "r", encoding="utf-8") as f:
            hk = json.load(f).get("hotkey")
        mods, key = hk.get("mods"), hk.get("key")
        if not isinstance(mods, list) or not all(m in HOTKEY_MODS for m in mods) or len(set(mods)) != len(mods):
            return DEFAULT_HOTKEY
        if not isinstance(key, str) or not HOTKEY_KEY_RE.fullmatch(key) or (len(key) == 1 and not mods):
            return DEFAULT_HOTKEY
        return "+".join([m for m in HOTKEY_MODS if m in mods] + [key])
    except Exception:
        return DEFAULT_HOTKEY


def bind_hotkey():
    hk = read_hotkey()
    if hk == state["hotkey"]:
        return
    on_hotkey = getattr(API, "OnHotKey", None)
    if state["hotkey"]:
        call(on_hotkey, state["hotkey"], None)       # a None callback unregisters it
    call(on_hotkey, hk, toggle)
    state["hotkey"] = hk
    set_text("hotkey", hotkey_text(hk))


def hotkey_text(hk):
    return "%s shows/hides this window." % "+".join(p.capitalize() for p in hk.split("+"))


def last_scan():
    """mtime of this character's newest scan file in the inbox or scans/ (names only, never opened)."""
    slug = re.sub(r"[^A-Za-z0-9_-]", "_", state["character"])
    if not slug:
        return None
    pattern = re.compile(re.escape(slug) + r"-\d{8}[-T]\d{6}.*\.json$")
    newest = None
    for d in SCAN_DIRS:
        try:
            with os.scandir(d) as it:
                for i, e in enumerate(it):
                    if i >= MAX_DIR_ENTRIES:
                        break
                    if pattern.match(e.name) and e.is_file(follow_symlinks=False):
                        mt = e.stat(follow_symlinks=False).st_mtime
                        newest = mt if newest is None or mt > newest else newest
        except Exception:
            pass
    return newest


def ago(t):
    s = max(0, int(time.time() - t))
    if s < 60:
        return "just now"
    if s < 3600:
        return "%d min ago" % (s // 60)
    if s < 86400:
        return "%d h ago" % (s // 3600)
    return "%d days ago" % (s // 86400)


def refresh():
    if not state["character"]:
        try:
            state["character"] = str(API.Player.Name or "")
        except Exception:
            pass
    set_text("title", "Pack Rat - " + "".join(ch for ch in state["character"] if ch.isprintable())[:30])
    running = [n for n in (SCANNER, REFRESH, BRIDGE, BLACKLIST) if is_running(n)]
    for name in state["was_running"] - set(running) - set(state["pending"]):
        say("The %s finished." % LABELS[name])
    state["was_running"] = set(running)
    set_text("running", "Running: " + (", ".join(LABELS[n] for n in running) or "nothing"))
    set_text("bridge_btn", "Stop bridge" if BRIDGE in running else "Start bridge")
    set_text("bridge", "Bridge: " + ("on" if BRIDGE in running else "off"))
    t = last_scan()
    set_text("scan", "Last scan: " + ("none yet" if t is None else ago(t)))
    write_json_atomic(HEARTBEAT, {"alive": rfc3339_now(), "character": state["character"]})


def write_stopped():
    try:
        write_json_atomic(HEARTBEAT, {"alive": rfc3339_now(), "character": state["character"], "stopped": True})
    except Exception:
        pass


def on_stop():
    state["done"] = True
    write_stopped()


def create_window():
    """A None from a Gumps call means this script is being stopped (the call never reached the client's
    main thread); anything else is retried a few times, 1 s apart."""
    for _ in range(WINDOW_TRIES):
        g = call(gumps("CreateModernGump"), 120, 120, W, H, False, W, H, None)
        if g is not None or API.StopRequested:
            return g
        API.Pause(1.0)
    return None


def build_window():
    ui.clear()
    shown.clear()
    g = create_window()
    if g is None:
        return None
    rows = [("title", "Pack Rat", TITLE_HUE, 14), ("running", "", TEXT_HUE, 124),
            ("bridge", "", TEXT_HUE, 144), ("scan", "", TEXT_HUE, 164),
            ("msg", "", OK_HUE, 186), ("msg2", "", OK_HUE, 204), ("hotkey", "", TEXT_HUE, 240)]
    for key, text, hue, y in rows:
        lbl = call(gumps("CreateGumpLabel"), text, hue)
        if lbl is None:
            if API.StopRequested:
                return None
            continue
        lbl.SetPos(16, y)
        g.Add(lbl)
        ui[key] = lbl
    buttons = [("scan_btn", "Scan here", lambda: start(SCANNER), 16, 44),
               ("refresh_btn", "Quick refresh", lambda: start(REFRESH), 196, 44),
               ("bridge_btn", "Start bridge", on_bridge, 16, 80),
               ("blacklist_btn", "Blacklist a container", lambda: start(BLACKLIST), 196, 80),
               ("close_btn", "Close", on_close, 276, 232)]
    for key, text, fn, x, y in buttons:
        b = call(gumps("CreateSimpleButton"), text, 88 if key == "close_btn" else 168, 28)
        if b is None:
            if API.StopRequested:
                return None
            continue
        b.SetPos(x, y)
        g.Add(b)
        call(gumps("AddControlOnClick"), b, fn)
        ui[key] = b
    call(gumps("AddControlOnDisposed"), g, lambda: on_disposed(g))
    call(gumps("AddGump"), g)
    state["window"] = g
    if state["hotkey"]:
        set_text("hotkey", hotkey_text(state["hotkey"]))
    refresh()
    return g


def main():
    state["prefix"] = own_prefix()
    call(getattr(API, "OnStop", None), on_stop)
    bind_hotkey()
    if build_window() is None:
        if not API.StopRequested:
            API.SysMsg("Pack Rat panel: the window could not be opened. Start packrat-panel.py again.", 33)
        return
    process = getattr(API, "ProcessCallbacks", None)
    deadline = time.time() + MAX_HOURS * 3600
    next_status, next_prefs = time.time() + STATUS_EVERY_S, time.time() + PREFS_EVERY_S
    failed = False
    while not API.StopRequested and not state["done"] and time.time() < deadline:
        call(process)
        try:
            watch_pending()
            if time.time() >= next_prefs:
                bind_hotkey()
                next_prefs = time.time() + PREFS_EVERY_S
            if time.time() >= next_status:
                refresh()
                next_status = time.time() + STATUS_EVERY_S
        except Exception as e:
            if not failed:
                API.SysMsg("Pack Rat panel: status update failed: %s" % str(e)[:80], 33)
                failed = True
        API.Pause(POLL_S)
    if not API.StopRequested and not state["done"]:
        API.SysMsg("Pack Rat panel closed; type -playlscript packrat-panel.py to reopen", 88)
    call(getattr(API, "OnHotKey", None), state["hotkey"], None)
    g = state["window"]
    try:
        if g is not None and not bool(g.IsDisposed):
            g.Dispose()
    except Exception:
        pass


try:
    main()
finally:
    write_stopped()
