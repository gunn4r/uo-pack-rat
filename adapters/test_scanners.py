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

    def test_a_bag_that_did_not_open_leaves_its_whole_root_unrecorded(self):
        w = World(); home(w); w.locked.add(BAG)
        self.scan(w)
        [s] = self.scans("tazuo")
        self.assertFalse(self.root(s, CHEST)["opened"])
        self.assertNotIn(str(BAG), s["containers"])
        self.assertNotIn(str(CHEST), s["containers"])
        self.assertTrue(self.root(s, PACK)["opened"], "the backpack is unaffected")

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

    def test_it_runs_where_the_host_defines_no___file__(self):
        w = World(); home(w)
        self.scan(w, with_file=False)
        self.assertEqual(len(self.scans("tazuo")), 1)


class TazUORefresh(DataDir, unittest.TestCase):
    SCRIPT = adapter_path("tazuo", "packrat-refresh.py")

    def test_it_walks_the_backpack_with_the_scanners_own_code(self):
        def body(path, name):
            with open(path, encoding="utf-8") as f:
                t = f.read()
            m = re.search(r"^def %s\(.*?(?=^def |^[A-Z_]+ = )" % name, t, re.S | re.M)
            self.assertIsNotNone(m, "%s lacks %s" % (path, name))
            return m.group(0)
        for name in ("is_container", "was_opened", "scan_root"):
            self.assertEqual(body(self.SCRIPT, name), body(TazUOScanner.SCRIPT, name), name)

    def test_a_bag_in_the_backpack_that_did_not_open_writes_nothing(self):
        w = World(); home(w)
        w.add(BAG + 0x100, PACK, name="Pouch", OnGround=False)
        w.add(RING + 0x100, BAG + 0x100, name="Ring", container_like=False, OnGround=False)
        w.locked.add(BAG + 0x100)
        run_script(self.SCRIPT, w, api=tazuo_api(w, PACK))
        self.assertEqual(self.scans("tazuo"), [])


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

    def test_a_bag_that_did_not_open_leaves_its_whole_root_unrecorded(self):
        w = World(); home(w); w.locked.add(BAG)
        self.scan(w)
        [s] = self.scans("razor-enhanced")
        self.assertFalse(self.root(s, CHEST)["opened"])
        self.assertNotIn(str(BAG), s["containers"])
        self.assertTrue(self.root(s, PACK)["opened"])

    def test_skills_are_written_under_the_names_the_app_reads(self):
        w = World(); home(w)
        self.scan(w, skills={"Magic Resist": 100.0, "Swords": 90.0, "EvalInt": 80.0, "Tactics": 70.0})
        [s] = self.scans("razor-enhanced")
        self.assertEqual(sorted(s["skills"]), ["Evaluating Intelligence", "Resisting Spells", "Swordsmanship", "Tactics"])
        self.assertEqual(s["skills"]["Resisting Spells"]["value"], 100.0)

    def test_it_runs_where_the_host_defines_no___file__(self):
        w = World(); home(w)
        self.scan(w, with_file=False)
        self.assertEqual(len(self.scans("razor-enhanced")), 1)


if __name__ == "__main__":
    unittest.main()
