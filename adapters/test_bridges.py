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
DEST, DEST_BAG, TRASH_BIN, CORPSE, LOOSE, STACK, OTHER_GEM = (0x40000050, 0x40000051, 0x40000052, 0x40000053,
                                                               0x40000054, 0x40000055, 0x40000056)
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

        def enqueue():
            with open(os.path.join(self.dir, "queue.jsonl"), "a", encoding="utf-8") as f:
                for c in cmds:
                    c = dict(c)
                    c["queuedAt"] = stamp(world.clock.now - c.pop("age_s"))
                    f.write(json.dumps(c) + "\n")
        world.clock.at(at_s, enqueue)
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

    def test_a_duplicate_line_in_one_read_runs_once(self):
        w = home()
        c = self.cmd("d1", "grab", AMULET, [CHEST, BAG])
        self.run_bridge(w, 1, [c, c])
        self.assertEqual(self.moved(w), [AMULET])


class TazUOBridge(BridgeCase, unittest.TestCase):
    ADAPTER = "tazuo"

    def start(self, world):
        api = tazuo_api(world, PACK)
        if getattr(self, "drop_cancel", False):
            del api.CancelPathfinding
        world.clock.at(RUN_S, lambda: setattr(api, "StopRequested", True))
        run_script(adapter_path("tazuo", "packrat-bridge.py"), world, api=api)

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
        self.assertEqual(sorted(set(k for s in r["steps"] for k in s)), ["msg", "ok", "op", "serial"])
        self.assertEqual(self.moves(w), [(AMULET, PACK), (BRACELET, PACK), (AMULET, DEST_BAG), (BRACELET, DEST_BAG)])
        self.assertIn("Pack Rat organize: trip 3, 2 items", w.messages)
        self.assert_heartbeat(writes)

    def test_a_take_drops_at_an_explicit_spot_so_a_stack_keeps_its_serial(self):
        w = trip_home()
        w.merges = True                          # LOOSE, in the pack, has the amulet's graphic and hue
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])])])
        self.assertTrue(final["results"]["t1"]["ok"], final["results"]["t1"])
        [call] = [c for c in w.calls if c[0] == "move"]
        self.assertEqual(call[1:], (AMULET, PACK, 0, 60, 90))
        self.assertEqual(w.items[AMULET].Container, PACK)

    def test_the_stop_flag_halts_a_trip_between_steps_and_the_taken_item_can_still_be_put_away(self):
        w = trip_home()
        flag = self.stop_flag()
        w.on_move = lambda s, dst: open(flag, "w").close() if (s, dst) == (AMULET, PACK) else None
        final, _ = self.run_bridge(w, 1, [
            self.trip("t1", takes=[(AMULET, [CHEST, BAG]), (BRACELET, [CHEST, BAG])], puts=[(AMULET, [DEST]), (BRACELET, [DEST])]),
            self.trip("t2", puts=[(AMULET, [DEST])], index=4)])
        r = final["results"]["t1"]
        self.assertFalse(r["ok"])
        self.assertTrue(r["stopped"])
        self.assertEqual(self.steps(final, "t1"), [("take", AMULET, True)])
        self.assertTrue(final["results"]["t2"]["ok"], final["results"]["t2"])
        self.assertEqual(self.moves(w), [(AMULET, PACK), (AMULET, DEST)])

    def test_a_stop_flag_left_over_from_before_is_cleared_when_a_trip_starts(self):
        w = trip_home()
        w.clock.at(0.5, lambda: open(self.stop_flag(), "w").close())
        final, _ = self.run_bridge(w, 1, [self.trip("t1", takes=[(AMULET, [CHEST, BAG])], puts=[(AMULET, [DEST])])])
        self.assertTrue(final["results"]["t1"]["ok"], final["results"]["t1"])
        self.assertFalse(os.path.exists(self.stop_flag()))

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

    def start(self, world):
        g = razor_globals(world, PACK)
        world.clock.at(RUN_S, lambda: setattr(g["Player"], "Connected", False))
        run_script(adapter_path("razor-enhanced", "packrat-bridge.py"), world, extra_globals=g)

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
