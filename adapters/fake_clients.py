"""fake_clients.py -- stand-in game clients for the adapter tests (test_scanners.py, test_bridges.py).

The adapter scripts run inside a live game client and call main() when they load, so the only way to
test their real control flow offline is to run the real file against a fake of the client's API. Each
fake below models just enough of one client for that: a world of items, containers that only reveal
their contents once opened (and never when locked), a player standing somewhere, and a clock that
moves only when the script pauses, so an 8-second highlight takes no real time.

run_script() execs a script file with the fake installed: TazUO's `API` module, or Razor Enhanced's
`Items` / `Player` / `Misc` globals, plus a fake `time` module while the script loads.
"""
import os
import sys
import time as real_time
import types

PLAYER = 0x00000100
STRANGER = 0x00000222


class Clock(object):
    """Fake wall clock. Starts at the real time (so real RFC 3339 stamps parse as fresh) and moves
    only when advanced. `hooks` are (at, fn) pairs fired once the clock passes `at`."""
    def __init__(self):
        self.now = real_time.time()
        self.start = self.now
        self.hooks = []

    def at(self, offset_s, fn):
        self.hooks.append((self.start + offset_s, fn))

    def advance(self, s):
        self.now += s
        due = [h for h in self.hooks if h[0] <= self.now]
        self.hooks = [h for h in self.hooks if h[0] > self.now]
        for _, fn in due:
            fn()

    def module(self):
        m = types.ModuleType("time")
        m.time = lambda: self.now
        m.localtime = lambda secs=None: real_time.localtime(self.now if secs is None else secs)
        m.strftime = real_time.strftime
        m.sleep = lambda s: self.advance(s)
        m.__getattr__ = lambda name: getattr(real_time, name)   # everything else (datetime needs some)
        return m


class Item(object):
    def __init__(self, serial, container=0, name="bag", container_like=True, **kw):
        self.Serial = serial
        self.Container = container or 0xFFFFFFFF   # TazUO's "no container" for an item on the ground
        self.Name = name
        self.X, self.Y, self.Z = 10, 10, 0
        self.Graphic = 0x0E75 if container_like else 0x1086
        self.IsContainer = container_like
        self.IsCorpse = False
        self.Hue = 0
        self.Amount = 1
        self.Opened = False
        self.EverOpened = False
        self.OnGround = container == 0
        self._world = None
        for k, v in kw.items():
            setattr(self, k, v)

    @property
    def GetContainerGump(self):
        """TazUO's ApiItem.GetContainerGump(): this container's open window, or None. A world with
        no_container_gump set models a client build without the call (the attribute is missing)."""
        w = self._world
        if w is None or getattr(w, "no_container_gump", False):
            raise AttributeError("GetContainerGump")
        return lambda: self._container_gump(w)

    def _container_gump(self, w):
        # The real call waits on the client's main thread; a world with gump_delay set makes each
        # lookup cost that many seconds. It walks the client's gump list from the back and takes the
        # first gump of ANY type with this serial, and an item's name plate always sits behind its
        # container window: while the item has one (world.labels) the call answers None.
        w.clock.advance(getattr(w, "gump_delay", 0.0))
        if self.Serial in w.labels:
            return None
        return ContainerGump(w, self) if self.Opened else None

    def GetItemData(self):
        """TazUO's ApiItem.GetItemData(): the item's tiledata flags and per-unit weight (`Stones`, 1 when unset).
        `Stackable` (True when unset) is the tiledata stackable flag; a world with no_stackable_flag set
        models a build whose data has no IsStackable, and `data_error` makes the call raise."""
        w = self._world
        if w is not None and getattr(w, "data_error", None) is not None:
            raise w.data_error("GetItemData")
        data = types.SimpleNamespace(IsWearable=bool(getattr(self, "Wearable", False)), Weight=getattr(self, "Stones", 1))
        if w is None or not getattr(w, "no_stackable_flag", False):
            data.IsStackable = bool(getattr(self, "Stackable", True))
        return data


class ContainerGump(object):
    """An open container window. Dispose() closes it the way the client does: the item's Opened
    flag drops. A world with gump_without_dispose set models a window object lacking Dispose."""
    def __init__(self, world, item):
        self.world, self.item = world, item

    def __getattr__(self, name):
        if name != "Dispose" or getattr(self.world, "gump_without_dispose", False):
            raise AttributeError(name)
        return self.dispose

    def dispose(self):
        close_window(self.world, self.item)


def close_window(world, item):
    """Close an item's container window; a container with no window open is left alone."""
    if not item.Opened:
        return
    world.calls.append(("close", item.Serial))
    item.Opened = False
    hook = getattr(world, "on_close", None)
    if hook is not None:
        hook(item.Serial)


class World(object):
    """Items by serial, which of them are locked, and every world-acting call the script made.
    `labels` holds the items showing a name plate."""
    def __init__(self):
        self.clock = Clock()
        self.items = {}
        self.locked = set()
        self.labels = set()
        self.calls = []
        self.messages = []
        self.px, self.py = 10, 10
        self.facet = None          # what the client's map call answers: an int, a callable, or None for a build without the call

    def add(self, serial, container=0, **kw):
        self.items[serial] = Item(serial, container, **kw)
        self.items[serial]._world = self
        return self.items[serial]

    def open(self, serial):
        it = self.items.get(serial)
        self.calls.append(("open", serial))
        # `Openable` marks a container whose graphic the client does not flag as one. `open_lag` (fake
        # seconds) models the server's answer arriving late: the window and its contents show only then.
        if it is not None and (it.IsContainer or getattr(it, "Openable", False)) and serial not in self.locked:
            lag = getattr(self, "open_lag", 0)
            if lag:
                self.clock.at(self.clock.now - self.clock.start + lag, lambda: setattr(it, "Opened", True))
            else:
                it.Opened = True
            it.EverOpened = True
            return True
        return False

    def known(self, serial):
        """What the client can see: anything on the ground or on a mobile, and an item inside a
        container once that container has opened."""
        it = self.items.get(serial)
        if it is None:
            return None
        parent = self.items.get(it.Container)
        if parent is not None and not parent.Opened:
            return None
        return it

    def kids(self, serial, recursive):
        parent = self.items.get(serial)
        if parent is None or not parent.Opened:
            return []
        out = []
        for it in list(self.items.values()):
            if it.Container == serial:
                out.append(it)
                if recursive:
                    out.extend(self.kids(it.Serial, True))
        return out

    def dist(self, x, y):
        return max(abs(x - self.px), abs(y - self.py))


def tazuo_api(world, backpack, bank=0, skills=None):
    api = types.ModuleType("API")
    player = types.SimpleNamespace(Name="Tester", X=world.px, Y=world.py, Strength=50, Dexterity=50,
                                   Intelligence=50, HitsMax=1, StaminaMax=1, ManaMax=1,
                                   Weight=0, WeightMax=getattr(world, "weight_max", 400))
    api.Player = player
    api.Backpack = backpack
    api.Bank = bank
    api.StopRequested = False
    api.walking = [False]

    def sync():
        player.X, player.Y = world.px, world.py

    def pause(s):
        world.clock.advance(float(s))
        sync()

    api.Pause = pause
    api.ProcessCallbacks = lambda: None
    api.SysMsg = lambda m, h=0: world.messages.append(str(m))
    api.HeadMsg = lambda *a: world.calls.append(("headmsg", a[1] if len(a) > 1 else None))
    api.MarkTile = lambda x, y, *a: world.calls.append(("mark", int(x), int(y)))
    api.RemoveMarkedTile = lambda x, y, *a: world.calls.append(("unmark", int(x), int(y)))
    api.FindItem = lambda s: world.known(int(s))
    err = getattr(world, "opened_error", None)
    if err is not None:
        # A client build whose item has no Opened (AttributeError) or whose Opened read fails.
        class NoOpened(object):
            def __init__(self, it):
                object.__setattr__(self, "_it", it)

            def __getattr__(self, name):
                if name == "Opened":
                    raise err("Opened")
                return getattr(self._it, name)

            def __setattr__(self, name, v):
                setattr(self._it, name, v)
        api.FindItem = lambda s: (lambda it: None if it is None else NoOpened(it))(world.known(int(s)))
    api.FindLayer = lambda layer: None
    api.UseObject = lambda s, *a: world.open(int(s))
    def items_in(s, recursive=False):
        world.calls.append(("items_in", int(s)))
        return world.kids(int(s), recursive)
    api.ItemsInContainer = items_in
    fta = getattr(world, "find_type_all", "ok")     # "ok", "missing" (a build without the call) or "raise"
    if fta != "missing":
        def find_type_all(graphic, container=0xFFFFFFFF, range=0xFFFF, hue=0xFFFF, minamount=0):
            """TazUO's FindTypeAll: items the client knows with this graphic (and hue, unless 0xFFFF)
            whose container OR root container is `container` -- so an item in a bag in the chest matches too."""
            world.calls.append(("find_type_all", int(graphic), int(container), int(hue)))
            if fta == "raise":
                raise RuntimeError("FindTypeAll failed")

            def root(it):
                seen = 0
                while it.Container in world.items and seen < 32:
                    it, seen = world.items[it.Container], seen + 1
                return it.Serial
            return [it for it in list(world.items.values())
                    if world.known(it.Serial) is not None and it.Graphic == graphic
                    and (hue == 0xFFFF or it.Hue == hue) and it.Amount >= minamount
                    and container in (it.Container, root(it))]
        api.FindTypeAll = find_type_all
    api.Contents = lambda s: len(world.kids(int(s), True))
    api.GetItemsOnGround = lambda r: [it for it in world.items.values() if it.OnGround and world.dist(it.X, it.Y) <= r]
    api.ItemNameAndProps = lambda s, b=False: getattr(world.items[int(s)], "Tooltip", None) or world.items[int(s)].Name
    api.RequestOPLData = lambda serials: None
    if world.facet is not None:    # a build without GetMap() has no attribute at all
        api.GetMap = lambda: world.facet() if callable(world.facet) else world.facet

    def get_skill(name):
        v = (skills or {}).get(name)
        return None if v is None else types.SimpleNamespace(Value=v, Base=v, Cap=100)
    api.GetSkill = get_skill

    def move(s, dst, *a):
        """The server's drop: `refuse` bounces it (a full or locked container), a drop with no spot
        stacks onto a matching stack when `merges` is set, and the player's weight follows the pack.
        `on_move(serial, dst)` runs first, like a click the player makes mid-trip."""
        s, dst = int(s), int(dst)
        world.calls.append(("move", s, dst) + tuple(a))
        hook = getattr(world, "on_move", None)
        if hook is not None:
            hook(s, dst)
        if dst in getattr(world, "refuse", ()):
            return
        it = world.items[s]
        stones = getattr(it, "Stones", 1) * max(1, it.Amount)
        if it.Container == backpack:
            player.Weight -= stones
        if dst == backpack:
            player.Weight += stones
        if getattr(world, "merges", False) and not a:
            same = [k for k in world.items.values()
                    if k.Container == dst and k.Serial != s and (k.Graphic, k.Hue) == (it.Graphic, it.Hue)]
            if same:
                same[0].Amount += it.Amount
                del world.items[s]
                return
        it.Container = dst
    api.MoveItem = move

    def walk_to(x, y, wait, timeout):
        """The fake pathfinder: gets there at once, or never when world.no_path is set -- and then a
        waiting call blocks for its whole timeout, the way the client's does. A tile in world.blocked
        (a chest, a wall) has no path at all: the call says so at once."""
        world.calls.append(("walk", x, y))
        if (x, y) in getattr(world, "blocked", ()):
            return False
        if getattr(world, "no_path", False):
            if wait:
                world.clock.advance(float(timeout))
                return False
            api.walking[0] = True
            return True
        world.px, world.py = x, y
        sync()
        return True

    api.Pathfind = lambda x, y, z=0, distance=1, wait=False, timeout=10, *a: walk_to(int(x), int(y), wait, timeout)
    api.PathfindEntity = lambda s, distance=1, wait=False, timeout=10, *a: walk_to(world.items[int(s)].X, world.items[int(s)].Y, wait, timeout)
    api.Pathfinding = lambda: api.walking[0]
    api.CancelPathfinding = lambda: api.walking.__setitem__(0, False)
    return api


class Control(object):
    """A script-built window or control: its text, children, and click / close callbacks."""
    def __init__(self, text=""):
        self.Text, self.children, self.IsDisposed, self.IsVisible = text, [], False, True
        self.on_click = self.on_disposed = None

    def SetPos(self, x, y):
        pass

    def Add(self, child):
        self.children.append(child)

    def Dispose(self):
        self.IsDisposed = True


def tazuo_panel_api(world, loaded=(), prefix=""):
    """tazuo_api plus the gump and script-control calls packrat-panel.py uses. The panel runs as
    `prefix`packrat-panel.py; PlayScript starts a script only when its relative path is in `loaded`
    (the client's silent no-op otherwise). click() queues a control's callback, which runs on the
    script's next ProcessCallbacks, as in the client; so does press() for a key bound with OnHotKey
    (api.hotkeys). api.log records every PlayScript / StopScript and OnHotKey."""
    api = tazuo_api(world, 0)
    api.running, api.windows, api.queue, api.log, api.hotkeys = [prefix + "packrat-panel.py"], [], [], [], {}

    def play(path):
        api.log.append(("play", path))
        if path in loaded and path not in api.running:
            api.running.append(path)

    def stop(path):
        api.log.append(("stop", path))
        if path in api.running:
            api.running.remove(path)

    def process():
        while api.queue:
            api.queue.pop(0)()

    def window(*args):
        api.windows.append(Control())
        return api.windows[-1]

    api.PlayScript, api.StopScript, api.ProcessCallbacks = play, stop, process
    api.IsScriptRunning = lambda path: path in api.running
    api.ListRunningScripts = lambda: list(api.running)
    api.OnStop = lambda fn: setattr(api, "on_stop", fn)

    def on_hotkey(key, fn=None):
        api.log.append(("hotkey", key, fn is not None))
        if fn is None:
            api.hotkeys.pop(key, None)
        else:
            api.hotkeys[key] = fn

    api.OnHotKey = on_hotkey
    api.press = lambda key: api.hotkeys.get(key) and api.queue.append(api.hotkeys[key])
    api.Gumps = types.SimpleNamespace(
        CreateModernGump=window, CreateGumpLabel=lambda text, hue=0: Control(text),
        CreateSimpleButton=lambda text, w, h: Control(text),
        AddControlOnClick=lambda c, fn, *a: setattr(c, "on_click", fn),
        AddControlOnDisposed=lambda c, fn: setattr(c, "on_disposed", fn),
        AddGump=lambda g: None)
    api.click = lambda c: api.queue.append(c.on_click)
    return api


class Pos(object):
    def __init__(self, x, y, z=0):
        self.X, self.Y, self.Z = x, y, z


def razor_globals(world, backpack, bank=None, skills=None):
    """Razor Enhanced's Items / Player / Misc, over the same World. Items carry .Position, .ItemID and
    .Contains (what the client has loaded) the way RE's Item does."""
    class REItem(object):
        def __init__(self, it):
            self._it = it

        def __getattr__(self, name):
            it = self._it
            if name == "Position":
                return Pos(it.X, it.Y, it.Z)
            if name == "ItemID":
                return it.Graphic
            if name == "Contains":
                return [REItem(k) for k in world.kids(it.Serial, False)]
            if name == "Properties":
                return (getattr(it, "Tooltip", None) or it.Name).split("\n")
            if name == "ContainerOpened":
                return it.EverOpened     # RE sets it when contents first arrive and never clears it
            return getattr(it, name)

    def wrap(it):
        return None if it is None else REItem(it)

    class ItemFilter(object):
        pass

    class Items(object):
        Filter = ItemFilter

        @staticmethod
        def FindBySerial(s):
            return wrap(world.known(int(s)))

        @staticmethod
        def WaitForContents(it, ms):
            # Whether RE reports True for a container that opened EMPTY is undocumented; a world with
            # empty_wait_false set models the answer being False.
            world.clock.advance(ms / 1000.0)
            ok = world.open(int(it.Serial))
            if ok and getattr(world, "empty_wait_false", False) and not world.kids(int(it.Serial), False):
                return False
            return ok

        @staticmethod
        def WaitForProps(it, ms):
            return True

        @staticmethod
        def ApplyFilter(f):
            return [wrap(it) for it in world.items.values()
                    if it.OnGround and it.IsContainer and world.dist(it.X, it.Y) <= f.RangeMax]

        @staticmethod
        def Move(s, dst, amount):
            world.calls.append(("move", int(s), int(dst)))
            world.items[int(s)].Container = int(dst)

        @staticmethod
        def SetColor(s, hue):
            world.calls.append(("color", int(s), hue))

        @staticmethod
        def Close(s):
            close_window(world, world.items[int(s)])

    if getattr(world, "no_items_close", False):
        del Items.Close            # a Razor Enhanced build without Items.Close

    skills = skills or {}

    class PlayerMeta(type):
        @property
        def Position(cls):
            return Pos(world.px, world.py)

        @property
        def Map(cls):
            f = world.facet
            if f is None:
                raise AttributeError("Map")      # a Razor Enhanced build without Player.Map
            return f() if callable(f) else f

    class Player(object, metaclass=PlayerMeta):
        Name = "Tester"
        Str = Dex = Int = 50
        HitsMax = StamMax = ManaMax = AR = 1
        FireResistance = ColdResistance = PoisonResistance = EnergyResistance = 1
        Connected = True
        Backpack = wrap(world.items[backpack])
        Bank = wrap(world.items[bank]) if bank else None

        @staticmethod
        def GetSkillValue(name):
            return skills.get(name, 0.0)

        @staticmethod
        def GetRealSkillValue(name):
            return skills.get(name, 0.0)

        @staticmethod
        def GetSkillCap(name):
            return 100.0

        @staticmethod
        def GetItemOnLayer(layer):
            return None

        @staticmethod
        def DistanceTo(it):
            return world.dist(it.X, it.Y)

        @staticmethod
        def PathFindTo(x, y, z):
            world.calls.append(("walk", x, y))
            if not getattr(world, "no_path", False):
                world.px, world.py = x, y

        @staticmethod
        def HeadMessage(hue, msg):
            world.calls.append(("headmsg", None))

    class Misc(object):
        @staticmethod
        def Pause(ms):
            world.clock.advance(ms / 1000.0)

        @staticmethod
        def SendMessage(msg, hue, wait):
            world.messages.append(str(msg))

    class Target(object):
        @staticmethod
        def PromptTarget(msg, color):
            world.messages.append(str(msg))
            return getattr(world, "target", -1)     # a world with no target set models Esc

    return {"Items": Items, "Player": Player, "Misc": Misc, "Target": Target}


def run_script(path, world, api=None, extra_globals=None, with_file=True):
    """exec one adapter script as its client would: the fake API importable, a fake clock as `time`."""
    g = {"__name__": "__main__"}
    if with_file:
        g["__file__"] = path
    g.update(extra_globals or {})
    saved = {k: sys.modules.get(k) for k in ("API", "time")}
    if api is not None:
        sys.modules["API"] = api
    sys.modules["time"] = world.clock.module()
    try:
        with open(path, encoding="utf-8") as f:
            code = compile(f.read(), path, "exec")
        exec(code, g)
    finally:
        for k, v in saved.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v
    return g


def adapter_path(adapter, script):
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), adapter, script)
