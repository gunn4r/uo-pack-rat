"""test_scanners.py -- the TazUO and Razor Enhanced scanners run end to end against a fake client
(fake_clients.py), checking the one property that matters most: a scan never records a container as
opened-and-empty unless it really opened. The app's fold replaces everything it knew under a root
with what the newest scan says, so a false "opened, nothing inside" erases real inventory records.

Run: python3 adapters/test_scanners.py  (app/adapters.test.mts also spawns it, so `npm test` does).
"""
import glob, json, os, re, shutil, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fake_clients import PLAYER, World, adapter_path, razor_globals, run_script, tazuo_api  # noqa: E402

PACK, CHEST, BAG, RING, RING2, EMPTY = 0x40000001, 0x40000002, 0x40000003, 0x40000010, 0x40000011, 0x40000004


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


class TazUORefresh(DataDir, unittest.TestCase):
    SCRIPT = adapter_path("tazuo", "packrat-refresh.py")

    def test_it_walks_the_backpack_with_the_scanners_own_code(self):
        def body(path, name):
            with open(path, encoding="utf-8") as f:
                t = f.read()
            m = re.search(r"^def %s\(.*?(?=^def |^[A-Z_]+ = )" % name, t, re.S | re.M)
            self.assertIsNotNone(m, "%s lacks %s" % (path, name))
            return m.group(0)
        for name in ("is_container", "was_opened", "note_if_closed", "scan_root", "close_opened", "read_blacklist", "without_blacklisted"):
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


if __name__ == "__main__":
    unittest.main()
