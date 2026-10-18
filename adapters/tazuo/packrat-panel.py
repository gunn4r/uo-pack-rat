# packrat-panel.py — ATTENDED in-game control panel for Pack Rat. A small window whose buttons run the
# other Pack Rat scripts, so nobody has to find them in the Script Manager:
#   Scan here               packrat-scanner.py
#   Character refresh       packrat-character-refresh.py
#   House map refresh       packrat-house-map-refresh.py (waits while a Put away runs: its file would read as the run's scan)
#                           (each of these three reads "Stop scan" while its script runs, and stops it)
#   Start / Stop bridge     packrat-bridge.py (the label follows whether it is running)
#   Blacklist a container   packrat-blacklist.py
#   Put away...             Put away (issue #131): files what lies directly in a container you pick with
#                           a target cursor by the app's Organize rules (see below)
#   Claim this house        claims the house you stand in (issue #299): scans open ground containers and
#                           capture the house only inside a claimed one. It reads Unclaim this house inside
#                           a claimed house, which takes the claim back, and is greyed and does nothing outside
#                           any house. The house where you stand is worked out again only when you move
#   Close                   hides the window; the hotkey shows it again
# Below the buttons: which Pack Rat scripts are running, whether the bridge is on, and how long ago this
# character's last scan file was saved. The panel reads only local files, the client's own script
# list and the house tiles where you stand (and, for a claim, the house sign's tooltip); it never touches
# the world. Every world action still comes from a click.
#
# Put away is one click, one run: it raises a target cursor, and the container picked (your backpack, a
# bag at any depth in it, or a container in a chest on the ground within reach, which the app must have
# labelled) is the run's only source; only what lies directly in it moves, never a bag in it or what the
# bag holds (pick that bag next). The panel runs the character refresh (your pack) or Scan here (a chest) and
# waits for its scan file, then drops a request into <data>/inbox/tazuo/putaway-request.json that names
# only the container, this character and where it stands. The app (it must be running) plans the first
# trip with its Organize rules, queues it for the bridge and answers in <data>/bridge/tazuo/putaway.json;
# the panel follows that trip's result in the bridge's status.json and asks again after each trip that
# put everything it tried, until the app says nothing is left, a step fails or PUT_AWAY_ROUNDS trips have
# run. The click also sets the shared variable PUT_AWAY_VAR to the picked container and the run's end:
# the bridge puts what you carry only from that container and only while it is set, so a line written
# into the queue file alone cannot (docs/threat-model.md, boundary 13).
#
# The script names are fixed siblings of this file. Their folder (top level, or a group folder in the
# Script Manager) is read off this script's own entry in API.ListRunningScripts(); nothing read from
# a file ever becomes a script name or path.
#
# The show/hide hotkey (default Ctrl+Shift+P) is set in the Pack Rat app, which writes it to
# <data directory>/tazuo-panel.json; the panel re-reads that file every few seconds, validates it and
# falls back to the default on anything it does not accept. The same file carries showAtLogin, written by
# the app and by this panel's own button: the app's install puts this script in TazUO's autostart list,
# so it always starts at login, and showAtLogin decides whether its window shows then or waits hidden
# for the hotkey.
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


# BEGIN generated: tazuo/paths
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
            # app/schema/packrat-paths.v1.schema.json's shapes: a relative path would land under the client's own
            # working folder and ~user/ elsewhere, unseen by the app, so refuse to start instead.
            drive = len(d) > 2 and "a" <= d[0].lower() <= "z" and d[1] == ":" and d[2] in "/\\"
            if not (drive or d == "~" or d.startswith(("/", "\\\\", "~/", "~\\"))):
                raise ValueError("packrat-paths.json: dataDir must be an absolute folder or start with ~/")
            return os.path.expanduser(d)
    return os.path.expanduser(os.environ.get("PACKRAT_DATA") or "~/.pack-rat")


def write_json_atomic(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, path)
# END generated: tazuo/paths


# BEGIN generated: rfc3339_now
def rfc3339_now():
    t = time.localtime()
    off = time.strftime("%z", t)
    tz = "Z" if not off else off if ":" in off else off[:3] + ":" + off[3:]
    return time.strftime("%Y-%m-%dT%H:%M:%S", t) + tz
# END generated: rfc3339_now


# BEGIN generated: tazuo/scripts
SCANNER, REFRESH, HOUSE = "packrat-scanner.py", "packrat-character-refresh.py", "packrat-house-map-refresh.py"


def script_prefix(self_name):
    """The folder of the running script `self_name`, relative to LegionScripts ('' or 'Group/'): PlayScript
    and IsScriptRunning match on that relative path exactly, and a bare name misses a script inside a group
    folder. Read off the script's own entry in API.ListRunningScripts(); the Pack Rat scripts are siblings."""
    try:
        running = API.ListRunningScripts() or []
    except Exception:
        running = []
    for p in running:
        p = str(p).replace("\\", "/")
        if p == self_name or p.endswith("/" + self_name):
            return p[: len(p) - len(self_name)]
    return ""
# END generated: tazuo/scripts


# BEGIN generated: manifest_version
ADAPTER_ID = "tazuo"
ADAPTER_VERSION = "2.21.0"
# END generated: manifest_version

SELF = "packrat-panel.py"
BRIDGE, BLACKLIST = "packrat-bridge.py", "packrat-blacklist.py"
LABELS = {SCANNER: "scan", REFRESH: "character refresh", HOUSE: "house map refresh", BRIDGE: "bridge", BLACKLIST: "blacklist"}
RUNNING = {SCANNER: "scan", REFRESH: "refresh", HOUSE: "house", BRIDGE: "bridge", BLACKLIST: "blacklist"}   # the Running line's words: all five fit the window

DATA = data_dir()
HEARTBEAT = os.path.join(DATA, "bridge", "tazuo", "panel.json")
PUT_AWAY_REQUEST = os.path.join(DATA, "inbox", "tazuo", "putaway-request.json")   # app/put-away.mts
PUT_AWAY_REPLY = os.path.join(DATA, "bridge", "tazuo", "putaway.json")
BRIDGE_STATUS = os.path.join(DATA, "bridge", "tazuo", "status.json")
STOP_FLAG = os.path.join(DATA, "bridge", "stop")
BLACKLIST_PATH = os.path.join(DATA, "scan-blacklist.json")    # Organize's Stop: the bridge halts a trip after its current step
PREFS = os.path.join(DATA, "tazuo-panel.json")
SCAN_DIRS = (os.path.join(DATA, "inbox", "tazuo"), os.path.join(DATA, "scans"))

MAX_HOURS = 24            # idle UI: a whole play session, then it says how to reopen it
POLL_S = 0.1              # callbacks only run inside ProcessCallbacks, so the loop stays quick
STATUS_EVERY_S = 2.0      # status lines and the heartbeat
PREFS_EVERY_S = 3.0       # the hotkey file
START_CHECK_S = 1.5       # a started script not seen running by then did not start
WINDOW_TRIES = 3
MAX_PREFS_BYTES = 4096
MAX_STATUS_BYTES = 1 << 20  # the bridge's status.json: 30 results of at most 60 steps each
PUT_AWAY_VAR = "packrat_putaway"   # packrat-bridge.py's put_away_asked reads it
PUT_AWAY_EVERY_S = 0.5    # how often a running Put away looks at its files
PUT_AWAY_ROUNDS = 10      # trips one click runs at most
SCAN_WAIT_S = 300         # the refresh or scan a Put away runs first
REPLY_WAIT_S = 30         # the app's answer: it folds every scan first
TRIP_WAIT_S = 180         # one trip, at most 40 puts
TARGET_S = 30             # how long Put away's target cursor waits for a click
SCAN_RANGE = 3            # packrat-scanner.py's reach: a chest must be this close to be scanned first
MAX_NEST = 4              # bags in bags in bags, as the scanners walk them
# What the scanners never take for a container (a book is one to the client) and what they never read.
# BEGIN generated: not_a_container_re
NOT_A_CONTAINER_RE = re.compile(r"\b(deed(?!\s+box)|sending|music box|\w*book|tome|atlas|compendium)\b", re.I)   # a "Commodity Deed Box" IS one
# END generated: not_a_container_re
# BEGIN generated: not_a_container_graphics
NOT_A_CONTAINER_GRAPHICS = {0x0EFA, 0x2D50, 0x2D9D, 0x2252, 0x2253, 0x225A, 0x225B, 0x238C, 0x23A0, 0x22C5, 0x9C16}
# END generated: not_a_container_graphics
# BEGIN generated: trash_re
TRASH_RE = re.compile(r"\btrash\b", re.I)
# END generated: trash_re
MAX_DIR_ENTRIES = 5000    # names looked at per folder per refresh
DEFAULT_HOTKEY = "CTRL+SHIFT+P"
HOTKEY_MODS = ("CTRL", "ALT", "SHIFT")
HOTKEY_KEY_RE = re.compile(r"[A-Z0-9]|F[1-9]|F1[0-2]")    # used with fullmatch
W, H = 380, 344
TITLE_HUE, TEXT_HUE, OK_HUE, DIM_HUE = 1153, 996, 68, 902
CLAIM_MAX = 500           # the claims house-claims.json holds at most (app/store/house-claims.mts)
SIGN_GRAPHICS = (0x0BD1, 0x0BD2)   # a house sign's art (ServUO HouseSign)
SIGN_RE = re.compile(r"\bsign\b", re.I)
OWNER_RE = re.compile(r"^owner:\s*(.+)$", re.I)   # the sign's owner line ("Owner: <name>")
SIGN_WAIT_S = 1           # how long a claim waits for the sign's tooltip
SCAN_NAME = re.compile(r"^(.+)-\d{8}[-T]\d{6}")   # a scan file's name: its character's slug, then its stamp

state = {"done": False, "prefix": "", "character": "", "pending": {}, "was_running": set(),
         "hotkey": None, "window": None, "show_at_login": True, "run": None, "quiet": set(), "claim_hue": None,
         "here_at": None, "here": None, "claims_mt": None, "claims": []}
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
            if name not in state["quiet"]:       # a Put away says what it is doing itself
                say("The %s is running." % LABELS[name])
        elif time.time() >= until:
            del state["pending"][name]
            say("Didn't start. Try again in a moment;", "if it persists, open Script Manager or relog.")


# The three scan buttons: while a button's script runs, it reads "Stop scan" and a click stops that script.
SCAN_BUTTONS = {SCANNER: ("scan_btn", "Scan here"), REFRESH: ("refresh_btn", "Character refresh"), HOUSE: ("house_btn", "House map refresh")}


def scan_click(name, fn):
    """A click on a scan button, its script's state read at the click: one that still read Stop scan when
    the script had already ended starts nothing."""
    def click():
        if is_running(name):
            stop_scan(name)
        elif shown.get(SCAN_BUTTONS[name][0]) == "Stop scan":
            say("The %s already finished." % LABELS[name])
        else:
            fn()
    return click


def stop_scan(name):
    """Stops a scan script. A Put away waiting for that scan ends with it: the file a stopped scan writes
    may leave out the container it picked."""
    call(getattr(API, "StopScript", None), rel(name))
    state["quiet"].add(name)    # it ends because of the Stop: no "finished" line
    run = state["run"]
    if run is not None and run["phase"] == "scan" and run["script"] == name:
        end_put_away("Put away canceled.")
    else:
        say("Stopping the %s..." % LABELS[name])


def on_house():
    if state["run"] is not None:
        say("Put away is running;", "refresh the house map after it.")
        return
    start(HOUSE)


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


def read_json(path, limit=MAX_PREFS_BYTES):
    """A JSON file as a dict, {} when missing, over `limit` bytes or not a JSON object."""
    try:
        if os.path.getsize(path) > limit:
            return {}
        with open(path, "r", encoding="utf-8") as f:
            doc = json.load(f)
        return doc if isinstance(doc, dict) else {}
    except Exception:
        return {}


def read_prefs():
    """<data>/tazuo-panel.json (the hotkey and showAtLogin; app/schema/tazuo-panel.v1.schema.json, and the cases both
    readers run, app/fixtures/contract-cases/tazuo-panel.json)."""
    return read_json(PREFS)


def read_hotkey(doc):
    """The file's hotkey as "CTRL+SHIFT+P", or the default for anything not accepted. A letter or digit
    needs a modifier: a bare one would fire whenever it is typed in chat."""
    try:
        hk = doc.get("hotkey")
        mods, key = hk.get("mods"), hk.get("key")
        if not isinstance(mods, list) or not all(m in HOTKEY_MODS for m in mods) or len(set(mods)) != len(mods):
            return DEFAULT_HOTKEY
        if not isinstance(key, str) or not HOTKEY_KEY_RE.fullmatch(key) or (len(key) == 1 and not mods):
            return DEFAULT_HOTKEY
        return "+".join([m for m in HOTKEY_MODS if m in mods] + [key])
    except Exception:
        return DEFAULT_HOTKEY


def read_show_at_login(doc):
    """The file's showAtLogin, else openAtLogin (the name an older app wrote), else True: the first that is
    true or false, as app/tazuo-panel-prefs.mts reads it."""
    for k in ("showAtLogin", "openAtLogin"):
        if isinstance(doc.get(k), bool):
            return doc[k]
    return True


def load_prefs():
    doc = read_prefs()
    state["show_at_login"] = read_show_at_login(doc)
    set_text("login_btn", login_text())
    hk = read_hotkey(doc)
    if hk == state["hotkey"]:
        return
    on_hotkey = getattr(API, "OnHotKey", None)
    if state["hotkey"]:
        call(on_hotkey, state["hotkey"], None)       # a None callback unregisters it
    call(on_hotkey, hk, toggle)
    state["hotkey"] = hk
    set_text("hotkey", hotkey_text(hk))


def login_text():
    return "Show at login: " + ("On" if state["show_at_login"] else "Off")


def on_login():
    """Save whether the window shows at the next login, keeping the hotkey as read_hotkey reads it, so an
    invalid one is written as the default, as the app's own write does."""
    parts = read_hotkey(read_prefs()).split("+")
    out = {"hotkey": {"mods": parts[:-1], "key": parts[-1]}, "showAtLogin": not state["show_at_login"]}
    try:
        write_json_atomic(PREFS, out)
    except Exception:
        say("Could not save that choice.")
        return
    state["show_at_login"] = out["showAtLogin"]
    set_text("login_btn", login_text())
    say("Saved. Applies from your next login.")


def hotkey_name(hk):
    return "+".join(p.capitalize() for p in hk.split("+"))


def hotkey_text(hk):
    return "%s shows/hides this window." % hotkey_name(hk)


HOUSE_FILE = re.compile(r"-house(-\d+)?\.json$")


def last_scan():
    """mtime of this character's newest scan file in the inbox or scans/ (names only, never opened). A house map
    refresh's file (named "-house", in both folders) is not a scan: it reads nothing Put away waits for."""
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
                    if pattern.match(e.name) and not HOUSE_FILE.search(e.name) and e.is_file(follow_symlinks=False):
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
    running = [n for n in (SCANNER, REFRESH, HOUSE, BRIDGE, BLACKLIST) if is_running(n)]
    for name in state["was_running"] - set(running) - set(state["pending"]):
        if state["run"] is None and name not in state["quiet"]:   # a Put away says what it is doing itself
            say("The %s finished." % LABELS[name])
        state["quiet"].discard(name)
    state["was_running"] = set(running)
    set_text("running", "Running: " + (", ".join(RUNNING[n] for n in running) or "nothing"))
    set_text("bridge_btn", "Stop bridge" if BRIDGE in running else "Start bridge")
    for name, (key, text) in SCAN_BUTTONS.items():
        set_text(key, "Stop scan" if name in running else text)
    set_text("bridge", "Bridge: " + ("on" if BRIDGE in running else "off"))
    t = last_scan()
    set_text("scan", "Last scan: " + ("none yet" if t is None else ago(t)))
    away_buttons()
    if bool(getattr(state["window"], "IsVisible", True)):    # hidden, nobody sees the button
        here = house_now()
        claim_button(here, bool(claims_over(here, claims_now())))
    write_json_atomic(HEARTBEAT, {"alive": rfc3339_now(), "character": state["character"]})


def facet():
    """The map the player stands on (0 Felucca .. 5 Ter Mur), as packrat-character-refresh.py reads it. None when
    the client cannot say."""
    get_map = getattr(API, "GetMap", None)
    try:
        m = int(get_map())
    except Exception:
        return None
    return m if 0 <= m <= 5 else None


def consent(value):
    """Sets PUT_AWAY_VAR, which the bridge reads before a Put away trip ("<container>:<until>"); "" withdraws it."""
    call(getattr(API, "SetSharedVar", None), PUT_AWAY_VAR, value)


def away_buttons():
    """Put away's button reads Cancel put away while a run goes on."""
    set_text("away_btn", "Cancel put away" if state["run"] else "Put away...")


# BEGIN generated: read_blacklist
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
# END generated: read_blacklist


# BEGIN generated: tazuo/tooltip_lines
def tooltip_lines(serial, wait=True, timeout=None):
    """The item's tooltip lines. `wait`: the client waits for a tooltip it does not have yet, up to
    `timeout` s (TazUO's ItemNameAndProps, 10 s when not given); without it, a missing tooltip reads as
    none at once. A build whose ItemNameAndProps takes no timeout gets the read without one (its own
    10 s wait), never none: a trash check must not fall back to a cached name ("barrel") over it."""
    try:
        data = API.ItemNameAndProps(int(serial), wait) if timeout is None else API.ItemNameAndProps(int(serial), wait, timeout)
    except Exception:
        try:
            data = API.ItemNameAndProps(int(serial), wait) if timeout is not None else None
        except Exception:
            data = None
    return [ln.strip() for ln in str(data or "").splitlines() if ln.strip()]
# END generated: tazuo/tooltip_lines


# BEGIN generated: tazuo/house_limits
HOUSE_RADIUS = 40        # tiles searched around the player for the house's tiles (a castle is about 32 across)
HOUSE_MAX_TILES = 20000  # a capture larger than this is left out rather than bloating the scan
HOUSE_ITEM_REACH = 18    # the server sends ground items within about this many tiles
HOUSE_MULTI_IDS = (0x13EC, 0x147B)   # custom-house multi ids (ServUO HousePlacementTool.cs)
HOUSE_ITEM_CENTRE_RADIUS = 2   # the bounds include steps and the rim, so their centre sits up to about a tile off the multi origin, and an even-sized plot has a .5 centre
HOUSE_MAX_ITEMS = 5000   # the scan schema's cap on house items: past it the nearest are kept, so the scan file still validates
HOUSE_MAX_CONTAINERS = 5000  # the scan schema's cap on the house's containers: past it the nearest are kept
# END generated: tazuo/house_limits


# BEGIN generated: tazuo/house_footprint
def house_footprint(px, py):
    """The house the player stands in, from the client's own house tiles (issue #10): its tiles, sorted, each [graphic, x, y, z, impassable], and the (x, y) cells they cover; or None outside a house or on a build without the multi calls. Only the tiles connected to the player's tile are kept (8-connected in x/y, across every z), so a neighbouring house is left out. It reads only tiles the client has: it records nothing and asks the server nothing."""
    at = getattr(API, "GetMultisAt", None)
    area = getattr(API, "GetMultisInArea", None)
    if at is None or area is None:
        return None
    try:
        if not list(at(px, py) or []):
            return None
        found = list(area(px - HOUSE_RADIUS, py - HOUSE_RADIUS, px + HOUSE_RADIUS, py + HOUSE_RADIUS) or [])
    except Exception:
        return None
    cells = {}
    for m in found:
        try:
            t = [int(m.Graphic), int(m.X), int(m.Y), int(m.Z), 1 if bool(getattr(m, "Impassible", False)) else 0]
        except Exception:
            continue
        cells.setdefault((t[1], t[2]), []).append(t)
    if (px, py) not in cells:
        return None
    keep = {(px, py)}
    todo = [(px, py)]
    while todo:
        x, y = todo.pop()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                n = (x + dx, y + dy)
                if n in cells and n not in keep:
                    keep.add(n)
                    todo.append(n)
    return sorted(t for c in keep for t in cells[c]), keep


def house_here():
    """The house the player stands in as (id, facet, bounds), or None (house_footprint, so only tiles are read). The id is the app's (app/house-capture.mts houseIdOf: "<facet>-<x0>-<y0>", the facet "x" when the client cannot say), and bounds {x0, y0, x1, y1} span every tile."""
    try:
        fp = house_footprint(int(API.Player.X), int(API.Player.Y))
    except Exception:
        return None
    if fp is None:
        return None
    xs, ys = [c[0] for c in fp[1]], [c[1] for c in fp[1]]
    f = facet()
    bounds = {"x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys)}
    return "%s-%d-%d" % ("x" if f is None else f, bounds["x0"], bounds["y0"]), f, bounds
# END generated: tazuo/house_footprint


# BEGIN generated: tazuo/claims
CLAIMS_PATH = os.path.join(data_dir(), "house-claims.json")
NOT_CLAIMED = "Not in one of your houses, so only your pack was scanned. Use Claim this house in the Pack Rat panel if this house is yours."


def read_claims(path):
    """The valid entries of <data directory>/house-claims.json, the houses the player claimed (issue #299:
    {id, facet, bounds: {x0, y0, x1, y1}, claimedAt, by?}), the same checks app/store/house-claims.mts makes
    (app/schema/house-claims.v1.schema.json; both run app/fixtures/contract-cases/house-claims.json).
    A bad entry is dropped, and a missing, unreadable or oversized file reads as none: a scan then reads
    no ground container."""
    def ok(e):
        b = e.get("bounds") if isinstance(e, dict) else None
        return (isinstance(b, dict) and isinstance(e.get("id"), str) and re.fullmatch(r"(\d{1,3}|x)-\d{1,6}-\d{1,6}", e["id"], re.ASCII)
                and "facet" in e and (e["facet"] is None or (type(e["facet"]) is int and 0 <= e["facet"] <= 5))
                and all(type(b.get(k)) is int and 0 <= b[k] <= 999999 for k in ("x0", "y0", "x1", "y1")) and b["x0"] <= b["x1"] and b["y0"] <= b["y1"]
                and isinstance(e.get("claimedAt"), str) and 0 < len(e["claimedAt"]) <= 40 and ("by" not in e or (isinstance(e["by"], str) and 0 < len(e["by"]) <= 64)))
    try:
        if os.path.getsize(path) > 256 * 1024:
            return []
        with open(path, "r", encoding="utf-8") as f:
            doc = json.load(f)
        return [e for e in doc if ok(e)][:500]
    except Exception:
        return []


def claims_over(here, claims):
    """The claims the house `here` (house_here's (id, facet, bounds), or None) falls under: on its facet,
    with bounds overlapping its own, so a house customized since it was claimed still counts."""
    if here is None:
        return []
    f, b = here[1], here[2]
    return [c for c in claims if c.get("facet") == f and c["bounds"]["x0"] <= b["x1"] and b["x0"] <= c["bounds"]["x1"]
            and c["bounds"]["y0"] <= b["y1"] and b["y0"] <= c["bounds"]["y1"]]
# END generated: tazuo/claims


def slug(name):
    """A character name as scan file names spell it, lower-cased."""
    return re.sub(r"[^A-Za-z0-9_-]", "_", name).lower()


def my_characters():
    """The characters Pack Rat has scans of, read off the names of the files in <data>/scans/ (never opened),
    and this one, as slugs."""
    out = {slug(state["character"])}
    try:
        with os.scandir(os.path.join(DATA, "scans")) as it:
            for i, e in enumerate(it):
                if i >= MAX_DIR_ENTRIES:
                    break
                m = SCAN_NAME.match(e.name)
                if m:
                    out.add(m.group(1).lower())
    except Exception:
        pass
    return out


def sign_owners(bounds):
    """The owners the house signs on the ground within a tile of `bounds` name on their tooltips ("Owner: X"),
    each sign read with a wait of at most SIGN_WAIT_S; none when there is no sign or no owner line. Every sign
    is read, since a neighbour's sign can stand within that tile too."""
    owners = []
    for g in call(getattr(API, "GetItemsOnGround", None), HOUSE_ITEM_REACH) or []:
        try:
            x, y, s = int(g.X), int(g.Y), int(g.Serial)
            near = bounds["x0"] - 1 <= x <= bounds["x1"] + 1 and bounds["y0"] - 1 <= y <= bounds["y1"] + 1
            sign = int(getattr(g, "Graphic", 0) or 0) in SIGN_GRAPHICS or SIGN_RE.search(str(getattr(g, "Name", "") or ""))
        except Exception:
            continue
        if not near or not sign:
            continue
        call(getattr(API, "RequestOPLData", None), [s])
        for ln in tooltip_lines(s, True, SIGN_WAIT_S):
            m = OWNER_RE.match(ln)
            if m:
                owners.append(m.group(1).strip())
    return owners


def house_now(fresh=False):
    """house_here(), worked out again only when the player has moved or changed facet (or `fresh`): the
    footprint reads a wide area of tiles, too much for every status pass. Not being in a house is never kept:
    the client may not have sent the house's tiles yet (after a recall or a login), so it is asked again."""
    try:
        at = (int(API.Player.X), int(API.Player.Y), facet())
    except Exception:
        at = None
    if fresh or at is None or at != state["here_at"] or state["here"] is None:
        state["here_at"], state["here"] = at, house_here()
    return state["here"]


def claims_now():
    """read_claims(CLAIMS_PATH), read again only when the file's time changes (the app's Unclaim writes it too)."""
    try:
        mt = os.path.getmtime(CLAIMS_PATH)
    except Exception:
        mt = None
    if mt is None or mt != state["claims_mt"]:
        state["claims_mt"], state["claims"] = mt, read_claims(CLAIMS_PATH)
    return state["claims"]


def claim_button(here, claimed):
    """Claim this house reads Unclaim this house inside a claimed house; outside any house it is greyed and a
    click does nothing (on_claim)."""
    set_text("claim_btn", "Unclaim this house" if claimed else "Claim this house")
    b, hue = ui.get("claim_btn"), DIM_HUE if here is None else state["claim_hue"]
    if b is not None and hue is not None:
        try:
            b.TextHue = hue
        except Exception:
            pass


def on_claim():
    """Claim this house: a claim for the house the player stands in, unless the house's signs name owners and
    none of them is one of this player's characters; inside a claimed house it takes every claim over it back.
    Outside a house the button is disabled: the click changes nothing. A character whose name the client has
    not given yet cannot claim, since the claim names it."""
    here = house_now(fresh=True)
    if here is None:
        claim_button(None, False)
        return
    claims = read_claims(CLAIMS_PATH)
    over = claims_over(here, claims)
    if over:
        claims = [c for c in claims if c not in over]
        done = ("Unclaimed this house.", "Scans here read only your pack now.")
    else:
        if not state["character"]:
            say("Pack Rat does not know this character's", "name yet; try again in a moment.")
            return
        owners = sign_owners(here[2])
        mine = my_characters()
        if owners and not any(slug(o) in mine for o in owners):
            say("This house's sign names %s as the owner," % text_of(owners[0], 24), "so it was not claimed.")
            return
        if len(claims) >= CLAIM_MAX:
            say("Pack Rat keeps %d claimed houses at most;" % CLAIM_MAX, "unclaim one in the app first.")
            return
        claims = claims + [{"id": here[0], "facet": here[1], "bounds": here[2], "claimedAt": rfc3339_now(), "by": state["character"]}]
        done = ("Claimed this house.", "Scans here read its containers now.")
    try:
        write_json_atomic(CLAIMS_PATH, claims)
    except Exception:
        say("Could not save the claim.")
        return
    state["claims_mt"] = None   # read again at the next status pass
    claim_button(here, not over)
    say(*done)


def picked_source(serial):
    """What Put away's cursor picked: ("pack", "") for your backpack or a bag at any depth in it, ("ground", "")
    for a container on the ground (or in a chest there) within SCAN_RANGE, else (None, why not). The app
    then checks the chest is labelled."""
    it = call(getattr(API, "FindItem", None), serial)
    try:
        name = str(it.Name or "") if it is not None else ""
        graphic = int(getattr(it, "Graphic", 0) or 0) if it is not None else 0
        box = it is not None and bool(it.IsContainer) and not bool(getattr(it, "IsCorpse", False))
    except Exception:
        name, graphic, box = "", 0, False
    if not box or NOT_A_CONTAINER_RE.search(name) or graphic in NOT_A_CONTAINER_GRAPHICS:
        return None, "That is not a container."
    try:
        first = str(API.ItemNameAndProps(int(serial), True) or "").strip().splitlines()[0]
    except Exception:
        first = name
    if TRASH_RE.search(first or name):
        return None, "That is a trash container."
    black = set(e["serial"] for e in read_blacklist(BLACKLIST_PATH))
    pack, c = int(API.Backpack), int(serial)
    for _ in range(MAX_NEST + 2):
        if c in black:
            return None, "That container is blacklisted."
        if c == pack:
            return "pack", ""
        if it is None:
            break
        try:
            if bool(getattr(it, "OnGround", False)):
                near = max(abs(int(it.X) - int(API.Player.X)), abs(int(it.Y) - int(API.Player.Y))) <= SCAN_RANGE
                return ("ground", "") if near else (None, "Stand next to it first.")
            c = int(getattr(it, "Container", 0) or 0)
        except Exception:
            break
        it = call(getattr(API, "FindItem", None), c)
    return None, "Pick your pack, a container in it, or one on the ground."


def write_stop():
    """Organize's stop flag: a trip under way halts after its current step."""
    try:
        os.makedirs(os.path.dirname(STOP_FLAG), exist_ok=True)
        with open(STOP_FLAG, "w", encoding="utf-8") as f:
            f.write(rfc3339_now() + "\n")
    except Exception:
        pass


def cancel_put_away():
    """Ends the run, withdraws the bridge's consent (a trip not started yet is refused) and writes the
    stop flag, so a trip under way halts after its current step."""
    trip = state["run"]["phase"] == "trip"
    write_stop()
    end_put_away("Put away canceled.", "The bridge stops after its current step." if trip else "")


def on_put_away():
    """Put away's click: a target cursor for the container, then the scan (the character refresh for your
    pack, Scan here for a chest), then watch_put_away takes it from there. The bridge must be on: it
    carries the trips. While a run goes on, the button cancels it."""
    if state["run"] is not None:
        cancel_put_away()
        return
    if not is_running(BRIDGE):
        say("Start the bridge first: Put away", "moves the items through it.")
        return
    say("Put away: click the container (Esc cancels).")
    try:
        serial = int(API.RequestTarget(TARGET_S) or 0)
    except Exception:
        serial = 0
    if not serial:
        say("Put away: nothing picked.")
        return
    source, why = picked_source(serial)
    if source is None:
        say(why)
        return
    script = REFRESH if source == "pack" else SCANNER
    if is_running(script) or script in state["pending"]:
        say("The %s is running;" % LABELS[script], "try again after it.")
        return
    # The scan it waits for is one newer than this character's newest now: file times, never the clock.
    state["run"] = {"container": serial, "script": script, "phase": "scan", "since": time.time(), "before": last_scan(),
                    "clicked": rfc3339_now(), "put": 0, "failed": 0, "rounds": 0}
    away_buttons()
    start(script)
    state["quiet"].add(script)
    say("Put away: reading %s..." % ("your pack" if source == "pack" else "the container"))


def end_put_away(line1, line2=""):
    consent("")
    state["run"] = None
    away_buttons()
    say(line1, line2)


def ask(run):
    """One request to the app: a fresh id, where the character stands, and the bridge's consent for the
    length of one answer and one trip."""
    run["rounds"] += 1
    run["id"] = "%d-%d" % (int(time.time() * 1000), run["rounds"])
    at = {"x": int(API.Player.X), "y": int(API.Player.Y)}
    f = facet()
    if f is not None:
        at["facet"] = f
    value = "%d:%f" % (run["container"], time.time() + REPLY_WAIT_S + TRIP_WAIT_S)
    consent(value)
    took = str(call(getattr(API, "GetSharedVar", None), PUT_AWAY_VAR)) == value
    if not took:       # the bridge would refuse every trip: say why now
        end_put_away("Put away needs shared variables,", "which this TazUO build lacks.")
        return
    try:
        write_json_atomic(PUT_AWAY_REQUEST, {"id": run["id"], "container": run["container"], "character": state["character"],
                                             "requestedAt": rfc3339_now(), "clickedAt": run["clicked"], "at": at})
    except Exception:
        end_put_away("Put away could not write its request.")
        return
    run["phase"], run["since"] = "reply", time.time()


def text_of(v, n=48):
    return "".join(ch for ch in v if ch.isprintable())[:n] if isinstance(v, str) else ""


def watch_put_away():
    """Put away's next step, from its files: the scan file, the app's answer, the trip's result."""
    run = state["run"]
    if run is None:
        return
    waited = time.time() - run["since"]
    if run["phase"] == "scan":
        t = last_scan()
        if t is not None and (run["before"] is None or t > run["before"]):
            ask(run)
        elif waited > SCAN_WAIT_S or (waited > START_CHECK_S and not is_running(run["script"]) and run["script"] not in state["pending"]):
            end_put_away("Put away stopped: the %s" % LABELS[run["script"]], "saved nothing.")
    elif run["phase"] == "reply":
        reply = read_json(PUT_AWAY_REPLY)
        if reply.get("id") != run["id"]:
            if waited > REPLY_WAIT_S:
                end_put_away("Pack Rat did not answer.", "Is the app running?")
            return
        trip = reply.get("trip")
        if reply.get("ok") is True and isinstance(trip, str) and trip:
            run["trip"], run["phase"], run["since"] = trip, "trip", time.time()
            say(text_of(reply.get("msg")), "%d put away so far." % run["put"] if run["put"] else "")
        elif run["put"] and reply.get("ok") is True:
            end_put_away("Put away done: %d put away." % run["put"], text_of(reply.get("detail")))
        else:
            end_put_away(text_of(reply.get("msg")) or "Put away was refused.", text_of(reply.get("detail")))
    elif run["phase"] == "trip":
        result = (read_json(BRIDGE_STATUS, MAX_STATUS_BYTES).get("results") or {}).get(run["trip"])
        if not isinstance(result, dict):
            if waited > TRIP_WAIT_S:
                write_stop()          # never left running unattended: it halts after its current step
                end_put_away("The trip did not report back.", "%d put away." % run["put"])
            return
        steps = [x for x in result.get("steps") or [] if isinstance(x, dict)]
        put = sum(1 for x in steps if x.get("op") == "put" and x.get("ok") is True)
        failed = sum(1 for x in steps if x.get("ok") is not True)
        run["put"] += put
        run["failed"] += failed
        if put and not failed and not result.get("stopped") and run["rounds"] < PUT_AWAY_ROUNDS:
            ask(run)
        else:
            end_put_away("Put away: %d put away, %d failed." % (run["put"], run["failed"]), text_of(result.get("msg")))


def write_stopped():
    """The last heartbeat, `stopped: true`, and the bridge's Put away consent withdrawn: called on Stop and
    from main()'s finally, however the panel ends."""
    consent("")
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
    rows = [("title", "Pack Rat", TITLE_HUE, 14), ("running", "", TEXT_HUE, 196),
            ("bridge", "", TEXT_HUE, 216), ("scan", "", TEXT_HUE, 236),
            ("msg", "", OK_HUE, 258), ("msg2", "", OK_HUE, 276), ("hotkey", "", TEXT_HUE, 312)]
    for key, text, hue, y in rows:
        lbl = call(gumps("CreateGumpLabel"), text, hue)
        if lbl is None:
            if API.StopRequested:
                return None
            continue
        lbl.SetPos(16, y)
        g.Add(lbl)
        ui[key] = lbl
    buttons = [("refresh_btn", "Character refresh", scan_click(REFRESH, lambda: start(REFRESH)), 16, 44),
               ("house_btn", "House map refresh", scan_click(HOUSE, on_house), 196, 44),
               ("scan_btn", "Scan here", scan_click(SCANNER, lambda: start(SCANNER)), 16, 80),
               ("blacklist_btn", "Blacklist a container", lambda: start(BLACKLIST), 196, 80),
               ("bridge_btn", "Start bridge", on_bridge, 16, 116),
               ("away_btn", "Put away...", on_put_away, 196, 116),
               ("login_btn", login_text(), on_login, 16, 152),
               ("claim_btn", "Claim this house", on_claim, 196, 152),
               ("close_btn", "Close", on_close, 276, 304)]
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
    state["claim_hue"] = getattr(ui.get("claim_btn"), "TextHue", None)
    call(gumps("AddControlOnDisposed"), g, lambda: on_disposed(g))
    call(gumps("AddGump"), g)
    state["window"] = g
    if state["hotkey"]:
        set_text("hotkey", hotkey_text(state["hotkey"]))
    refresh()
    return g


def main():
    state["prefix"] = script_prefix(SELF)
    call(getattr(API, "OnStop", None), on_stop)
    load_prefs()
    g = build_window()
    if g is None:
        if not API.StopRequested:
            API.SysMsg("Pack Rat panel: the window could not be opened. Start packrat-panel.py again.", 33)
        return
    if not state["show_at_login"]:
        try:
            g.IsVisible = False
        except Exception:
            pass
        API.SysMsg("Pack Rat panel ready - %s to show" % hotkey_name(state["hotkey"]), 88)
    process = getattr(API, "ProcessCallbacks", None)
    deadline = time.time() + MAX_HOURS * 3600
    next_status, next_prefs, next_away = time.time() + STATUS_EVERY_S, time.time() + PREFS_EVERY_S, 0
    failed = False
    while not API.StopRequested and not state["done"] and time.time() < deadline:
        call(process)
        try:
            watch_pending()
            if time.time() >= next_away:
                watch_put_away()
                next_away = time.time() + PUT_AWAY_EVERY_S
            if time.time() >= next_prefs:
                load_prefs()
                next_prefs = time.time() + PREFS_EVERY_S
            if time.time() >= next_status:
                refresh()
                next_status = time.time() + STATUS_EVERY_S
        except Exception as e:
            if not failed:
                API.SysMsg("Pack Rat panel: status update failed: %s" % str(e)[:80], 33)
                failed = True
            if state["run"] is not None:
                end_put_away("Put away stopped: %s" % str(e)[:40])
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
