"""test_scanners.py -- the TazUO and Razor Enhanced scanners and refreshes run end to end against a fake client.

The fake client is fake_clients.py: a world of items whose containers reveal their contents only once opened and never when locked, TazUO's `API` module, Razor Enhanced's `Items`/`Player`/`Misc`, and a fake `time` module whose clock moves only when the script pauses. The one property that matters most: a scan never records a container as opened-and-empty unless it really opened. The app's fold replaces everything it knew under a root with what the newest scan says, so a false "opened, nothing inside" erases real inventory records.

Covers: neither scanner ever records a container it could not read as opened-and-empty (a locked root, Stop while a root opens); a bag inside a root that did not open, or deeper than `MAX_NEST`, is marked `opened: false` while the rest of the root is recorded (scanner and refresh); an empty bag neither blocks nor erases in Razor Enhanced whether `WaitForContents` answers true or false for it; a deed, a bag of sending, a book of any kind (spellbooks of every school, runebooks, a runic atlas) and armour named like a chest are never double-clicked and are recorded as items, while a Commodity Deed Box is opened as the container it is (and containers the client does not flag, a Gargish Chest among them, are still opened by graphic or name); RE's skill names come out as the game's; the scanners and the TazUO refresh close exactly the container windows they opened (innermost first, only after the scan file is written, after a Stop or a failure too, never one that was open before the run); a ground container showing a name plate stays open and is reported (the fake's `GetContainerGump()` answers None while an item has a plate, as TazUO's does); a client build lacking the close calls (`GetContainerGump`, a window's `Dispose`, RE's `Items.Close`) leaves the windows open without raising; and both run with no `__file__` defined.

Issue #38: a blacklisted ground chest is left out and a blacklisted bag recorded unopened by both scanners and both refreshes, a corrupt or oversized list skips nothing, the Razor Enhanced refresh writes the backpack as its only root and nothing when the backpack does not open, and both adapters' `packrat-blacklist.py` adds a targeted container and writes nothing on cancel, the player's backpack or a non-container. Issue #74: a trash container (a name with "trash" in it, read from the tooltip when the client's own name is the generic one) is never opened or recorded, with its contents, by the TazUO scanner or refresh, while an ordinary barrel on the same graphic is, and the scan summary counts what it skipped. Issue #11: a ground root's containers entry carries its tooltip (a chest that opened empty too) and its `pos` the facet the client reports, left out when the client has no map call, the call raises, or it answers anything but 0-5.

Issue #10: a scan inside a house records its tiles and where the player stood, keeps only the house under the player (a neighbour two tiles away is left out), records furniture inside the footprint but not containers or items outside it, keeps the nearest 5,000 pieces of furniture past the schema's cap and says how many farther ones it left out ("1 farther one" in the singular), leaves `items` out when the ground read raises, captures the same tiles from the front steps, a corner or inside, leaves out a house of more than 20,000 tiles with a summary line saying so, and writes no house section outside a house, on a build without the multi calls or when a call raises. 2.11.0: every container inside the footprint is listed in `house.containers` with its place without being opened, trash containers left out (one the roots pass knew as trash only by its tooltip too), the summary line counting the chests, and no list written when the ground read fails.

The TazUO house map refresh (2.12.0, issue #10): a house-only file (`kind: "house"`, no inventory) named `<Character>-<stamp>-house.json` with the tiles, furniture and every chest, no container opened and no tooltip or OPL request, its one summary line, trash by cached name, blacklisted containers and corpses kept out of the chests, nothing written outside a house, without the multi calls or past the tile cap (each said in one line), the tiles kept and the furniture claim left out when the ground read fails, nothing written after a Stop, and a run without `__file__`; the trash containers the roots pass skipped written as `house.trash` (issue #162), with no field when there were none or no house.

Issue #298: a TazUO scan whose player moves more than 15 tiles away or to another facet partway stops right after the root under way and before the house capture (the roots finished are written, that one and the rest left out, no house, the in-game line saying why); a Stop while a root opens, or one that interrupts a pause inside it, writes the roots finished the same way with its own line, and a Stop before any root is finished writes nothing, while a few steps change nothing; tooltips that arrive late (the fake's `late_tooltips`) are waited for, re-asked for only while missing, and ones that never arrive are waited for a bounded time, the root recorded as not opened when most of it has none, else counted in the summary.

Claimed houses (issue #299): the TazUO tests write a claim over the house home() builds (DataDir.claim). A scan opens ground containers and captures the house only inside a claimed house, a customized one whose footprint overlaps the claim included; in an unclaimed house, under a claim on another facet, outside any house, or with a missing or broken claims file it reads only the pack and equipped items and says why; the house map refresh writes nothing in an unclaimed house and asks the server nothing to find out. A bag whose tooltip never arrives is checked for trash for at most 2 s.

The Razor scanner records a worn piece on its own layer (`GetItemOnLayer` in the fake answers an item added with `Layer=`); that test's world is the one `adapters/razor-enhanced/fixture.scan.json` is made from. With `PACKRAT_TEST_OUTPUTS` set to a folder, `fake_clients.py`'s `run_script` copies every scan a script writes into it, for `app/adapter-outputs.test.mts`.

Run: python3 adapters/test_scanners.py  (app/adapters.test.mts also spawns it, so `npm test` does).
"""
import glob, json, os, shutil, sys, tempfile, types, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fake_clients import PLAYER, World, adapter_path, house_tiles, razor_globals, run_script, tazuo_api  # noqa: E402

PACK, CHEST, BAG, RING, RING2, EMPTY = 0x40000001, 0x40000002, 0x40000003, 0x40000010, 0x40000011, 0x40000004
TRASH_BARREL, BARREL, TRASH_CHEST = 0x40000300, 0x40000301, 0x40000302
CHEST2 = 0x40000006
NOT_CLAIMED = "Not in one of your houses, so only your pack was scanned. Use Claim this house in the Pack Rat panel if this house is yours."


def home(world):
    """A backpack holding a ring, and a chest in reach holding a bag holding a ring, in a house of 12 by 12
    tiles from (5, 5) (the claims DataDir.claim writes cover it)."""
    world.multis = house_tiles(5, 5, 12, 12)
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

    def claim(self, bounds=(5, 5, 16, 16), facets=(None, 0, 1, 2, 3, 4, 5)):
        """Write <data>/house-claims.json (issue #299): a claim of `bounds` on each of `facets`, the house home()
        builds by default, so a scan there reads the ground as it did before claims."""
        x0, y0, x1, y1 = bounds
        doc = [{"id": "%s-%d-%d" % ("x" if f is None else f, x0, y0), "facet": f, "bounds": {"x0": x0, "y0": y0, "x1": x1, "y1": y1},
                "claimedAt": "2026-10-16T10:00:00Z", "by": "Tester"} for f in facets]
        with open(os.path.join(self.data, "house-claims.json"), "w", encoding="utf-8") as f:
            json.dump(doc, f)


class TazUOScanner(DataDir, unittest.TestCase):
    SCRIPT = adapter_path("tazuo", "packrat-scanner.py")

    def setUp(self):
        super().setUp()
        self.claim()

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

    def test_only_a_claimed_house_has_its_ground_scanned_and_its_house_captured(self):
        for name, claim, multis, opened in (
                ("a claimed house", (5, 5, 16, 16), house_tiles(5, 5, 12, 12), True),
                ("a house customized since it was claimed: its footprint overlaps the claim", (5, 5, 16, 16), house_tiles(3, 7, 10, 12), True),
                ("an unclaimed house", (40, 40, 50, 50), house_tiles(5, 5, 12, 12), False),
                ("a claim on another facet", (5, 5, 16, 16), house_tiles(5, 5, 12, 12), False),
                ("outside any house", (5, 5, 16, 16), house_tiles(30, 30, 5, 5), False)):
            with self.subTest(name):
                shutil.rmtree(os.path.join(self.data, "inbox"), ignore_errors=True)
                self.claim(claim, facets=[4 if "facet" in name else 1])
                w = World(); home(w); w.facet = 1; w.multis = multis
                self.scan(w)
                [s] = self.scans("tazuo")
                if opened:
                    self.assertTrue(self.root(s, CHEST)["opened"])
                    self.assertIn("house", s)
                    self.assertNotIn(NOT_CLAIMED, w.messages)
                else:
                    self.assertEqual([r["serial"] for r in s["roots"]], [PACK])
                    self.assertEqual([i["serial"] for i in s["items"]], [RING2], "the pack is still read")
                    self.assertNotIn(CHEST, self.opened(w))
                    self.assertNotIn("house", s)
                    self.assertIn(NOT_CLAIMED, w.messages)

    def test_a_missing_or_broken_claims_file_reads_as_no_claim(self):
        for doc in (None, "not json", '{"id": "1-5-5"}', json.dumps([{"id": "1-5-5", "facet": 1, "bounds": {"x0": 16, "y0": 5, "x1": 5, "y1": 16}}])):
            with self.subTest(doc=doc):
                shutil.rmtree(os.path.join(self.data, "inbox"), ignore_errors=True)
                if os.path.exists(os.path.join(self.data, "house-claims.json")):
                    os.remove(os.path.join(self.data, "house-claims.json"))
                if doc is not None:
                    with open(os.path.join(self.data, "house-claims.json"), "w", encoding="utf-8") as f:
                        f.write(doc)
                w = World(); home(w); w.facet = 1
                self.scan(w)
                [s] = self.scans("tazuo")
                self.assertEqual([r["serial"] for r in s["roots"]], [PACK])

    def test_a_bag_whose_tooltip_never_arrives_is_checked_for_trash_for_at_most_2_s(self):
        took = []
        for late in (False, True):
            shutil.rmtree(os.path.join(self.data, "inbox"), ignore_errors=True)
            w = World(); home(w)
            bags = [BAG + 0x100 + i for i in range(4)]
            for b in bags:
                w.add(b, CHEST, name="Bag", OnGround=False)
            w.late_tooltips = dict((b, None) for b in bags) if late else {}
            t0 = w.clock.now
            self.scan(w)
            took.append(w.clock.now - t0)
        self.assertTrue(all(b in self.opened(w) for b in bags), "a bag with no tooltip is no trash by its cached name")
        # The chest's own tooltip wait (8 s at most) and 2 s for each trash check (a bag is checked when it is opened and when it is listed), never the client's own 10 s.
        self.assertLess(took[1] - took[0], 8 + 2 * 4 * 2)

    def only_the_pack(self, w):
        """A stopped scan wrote the backpack it finished and nothing of the chest it was reading, and said so."""
        [s] = self.scans("tazuo")
        self.assertEqual([r["serial"] for r in s["roots"]], [PACK])
        self.assertNotIn(str(CHEST), s["containers"])
        self.assertEqual([i["serial"] for i in s["items"]], [RING2])
        self.assertNotIn("house", s)
        self.assertIn("Scan stopped. Chests it had not finished keep what Pack Rat knew.", w.messages)

    def test_stop_while_a_root_opens_writes_the_finished_roots_and_not_that_one(self):
        w = World(); home(w)
        api = tazuo_api(w, PACK)
        opener = w.open

        def open_then_stop(serial):
            if serial == CHEST:
                api.StopRequested = True
            return opener(serial)
        api.UseObject = lambda s, *a: open_then_stop(int(s))
        w.multis = house_tiles(5, 5, 12, 12)
        run_script(self.SCRIPT, w, api=api)
        self.only_the_pack(w)

    def test_stop_before_any_root_is_finished_writes_nothing(self):
        w = World(); home(w)
        api = tazuo_api(w, PACK)
        opener = w.open
        api.UseObject = lambda s, *a: (setattr(api, "StopRequested", True), opener(int(s)))[1]
        run_script(self.SCRIPT, w, api=api)
        self.assertEqual(self.scans("tazuo"), [])
        self.assertIn("Pack Rat scan stopped — nothing written.", w.messages)

    def test_a_stop_that_interrupts_a_pause_inside_a_root_still_writes_the_finished_roots(self):
        w = World(); home(w)
        api = tazuo_api(w, PACK)
        pause = api.Pause

        def interrupted(sec):
            if any(c == ("open", CHEST) for c in w.calls):
                api.StopRequested = True
                raise RuntimeError("Thread interrupted")   # what the client's Stop does to a blocking call
            pause(sec)
        api.Pause = interrupted
        run_script(self.SCRIPT, w, api=api)
        self.only_the_pack(w)

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
        self.only_the_pack(w)
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
        self.only_the_pack(w)
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

    def test_on_a_build_without_the_tooltip_timeout_a_trash_container_is_still_known_by_its_tooltip(self):
        self.trash_scan(True, no_timeout=True)

    def trash_scan(self, cached, no_timeout=False):
        w = World(); home(w); trash(w, cached); w.no_tooltip_timeout = no_timeout
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

    def test_a_multi_call_that_raises_reads_as_no_house_and_the_pack_is_still_scanned(self):
        w = World(); home(w); w.multis = house_tiles(5, 5, 12, 12)
        api = tazuo_api(w, PACK)
        def broken(*a):
            raise RuntimeError("in the stub, not in this build")
        api.GetMultisInArea = broken
        run_script(self.SCRIPT, w, api=api)
        [s] = self.scans("tazuo")
        self.assertNotIn("house", s)
        self.assertEqual([r["serial"] for r in s["roots"]], [PACK], "no claimed house can be found, so no ground container is opened")

    def test_furniture_inside_the_house_is_recorded_and_containers_are_not(self):
        w = World(); home(w); w.multis = house_tiles(5, 5, 12, 12)
        w.add(0x40000040, 0, name="table", container_like=False, X=12, Y=12, Z=7)
        w.items[0x40000040].Graphic = 0x0B34
        w.add(0x40000041, 0, name="statue", container_like=False, X=17, Y=17, Z=7)   # in reach, outside the footprint
        self.scan(w)
        [s] = self.scans("tazuo")
        self.assertEqual(s["house"]["items"], [[0x40000040, 0x0B34, 12, 12, 7]], "the chest beside the player is a root, not furniture")

    def test_only_the_item_nearest_the_centre_is_dropped_as_the_house_itself(self):
        def run(extra):
            w = World(); home(w); w.multis = house_tiles(5, 5, 12, 12)
            for serial, graphic, x, y in extra:
                w.add(serial, 0, name="x", container_like=False, X=x, Y=y, Z=7)
                w.items[serial].Graphic = graphic
            self.scan(w)
            return [r[0] for r in self.scans("tazuo")[-1]["house"]["items"]]
        # footprint x/y 5..16, centre 10.5; the multi at the centre goes, a telescope piece and a stool stay
        self.assertEqual(run([(0x40000040, 0x147B, 10, 10), (0x40000041, 0x147B, 6, 14), (0x40000042, 0x0A2A, 12, 12)]), [0x40000041, 0x40000042])
        self.assertEqual(run([(0x40000041, 0x147B, 6, 14)]), [0x40000041], "a lone in-range item far from the centre is a telescope, not the house")
        self.assertEqual(run([(0x40000041, 0x147B, 12, 12)]), [], "one or two tiles off the centre is still the house")
        self.assertEqual(run([(0x40000051, 0x147B, 11, 11), (0x40000050, 0x147B, 10, 10)]), [0x40000051], "a tie drops the lower serial, whatever the order")

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
        self.assertIn("  house: 144 tiles, 0 pieces of furniture, 2 containers", w.messages)

    def test_a_trash_barrel_the_scan_knew_only_by_its_tooltip_is_not_in_the_houses_chest_list(self):
        w = World(); home(w); w.multis = house_tiles(5, 5, 12, 12); trash(w, cached=True)
        self.scan(w)
        [s] = self.scans("tazuo")
        serials = [c[0] for c in s["house"]["containers"]]
        self.assertNotIn(TRASH_BARREL, serials, "the client calls it just \"barrel\"; the roots pass learnt it is trash")
        self.assertIn(BARREL, serials)

    def test_the_trash_containers_the_roots_pass_skipped_are_listed_in_the_house_so_a_later_far_capture_can_leave_them_out(self):
        w = World(); home(w); w.multis = house_tiles(5, 5, 12, 12); trash(w, cached=True)
        self.scan(w)
        [s] = self.scans("tazuo")
        self.assertEqual(s["house"]["trash"], sorted([TRASH_BARREL, TRASH_CHEST]))

    def test_a_house_without_trash_has_no_trash_list_and_trash_without_a_house_records_nothing(self):
        w = World(); home(w); w.multis = house_tiles(5, 5, 12, 12)
        self.scan(w)
        self.assertNotIn("trash", self.scans("tazuo")[-1]["house"])
        shutil.rmtree(os.path.join(self.data, "inbox"))
        w = World(); home(w); w.multis = None; trash(w)
        self.scan(w)
        [s] = self.scans("tazuo")
        self.assertNotIn("house", s)
        self.assertNotIn("trash", s)

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
        self.assertIn("  house: 144 tiles, 5000 pieces of furniture (1 farther one left out), 1 container", w.messages)

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
        self.assertIn("  house: 144 tiles, furniture and containers not read", w.messages)

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

    def moving_scan(self, when, to=None, facet=None):
        """A scan inside a house with two chests in reach, where the player is put at `to` and on
        `facet` as chest `when` is opened; returns the scan and the world."""
        w = World(); home(w); w.facet = 1
        w.multis = house_tiles(5, 5, 12, 12)
        w.add(CHEST2, 0, name="Wooden Chest", X=10, Y=11)
        w.add(RING + 0x30, CHEST2, name="Pearl Ring", container_like=False, OnGround=False)
        api = tazuo_api(w, PACK)
        opener = w.open

        def open_then_move(serial):
            if serial == when:
                w.px, w.py = to or (w.px, w.py)
                w.facet = facet or w.facet
            return opener(serial)
        api.UseObject = lambda s, *a: open_then_move(int(s))
        run_script(self.SCRIPT, w, api=api)
        [s] = self.scans("tazuo")
        return s, w

    def test_moving_away_stops_the_scan_keeps_the_finished_roots_and_writes_no_house(self):
        moved = "You moved away, so the scan stopped. Run it again from where you started."
        s, w = self.moving_scan(CHEST, to=(400, 900))
        self.assertEqual([r["serial"] for r in s["roots"]], [PACK], "the root the player left while it was read, and the ones never reached, are left out")
        self.assertNotIn(str(CHEST), s["containers"])
        self.assertEqual([i["serial"] for i in s["items"]], [RING2])
        self.assertNotIn(CHEST2, self.opened(w))
        self.assertNotIn("house", s)
        self.assertIn(moved, w.messages)
        with self.subTest("a facet change on the last root"):
            shutil.rmtree(os.path.join(self.data, "inbox"), ignore_errors=True)
            s, w = self.moving_scan(CHEST2, facet=4)
            self.assertEqual([r["serial"] for r in s["roots"]], [PACK, CHEST])
            self.assertNotIn("house", s, "the house is captured from where the player stands now")
            self.assertIn(moved, w.messages)
        with self.subTest("a few steps"):
            shutil.rmtree(os.path.join(self.data, "inbox"), ignore_errors=True)
            s, w = self.moving_scan(CHEST, to=(16, 12))
            self.assertEqual(len(s["roots"]), 3)
            self.assertIn("house", s)
            self.assertNotIn(moved, w.messages)

    def test_late_tooltips_are_waited_for_and_re_asked_for_only_while_missing(self):
        w = World(); home(w)
        late = [RING + 0x40 + i for i in range(6)]
        for i, r in enumerate(late):
            w.add(r, CHEST, name="", Tooltip=f"Ring {i}", container_like=False, OnGround=False)
        w.late_tooltips = dict((r, 1.0 + 0.25 * i) for i, r in enumerate(late))
        self.scan(w)
        [s] = self.scans("tazuo")
        self.assertEqual(sorted(i["name"] for i in s["items"] if i["serial"] in late), [f"Ring {i}" for i in range(6)])
        asked = [c[1] for c in w.calls if c[0] == "opl"]
        chest_asks = [a for a in asked if set(a) & set(late)]
        self.assertIn(RING, chest_asks[0])
        self.assertTrue(all(set(a) <= set(late) for a in chest_asks[1:]), "a re-ask names only the missing items")
        self.assertEqual(len(chest_asks[-1]), 1)
        self.assertFalse(any("without a tooltip" in m for m in w.messages))

    def test_a_recall_mid_chest_with_100_tooltips_missing_ends_within_the_cap(self):
        w = World(); home(w)
        rings = [RING + 0x100 + i for i in range(100)]
        for r in rings:
            w.add(r, CHEST, name="", Tooltip="Ring", container_like=False, OnGround=False)
        w.late_tooltips = dict((r, None) for r in rings)
        api = tazuo_api(w, PACK)
        opener = w.open
        api.UseObject = lambda s, *a: (setattr(w, "px", 900) if int(s) == CHEST else None, opener(int(s)))[1]
        t0 = w.clock.now
        run_script(self.SCRIPT, w, api=api)
        [s] = self.scans("tazuo")
        # Three containers opened (1.2 s each), the backpack's first look (0.5 s) and the chest's whole wait (8 s at most).
        self.assertLess(w.clock.now - t0, 3 * 1.2 + 0.5 + 8 + 0.5)
        self.assertEqual([r["serial"] for r in s["roots"]], [PACK])
        self.assertFalse(any("without a tooltip" in m for m in w.messages))

    def test_the_without_a_tooltip_count_leaves_out_a_root_the_scan_then_dropped(self):
        w = World(); home(w)
        w.add(RING + 0x40, CHEST, name="", Tooltip="Ring", container_like=False, OnGround=False)
        w.late_tooltips = {RING + 0x40: None}
        api = tazuo_api(w, PACK)
        opener = w.open
        api.UseObject = lambda s, *a: (setattr(w, "px", 900) if int(s) == CHEST else None, opener(int(s)))[1]
        run_script(self.SCRIPT, w, api=api)
        [s] = self.scans("tazuo")
        self.assertEqual([r["serial"] for r in s["roots"]], [PACK])
        self.assertFalse(any("without a tooltip" in m for m in w.messages))

    def test_tooltips_that_never_arrive_are_waited_for_a_bounded_time(self):
        for never, opened in ((1, True), (5, False)):
            with self.subTest(never=never):
                shutil.rmtree(os.path.join(self.data, "inbox"), ignore_errors=True)
                w = World(); home(w)
                rings = [RING + 0x40 + i for i in range(6)]
                for r in rings:
                    w.add(r, CHEST, name="", Tooltip="Ring", container_like=False, OnGround=False)
                w.late_tooltips = dict((r, None) for r in rings[:never])
                t0 = w.clock.now
                self.scan(w)
                [s] = self.scans("tazuo")
                self.assertLess(w.clock.now - t0, 10, "a root waits at most 2 s plus 30 ms an item, never the client's own 10 s a tooltip")
                self.assertEqual(self.root(s, CHEST)["opened"], opened)
                ids = [i["serial"] for i in s["items"]]
                if opened:
                    self.assertTrue(set(rings) <= set(ids))
                    self.assertIn("  1 item recorded without a tooltip (it did not arrive in time)", w.messages)
                else:
                    self.assertFalse(set(rings) & set(ids), "a root mostly without tooltips is kept from the last scan")
                    self.assertNotIn(str(CHEST), s["containers"])


class TazUORefresh(DataDir, unittest.TestCase):
    SCRIPT = adapter_path("tazuo", "packrat-character-refresh.py")

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

    def setUp(self):
        super().setUp()
        self.claim()

    def house(self, w):
        """Run the house map refresh with a client that records every tooltip and OPL request."""
        api = tazuo_api(w, PACK)
        asked = []
        names = api.ItemNameAndProps
        api.ItemNameAndProps = lambda s, b=False: (asked.append(("tooltip", int(s))), names(s, b))[1]
        api.RequestOPLData = lambda serials: asked.append(("opl", list(serials)))
        run_script(self.SCRIPT, w, api=api)
        return asked

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
        self.assertEqual(w.messages, ["Pack Rat house map refresh (Tester) -> %s: 144 tiles, 1 pieces of furniture, 2 containers" % os.path.basename(files[0])])

    def test_only_a_claimed_house_is_captured(self):
        for name, claim, multis, written in (
                ("a house customized since it was claimed: its footprint overlaps the claim", (5, 5, 16, 16), house_tiles(3, 7, 10, 12), True),
                ("an unclaimed house", (40, 40, 50, 50), house_tiles(5, 5, 12, 12), False)):
            with self.subTest(name):
                shutil.rmtree(os.path.join(self.data, "inbox"), ignore_errors=True)
                self.claim(claim, facets=[1])
                w = World(); home(w); w.facet = 1; w.multis = multis
                asked = self.house(w)
                self.assertEqual(len(self.scans("tazuo")), 1 if written else 0)
                self.assertEqual(asked, [], "finding the house asks the server nothing")
                if not written:
                    self.assertEqual(w.messages, ["Not in one of your houses, so nothing was refreshed. Use Claim this house in the Pack Rat panel if this house is yours."])

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
        self.assertTrue(w.messages[0].endswith(": 144 tiles, furniture and containers not read"), w.messages)

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

    def test_a_worn_piece_is_recorded_on_its_own_layer(self):
        """Also the world adapters/razor-enhanced/fixture.scan.json is made from (adapter-guide.md, Fixture rules)."""
        w = World(); home(w); w.facet = 1
        w.items[CHEST].Tooltip = "Wooden Chest\nContents: 1/125 Items, 3 Stones"
        w.add(0x40000020, PLAYER, name="Katana", Layer="RightHand", container_like=False, Graphic=0x13FF, OnGround=False,
              Tooltip="Katana\nSwordsmanship\nWeapon Damage 10 - 14\nCrafted By Tester")
        w.add(0x40000021, PLAYER, name="Armor Of Initiation", Layer="Arms", container_like=False, Graphic=0x13CD, OnGround=False,
              Tooltip="Armor Of Initiation\nPart Of An Armor Set (6 Pieces)\nPhysical Resist 7%\nDurability 123 / 150"
                      "\n<br>Only When Full Set Is Present:\nPhysical Resist +2%")
        self.scan(w, skills={"Swords": 90.0, "Magic Resist": 80.0})
        [s] = self.scans("razor-enhanced")
        self.assertEqual([(e["serial"], e["layer"], e["container"]) for e in s["equipped"]],
                         [(0x40000020, "RightHand", None), (0x40000021, "Arms", None)])
        self.assertEqual(s["equipped"][1]["tooltip"][-2:], ["<br>Only When Full Set Is Present:", "Physical Resist +2%"])

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
    SCRIPT = adapter_path("razor-enhanced", "packrat-character-refresh.py")

    def refresh(self, world):
        run_script(self.SCRIPT, world, extra_globals=razor_globals(world, PACK))

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
        self.assertEqual(w.messages.count("Pack Rat: canceled, nothing blacklisted."), 2)


if __name__ == "__main__":
    unittest.main()
