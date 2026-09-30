"""test_bridges.py -- both bridges' main() loops run end to end against a fake client
(fake_clients.py): lines appear in the queue file while the bridge runs, the fake clock moves only
when the script pauses, and the test reads back what the bridge did in the world and wrote to its
status file. Covers what the pure-block tests in test_adapters.py cannot reach: the heartbeat during
long actions, refusals reaching the page under the command's own id, and the container chain checks
that decide what may be double-clicked.

Run: python3 adapters/test_bridges.py  (app/adapters.test.mts also spawns it, so `npm test` does).
"""
import datetime, json, os, shutil, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fake_clients import PLAYER, STRANGER, World, adapter_path, razor_globals, run_script, tazuo_api  # noqa: E402

PACK, POUCH, CHEST, BAG, FAR = 0x40000001, 0x40000002, 0x40000003, 0x40000004, 0x40000005
RING, AMULET, BRACELET, FAR_RING = 0x40000010, 0x40000011, 0x40000012, 0x40000013
OTHER_CHEST, OTHER_BAG, STRANGER_PACK, STRANGER_RING = 0x40000020, 0x40000021, 0x40000030, 0x40000031
BOOK, RUNEBOOK, ARMOUR = 0x40000040, 0x40000041, 0x40000042
DEST, DEST_BAG, TRASH_BIN, CORPSE, LOOSE, STACK, OTHER_GEM, EMPTY = (0x40000050, 0x40000051, 0x40000052, 0x40000053,
                                                                      0x40000054, 0x40000055, 0x40000056, 0x40000057)
RUN_S = 120                      # every scenario stops the bridge after this many fake seconds


def home():
    """Backpack (worn, so its X/Y say nothing about where the player is) holding a pouch holding a
    ring; a chest in reach holding a bag with two pieces; a chest 10 tiles off; a second chest with
    its own bag; a stranger standing nearby with a ring in his pack."""
    w = World()
    w.add(PACK, PLAYER, name="Backpack", OnGround=False, X=0, Y=0, Opened=True)
    w.add(POUCH, PACK, name="Pouch", OnGround=False, X=0, Y=0)
    w.add(RING, POUCH, name="Ring", container_like=False, OnGround=False)
    w.add(CHEST, 0, name="Wooden Chest", X=11, Y=10)
    w.add(BAG, CHEST, name="Bag", OnGround=False)
    for s in (AMULET, BRACELET):
        w.add(s, BAG, name="Jewel", container_like=False, OnGround=False)
    w.add(FAR, 0, name="Far Chest", X=20, Y=10)
    w.add(FAR_RING, FAR, name="Ring", container_like=False, OnGround=False)
    w.add(OTHER_CHEST, 0, name="Other Chest", X=9, Y=10, Opened=True)
    w.add(OTHER_BAG, OTHER_CHEST, name="Bag", OnGround=False)
    w.add(STRANGER_PACK, STRANGER, name="Backpack", OnGround=False, X=0, Y=0)
    w.add(STRANGER_RING, STRANGER_PACK, name="Ring", container_like=False, OnGround=False)
    w.add(BOOK, PACK, name="Mysticism Spellbook", Graphic=0x2D9D, OnGround=False)
    w.add(RUNEBOOK, PACK, name="Runebook", Graphic=0x22C5, OnGround=False)
    w.add(ARMOUR, PACK, name="Gargish Stone Chest", container_like=False, Graphic=0x1415, Wearable=True, OnGround=False)
    return w


def trip_home():
    """home() plus what Organize needs: a destination chest in reach with a bag in it, a trash barrel,
    a corpse, and a ring loose in the backpack that no trip ever took (same graphic as the jewels)."""
    w = home()
    w.add(DEST, 0, name="Metal Chest", X=11, Y=11)
    w.add(DEST_BAG, DEST, name="Bag", OnGround=False)
    w.add(TRASH_BIN, 0, name="barrel", Tooltip="A Trash Barrel", Graphic=0x0E77, X=9, Y=11)
    w.add(CORPSE, 0, name="a corpse", Graphic=0x2006, IsCorpse=True, X=9, Y=9)
    w.add(LOOSE, PACK, name="Ring", container_like=False, OnGround=False)
    return w


def stamp(epoch):
    return datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


class BridgeCase(object):
    ADAPTER = None

    def setUp(self):
        self.data = tempfile.mkdtemp()
        self.prev = os.environ.get("PACKRAT_DATA")
        os.environ["PACKRAT_DATA"] = self.data
        self.dir = os.path.join(self.data, "bridge", self.ADAPTER)

    def tearDown(self):
        if self.prev is None:
            os.environ.pop("PACKRAT_DATA", None)
        else:
            os.environ["PACKRAT_DATA"] = self.prev
        shutil.rmtree(self.data, ignore_errors=True)

    def cmd(self, cid, action, serial, chain, age_s=0, **kw):
        c = {"id": cid, "action": action, "serial": serial, "name": "piece " + cid, "chain": chain,
             "pos": None, "age_s": age_s}
        c.update(kw)
        return c

    def enqueue_at(self, world, at_s, cmds):
        """Append `cmds` to the queue `at_s` fake seconds in, each stamped `age_s` before then."""
        def enqueue():
            with open(os.path.join(self.dir, "queue.jsonl"), "a", encoding="utf-8") as f:
                for c in cmds:
                    c = dict(c)
                    c["queuedAt"] = stamp(world.clock.now - c.pop("age_s"))
                    f.write(json.dumps(c) + "\n")
        world.clock.at(at_s, enqueue)

    def run_bridge(self, world, at_s, cmds):
        """Start the bridge, append `cmds` to its queue `at_s` fake seconds in, stop it at RUN_S.
        Returns (final status, [(fake second, status) for every status write seen])."""
        status_path = os.path.join(self.dir, "status.json")
        writes = []
        real_replace = os.replace

        def replace(src, dst):
            # Every status write goes through write_json_atomic's os.replace: note the fake time of each.
            if os.path.basename(dst) == "status.json":
                with open(src, encoding="utf-8") as f:
                    writes.append((world.clock.now - world.clock.start, json.load(f)))
            real_replace(src, dst)

        self.enqueue_at(world, at_s, cmds)
        os.replace = replace
        try:
            self.start(world)
        finally:
            os.replace = real_replace
        with open(status_path, encoding="utf-8") as f:
            return json.load(f), writes

    def opened(self, world):
        return [c[1] for c in world.calls if c[0] == "open"]

    def moved(self, world):
        return [c[1] for c in world.calls if c[0] == "move"]

    # ---- the heartbeat -------------------------------------------------------------------------

    def assert_heartbeat(self, writes):
        """While a command is running, `alive` is rewritten at least every 3 fake seconds (the page
        calls the bridge offline once it is 8 old)."""
        busy = [(t, s) for t, s in writes if s.get("current")]
        self.assertTrue(busy, "no status write ever showed a command running")
        times = [t for t, _ in writes]
        start, end = busy[0][0], [t for t, s in writes if t > busy[0][0] and not s.get("current")][0]
        inside = [t for t in times if start <= t <= end]
        gaps = [b - a for a, b in zip(inside, inside[1:])]
        self.assertLessEqual(max(gaps), 3.0, "status went %.1f s without a heartbeat" % max(gaps))

    def test_the_heartbeat_continues_through_a_highlight(self):
        w = home()
        final, writes = self.run_bridge(w, 1, [self.cmd("h1", "highlight", AMULET, [CHEST, BAG])])
        self.assertTrue(final["results"]["h1"]["ok"], final["results"]["h1"])
        self.assert_heartbeat(writes)

    def test_the_heartbeat_continues_through_a_walk_that_never_arrives(self):
        w = home(); w.no_path = True
        final, writes = self.run_bridge(w, 1, [self.cmd("g1", "goto", FAR_RING, [FAR], pos={"x": 20, "y": 10, "z": 0})])
        self.assertFalse(final["results"]["g1"]["ok"])
        self.assert_heartbeat(writes)

    def test_a_ground_container_highlighted_as_itself_is_marked_without_a_walk_or_an_open(self):
        # The Containers view's Highlight in game (issue #10): the container is the serial, its chain empty.
        # The far chest is in view but out of reach, so a highlight that walked or opened would show here.
        w = home()
        final, _ = self.run_bridge(w, 1, [self.cmd("c1", "highlight", FAR, [], pos={"x": 20, "y": 10, "z": 0})])
        self.assertTrue(final["results"]["c1"]["ok"], final["results"]["c1"])
        self.assertEqual([c for c in w.calls if c[0] in ("walk", "open")], [])
        self.assertEqual({c[1] for c in w.calls if c[0] in ("headmsg", "color") and c[1] is not None}, {FAR})
        self.assert_marked_then_cleared(w, FAR, 20, 10)

    def test_a_highlight_cut_short_still_clears_its_mark(self):
        # An exception out of the pause: an error, or a Razor Enhanced Stop that aborts the script's thread.
        w = home()

        def interrupt():
            raise RuntimeError("interrupted")
        w.clock.at(4, interrupt)
        final, _ = self.run_bridge(w, 1, [self.cmd("c1", "highlight", CHEST, [], pos={"x": 11, "y": 10, "z": 0})])
        self.assertFalse(final["results"]["c1"]["ok"])
        self.assert_marked_then_cleared(w, CHEST, 11, 10)

    def test_a_ground_container_out_of_view_is_refused_with_a_reason(self):
        w = home()
        final, _ = self.run_bridge(w, 1, [self.cmd("c1", "highlight", 0x40000099, [], pos={"x": 11, "y": 10, "z": 0})])
        self.assertFalse(final["results"]["c1"]["ok"])
        self.assertIn("not in view", final["results"]["c1"]["msg"])
        self.assertEqual([c for c in w.calls if c[0] in ("walk", "open")], [])

    # ---- own backpack / bank ---------------------------------------------------------------------

    def test_a_grab_from_a_bag_in_the_backpack_needs_no_walk(self):
        w = home()
        final, _ = self.run_bridge(w, 1, [self.cmd("b1", "grab", RING, [PACK, POUCH])])
        self.assertTrue(final["results"]["b1"]["ok"], final["results"]["b1"])
        self.assertEqual([c for c in w.calls if c[0] == "walk"], [])
        self.assertEqual(self.moved(w), [RING])

    # ---- the chain -------------------------------------------------------------------------------

    def test_a_grab_all_from_one_bag_is_never_refused_by_the_chain_check(self):
        w = home()
        cmds = [self.cmd("a%d" % i, "grab", s, [CHEST, BAG]) for i, s in enumerate((AMULET, BRACELET))]
        cmds.append(self.cmd("a9", "grab", RING, [PACK, POUCH]))
        final, _ = self.run_bridge(w, 1, cmds)
        for c in cmds:
            self.assertTrue(final["results"][c["id"]]["ok"], final["results"][c["id"]])
        self.assertEqual(sorted(self.moved(w)), sorted([AMULET, BRACELET, RING]))

    def test_a_stranger_named_after_a_chest_in_the_chain_is_never_opened(self):
        w = home()
        final, _ = self.run_bridge(w, 1, [self.cmd("s1", "grab", STRANGER_RING, [CHEST, STRANGER_PACK])])
        self.assertFalse(final["results"]["s1"]["ok"])
        self.assertNotIn(STRANGER_PACK, self.opened(w))
        self.assertEqual(self.moved(w), [])

    def test_a_strangers_pack_as_the_root_is_never_opened(self):
        w = home()
        final, _ = self.run_bridge(w, 1, [self.cmd("s2", "highlight", STRANGER_RING, [STRANGER_PACK])])
        self.assertFalse(final["results"]["s2"]["ok"])
        self.assertIn("refused", final["results"]["s2"]["msg"])
        self.assertNotIn(STRANGER_PACK, self.opened(w))

    def test_a_chain_whose_entries_do_not_nest_is_refused_before_the_stray_bag_opens(self):
        w = home()
        final, _ = self.run_bridge(w, 1, [self.cmd("n1", "highlight", AMULET, [CHEST, OTHER_BAG])])
        self.assertFalse(final["results"]["n1"]["ok"])
        self.assertNotIn(OTHER_BAG, self.opened(w))

    def test_a_book_or_a_piece_of_armour_in_the_chain_is_refused_and_never_opened(self):
        w = home()
        cmds = [self.cmd("k%d" % i, "highlight", RING, [PACK, s]) for i, s in enumerate((BOOK, RUNEBOOK, ARMOUR))]
        final, _ = self.run_bridge(w, 1, cmds)
        for c in cmds:
            self.assertFalse(final["results"][c["id"]]["ok"], final["results"][c["id"]])
        self.assertEqual([s for s in self.opened(w) if s in (BOOK, RUNEBOOK, ARMOUR)], [])

    # ---- refusals reach the page --------------------------------------------------------------------

    def test_an_expired_command_is_recorded_under_its_own_id_with_the_reason(self):
        w = home()
        final, _ = self.run_bridge(w, 1, [self.cmd("old", "grab", AMULET, [CHEST, BAG], age_s=90)])
        self.assertFalse(final["results"]["old"]["ok"])
        self.assertIn("expired", final["results"]["old"]["msg"])
        self.assertEqual(self.moved(w), [])

    def test_a_deleted_queue_file_reads_as_empty_and_the_next_command_still_runs(self):
        w = home()
        w.clock.at(0.5, lambda: os.remove(os.path.join(self.dir, "queue.jsonl")))
        final, _ = self.run_bridge(w, 5, [self.cmd("q1", "grab", RING, [PACK, POUCH])])
        self.assertTrue(final["results"]["q1"]["ok"], final["results"]["q1"])
        self.assertEqual([m for m in w.messages if "queue read failed" in m], [])

    def test_the_newest_results_survive_the_trim_whatever_order_the_dict_keeps(self):
        """Issue #140: the client's Python keeps a dict in hash order, so a trim by dict order dropped
        the newest result. A dict that iterates newest first stands in for it."""
        class NewestFirst(dict):
            def __iter__(self):
                return iter(list(dict.keys(self))[::-1])

            def keys(self):
                return list(self.__iter__())

            def items(self):
                return [(k, self[k]) for k in self.__iter__()]

        def scramble():
            f = sys._getframe()
            while f is not None and "record" not in f.f_globals:
                f = f.f_back
            f.f_globals["results"] = NewestFirst(f.f_globals["results"])

        w = home()
        w.clock.at(0.2, scramble)
        ids = ["e%02d" % i for i in range(35)]
        final, _ = self.run_bridge(w, 1, [self.cmd(i, "grab", AMULET, [CHEST, BAG], age_s=90) for i in ids])
        self.assertEqual(sorted(final["results"]), ids[-30:])

    def test_a_duplicate_line_in_one_read_runs_once(self):
        w = home()
        c = self.cmd("d1", "grab", AMULET, [CHEST, BAG])
        self.run_bridge(w, 1, [c, c])
        self.assertEqual(self.moved(w), [AMULET])

    # ---- the stop marker ---------------------------------------------------------------------------

    def test_a_stop_that_interrupts_a_pause_still_marks_the_status_stopped_and_the_next_start_clears_it(self):
        """The client's Stop interrupts the script at its next pause, so nothing after the main loop
        runs: the stopped marker must come from a finally, or the installer waits out the heartbeat."""
        class Interrupted(Exception):
            pass

        def interrupt():
            raise Interrupted()

        w = home()
        w.clock.at(5, interrupt)
        with self.assertRaises(Interrupted):
            self.run_bridge(w, 60, [])
        with open(os.path.join(self.dir, "status.json"), encoding="utf-8") as f:
            self.assertIs(json.load(f).get("stopped"), True)
        final, writes = self.run_bridge(home(), 1, [])
        self.assertNotIn("stopped", writes[0][1], "a running bridge's heartbeat never says stopped")
        self.assertIs(final.get("stopped"), True, "and an ordinary stop says it again")

    def test_a_stop_that_breaks_the_client_still_writes_the_marker_and_every_queued_result(self):
        """After the interrupt any client call may fail; the name, the messages and each queued
        command's result are guarded one by one so none of them costs the stopped marker."""
        class Interrupted(Exception):
            pass

        def interrupt():
            self.break_client(w)
            raise Interrupted()

        w = home()
        w.clock.at(3, interrupt)
        ids = ["h%d" % i for i in range(6)]
        with self.assertRaises(Exception):
            self.run_bridge(w, 1, [self.cmd(i, "highlight", AMULET, [CHEST, BAG]) for i in ids])
        with open(os.path.join(self.dir, "status.json"), encoding="utf-8") as f:
            final = json.load(f)
        self.assertIs(final.get("stopped"), True)
        self.assertEqual(final["character"], "Tester")
        self.assertEqual(sorted(final["results"]), ids)
        self.assertGreaterEqual([r["msg"] for r in final["results"].values()].count(
            "not run — the bridge stopped first" if self.ADAPTER == "tazuo" else "not run -- the bridge stopped first"), 2)


class TazUOBridge(BridgeCase, unittest.TestCase):
    ADAPTER = "tazuo"

    def break_client(self, world):
        def fail(*a):
            raise RuntimeError("client gone")
        world.api.SysMsg = fail
        world.api.Player = None                  # every API.Player read fails

    def start(self, world):
        api = world.api = tazuo_api(world, PACK)
        if getattr(self, "drop_cancel", False):
            del api.CancelPathfinding
        world.clock.at(RUN_S, lambda: setattr(api, "StopRequested", True))
        run_script(adapter_path("tazuo", "packrat-bridge.py"), world, api=api)

    def assert_marked_then_cleared(self, world, serial, x, y):
        """The chest's live tile marked once, and the same tile cleared after it."""
        self.assertEqual([c for c in world.calls if c[0] in ("mark", "unmark")], [("mark", x, y), ("unmark", x, y)])

    def test_a_ground_container_is_marked_where_the_client_sees_it_not_where_it_was_scanned(self):
        w = home()
        self.run_bridge(w, 1, [self.cmd("c1", "highlight", CHEST, [], pos={"x": 30, "y": 30, "z": 0})])
        self.assert_marked_then_cleared(w, CHEST, 11, 10)

    def trip(self, cid, takes=(), puts=(), index=3, age_s=0):
        """One trip line as app/bridge-trip.mts writes it. Every root is placed on the player's tile:
        walk_to prefers the live item's own position whenever the client knows it."""
        roots = {}
        for _, path in list(takes) + list(puts):
            roots[str(path[0])] = {"x": 10, "y": 10, "z": 0}
        return {"id": cid, "action": "trip", "index": index, "stamp": "2026-09-28T12:00:00.000Z", "roots": roots,
                "takes": [{"serial": s, "name": "piece %x" % s, "chain": list(c)} for s, c in takes],
                "puts": [{"serial": s, "name": "piece %x" % s, "dest": list(d)} for s, d in puts],
                "age_s": age_s}

    def stop_flag(self):
        return os.path.join(self.data, "bridge", "stop")

    def press_stop(self, world, ago_s=0):
        """Organize's Stop, `ago_s` fake seconds before now: the bridge compares the flag's mtime with
        a trip's queuedAt, both on the fake clock here."""
        open(self.stop_flag(), "w").close()
        t = world.clock.now - ago_s
        os.utime(self.stop_flag(), (t, t))

    def steps(self, final, cid):
        return [(s["op"], s["serial"], s["ok"]) for s in final["results"][cid]["steps"]]

    def moves(self, world):
        return [(c[1], c[2]) for c in world.calls if c[0] == "move"]

    def test_a_trip_takes_then_puts_and_reports_every_step(self):
        w = trip_home()
        final, writes = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG]), (BRACELET, [CHEST, BAG])],
                                                         puts=[(AMULET, [DEST, DEST_BAG]), (BRACELET, [DEST, DEST_BAG])])])
        r = final["results"]["t1"]
        self.assertTrue(r["ok"], r)
        self.assertEqual((r["partial"], r["stopped"]), (False, False))
        self.assertEqual(self.steps(final, "t1"), [("take", AMULET, True), ("take", BRACELET, True),
                                                   ("put", AMULET, True), ("put", BRACELET, True)])
        self.assertEqual(sorted(set(k for s in r["steps"] for k in s)), ["ms", "msg", "ok", "op", "serial"])
        for s in r["steps"]:
            self.assertIs(type(s["ms"]), int)
        self.assertIs(type(r["ms"]), int)
        self.assertGreaterEqual(r["ms"], sum(s["ms"] for s in r["steps"]))
        self.assertEqual(self.moves(w), [(AMULET, PACK), (BRACELET, PACK), (AMULET, DEST_BAG), (BRACELET, DEST_BAG)])
        self.assertIn("Pack Rat organize: trip 3, 2 items", w.messages)
        self.assert_heartbeat(writes)

    def test_a_trip_opens_each_container_once_and_the_next_trip_opens_it_again(self):
        w = trip_home()
        w.add(OTHER_GEM, BAG, name="Jewel", container_like=False, OnGround=False)
        final, _ = self.run_bridge(w, 1, [
            self.trip("t1", takes=[(AMULET, [CHEST, BAG]), (BRACELET, [CHEST, BAG])],
                      puts=[(AMULET, [DEST, DEST_BAG]), (BRACELET, [DEST, DEST_BAG])]),
            self.trip("t2", takes=[(OTHER_GEM, [CHEST, BAG])], puts=[(OTHER_GEM, [DEST, DEST_BAG])], index=4)])
        for cid in ("t1", "t2"):
            self.assertTrue(final["results"][cid]["ok"], final["results"][cid])
        opened = self.opened(w)
        self.assertEqual([opened.count(s) for s in (CHEST, BAG, DEST, DEST_BAG)], [2, 2, 2, 2])

    def test_a_walk_during_a_trip_opens_the_containers_again(self):
        w = trip_home()
        w.add(OTHER_GEM, BAG, name="Jewel", container_like=False, OnGround=False)
        final, _ = self.run_bridge(w, 1, [
            self.trip("t1", takes=[(AMULET, [CHEST, BAG]), (FAR_RING, [FAR]), (OTHER_GEM, [CHEST, BAG])])])
        self.assertTrue(final["results"]["t1"]["ok"], final["results"]["t1"])
        self.assertEqual([c[1:] for c in w.calls if c[0] == "walk"], [(20, 10), (11, 10)])
        opened = self.opened(w)
        self.assertEqual([opened.count(s) for s in (CHEST, BAG)], [2, 2])

    def test_a_player_who_steps_by_hand_mid_trip_gets_the_containers_opened_again(self):
        w = trip_home()

        def step(s, dst):
            if (s, dst) == (AMULET, PACK):
                w.px = w.api.Player.X = 12           # the player steps a tile; the chest stays in reach
        w.on_move = step
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG]), (BRACELET, [CHEST, BAG])])])
        self.assertTrue(final["results"]["t1"]["ok"], final["results"]["t1"])
        self.assertEqual([c for c in w.calls if c[0] == "walk"], [])
        opened = self.opened(w)
        self.assertEqual([opened.count(s) for s in (CHEST, BAG)], [2, 2])

    def test_a_container_opened_earlier_in_the_trip_is_still_checked_on_every_step(self):
        w = trip_home()
        w.add(OTHER_GEM, BAG, name="Jewel", container_like=False, OnGround=False)

        def swap(s, dst):
            if (s, dst) == (AMULET, PACK):
                w.items[BAG].Container = OTHER_CHEST        # the bag moved to another chest mid-trip
            if (s, dst) == (BRACELET, DEST):
                w.items[DEST].Tooltip = "A Trash Barrel"    # and the destination turned out to be trash
        w.on_move = swap
        final, _ = self.run_bridge(w, 1, [
            self.trip("t1", takes=[(AMULET, [CHEST, BAG]), (OTHER_GEM, [CHEST, BAG])]),
            self.trip("t2", takes=[(BRACELET, [OTHER_CHEST, BAG])], index=4),
            self.trip("t3", puts=[(BRACELET, [DEST]), (AMULET, [DEST])], index=5)])
        self.assertEqual(self.steps(final, "t1"), [("take", AMULET, True), ("take", OTHER_GEM, False)])
        self.assertIn("is not inside", final["results"]["t1"]["steps"][1]["msg"])
        self.assertEqual(self.steps(final, "t3"), [("put", BRACELET, True), ("put", AMULET, False)])
        self.assertIn("trash", final["results"]["t3"]["steps"][1]["msg"])
        self.assertEqual(w.items[AMULET].Container, PACK)

    def move_times(self, w):
        """Record the fake second of every MoveItem call."""
        times = []
        w.on_move = lambda s, dst: times.append(w.clock.now)
        return times

    def test_a_move_that_lands_at_once_waits_only_the_minimum_gap_before_the_next(self):
        w = trip_home()
        times = self.move_times(w)
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG]), (BRACELET, [CHEST, BAG])],
                                                    puts=[(AMULET, [DEST]), (BRACELET, [DEST])])])
        self.assertTrue(final["results"]["t1"]["ok"], final["results"]["t1"])
        gaps = [b - a for a, b in zip(times, times[1:])]
        self.assertAlmostEqual(gaps[0], 0.35, places=3)    # second take: chest already open, first move landed at once
        self.assertAlmostEqual(gaps[2], 0.35, places=3)    # second put likewise
        self.assertLess(final["results"]["t1"]["steps"][1]["ms"], 500)

    def test_a_move_that_never_lands_is_reported_bounced_after_the_cap(self):
        w = trip_home()
        w.refuse = {DEST}
        times = self.move_times(w)
        final, writes = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])], puts=[(AMULET, [DEST])])])
        r = final["results"]["t1"]
        self.assertEqual(self.steps(final, "t1"), [("take", AMULET, True), ("put", AMULET, False)])
        self.assertIn("bounced", r["steps"][1]["msg"])
        done = [t for t, s in writes if "t1" in s.get("results", {})][0]
        self.assertGreaterEqual(done - (times[1] - w.clock.start), 1.5)
        self.assertLess(done - (times[1] - w.clock.start), 1.6)

    # ---- the wait after opening a container --------------------------------------------------------

    def open_and_move_times(self, w):
        """[(kind, serial, fake second)] for every UseObject and MoveItem, in order."""
        times, real_open = [], w.open

        def use(s):
            times.append(("open", s, w.clock.now))
            return real_open(s)
        w.open = use
        w.on_move = lambda s, dst: times.append(("move", s, w.clock.now))
        return times

    def gaps(self, times):
        return [b[2] - a[2] for a, b in zip(times, times[1:])]

    def test_an_open_whose_contents_arrive_at_once_waits_only_the_floor(self):
        w = trip_home()
        times = self.open_and_move_times(w)
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])])])
        self.assertTrue(final["results"]["t1"]["ok"], final["results"]["t1"])
        self.assertEqual([t[:2] for t in times], [("open", CHEST), ("open", BAG), ("move", AMULET)])
        for gap in self.gaps(times):
            self.assertAlmostEqual(gap, 0.6, places=3)

    def test_an_open_whose_contents_lag_waits_until_they_arrive(self):
        w = trip_home()
        w.open_lag = 0.8
        times = self.open_and_move_times(w)
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])])])
        self.assertTrue(final["results"]["t1"]["ok"], final["results"]["t1"])
        for gap in self.gaps(times):
            self.assertGreaterEqual(gap, 0.8)
            self.assertLess(gap, 0.86)

    def test_an_open_whose_contents_never_arrive_gives_up_at_the_cap(self):
        w = trip_home()
        w.add(OTHER_GEM, CHEST, name="Jewel", container_like=False, OnGround=False)
        w.open_lag = 30
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(OTHER_GEM, [CHEST])])])
        step = final["results"]["t1"]["steps"][0]
        self.assertFalse(step["ok"], step)
        self.assertGreaterEqual(step["ms"], 1000)
        self.assertLess(step["ms"], 1100)

    def test_a_client_without_a_readable_opened_waits_the_old_flat_second(self):
        for err in (AttributeError, RuntimeError):
            w = trip_home()
            w.opened_error = err
            times = self.open_and_move_times(w)
            final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])])])
            self.assertTrue(final["results"]["t1"]["ok"], (err, final["results"]["t1"]))
            for gap in self.gaps(times):
                self.assertGreaterEqual(gap, 1.0, err)
                self.assertLess(gap, 1.06, err)

    def test_an_empty_container_does_not_hold_up_a_put(self):
        w = trip_home()
        w.add(EMPTY, 0, name="Metal Chest", X=11, Y=11)
        times = self.open_and_move_times(w)
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])], puts=[(AMULET, [EMPTY])])])
        self.assertTrue(final["results"]["t1"]["ok"], final["results"]["t1"])
        opened = [t for t in times if t[:2] == ("open", EMPTY)][0]
        put = times[times.index(opened) + 1]
        self.assertEqual(put[:2], ("move", AMULET))
        self.assertAlmostEqual(put[2] - opened[2], 0.6, places=3)

    def test_a_take_drops_at_an_explicit_spot_so_a_stack_keeps_its_serial(self):
        w = trip_home()
        w.merges = True                          # LOOSE, in the pack, has the amulet's graphic and hue
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])])])
        self.assertTrue(final["results"]["t1"]["ok"], final["results"]["t1"])
        [call] = [c for c in w.calls if c[0] == "move"]
        self.assertEqual(call[1:], (AMULET, PACK, 0, 60, 90))
        self.assertEqual(w.items[AMULET].Container, PACK)

    def test_the_stop_flag_halts_a_trip_between_steps_and_one_queued_before_it_and_the_taken_item_can_still_be_put_away(self):
        w = trip_home()
        w.on_move = lambda s, dst: self.press_stop(w) if (s, dst) == (AMULET, PACK) else None
        self.enqueue_at(w, 60, [self.trip("t3", puts=[(AMULET, [DEST])], index=5)])
        final, _ = self.run_bridge(w, 1, [
            self.trip("t1", takes=[(AMULET, [CHEST, BAG]), (BRACELET, [CHEST, BAG])], puts=[(AMULET, [DEST]), (BRACELET, [DEST])]),
            self.trip("t2", puts=[(AMULET, [DEST])], index=4)])
        r = final["results"]["t1"]
        self.assertFalse(r["ok"])
        self.assertTrue(r["stopped"])
        self.assertEqual(self.steps(final, "t1"), [("take", AMULET, True)])
        # t2 was already waiting when Stop was pressed: it stops before its first step.
        self.assertTrue(final["results"]["t2"]["stopped"], final["results"]["t2"])
        self.assertEqual(self.steps(final, "t2"), [])
        self.assertTrue(final["results"]["t3"]["ok"], final["results"]["t3"])
        self.assertEqual(self.moves(w), [(AMULET, PACK), (AMULET, DEST)])
        self.assertFalse(os.path.exists(self.stop_flag()))

    def test_a_stop_flag_left_over_from_before_is_cleared_when_a_trip_starts(self):
        w = trip_home()
        w.clock.at(0.5, lambda: self.press_stop(w, ago_s=30))
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])], puts=[(AMULET, [DEST])])])
        self.assertTrue(final["results"]["t1"]["ok"], final["results"]["t1"])
        self.assertFalse(os.path.exists(self.stop_flag()))

    def test_a_directory_where_the_stop_flag_goes_does_not_wedge_trips(self):
        w = trip_home()
        os.makedirs(self.stop_flag())
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])], puts=[(AMULET, [DEST])])])
        self.assertTrue(final["results"]["t1"]["ok"], final["results"]["t1"])

    def test_a_take_never_starts_in_your_own_backpack_or_bank_so_nothing_you_carry_joins_the_carried_set(self):
        w = trip_home()
        final, _ = self.run_bridge(w, 1, [
            self.trip("t1", takes=[(LOOSE, [PACK])], puts=[(LOOSE, [DEST])]),
            self.trip("t2", takes=[(AMULET, [CHEST, BAG])], index=4),
            self.trip("t3", takes=[(RING, [PACK, POUCH])], puts=[(RING, [DEST])], index=5),
            self.trip("t4", puts=[(LOOSE, [DEST]), (RING, [DEST])], index=6)])
        self.assertEqual(self.steps(final, "t1"), [("take", LOOSE, False), ("put", LOOSE, False)])
        self.assertIn("refused", final["results"]["t1"]["steps"][0]["msg"])
        self.assertEqual(self.steps(final, "t3"), [("take", RING, False), ("put", RING, False)])
        self.assertEqual(self.steps(final, "t4"), [("put", LOOSE, False), ("put", RING, False)])
        self.assertEqual(self.moves(w), [(AMULET, PACK)])
        self.assertNotIn(POUCH, self.opened(w))

    def test_a_put_into_a_container_whose_name_has_not_loaded_is_refused(self):
        w = trip_home()
        w.items[DEST].Name = ""
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])], puts=[(AMULET, [DEST])])])
        self.assertEqual(self.steps(final, "t1"), [("take", AMULET, True), ("put", AMULET, False)])
        self.assertIn("did not load", final["results"]["t1"]["steps"][1]["msg"])
        self.assertEqual(w.items[AMULET].Container, PACK)

    def test_a_backpack_the_character_cannot_carry_more_in_cuts_the_takes_short_and_skips_their_puts(self):
        w = trip_home()
        w.weight_max = 1
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG]), (BRACELET, [CHEST, BAG])],
                                                    puts=[(AMULET, [DEST]), (BRACELET, [DEST])])])
        r = final["results"]["t1"]
        self.assertFalse(r["ok"])
        self.assertTrue(r["partial"])
        self.assertEqual(self.steps(final, "t1"), [("take", AMULET, True), ("take", BRACELET, False),
                                                   ("put", AMULET, True), ("put", BRACELET, False)])
        self.assertIn("skipped", r["steps"][3]["msg"])
        self.assertEqual(w.items[BRACELET].Container, BAG)

    def test_a_stack_whose_tiledata_weight_is_zero_is_taken_not_counted_a_stone_a_unit(self):
        # Arrows and reagents weigh a fraction of a stone, which tiledata stores as 0 (#117).
        w = trip_home()
        w.weight_max = 100
        w.items[AMULET].Stones, w.items[AMULET].Amount = 0, 300
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])], puts=[(AMULET, [DEST])])])
        self.assertEqual(self.steps(final, "t1"), [("take", AMULET, True), ("put", AMULET, True)])

    def test_a_backpack_at_its_item_cap_takes_nothing(self):
        w = trip_home()
        for i in range(120):                     # with the five pieces trip_home() leaves in the pack: 125, the cap
            w.add(0x40002000 + i, PACK, name="Gem", container_like=False, OnGround=False)
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])], puts=[(AMULET, [DEST])])])
        r = final["results"]["t1"]
        self.assertTrue(r["partial"])
        self.assertEqual(self.steps(final, "t1"), [("take", AMULET, False), ("put", AMULET, False)])
        self.assertEqual(self.moved(w), [])

    def test_an_item_gone_since_the_plan_fails_its_take_and_its_put_is_skipped(self):
        w = trip_home()
        gone = 0x40000099
        final, _ = self.run_bridge(w, 1, [
            self.trip("t1", takes=[(gone, [CHEST, BAG]), (AMULET, [CHEST, BAG])], puts=[(gone, [DEST]), (AMULET, [DEST])]),
            self.trip("t2", takes=[(BRACELET, [CHEST])], index=4)])
        r = final["results"]["t1"]
        self.assertFalse(r["ok"])
        self.assertFalse(r["partial"])
        self.assertEqual(self.steps(final, "t1"), [("take", gone, False), ("take", AMULET, True),
                                                   ("put", gone, False), ("put", AMULET, True)])
        self.assertIn("rescan", r["steps"][0]["msg"])
        self.assertIn("refused", final["results"]["t2"]["steps"][0]["msg"])
        self.assertEqual(w.items[BRACELET].Container, BAG)

    def test_a_put_of_something_no_trip_took_is_refused_and_nothing_moves(self):
        w = trip_home()
        w.items[AMULET].Container = PACK         # taken by a bridge that has since restarted
        final, _ = self.run_bridge(w, 1, [self.trip("h1", puts=[(LOOSE, [DEST])]),
                                          self.trip("h2", puts=[(AMULET, [DEST])], index=4)])
        for cid in ("h1", "h2"):
            self.assertFalse(final["results"][cid]["ok"], cid)
            self.assertIn("not taken by this bridge", final["results"][cid]["steps"][0]["msg"])
        self.assertEqual(self.moved(w), [])
        self.assertNotIn(DEST, self.opened(w))

    def test_a_put_the_container_bounces_keeps_the_item_carried_for_put_them_away(self):
        w = trip_home()
        w.refuse = {DEST}
        final, _ = self.run_bridge(w, 1, [
            self.trip("t1", takes=[(AMULET, [CHEST, BAG])], puts=[(AMULET, [DEST])]),
            self.trip("t2", puts=[(AMULET, [DEST, DEST_BAG])], index=4)])
        self.assertEqual(self.steps(final, "t1"), [("take", AMULET, True), ("put", AMULET, False)])
        self.assertIn("bounced", final["results"]["t1"]["steps"][1]["msg"])
        self.assertTrue(final["results"]["t2"]["ok"], final["results"]["t2"])
        self.assertEqual(w.items[AMULET].Container, DEST_BAG)

    def test_a_put_never_goes_into_your_own_pack_a_strangers_pack_or_a_corpse(self):
        w = trip_home()
        final, _ = self.run_bridge(w, 1, [
            self.trip("t1", takes=[(AMULET, [CHEST, BAG])], puts=[(AMULET, [PACK, POUCH])]),
            self.trip("t2", puts=[(AMULET, [STRANGER_PACK])], index=4),
            self.trip("t3", puts=[(AMULET, [CORPSE])], index=5)])
        self.assertEqual(self.steps(final, "t1"), [("take", AMULET, True), ("put", AMULET, False)])
        for cid in ("t2", "t3"):
            self.assertEqual(self.steps(final, cid), [("put", AMULET, False)], cid)
        self.assertEqual(self.moved(w), [AMULET])
        for s in (STRANGER_PACK, CORPSE, POUCH):
            self.assertNotIn(s, self.opened(w))
        self.assertEqual(w.items[AMULET].Container, PACK)

    def test_a_trip_never_opens_or_fills_a_blacklisted_container(self):
        w = trip_home()
        w.add(OTHER_GEM, OTHER_BAG, name="Gem", container_like=False, OnGround=False)
        with open(os.path.join(self.data, "scan-blacklist.json"), "w", encoding="utf-8") as f:
            json.dump([{"serial": DEST_BAG, "name": "Bag", "addedAt": "2026-09-28T12:00:00Z"},
                       {"serial": OTHER_CHEST, "name": "Other Chest", "addedAt": "2026-09-28T12:00:00Z"}], f)
        final, _ = self.run_bridge(w, 1, [
            self.trip("t1", takes=[(AMULET, [CHEST, BAG])], puts=[(AMULET, [DEST, DEST_BAG])]),
            self.trip("t2", takes=[(OTHER_GEM, [OTHER_CHEST, OTHER_BAG])], index=4)])
        self.assertEqual(self.steps(final, "t1"), [("take", AMULET, True), ("put", AMULET, False)])
        self.assertIn("blacklisted", final["results"]["t1"]["steps"][1]["msg"])
        self.assertEqual(self.steps(final, "t2"), [("take", OTHER_GEM, False)])
        self.assertIn("blacklisted", final["results"]["t2"]["steps"][0]["msg"])
        for s in (DEST, DEST_BAG, OTHER_CHEST, OTHER_BAG):
            self.assertNotIn(s, self.opened(w))
        self.assertEqual(self.moved(w), [AMULET])

    def test_a_put_never_goes_into_a_trash_container(self):
        w = trip_home()
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])], puts=[(AMULET, [TRASH_BIN])])])
        self.assertIn("trash", final["results"]["t1"]["steps"][1]["msg"])
        self.assertNotIn(TRASH_BIN, self.opened(w))
        self.assertEqual(w.items[AMULET].Container, PACK)

    def test_a_put_that_merges_onto_a_stack_counts_as_put_away(self):
        w = trip_home()
        w.merges = True
        w.add(STACK, DEST_BAG, name="Jewel", container_like=False, OnGround=False)
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])], puts=[(AMULET, [DEST, DEST_BAG])])])
        self.assertTrue(final["results"]["t1"]["ok"], final["results"]["t1"])
        self.assertNotIn(AMULET, w.items)
        self.assertEqual(w.items[STACK].Amount, 2)
        self.assertLess(final["results"]["t1"]["steps"][1]["ms"], 2500)   # two opens, then the merge counts at once
        # The stack is looked up by type, not by reading every child of the bag.
        self.assertIn(("find_type_all", 0x1086, DEST_BAG, 0), w.calls)
        self.assertNotIn(("items_in", DEST_BAG), w.calls)

    def test_a_put_of_an_item_that_cannot_stack_reads_none_of_the_containers_contents(self):
        # 50 power scrolls into one chest got ~50 ms slower per scroll already there, live (#122): every
        # put summed the chest's matching stacks, one client round trip per child.
        w = trip_home()
        w.items[AMULET].Stackable = False
        for i in range(50):
            w.add(0x40001000 + i, DEST_BAG, name="Jewel", container_like=False, OnGround=False, Stackable=False)
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])], puts=[(AMULET, [DEST, DEST_BAG])])])
        self.assertTrue(final["results"]["t1"]["ok"], final["results"]["t1"])
        self.assertEqual(w.items[AMULET].Container, DEST_BAG)
        self.assertEqual([c for c in w.calls if c[0] in ("items_in", "find_type_all") and c[1] != PACK], [])

    def test_a_put_of_an_item_that_cannot_stack_and_vanishes_is_not_put_away(self):
        w = trip_home()
        w.items[AMULET].Stackable = False
        w.add(STACK, DEST_BAG, name="Jewel", container_like=False, OnGround=False, Stackable=False)
        w.refuse = {DEST_BAG}
        w.on_move = lambda s, dst: w.items.pop(s) if dst == DEST_BAG else None
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])], puts=[(AMULET, [DEST, DEST_BAG])])])
        self.assertEqual(self.steps(final, "t1"), [("take", AMULET, True), ("put", AMULET, False)])

    def test_a_merge_counts_only_stacks_directly_in_the_container_not_in_a_bag_inside_it(self):
        # FindTypeAll matches an item whose container OR root container is the one asked for.
        w = trip_home()
        w.add(STACK, DEST_BAG, name="Jewel", container_like=False, OnGround=False)
        w.refuse = {DEST}
        w.on_move = lambda s, dst: w.items.pop(s) if dst == DEST else None
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])], puts=[(AMULET, [DEST])])])
        self.assertEqual(self.steps(final, "t1"), [("take", AMULET, True), ("put", AMULET, False)])

    def assert_merge_counts(self, **world):
        w = trip_home()
        w.merges = True
        for k, v in world.items():
            setattr(w, k, v)
        w.add(STACK, DEST_BAG, name="Jewel", container_like=False, OnGround=False)
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])], puts=[(AMULET, [DEST, DEST_BAG])])])
        self.assertTrue(final["results"]["t1"]["ok"], final["results"]["t1"])
        self.assertEqual(w.items[STACK].Amount, 2)
        return w

    def test_a_merge_still_counts_on_a_client_without_find_type_all_or_whose_call_fails(self):
        self.assertIn(("items_in", DEST_BAG), self.assert_merge_counts(find_type_all="missing").calls)
        self.assertIn(("items_in", DEST_BAG), self.assert_merge_counts(find_type_all="raise").calls)

    def test_an_item_whose_stackable_flag_cannot_be_read_is_treated_as_stackable(self):
        self.assert_merge_counts(no_stackable_flag=True)
        self.assert_merge_counts(data_error=RuntimeError)

    def test_a_trip_line_over_the_line_limit_is_refused_unread(self):
        w = trip_home()
        big = self.trip("big", takes=[(AMULET, [CHEST, BAG])], puts=[(AMULET, [DEST])])
        big["takes"][0]["name"] = "N" * 17000
        final, _ = self.run_bridge(w, 1, [big])
        self.assertNotIn("big", final["results"])
        self.assertTrue([k for k in final["results"] if k.startswith("rejected-")], final["results"])
        self.assertEqual(self.moved(w), [])


    def test_a_timed_out_walk_is_reported_failed_even_where_pathfinding_cannot_be_cancelled(self):
        w = home(); w.no_path = True
        self.drop_cancel = True
        final, writes = self.run_bridge(w, 1, [self.cmd("g2", "goto", FAR_RING, [FAR])])
        self.assertFalse(final["results"]["g2"]["ok"])
        done, status = [(t, s) for t, s in writes if "g2" in s.get("results", {})][0]
        self.assertLess(done, 1 + 20 + 3, "the walk gave up at its own timeout")
        self.assertIsNone(status["current"], "and stopped being reported as running")


class RazorBridge(BridgeCase, unittest.TestCase):
    ADAPTER = "razor-enhanced"

    def break_client(self, world):
        def fail(*a):
            raise RuntimeError("client gone")
        world.g["Misc"].SendMessage = staticmethod(fail)
        type(world.g["Player"]).Name = property(fail)

    def start(self, world):
        g = world.g = razor_globals(world, PACK)
        world.clock.at(RUN_S, lambda: setattr(g["Player"], "Connected", False))
        run_script(adapter_path("razor-enhanced", "packrat-bridge.py"), world, extra_globals=g)

    def assert_marked_then_cleared(self, world, serial, x, y):
        """The chest recoloured once, and its own colour restored after it (-1)."""
        colours = [c for c in world.calls if c[0] == "color"]
        self.assertEqual([c[1] for c in colours], [serial, serial])
        self.assertEqual(colours[1][2], -1)

    def test_a_walk_heads_for_the_tile_beside_the_container_not_onto_it(self):
        w = home()
        final, _ = self.run_bridge(w, 1, [self.cmd("w1", "goto", FAR_RING, [FAR])])
        self.assertTrue(final["results"]["w1"]["ok"], final["results"]["w1"])
        self.assertEqual([c for c in w.calls if c[0] == "walk"], [("walk", 19, 10)])

    def test_a_trip_is_refused_as_an_unknown_action(self):
        w = home()
        trip = {"id": "t1", "action": "trip", "index": 1, "stamp": "2026-09-28T12:00:00.000Z",
                "roots": {str(CHEST): {"x": 11, "y": 10, "z": 0}},
                "takes": [{"serial": AMULET, "name": "Jewel", "chain": [CHEST, BAG]}], "puts": [], "age_s": 0}
        final, _ = self.run_bridge(w, 1, [trip])
        self.assertEqual(final["results"]["t1"]["msg"], "unknown action")
        self.assertEqual(self.moved(w), [])
        self.assertEqual(self.opened(w), [])


if __name__ == "__main__":
    unittest.main()
