"""test_scanners.py -- the TazUO and Razor Enhanced scanners run end to end against a fake client
(fake_clients.py), checking the one property that matters most: a scan never records a container as
opened-and-empty unless it really opened. The app's fold replaces everything it knew under a root
with what the newest scan says, so a false "opened, nothing inside" erases real inventory records.

Run: python3 adapters/test_scanners.py  (app/adapters.test.mts also spawns it, so `npm test` does).
"""
import glob, json, os, re, shutil, sys, tempfile, types, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fake_clients import PLAYER, World, adapter_path, house_tiles, razor_globals, run_script, tazuo_api  # noqa: E402

PACK, CHEST, BAG, RING, RING2, EMPTY = 0x40000001, 0x40000002, 0x40000003, 0x40000010, 0x40000011, 0x40000004
TRASH_BARREL, BARREL, TRASH_CHEST = 0x40000300, 0x40000301, 0x40000302


def home(world):
    """A backpack holding a ring, and a chest in reach holding a bag holding a ring."""
    world.add(PACK, PLAYER, name="Backpack", OnGround=False)
    world.add(RING2, PACK, name="Gold Ring", container_like=False, OnGround=False)
    world.add(CHEST, 0, name="Wooden Chest", X=11, Y=10)
    world.add(BAG, CHEST, name="Bag", OnGround=False)
    world.add(RING, BAG, name="Ruby Ring", container_like=False, OnGround=False)


# Things the client may call a container, or whose name says "chest", that are not item containers:
# double-clicking a book opens a spellbook or runebook, never a container window, and armour is worn.
BOOKS = [("Spellbook", 0x0EFA), ("Mysticism Spellbook", 0x2D9D), ("Spellweaving Spellbook", 0x2D50),
         ("Necromancer Spellbook", 0x2253), ("Book of Chivalry", 0x2252), ("Book of Bushido", 0x238C),
         ("Book of Ninjitsu", 0x23A0), ("Book of Masteries", 0x225A), ("Runebook", 0x22C5),
         ("Runic Atlas", 0x9C16), ("", 0x2D50)]
ARMOUR = ["Gargish Stone Chest", "Gargish Platemail Chest Of Sorcery", "Platemail Chest"]


def books_and_armour(world, parent, first=0x40000500):
    """Every book in BOOKS (the client says IsContainer, as it does for a spellbook) and every piece of
    ARMOUR (not a container to the client), plus a piece the client calls wearable whose name alone
    would pass for a chest; returns their serials."""
    out = []
    for i, (name, graphic) in enumerate(BOOKS):
        out.append(first + i)
        world.add(out[-1], parent, name=name, Graphic=graphic, OnGround=False)
    for i, name in enumerate(ARMOUR + ["Chest"]):
        out.append(first + 0x40 + i)
        world.add(out[-1], parent, name=name, container_like=False, Graphic=0x1415,
                  Wearable=(name in ("Gargish Stone Chest", "Chest")), OnGround=False)
    return out


def trash(world, cached=False):
    """A trash barrel on the ground and a trash chest in the backpack, each holding a ring the client
    still holds from an earlier open, and an ordinary barrel on the trash barrel's graphic. `cached`:
    the client's own name for both is the generic "barrel", and only the tooltip says trash."""
    names = lambda n: dict(name="barrel", Tooltip=n) if cached else dict(name=n)
    world.add(TRASH_BARREL, 0, Graphic=0x0E77, X=11, Y=11, Opened=True, **names("A Trash Barrel"))
    world.add(RING + 0x200, TRASH_BARREL, name="Old Ring", container_like=False, OnGround=False)
    world.add(TRASH_CHEST, PACK, OnGround=False, Opened=True, **names("Trash Chest"))
    world.add(RING + 0x201, TRASH_CHEST, name="Tossed Ring", container_like=False, OnGround=False)
    world.add(BARREL, 0, name="Barrel", Graphic=0x0E77, X=10, Y=11)


def nest(world, parent, depth):
    """`depth` bags each inside the last, starting in `parent`, with a ring in the deepest; returns the
    bags, outermost first."""
    bags = []
    for i in range(depth):
        bags.append(0x40000100 + i)
        world.add(bags[-1], parent, name="Bag", OnGround=False)
        parent = bags[-1]
    world.add(0x40000200, parent, name="Deep Ring", container_like=False, OnGround=False)
    return bags


def helper_body(path, name):
    """The source of one top-level function, for the copied-verbatim checks."""
    with open(path, encoding="utf-8") as f:
        t = f.read()
    m = re.search(r"^def %s\(.*?(?=^def |^[A-Z_]+ = |^# -)" % name, t, re.S | re.M)
    return m.group(0) if m else None


class DataDir(object):
    def setUp(self):
        self.data = tempfile.mkdtemp()
        self.prev = os.environ.get("PACKRAT_DATA")
        os.environ["PACKRAT_DATA"] = self.data

    def tearDown(self):
        if self.prev is None:
            os.environ.pop("PACKRAT_DATA", None)
        else:
            os.environ["PACKRAT_DATA"] = self.prev
        shutil.rmtree(self.data, ignore_errors=True)

    def scans(self, adapter):
        out = []
        for f in sorted(glob.glob(os.path.join(self.data, "inbox", adapter, "*.json"))):
            with open(f, encoding="utf-8") as fh:
                out.append(json.load(fh))
        return out

    def root(self, scan, serial):
        return [r for r in scan["roots"] if r["serial"] == serial][0]

    def closed(self, world):
        return [c[1] for c in world.calls if c[0] == "close"]

    def blacklist(self, doc):
        """Write <data>/scan-blacklist.json: a list of serials becomes valid entries, anything else is
        written as it is."""
        if isinstance(doc, list):
            doc = json.dumps([{"serial": s, "name": "Listed", "addedAt": "2026-09-24T10:00:00Z"} for s in doc])
        with open(os.path.join(self.data, "scan-blacklist.json"), "w", encoding="utf-8") as f:
            f.write(doc)

    def opened(self, world):
        return [c[1] for c in world.calls if c[0] == "open"]


class TazUOScanner(DataDir, unittest.TestCase):
    SCRIPT = adapter_path("tazuo", "packrat-scanner.py")

    def scan(self, world, **kw):
        api = tazuo_api(world, PACK, skills=kw.pop("skills", None))
        run_script(self.SCRIPT, world, api=api, **kw)
        return api

    def test_a_normal_scan_records_every_root_and_the_nested_ring(self):
        w = World(); home(w)
        self.scan(w)
        [s] = self.scans("tazuo")
        self.assertTrue(self.root(s, CHEST)["opened"])
        self.assertEqual(sorted(i["serial"] for i in s["items"]), [RING, RING2])
        self.assertIn(str(BAG), json.loads(json.dumps(s["containers"])))

    def test_stop_while_the_last_root_opens_writes_nothing(self):
        w = World(); home(w)
        api = tazuo_api(w, PACK)
        opener = w.open

        def open_then_stop(serial):
            if serial == CHEST:
                api.StopRequested = True
            return opener(serial)
        api.UseObject = lambda s, *a: open_then_stop(int(s))
        run_script(self.SCRIPT, w, api=api)
        self.assertEqual(self.scans("tazuo"), [], "a stopped scan must not write a chest it never read")

    def test_a_locked_root_is_recorded_not_opened(self):
        w = World(); home(w); w.locked.add(CHEST)
        self.scan(w)
        [s] = self.scans("tazuo")
        self.assertFalse(self.root(s, CHEST)["opened"])

    def test_a_bag_that_did_not_open_is_marked_unopened_and_the_rest_of_its_root_recorded(self):
        w = World(); home(w); w.locked.add(BAG)
        w.add(RING + 0x20, CHEST, name="Loose Ring", container_like=False, OnGround=False)
        self.scan(w)
        [s] = self.scans("tazuo")
        self.assertTrue(self.root(s, CHEST)["opened"])
        self.assertIs(s["containers"][str(BAG)]["opened"], False)
        self.assertIn(RING + 0x20, [i["serial"] for i in s["items"]])
        self.assertTrue(any("Bag" in m and "kept from the last scan" in m for m in w.messages), w.messages)

    def test_a_commodity_deed_box_is_a_real_container_and_is_opened(self):
        w = World(); home(w)
        w.add(0x40000022, CHEST, name="Commodity Deed Box", OnGround=False)
        w.add(0x40000023, 0x40000022, name="Commodity Deed", container_like=False, OnGround=False)
        self.scan(w)
        self.assertIn(("open", 0x40000022), w.calls)
        [s] = self.scans("tazuo")
        self.assertIn(str(0x40000022), s["containers"])
        self.assertIn(0x40000023, [i["serial"] for i in s["items"]])

    def test_a_bag_of_sending_is_never_double_clicked_and_is_recorded_as_an_item(self):
        w = World(); home(w)
        w.add(0x40000021, CHEST, name="a bag of sending", OnGround=False, Graphic=0x0E76)
        self.scan(w)
        self.assertNotIn(("open", 0x40000021), w.calls)
        [s] = self.scans("tazuo")
        self.assertTrue(self.root(s, CHEST)["opened"])
        self.assertIn(0x40000021, [i["serial"] for i in s["items"]])
        self.assertNotIn(str(0x40000021), s["containers"])

    def test_a_bag_nested_past_the_depth_limit_is_marked_unopened(self):
        w = World(); home(w)
        # chest > BAG > bags[0] > bags[1] are opened (MAX_NEST = 4 levels); bags[2] is seen, not opened
        deepest = nest(w, BAG, 5)[2]
        self.scan(w)
        [s] = self.scans("tazuo")
        self.assertIs(s["containers"][str(deepest)]["opened"], False)
        self.assertNotIn(deepest, [i["serial"] for i in s["items"]])

    def test_an_empty_bag_that_did_open_is_recorded(self):
        w = World(); home(w); w.add(EMPTY, CHEST, name="Pouch", OnGround=False)
        self.scan(w)
        [s] = self.scans("tazuo")
        self.assertTrue(self.root(s, CHEST)["opened"])
        self.assertIn(str(EMPTY), s["containers"])

    def test_a_deed_named_like_a_chest_is_never_double_clicked(self):
        w = World(); home(w)
        w.add(0x40000020, CHEST, name="Wooden Chest Deed", container_like=False, OnGround=False, Graphic=0x14F0)
        self.scan(w)
        self.assertNotIn(("open", 0x40000020), w.calls)
        [s] = self.scans("tazuo")
        self.assertTrue(self.root(s, CHEST)["opened"])

    def test_it_closes_exactly_the_container_windows_it_opened_innermost_first(self):
        w = World(); home(w)
        w.add(0x40000030, 0, name="Metal Chest", X=11, Y=11); w.locked.add(0x40000030)
        self.scan(w)
        self.assertEqual(self.closed(w), [BAG, CHEST, PACK], "a locked chest never opened, so it has no window to close")
        self.assertFalse(any(it.Opened for it in w.items.values()))

    def test_windows_the_player_already_had_open_are_left_open(self):
        w = World(); home(w)
        w.items[PACK].Opened = w.items[CHEST].Opened = True
        self.scan(w)
        self.assertEqual(self.closed(w), [BAG])
        self.assertTrue(w.items[PACK].Opened and w.items[CHEST].Opened)

    def test_windows_close_only_after_the_scan_file_is_written(self):
        w = World(); home(w)
        written = []
        w.on_close = lambda serial: written.append(len(self.scans("tazuo")))
        self.scan(w)
        self.assertEqual(written, [1, 1, 1])

    def test_it_closes_what_it_opened_after_a_stop_even_once_lookups_by_serial_answer_nothing(self):
        w = World(); home(w)
        api = tazuo_api(w, PACK)
        opener, finder = w.open, api.FindItem

        def open_then_stop(serial):
            if serial == CHEST:
                api.StopRequested = True
            return opener(serial)
        api.UseObject = lambda s, *a: open_then_stop(int(s))
        # The client cancels a stopped script's token, and FindItem then returns nothing.
        api.FindItem = lambda s: None if api.StopRequested else finder(s)
        run_script(self.SCRIPT, w, api=api)
        self.assertEqual(self.scans("tazuo"), [])
        self.assertEqual(self.closed(w), [CHEST, PACK])

    def test_after_a_stop_closing_gives_up_within_the_clients_stop_grace(self):
        # TazUO detaches a stopped script's thread after 2 s; each window lookup waits on the
        # client's main thread, so closing after a Stop must end well inside that.
        w = World(); home(w)
        bags = nest(w, CHEST, 3)
        w.gump_delay = 0.4
        api = tazuo_api(w, PACK)
        started, t0 = [], []

        def stop_once_the_chest_is_read(serials):
            if RING in serials:           # the chest's last level is listed: every window is open
                api.StopRequested = True
                t0.append(w.clock.now)
        api.RequestOPLData = stop_once_the_chest_is_read
        w.on_close = lambda serial: started.append(w.clock.now)
        run_script(self.SCRIPT, w, api=api)
        self.assertTrue(t0, "the scan should have seen the Stop")
        self.assertEqual(self.scans("tazuo"), [])
        self.assertTrue(started, "some windows still close after a Stop")
        # From the first window lookup to the end of the last one.
        self.assertLessEqual(max(started) - (min(started) - w.gump_delay), 2.0)
        self.assertLess(len(started), len(bags) + 3, "the rest are left open")

    def test_without_a_stop_every_window_closes_however_long_it_takes(self):
        w = World(); home(w)
        nest(w, CHEST, 3)
        w.gump_delay = 0.4
        self.scan(w)
        self.assertEqual(len(self.closed(w)), 6)

    def test_it_closes_what_it_opened_when_the_scan_fails(self):
        w = World(); home(w)
        api = tazuo_api(w, PACK)
        lister = api.ItemsInContainer

        def list_or_fail(s, recursive=False):
            if int(s) == CHEST:
                raise RuntimeError("client went away")
            return lister(s, recursive)
        api.ItemsInContainer = list_or_fail
        with self.assertRaises(RuntimeError):
            run_script(self.SCRIPT, w, api=api)
        self.assertEqual(self.closed(w), [CHEST, PACK])

    def test_a_window_whose_name_plate_showed_from_the_start_stays_open_and_is_reported(self):
        w = World(); home(w)
        w.labels.add(CHEST)
        self.scan(w)
        self.assertEqual(self.closed(w), [BAG, PACK])
        self.assertTrue(w.items[CHEST].Opened)
        self.assertEqual(len(self.scans("tazuo")), 1)
        self.assertTrue(any("1 container window" in m and "by hand" in m for m in w.messages), w.messages)

    def test_books_and_armour_are_never_double_clicked_and_are_recorded_as_items(self):
        w = World(); home(w)
        serials = books_and_armour(w, PACK) + books_and_armour(w, CHEST, first=0x40000600)
        self.scan(w)
        opened = [c[1] for c in w.calls if c[0] == "open"]
        self.assertEqual([s for s in serials if s in opened], [])
        [s] = self.scans("tazuo")
        items = [i["serial"] for i in s["items"]]
        self.assertEqual([x for x in serials if x not in items], [])

    def test_containers_the_client_does_not_flag_are_still_opened(self):
        # UO Alive's tiledata does not flag every container: these open by graphic or by name, a
        # word like "gargish" in the name included (only a wearable item is refused that way).
        w = World(); home(w)
        names = [("Gargish Chest", 0x4025), ("Gargish Chest", 0x4026), ("Chest of Drawers", 0x1234),
                 ("Wooden Box", 0x1234), ("Toolbox", 0x1234), ("Golden Chest", 0x1234),
                 ("Treasure Chest", 0x1234), ("Crate", 0x1234), ("Wooden Chest", 0x1234)]
        serials = []
        for i, (name, graphic) in enumerate(names):
            serials.append(0x40000700 + i)
            w.add(serials[-1], CHEST, name=name, Graphic=graphic, container_like=False, Openable=True,
                  OnGround=False)
        self.scan(w)
        opened = [c[1] for c in w.calls if c[0] == "open"]
        self.assertEqual([n for s, (n, _) in zip(serials, names) if s not in opened], [])

    def test_a_client_without_the_window_calls_leaves_windows_open_and_does_not_raise(self):
        for flag in ("no_container_gump", "gump_without_dispose"):
            w = World(); home(w); setattr(w, flag, True)
            self.scan(w)
            self.assertEqual(self.closed(w), [], flag)
            self.assertTrue(w.items[CHEST].Opened, flag)
            self.assertEqual(len(self.scans("tazuo")), 1, flag)
            shutil.rmtree(os.path.join(self.data, "inbox"), ignore_errors=True)

    def test_it_runs_where_the_host_defines_no___file__(self):
        w = World(); home(w)
        self.scan(w, with_file=False)
        self.assertEqual(len(self.scans("tazuo")), 1)


    def test_a_blacklisted_ground_chest_is_left_out_and_a_blacklisted_bag_is_recorded_unopened(self):
        w = World(); home(w)
        w.add(CHEST + 0x100, 0, name="Trash Barrel", X=11, Y=11)
        w.items[BAG].Opened = True      # the client already holds the bag's contents from an earlier open
        self.blacklist([CHEST + 0x100, BAG])
        self.scan(w)
        [s] = self.scans("tazuo")
        self.assertNotIn(CHEST + 0x100, self.opened(w))
        self.assertNotIn(BAG, self.opened(w))
        self.assertEqual([r["serial"] for r in s["roots"]], [PACK, CHEST], "a listed root is not recorded, so the fold keeps it")
        self.assertIs(s["containers"][str(BAG)]["opened"], False, "a listed bag is recorded unopened, so the fold keeps its contents")
        self.assertEqual(sorted(i["serial"] for i in s["items"]), [RING2], "nothing inside the listed bag is recorded")
        self.assertIn("  skipped 2 blacklisted containers", w.messages)

    def test_a_corrupt_or_oversized_blacklist_skips_nothing(self):
        for doc in ("{not json", json.dumps([{"serial": BAG, "name": "x" * 300 * 1024}])):
            w = World(); home(w)
            self.blacklist(doc)
            self.scan(w)
            [s] = self.scans("tazuo")
            self.assertEqual(sorted(i["serial"] for i in s["items"]), [RING, RING2], doc[:40])
            shutil.rmtree(os.path.join(self.data, "inbox"))

    def test_a_trash_container_is_never_opened_or_recorded_and_an_ordinary_barrel_is(self):
        for cached in (False, True):
            with self.subTest(cached=cached):
                shutil.rmtree(os.path.join(self.data, "inbox"), ignore_errors=True)
                self.trash_scan(cached)

    def trash_scan(self, cached):
        w = World(); home(w); trash(w, cached)
        self.scan(w)
        [s] = self.scans("tazuo")
        self.assertNotIn(TRASH_BARREL, self.opened(w))
        self.assertNotIn(TRASH_CHEST, self.opened(w))
        self.assertIn(BARREL, self.opened(w), "an ordinary barrel on the same graphic is still scanned")
        self.assertEqual([r["serial"] for r in s["roots"]], [PACK, CHEST, BARREL])
        self.assertEqual([c for c in (TRASH_BARREL, TRASH_CHEST) if str(c) in s["containers"]], [])
        self.assertEqual(sorted(i["serial"] for i in s["items"]), [RING, RING2], "nothing in or of the trash is recorded")
        self.assertIn("  skipped 2 trash containers", w.messages)

    def test_a_ground_root_records_its_tooltip_and_its_facet(self):
        w = World(); home(w); w.facet = 3
        w.items[CHEST].Tooltip = "Wooden Chest\nContents: 1/125 Items, 3 Stones"
        w.add(0x40000030, 0, name="Metal Chest", X=10, Y=11, Tooltip="Metal Chest\nContents: 0/125 Items, 0 Stones")
        self.scan(w)
        [s] = self.scans("tazuo")
        chest, empty, pack = (s["containers"][str(x)] for x in (CHEST, 0x40000030, PACK))
        self.assertEqual(chest["tooltip"], ["Wooden Chest", "Contents: 1/125 Items, 3 Stones"])
        self.assertEqual(chest["pos"], {"x": 11, "y": 10, "z": 0, "facet": 3})
        self.assertEqual(empty["tooltip"], ["Metal Chest", "Contents: 0/125 Items, 0 Stones"], "a chest that opened empty")
        self.assertEqual(empty["pos"]["facet"], 3)
        self.assertNotIn("tooltip", pack)
        self.assertIsNone(pack["pos"])

    def test_the_facet_is_left_out_when_the_client_cannot_say(self):
        def stub_ahead_of_build():
            raise RuntimeError("GetMap is in the stub, not in this build")
        for facet in (None, -1, 6, "Trammel", stub_ahead_of_build):
            with self.subTest(facet=facet):
                shutil.rmtree(os.path.join(self.data, "inbox"), ignore_errors=True)
                w = World(); home(w); w.facet = facet
                self.scan(w)
                [s] = self.scans("tazuo")
                self.assertEqual(s["containers"][str(CHEST)]["pos"], {"x": 11, "y": 10, "z": 0})

    def test_a_scan_inside_a_house_records_its_tiles_and_where_the_player_stood(self):
        w = World(); home(w); w.facet = 1
        w.multis = house_tiles(5, 5, 12, 12)
        w.multis.append(types.SimpleNamespace(Graphic=0x0064, X=5, Y=5, Z=7, Impassible=True))
        self.scan(w)
        [s] = self.scans("tazuo")
        h = s["house"]
        self.assertEqual(h["facet"], 1)
        self.assertEqual(h["at"], {"x": 10, "y": 10})
        self.assertEqual(len(h["tiles"]), 12 * 12 + 1)
        self.assertIn([0x0064, 5, 5, 7, 1], h["tiles"])
        self.assertRegex(h["capturedAt"], r"^\d{4}-\d\d-\d\dT")

    def test_only_the_house_under_the_player_is_kept(self):
        w = World(); home(w)
        w.multis = house_tiles(5, 5, 12, 12) + house_tiles(19, 5, 6, 6)   # a neighbour two tiles away
        self.scan(w)
        [s] = self.scans("tazuo")
        self.assertEqual(len(s["house"]["tiles"]), 12 * 12)
        self.assertTrue(all(t[1] <= 16 for t in s["house"]["tiles"]))

    def test_no_house_section_outside_a_house_or_without_the_multi_calls(self):
        for multis in (None, [], house_tiles(30, 30, 5, 5)):
            with self.subTest(multis=None if multis is None else len(multis)):
                shutil.rmtree(os.path.join(self.data, "inbox"), ignore_errors=True)
                w = World(); home(w); w.multis = multis
                self.scan(w)
                [s] = self.scans("tazuo")
                self.assertNotIn("house", s)

    def test_a_multi_call_that_raises_leaves_the_house_out_and_the_scan_whole(self):
        w = World(); home(w); w.multis = house_tiles(5, 5, 12, 12)
        api = tazuo_api(w, PACK)
        def broken(*a):
            raise RuntimeError("in the stub, not in this build")
        api.GetMultisInArea = broken
        run_script(self.SCRIPT, w, api=api)
        [s] = self.scans("tazuo")
        self.assertNotIn("house", s)
        self.assertTrue(self.root(s, CHEST)["opened"])

    def test_furniture_inside_the_house_is_recorded_and_containers_are_not(self):
        w = World(); home(w); w.multis = house_tiles(5, 5, 12, 12)
        w.add(0x40000040, 0, name="table", container_like=False, X=12, Y=12, Z=7)
        w.items[0x40000040].Graphic = 0x0B34
        w.add(0x40000041, 0, name="statue", container_like=False, X=17, Y=17, Z=7)   # in reach, outside the footprint
        self.scan(w)
        [s] = self.scans("tazuo")
        self.assertEqual(s["house"]["items"], [[0x40000040, 0x0B34, 12, 12, 7]], "the chest beside the player is a root, not furniture")

    def test_every_container_inside_the_house_is_listed_with_its_place_and_the_far_ones_are_not_opened(self):
        w = World(); home(w); w.multis = house_tiles(5, 5, 12, 12)
        w.add(0x40000050, 0, name="Metal Chest", X=15, Y=15, Z=7)   # inside, five tiles away: past the 3-tile opening reach
        w.items[0x40000050].Graphic = 0x0E7C
        w.add(0x40000051, 0, name="Wooden Chest", X=20, Y=20)      # in the server's reach, outside the footprint
        w.add(0x40000052, 0, name="trash barrel", X=14, Y=14)      # a trash container is never listed
        self.scan(w)
        [s] = self.scans("tazuo")
        self.assertEqual(s["house"]["containers"], [[CHEST, 0x0E75, 11, 10, 0], [0x40000050, 0x0E7C, 15, 15, 7]])
        self.assertNotIn(0x40000050, self.opened(w))
        self.assertNotIn(0x40000050, [r["serial"] for r in s["roots"]])
        self.assertEqual(s["house"]["items"], [], "a container is never furniture")
        self.assertIn("  house: 144 tiles, 0 pieces of furniture, 2 chests", w.messages)

    def test_a_trash_barrel_the_scan_knew_only_by_its_tooltip_is_not_in_the_houses_chest_list(self):
        w = World(); home(w); w.multis = house_tiles(5, 5, 12, 12); trash(w, cached=True)
        self.scan(w)
        [s] = self.scans("tazuo")
        serials = [c[0] for c in s["house"]["containers"]]
        self.assertNotIn(TRASH_BARREL, serials, "the client calls it just \"barrel\"; the roots pass learnt it is trash")
        self.assertIn(BARREL, serials)

    def test_past_the_schemas_5000_house_items_the_farthest_are_left_out(self):
        w = World(); home(w); w.multis = house_tiles(5, 5, 12, 12)
        for i in range(5000):
            w.add(0x50000000 + i, 0, name="vase", container_like=False, X=11, Y=11, Z=7)
        w.add(0x40000042, 0, name="statue", container_like=False, X=16, Y=16, Z=7)   # the farthest, still inside
        self.scan(w)
        [s] = self.scans("tazuo")
        items = s["house"]["items"]
        self.assertEqual(len(items), 5000)
        self.assertNotIn(0x40000042, [i[0] for i in items])
        self.assertTrue(self.root(s, CHEST)["opened"])
        self.assertIn("  house: 144 tiles, 5000 pieces of furniture (1 farther one left out), 1 chest", w.messages)

    def test_a_ground_item_read_that_raises_writes_the_tiles_and_no_furniture_claim(self):
        w = World(); home(w); w.multis = house_tiles(5, 5, 12, 12)
        w.add(0x40000040, 0, name="table", container_like=False, X=12, Y=12, Z=7)
        api = tazuo_api(w, PACK)
        roots = api.GetItemsOnGround
        def ground(r):
            if r > 3:   # the house's furniture read, not the 3-tile root search
                raise RuntimeError("the read failed")
            return roots(r)
        api.GetItemsOnGround = ground
        run_script(self.SCRIPT, w, api=api)
        [s] = self.scans("tazuo")
        self.assertEqual(len(s["house"]["tiles"]), 144)
        self.assertNotIn("items", s["house"], "an absent list erases nothing the app knew; an empty one would")
        self.assertNotIn("containers", s["house"], "an absent list erases nothing the app knew")
        self.assertTrue(self.root(s, CHEST)["opened"])
        self.assertIn("  house: 144 tiles, furniture and chests not read", w.messages)

    def test_a_house_over_the_tile_cap_is_left_out_and_the_summary_says_so(self):
        w = World(); home(w)
        w.multis = [t for z in range(139) for t in house_tiles(5, 5, 12, 12, z=z)]   # 20,016 tiles
        self.scan(w)
        [s] = self.scans("tazuo")
        self.assertNotIn("house", s)
        self.assertTrue(self.root(s, CHEST)["opened"])
        self.assertIn("  house too large to record: 20016 tiles", w.messages)

    def test_the_same_house_is_captured_whole_from_the_steps_a_corner_or_inside(self):
        steps = [types.SimpleNamespace(Graphic=0x0751, X=x, Y=17, Z=0, Impassible=False) for x in range(5, 17)]
        deck = [types.SimpleNamespace(Graphic=0x04C6, X=x, Y=y, Z=27, Impassible=False) for x in range(6, 16) for y in range(6, 16)]
        tiles = []
        for px, py in ((10, 10), (8, 17), (5, 5)):
            shutil.rmtree(os.path.join(self.data, "inbox"), ignore_errors=True)
            w = World(); home(w); w.px, w.py = px, py
            w.multis = house_tiles(5, 5, 12, 12) + steps + deck
            self.scan(w)
            [s] = self.scans("tazuo")
            tiles.append(s["house"]["tiles"])
        self.assertEqual(len(tiles[0]), 12 * 12 + 12 + 100)
        self.assertEqual(tiles[0], tiles[1])
        self.assertEqual(tiles[0], tiles[2])


class TazUORefresh(DataDir, unittest.TestCase):
    SCRIPT = adapter_path("tazuo", "packrat-character-refresh.py")

    def test_it_walks_the_backpack_with_the_scanners_own_code(self):
        def body(path, name):
            with open(path, encoding="utf-8") as f:
                t = f.read()
            m = re.search(r"^def %s\(.*?(?=^def |^[A-Z_]+ = )" % name, t, re.S | re.M)
            self.assertIsNotNone(m, "%s lacks %s" % (path, name))
            return m.group(0)
        for name in ("is_container", "was_opened", "note_if_closed", "scan_root", "close_opened", "read_blacklist", "without_skipped", "is_trash", "facet", "root_pos", "root_entry"):
            self.assertEqual(body(self.SCRIPT, name), body(TazUOScanner.SCRIPT, name), name)

    def test_a_bag_in_the_backpack_that_did_not_open_is_marked_unopened(self):
        w = World(); home(w)
        w.add(BAG + 0x100, PACK, name="Pouch", OnGround=False)
        w.add(RING + 0x100, BAG + 0x100, name="Ring", container_like=False, OnGround=False)
        w.locked.add(BAG + 0x100)
        run_script(self.SCRIPT, w, api=tazuo_api(w, PACK))
        [s] = self.scans("tazuo")
        self.assertIs(s["containers"][str(BAG + 0x100)]["opened"], False)
        self.assertIn(RING2, [i["serial"] for i in s["items"]])

    def test_it_closes_the_bags_it_opened_and_leaves_the_open_backpack_open(self):
        w = World(); home(w)
        w.items[PACK].Opened = True
        w.add(BAG + 0x100, PACK, name="Pouch", OnGround=False)
        run_script(self.SCRIPT, w, api=tazuo_api(w, PACK))
        self.assertEqual(len(self.scans("tazuo")), 1)
        self.assertEqual(self.closed(w), [BAG + 0x100])
        self.assertTrue(w.items[PACK].Opened)

    def test_a_trash_container_in_the_backpack_is_never_opened_or_recorded(self):
        for cached in (False, True):
            with self.subTest(cached=cached):
                shutil.rmtree(os.path.join(self.data, "inbox"), ignore_errors=True)
                w = World(); home(w); trash(w, cached)
                run_script(self.SCRIPT, w, api=tazuo_api(w, PACK))
                self.trash_refresh(w)

    def trash_refresh(self, w):
        [s] = self.scans("tazuo")
        self.assertNotIn(TRASH_CHEST, self.opened(w))
        self.assertNotIn(str(TRASH_CHEST), s["containers"])
        self.assertEqual(sorted(i["serial"] for i in s["items"]), [RING2])
        self.assertIn("  skipped 1 trash container", w.messages)


class TazUOHouseMapRefresh(DataDir, unittest.TestCase):
    SCRIPT = adapter_path("tazuo", "packrat-house-map-refresh.py")
    SHARED = ("data_dir", "write_json_atomic", "rfc3339_now", "read_blacklist", "sysmsg", "is_container", "facet", "house_capture")
    CONSTANTS = ("ADAPTER_ID", "CAPABILITIES", "HOUSE_RADIUS", "HOUSE_MAX_TILES", "HOUSE_ITEM_REACH", "HOUSE_MAX_ITEMS", "HOUSE_MAX_CONTAINERS",
                 "BLACKLIST", "HOUSE_LEFT_OUT", "HOUSE_TOO_LARGE", "OUT_DIR", "CONTAINER_RE", "NOT_A_CONTAINER_RE", "NOT_A_CONTAINER_GRAPHICS",
                 "TRASH_RE", "WEARABLE_RE", "CONTAINER_GRAPHICS")

    def house(self, w):
        """Run the house map refresh with a client that records every tooltip and OPL request."""
        api = tazuo_api(w, PACK)
        asked = []
        names = api.ItemNameAndProps
        api.ItemNameAndProps = lambda s, b=False: (asked.append(("tooltip", int(s))), names(s, b))[1]
        api.RequestOPLData = lambda serials: asked.append(("opl", list(serials)))
        run_script(self.SCRIPT, w, api=api)
        return asked

    def test_it_captures_the_house_with_the_scanners_own_code(self):
        for name in self.SHARED:
            body = helper_body(self.SCRIPT, name)
            self.assertIsNotNone(body, name)
            self.assertEqual(body, helper_body(TazUOScanner.SCRIPT, name), name)
        with open(self.SCRIPT, encoding="utf-8") as f:
            mine = f.read()
        with open(TazUOScanner.SCRIPT, encoding="utf-8") as f:
            scanner = f.read()
        for name in self.CONSTANTS:
            pattern = r"^%s = .*?(?=^[A-Za-z_#]|\Z)" % name
            m = re.search(pattern, mine, re.S | re.M)
            self.assertIsNotNone(m, name)
            self.assertEqual(m.group(0), re.search(pattern, scanner, re.S | re.M).group(0), name)

    def test_it_writes_only_the_house_and_asks_the_server_nothing(self):
        w = World(); home(w); w.facet = 1; w.multis = house_tiles(5, 5, 12, 12)
        w.add(0x40000040, 0, name="table", container_like=False, X=12, Y=12, Z=7)
        w.items[0x40000040].Graphic = 0x0B34
        w.add(0x40000050, 0, name="Metal Chest", X=15, Y=15, Z=7)
        w.items[0x40000050].Graphic = 0x0E7C
        asked = self.house(w)
        files = glob.glob(os.path.join(self.data, "inbox", "tazuo", "*.json"))
        self.assertEqual(len(files), 1)
        self.assertRegex(os.path.basename(files[0]), r"^Tester-\d{8}-\d{6}-house\.json$")
        [s] = self.scans("tazuo")
        self.assertEqual(s["kind"], "house")
        self.assertEqual(s["character"], "Tester")
        self.assertEqual(s["schemaVersion"], 2)
        self.assertEqual((s["stats"], s["roots"], s["containers"], s["items"], s["equipped"]), ({}, [], {}, [], []))
        h = s["house"]
        self.assertEqual((h["facet"], h["at"], len(h["tiles"])), (1, {"x": 10, "y": 10}, 144))
        self.assertEqual(h["items"], [[0x40000040, 0x0B34, 12, 12, 7]])
        self.assertEqual(h["containers"], [[CHEST, 0x0E75, 11, 10, 0], [0x40000050, 0x0E7C, 15, 15, 7]])
        self.assertEqual(self.opened(w), [], "no container is opened")
        self.assertEqual(asked, [], "no tooltip or OPL request")
        self.assertEqual(w.messages, ["Pack Rat house map refresh (Tester) -> %s: 144 tiles, 1 pieces of furniture, 2 chests" % os.path.basename(files[0])])

    def test_trash_blacklisted_containers_and_corpses_are_left_out_of_the_chests(self):
        w = World(); home(w); w.multis = house_tiles(5, 5, 12, 12)
        w.add(0x40000052, 0, name="trash barrel", X=14, Y=14)
        w.add(0x40000053, 0, name="Wooden Box", X=13, Y=13)
        w.add(0x40000054, 0, name="a corpse", Graphic=0x2006, X=12, Y=13)
        self.blacklist([0x40000053])
        self.house(w)
        [s] = self.scans("tazuo")
        self.assertEqual([c[0] for c in s["house"]["containers"]], [CHEST])

    def test_outside_a_house_or_without_the_multi_calls_it_writes_nothing_and_says_so(self):
        for multis in (None, [], house_tiles(30, 30, 5, 5), [t for z in range(139) for t in house_tiles(5, 5, 12, 12, z=z)]):
            with self.subTest(multis=None if multis is None else len(multis)):
                w = World(); home(w); w.multis = multis
                self.house(w)
                self.assertEqual(self.scans("tazuo"), [])
                self.assertEqual(len(w.messages), 1)
                self.assertTrue(w.messages[0].startswith("Pack Rat house map refresh: "), w.messages[0])
        self.assertIn("20016 tiles", w.messages[0])

    def test_a_ground_read_that_fails_writes_the_tiles_and_says_the_furniture_was_not_read(self):
        w = World(); home(w); w.multis = house_tiles(5, 5, 12, 12)
        api = tazuo_api(w, PACK)
        def broken(r):
            raise RuntimeError("the read failed")
        api.GetItemsOnGround = broken
        run_script(self.SCRIPT, w, api=api)
        [s] = self.scans("tazuo")
        self.assertNotIn("items", s["house"])
        self.assertTrue(w.messages[0].endswith(": 144 tiles, furniture and chests not read"), w.messages)

    def test_a_stop_writes_nothing(self):
        w = World(); home(w); w.multis = house_tiles(5, 5, 12, 12)
        api = tazuo_api(w, PACK)
        api.StopRequested = True
        run_script(self.SCRIPT, w, api=api)
        self.assertEqual(self.scans("tazuo"), [])

    def test_it_runs_where_the_host_defines_no___file__(self):
        w = World(); home(w); w.multis = house_tiles(5, 5, 12, 12)
        run_script(self.SCRIPT, w, api=tazuo_api(w, PACK), with_file=False)
        self.assertEqual(len(self.scans("tazuo")), 1)


class TazUOBlacklist(DataDir, unittest.TestCase):
    SCRIPT = adapter_path("tazuo", "packrat-blacklist.py")

    def pick(self, world, serial):
        api = tazuo_api(world, PACK)
        api.RequestTarget = lambda timeout: serial
        run_script(self.SCRIPT, world, api=api)

    def listed(self):
        with open(os.path.join(self.data, "scan-blacklist.json"), encoding="utf-8") as f:
            return json.load(f)

    def test_a_targeted_container_is_added_and_a_second_target_appends(self):
        w = World(); home(w)
        w.items[CHEST].Opened = True    # the player opened it to click the bag inside
        self.pick(w, CHEST)
        self.pick(w, BAG)
        self.pick(w, CHEST)
        [chest, bag] = self.listed()
        self.assertEqual((chest["serial"], chest["name"], chest["where"]), (CHEST, "Wooden Chest", "11, 10"))
        self.assertEqual((bag["serial"], bag["where"]), (BAG, "in Wooden Chest"))
        self.assertRegex(chest["addedAt"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$")
        self.assertEqual(w.calls, [], "nothing in the world is opened or moved")

    def test_a_cancelled_cursor_the_backpack_or_a_non_container_writes_nothing(self):
        w = World(); home(w)
        w.items[PACK].Opened = True
        for target in (0, PACK, RING2):
            self.pick(w, target)
        self.assertFalse(os.path.exists(os.path.join(self.data, "scan-blacklist.json")))


class RazorScanner(DataDir, unittest.TestCase):
    SCRIPT = adapter_path("razor-enhanced", "packrat-scanner.py")

    def scan(self, world, skills=None, **kw):
        run_script(self.SCRIPT, world, extra_globals=razor_globals(world, PACK, skills=skills), **kw)

    def test_a_normal_scan_records_every_root_and_the_nested_ring(self):
        w = World(); home(w)
        self.scan(w)
        [s] = self.scans("razor-enhanced")
        self.assertTrue(self.root(s, CHEST)["opened"])
        self.assertEqual(sorted(i["serial"] for i in s["items"]), [RING, RING2])

    def test_a_root_whose_contents_never_arrive_is_recorded_not_opened(self):
        w = World(); home(w); w.locked.add(CHEST)
        self.scan(w)
        [s] = self.scans("razor-enhanced")
        self.assertFalse(self.root(s, CHEST)["opened"])
        self.assertNotIn(str(CHEST), s["containers"])

    def test_a_bag_that_did_not_open_is_marked_unopened_and_the_rest_of_its_root_recorded(self):
        w = World(); home(w); w.locked.add(BAG)
        w.add(RING + 0x20, CHEST, name="Loose Ring", container_like=False, OnGround=False)
        self.scan(w)
        [s] = self.scans("razor-enhanced")
        self.assertTrue(self.root(s, CHEST)["opened"])
        self.assertIs(s["containers"][str(BAG)]["opened"], False)
        self.assertIn(RING + 0x20, [i["serial"] for i in s["items"]])
        self.assertTrue(any("Bag" in m and "kept from the last scan" in m for m in w.messages), w.messages)

    def test_an_empty_bag_neither_blocks_nor_erases_whichever_way_wait_for_contents_answers(self):
        for empty_wait_false in (False, True):
            w = World(); home(w); w.empty_wait_false = empty_wait_false
            w.add(EMPTY, CHEST, name="Pouch", OnGround=False)
            self.scan(w)
            s = self.scans("razor-enhanced")[-1]
            self.assertTrue(self.root(s, CHEST)["opened"], empty_wait_false)
            self.assertEqual(sorted(i["serial"] for i in s["items"]), [RING, RING2], empty_wait_false)
            # Answered True: recorded empty. Answered False: marked unopened, so the fold keeps
            # whatever it knew inside -- never erased either way.
            self.assertIs(s["containers"][str(EMPTY)].get("opened", True), not empty_wait_false)
            shutil.rmtree(os.path.join(self.data, "inbox"), ignore_errors=True)

    def test_a_commodity_deed_box_is_a_real_container_and_is_opened(self):
        w = World(); home(w)
        w.add(0x40000022, CHEST, name="Commodity Deed Box", OnGround=False)
        w.add(0x40000023, 0x40000022, name="Commodity Deed", container_like=False, OnGround=False)
        self.scan(w)
        self.assertIn(("open", 0x40000022), w.calls)
        [s] = self.scans("razor-enhanced")
        self.assertIn(str(0x40000022), s["containers"])
        self.assertIn(0x40000023, [i["serial"] for i in s["items"]])

    def test_a_bag_of_sending_is_never_opened_and_is_recorded_as_an_item(self):
        w = World(); home(w)
        w.add(0x40000021, CHEST, name="a bag of sending", OnGround=False, Graphic=0x0E76)
        self.scan(w)
        self.assertNotIn(("open", 0x40000021), w.calls)
        [s] = self.scans("razor-enhanced")
        self.assertIn(0x40000021, [i["serial"] for i in s["items"]])

    def test_books_and_armour_are_never_opened_and_are_recorded_as_items(self):
        w = World(); home(w)
        serials = books_and_armour(w, PACK) + books_and_armour(w, CHEST, first=0x40000600)
        self.scan(w)
        opened = [c[1] for c in w.calls if c[0] == "open"]
        self.assertEqual([s for s in serials if s in opened], [])
        [s] = self.scans("razor-enhanced")
        items = [i["serial"] for i in s["items"]]
        self.assertEqual([x for x in serials if x not in items], [])

    def test_a_bag_nested_past_the_depth_limit_is_marked_unopened(self):
        w = World(); home(w)
        # chest > BAG > bags[0] > bags[1] are opened (MAX_NEST = 4 levels); bags[2] is seen, not opened
        deepest = nest(w, BAG, 5)[2]
        self.scan(w)
        [s] = self.scans("razor-enhanced")
        self.assertIs(s["containers"][str(deepest)]["opened"], False)
        self.assertNotIn(deepest, [i["serial"] for i in s["items"]])

    def test_skills_are_written_under_the_names_the_app_reads(self):
        w = World(); home(w)
        self.scan(w, skills={"Magic Resist": 100.0, "Swords": 90.0, "EvalInt": 80.0, "Tactics": 70.0})
        [s] = self.scans("razor-enhanced")
        self.assertEqual(sorted(s["skills"]), ["Evaluating Intelligence", "Resisting Spells", "Swordsmanship", "Tactics"])
        self.assertEqual(s["skills"]["Resisting Spells"]["value"], 100.0)

    def test_it_closes_exactly_the_container_windows_it_opened_innermost_first(self):
        w = World(); home(w)
        self.scan(w)
        self.assertEqual(self.closed(w), [BAG, CHEST, PACK])

    def test_containers_opened_before_the_scan_are_left_open(self):
        w = World(); home(w)
        w.items[PACK].Opened = w.items[PACK].EverOpened = True
        w.items[CHEST].Opened = w.items[CHEST].EverOpened = True
        self.scan(w)
        self.assertEqual(self.closed(w), [BAG])

    def test_windows_close_only_after_the_scan_file_is_written(self):
        w = World(); home(w)
        written = []
        w.on_close = lambda serial: written.append(len(self.scans("razor-enhanced")))
        self.scan(w)
        self.assertEqual(written, [1, 1, 1])

    def test_it_closes_what_it_opened_when_the_scan_fails(self):
        w = World(); home(w)
        g = razor_globals(w, PACK)
        waiter = g["Items"].WaitForContents

        def wait_or_fail(it, ms):
            if int(it.Serial) == BAG:
                raise SystemExit("stopped")     # stands in for a Stop (RE aborts the script thread) or any error
            return waiter(it, ms)
        g["Items"].WaitForContents = staticmethod(wait_or_fail)
        with self.assertRaises(SystemExit):
            run_script(self.SCRIPT, w, extra_globals=g)
        self.assertEqual(self.scans("razor-enhanced"), [])
        self.assertEqual(self.closed(w), [CHEST, PACK])

    def test_a_build_without_items_close_leaves_windows_open_and_does_not_raise(self):
        w = World(); home(w); w.no_items_close = True
        self.scan(w)
        self.assertEqual(self.closed(w), [])
        self.assertEqual(len(self.scans("razor-enhanced")), 1)

    def test_it_runs_where_the_host_defines_no___file__(self):
        w = World(); home(w)
        self.scan(w, with_file=False)
        self.assertEqual(len(self.scans("razor-enhanced")), 1)

    def test_a_blacklisted_ground_chest_is_left_out_and_a_blacklisted_bag_is_recorded_unopened(self):
        w = World(); home(w)
        w.add(CHEST + 0x100, 0, name="Trash Barrel", X=11, Y=11)
        self.blacklist([CHEST + 0x100, BAG])
        self.scan(w)
        [s] = self.scans("razor-enhanced")
        self.assertNotIn(CHEST + 0x100, self.opened(w))
        self.assertNotIn(BAG, self.opened(w))
        self.assertEqual([r["serial"] for r in s["roots"]], [PACK, CHEST])
        self.assertIs(s["containers"][str(BAG)]["opened"], False)
        self.assertEqual(sorted(i["serial"] for i in s["items"]), [RING2])
        self.assertIn("  skipped 2 blacklisted containers", w.messages)

    def test_a_trash_container_is_never_opened_or_recorded_and_an_ordinary_barrel_is(self):
        for cached in (False, True):
            with self.subTest(cached=cached):
                shutil.rmtree(os.path.join(self.data, "inbox"), ignore_errors=True)
                self.trash_scan(cached)

    def trash_scan(self, cached):
        w = World(); home(w); trash(w, cached)
        self.scan(w)
        [s] = self.scans("razor-enhanced")
        self.assertNotIn(TRASH_BARREL, self.opened(w))
        self.assertNotIn(TRASH_CHEST, self.opened(w))
        self.assertIn(BARREL, self.opened(w), "an ordinary barrel on the same graphic is still scanned")
        self.assertEqual([r["serial"] for r in s["roots"]], [PACK, CHEST, BARREL])
        self.assertEqual([c for c in (TRASH_BARREL, TRASH_CHEST) if str(c) in s["containers"]], [])
        self.assertEqual(sorted(i["serial"] for i in s["items"]), [RING, RING2], "nothing in or of the trash is recorded")
        self.assertIn("  skipped 2 trash containers", w.messages)

    def test_a_ground_root_records_its_tooltip_and_its_facet(self):
        w = World(); home(w); w.facet = 3
        w.items[CHEST].Tooltip = "Wooden Chest\nContents: 1/125 Items, 3 Stones"
        w.add(0x40000030, 0, name="Metal Chest", X=10, Y=11, Tooltip="Metal Chest\nContents: 0/125 Items, 0 Stones")
        self.scan(w)
        [s] = self.scans("razor-enhanced")
        chest, empty, pack = (s["containers"][str(x)] for x in (CHEST, 0x40000030, PACK))
        self.assertEqual(chest["tooltip"], ["Wooden Chest", "Contents: 1/125 Items, 3 Stones"])
        self.assertEqual(chest["pos"], {"x": 11, "y": 10, "z": 0, "facet": 3})
        self.assertEqual(empty["tooltip"], ["Metal Chest", "Contents: 0/125 Items, 0 Stones"], "a chest that opened empty")
        self.assertNotIn("tooltip", pack)
        self.assertIsNone(pack["pos"])

    def test_the_facet_is_left_out_when_the_client_cannot_say(self):
        def build_without_it():
            raise RuntimeError("Player.Map failed")
        for facet in (None, -1, 6, "Trammel", build_without_it):
            with self.subTest(facet=facet):
                shutil.rmtree(os.path.join(self.data, "inbox"), ignore_errors=True)
                w = World(); home(w); w.facet = facet
                self.scan(w)
                [s] = self.scans("razor-enhanced")
                self.assertEqual(s["containers"][str(CHEST)]["pos"], {"x": 11, "y": 10, "z": 0})


class RazorRefresh(DataDir, unittest.TestCase):
    SCRIPT = adapter_path("razor-enhanced", "packrat-refresh.py")

    def refresh(self, world):
        run_script(self.SCRIPT, world, extra_globals=razor_globals(world, PACK))

    def test_it_walks_the_backpack_with_the_scanners_own_code(self):
        for script, names in ((self.SCRIPT, ("tooltip_lines", "name_of", "item_dict", "is_container", "root_pos", "facet", "root_entry",
                                             "container_entry", "scan_root", "note_if_closed", "close_opened",
                                             "note_unopened", "read_skills", "read_blacklist", "sysmsg", "as_int")),
                              (RazorBlacklist.SCRIPT, ("read_blacklist", "as_int", "tooltip_lines", "name_of"))):
            for name in names:
                body = helper_body(RazorScanner.SCRIPT, name)
                self.assertIsNotNone(body, name)
                self.assertEqual(helper_body(script, name), body, "%s %s" % (os.path.basename(script), name))

    def test_it_writes_the_backpack_as_the_only_root_and_opens_nothing_on_the_ground(self):
        w = World(); home(w)
        self.refresh(w)
        [s] = self.scans("razor-enhanced")
        self.assertEqual([r["serial"] for r in s["roots"]], [PACK])
        self.assertEqual([i["serial"] for i in s["items"]], [RING2])
        self.assertNotIn(CHEST, self.opened(w))
        self.assertEqual(s["meta"]["mode"], "quick")
        self.assertTrue(glob.glob(os.path.join(self.data, "inbox", "razor-enhanced", "Tester-*-quick.json")))

    def test_a_backpack_that_did_not_open_writes_nothing(self):
        w = World(); home(w); w.locked.add(PACK)
        self.refresh(w)
        self.assertEqual(self.scans("razor-enhanced"), [])
        self.assertTrue(any("nothing written" in m for m in w.messages), w.messages)

    def test_a_bag_in_the_backpack_that_did_not_open_is_marked_unopened(self):
        w = World(); home(w)
        w.add(BAG + 0x100, PACK, name="Pouch", OnGround=False)
        w.add(RING + 0x100, BAG + 0x100, name="Ring", container_like=False, OnGround=False)
        w.locked.add(BAG + 0x100)
        self.refresh(w)
        [s] = self.scans("razor-enhanced")
        self.assertIs(s["containers"][str(BAG + 0x100)]["opened"], False)
        self.assertIn(RING2, [i["serial"] for i in s["items"]])

    def test_a_blacklisted_bag_and_a_trash_chest_in_the_backpack_are_never_opened(self):
        w = World(); home(w); trash(w)
        w.add(BAG + 0x100, PACK, name="Pouch", OnGround=False)
        self.blacklist([BAG + 0x100])
        self.refresh(w)
        [s] = self.scans("razor-enhanced")
        self.assertEqual([c for c in (BAG + 0x100, TRASH_CHEST) if c in self.opened(w)], [])
        self.assertIs(s["containers"][str(BAG + 0x100)]["opened"], False)
        self.assertEqual([i["serial"] for i in s["items"]], [RING2])
        self.assertIn("  skipped 1 blacklisted container", w.messages)
        self.assertIn("  skipped 1 trash container", w.messages)

    def test_it_closes_the_bags_it_opened_and_leaves_the_open_backpack_open(self):
        w = World(); home(w)
        w.items[PACK].Opened = w.items[PACK].EverOpened = True
        w.add(BAG + 0x100, PACK, name="Pouch", OnGround=False)
        self.refresh(w)
        self.assertEqual(len(self.scans("razor-enhanced")), 1)
        self.assertEqual(self.closed(w), [BAG + 0x100])

    def test_it_runs_where_the_host_defines_no___file__(self):
        w = World(); home(w)
        run_script(self.SCRIPT, w, extra_globals=razor_globals(w, PACK), with_file=False)
        self.assertEqual(len(self.scans("razor-enhanced")), 1)


class RazorBlacklist(DataDir, unittest.TestCase):
    SCRIPT = adapter_path("razor-enhanced", "packrat-blacklist.py")

    def pick(self, world, serial):
        world.target = serial
        run_script(self.SCRIPT, world, extra_globals=razor_globals(world, PACK))

    def listed(self):
        with open(os.path.join(self.data, "scan-blacklist.json"), encoding="utf-8") as f:
            return json.load(f)

    def test_a_targeted_container_is_added_and_a_second_target_appends(self):
        w = World(); home(w)
        w.items[CHEST].Opened = True    # the player opened it to click the bag inside
        self.pick(w, CHEST)
        self.pick(w, BAG)
        self.pick(w, CHEST)
        [chest, bag] = self.listed()
        self.assertEqual((chest["serial"], chest["name"], chest["where"]), (CHEST, "Wooden Chest", "11, 10"))
        self.assertEqual((bag["serial"], bag["where"]), (BAG, "in Wooden Chest"))
        self.assertRegex(chest["addedAt"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$")
        self.assertEqual(w.calls, [], "nothing in the world is opened or moved")
        self.assertIn("Pack Rat: Wooden Chest is already blacklisted.", w.messages)

    def test_a_cancelled_cursor_the_backpack_or_a_non_container_writes_nothing(self):
        w = World(); home(w)
        w.items[PACK].Opened = True
        for target in (-1, 0, PACK, RING2):
            self.pick(w, target)
        self.assertFalse(os.path.exists(os.path.join(self.data, "scan-blacklist.json")))
        self.assertEqual(w.messages.count("Pack Rat: cancelled, nothing blacklisted."), 2)


if __name__ == "__main__":
    unittest.main()
