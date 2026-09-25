"""test_panel.py -- the TazUO in-game panel (adapters/tazuo/packrat-panel.py) run end to end against
the fake client (fake_clients.tazuo_panel_api): its window, what each button starts or stops and under
which relative path, the status lines over hostile status files, and the heartbeat the installer reads.

Run: python3 adapters/test_panel.py  (app/adapters.test.mts also spawns it, so `npm test` does).
"""
import json, os, shutil, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fake_clients import World, adapter_path, run_script, tazuo_panel_api  # noqa: E402

SCRIPT = adapter_path("tazuo", "packrat-panel.py")
ALL = ("packrat-scanner.py", "packrat-refresh.py", "packrat-bridge.py", "packrat-blacklist.py")


class Panel(unittest.TestCase):
    def setUp(self):
        self.data = tempfile.mkdtemp()
        self.prev = os.environ.get("PACKRAT_DATA")
        os.environ["PACKRAT_DATA"] = self.data
        self.bridge_dir = os.path.join(self.data, "bridge", "tazuo")

    def tearDown(self):
        if self.prev is None:
            os.environ.pop("PACKRAT_DATA", None)
        else:
            os.environ["PACKRAT_DATA"] = self.prev
        shutil.rmtree(self.data, ignore_errors=True)

    def run_panel(self, world, api, until_s=30):
        """Run the panel; `until_s` fake seconds in, the player presses Stop."""
        world.clock.at(until_s, lambda: setattr(api, "StopRequested", True))
        run_script(SCRIPT, world, api=api, with_file=False)

    def control(self, api, text):
        return next(c for c in api.windows[0].children if c.Text == text)

    def labels(self, api):
        return [c.Text for c in api.windows[0].children]

    def heartbeat(self):
        with open(os.path.join(self.bridge_dir, "panel.json"), encoding="utf-8") as f:
            return json.load(f)

    def test_each_button_runs_its_script_under_the_panels_own_group_folder(self):
        w = World()
        api = tazuo_panel_api(w, loaded=["PackRat/" + n for n in ALL], prefix="PackRat/")
        seen = {}
        w.clock.at(1, lambda: api.click(self.control(api, "Scan here")))
        w.clock.at(2, lambda: api.click(self.control(api, "Quick refresh")))
        w.clock.at(3, lambda: api.click(self.control(api, "Blacklist a container")))
        w.clock.at(4, lambda: api.click(self.control(api, "Start bridge")))
        w.clock.at(7, lambda: seen.setdefault("on", [c.Text for c in api.windows[0].children]))
        w.clock.at(8, lambda: api.click(self.control(api, "Stop bridge")))
        w.clock.at(11, lambda: seen.setdefault("off", [c.Text for c in api.windows[0].children]))
        w.clock.at(12, lambda: api.click(self.control(api, "Close")))
        self.run_panel(w, api)
        self.assertEqual(api.log, [("play", "PackRat/packrat-scanner.py"), ("play", "PackRat/packrat-refresh.py"),
                                   ("play", "PackRat/packrat-blacklist.py"), ("play", "PackRat/packrat-bridge.py"),
                                   ("stop", "PackRat/packrat-bridge.py")])
        self.assertIn("Stop bridge", seen["on"])
        self.assertIn("Bridge: on", seen["on"])
        self.assertIn("Start bridge", seen["off"])
        self.assertIn("Bridge: off", seen["off"])
        self.assertLess(w.clock.now - w.clock.start, 13, "Close ended the script")
        self.assertTrue(api.windows[0].IsDisposed)
        self.assertEqual(w.calls, [], "the panel takes no action in the world")

    def test_a_script_the_script_manager_has_not_loaded_says_so(self):
        w = World()
        api = tazuo_panel_api(w)          # nothing loaded: PlayScript is the client's silent no-op
        w.clock.at(1, lambda: api.click(self.control(api, "Scan here")))
        self.run_panel(w, api, until_s=4)
        self.assertEqual(api.log, [("play", "packrat-scanner.py")])
        self.assertIn("Not loaded yet: open the Script Manager once or relog", self.labels(api))

    def test_hostile_status_files_leave_short_printable_status_lines(self):
        os.makedirs(self.bridge_dir)
        status = os.path.join(self.bridge_dir, "status.json")
        docs = ["x" * 100000, "[" * 5000, "\xff\xfe not json",
                json.dumps({"results": {"a": {"ok": True, "msg": "\x1b[31m\n" + "A" * 500}}, "current": None})]
        for doc in docs:
            with open(status, "w", encoding="utf-8", errors="surrogateescape") as f:
                f.write(doc)
            w = World()
            api = tazuo_panel_api(w, loaded=["packrat-bridge.py"])
            api.running.append("packrat-bridge.py")
            self.run_panel(w, api, until_s=3)
            line = next(t for t in self.labels(api) if t.startswith("Bridge:"))
            self.assertTrue(line.isprintable(), repr(line))
            self.assertLessEqual(len(line), len("Bridge: on - ") + 40, line)
        self.assertEqual(line, "Bridge: on - last: [31m" + "A" * 30, "escape and newline dropped, cut at 40")

    def test_the_heartbeat_runs_while_open_ends_stopped_and_the_loop_is_bounded(self):
        inbox = os.path.join(self.data, "inbox", "tazuo")
        os.makedirs(inbox)
        for name in ("Tester-20260924-120000.json", "Testers-20260924-130000.json"):
            open(os.path.join(inbox, name), "w").close()
        w = World()
        api = tazuo_panel_api(w)
        mid = {}
        w.clock.at(60, lambda: mid.update(self.heartbeat()))
        run_script(SCRIPT, w, api=api, with_file=False)     # nobody presses Stop or Close
        self.assertEqual(mid.get("character"), "Tester")
        self.assertNotIn("stopped", mid)
        self.assertIs(self.heartbeat().get("stopped"), True)
        hours = (w.clock.now - w.clock.start) / 3600
        self.assertTrue(8 <= hours < 8.01, hours)
        self.assertTrue(any(t.startswith("Last scan: ") and "none" not in t for t in self.labels(api)))


if __name__ == "__main__":
    unittest.main()
