# packrat-panel.py — ATTENDED in-game control panel for Pack Rat. A small window whose buttons run the
# other Pack Rat scripts, so nobody has to find them in the Script Manager:
#   Scan here               packrat-scanner.py
#   Character refresh       packrat-character-refresh.py
#   Start / Stop bridge     packrat-bridge.py (the label follows whether it is running)
#   Blacklist a container   packrat-blacklist.py
#   Put away...             Put away (issue #131): files what lies directly in a container you pick with
#                           a target cursor by the app's Organize rules (see below)
#   Close                   hides the window; the hotkey shows it again
# Below the buttons: which Pack Rat scripts are running, whether the bridge is on, and how long ago this
# character's last scan file was saved. The panel reads only local files and the client's own script
# list; it never touches the world. Every world action still comes from a click.
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
ADAPTER_VERSION = "2.11.0"

SELF = "packrat-panel.py"
SCANNER, REFRESH, BRIDGE, BLACKLIST = "packrat-scanner.py", "packrat-character-refresh.py", "packrat-bridge.py", "packrat-blacklist.py"
LABELS = {SCANNER: "scan", REFRESH: "character refresh", BRIDGE: "bridge", BLACKLIST: "blacklist"}

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
NOT_A_CONTAINER_RE = re.compile(r"\b(deed(?!\s+box)|sending|music box|\w*book|tome|atlas|compendium)\b", re.I)   # a "Commodity Deed Box" IS one
NOT_A_CONTAINER_GRAPHICS = {0x0EFA, 0x2D50, 0x2D9D, 0x2252, 0x2253, 0x225A, 0x225B, 0x238C, 0x23A0, 0x22C5, 0x9C16}
TRASH_RE = re.compile(r"\btrash\b", re.I)
MAX_DIR_ENTRIES = 5000    # names looked at per folder per refresh
DEFAULT_HOTKEY = "CTRL+SHIFT+P"
HOTKEY_MODS = ("CTRL", "ALT", "SHIFT")
HOTKEY_KEY_RE = re.compile(r"[A-Z0-9]|F[1-9]|F1[0-2]")    # used with fullmatch
W, H = 380, 308
TITLE_HUE, TEXT_HUE, OK_HUE = 1153, 996, 68

state = {"done": False, "prefix": "", "character": "", "pending": {}, "was_running": set(),
         "hotkey": None, "window": None, "show_at_login": True, "run": None, "quiet": set()}
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
            if name not in state["quiet"]:       # a Put away says what it is doing itself
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
    """<data>/tazuo-panel.json (the hotkey and showAtLogin)."""
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


def load_prefs():
    doc = read_prefs()
    on = doc.get("showAtLogin", doc.get("openAtLogin"))     # openAtLogin: the name an older app wrote
    state["show_at_login"] = on if isinstance(on, bool) else True
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
    """Save whether the window shows at the next login, keeping the hotkey."""
    doc = read_prefs()
    out = {"hotkey": doc["hotkey"]} if isinstance(doc.get("hotkey"), dict) else {}
    out["showAtLogin"] = not state["show_at_login"]
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
        if state["run"] is None and name not in state["quiet"]:   # a Put away says what it is doing itself
            say("The %s finished." % LABELS[name])
        state["quiet"].discard(name)
    state["was_running"] = set(running)
    set_text("running", "Running: " + (", ".join(LABELS[n] for n in running) or "nothing"))
    set_text("bridge_btn", "Stop bridge" if BRIDGE in running else "Start bridge")
    set_text("bridge", "Bridge: " + ("on" if BRIDGE in running else "off"))
    t = last_scan()
    set_text("scan", "Last scan: " + ("none yet" if t is None else ago(t)))
    away_buttons()
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
    return None, "Pick your pack, a bag in it, or a chest."


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
    end_put_away("Put away cancelled.", "The bridge stops after its current step." if trip else "")


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
    say("Put away: reading %s..." % ("your pack" if source == "pack" else "the chest"))


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
    rows = [("title", "Pack Rat", TITLE_HUE, 14), ("running", "", TEXT_HUE, 160),
            ("bridge", "", TEXT_HUE, 180), ("scan", "", TEXT_HUE, 200),
            ("msg", "", OK_HUE, 222), ("msg2", "", OK_HUE, 240), ("hotkey", "", TEXT_HUE, 276)]
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
               ("refresh_btn", "Character refresh", lambda: start(REFRESH), 196, 44),
               ("bridge_btn", "Start bridge", on_bridge, 16, 80),
               ("blacklist_btn", "Blacklist a container", lambda: start(BLACKLIST), 196, 80),
               ("away_btn", "Put away...", on_put_away, 16, 116),
               ("login_btn", login_text(), on_login, 196, 116),
               ("close_btn", "Close", on_close, 276, 268)]
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
