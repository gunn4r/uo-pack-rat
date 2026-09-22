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

    # ---- refusals reach the page --------------------------------------------------------------------

    def test_an_expired_command_is_recorded_under_its_own_id_with_the_reason(self):
        w = home()
        final, _ = self.run_bridge(w, 1, [self.cmd("old", "grab", AMULET, [CHEST, BAG], age_s=90)])
        self.assertFalse(final["results"]["old"]["ok"])
        self.assertIn("expired", final["results"]["old"]["msg"])
        self.assertEqual(self.moved(w), [])

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


if __name__ == "__main__":
    unittest.main()
