"""test_panel.py -- the TazUO in-game panel (adapters/tazuo/packrat-panel.py) run end to end against
the fake client (fake_clients.tazuo_panel_api): its window, what each button starts or stops and under
which relative path, the show/hide hotkey read from the app's tazuo-panel.json, and the heartbeat the
installer reads.

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
        return next(c for c in api.windows[-1].children if c.Text == text)

    def labels(self, api):
        return [c.Text for c in api.windows[-1].children]

    def prefs(self, hotkey):
        with open(os.path.join(self.data, "tazuo-panel.json"), "w", encoding="utf-8") as f:
            json.dump({"hotkey": hotkey}, f)

    def heartbeat(self):
        with open(os.path.join(self.data, "bridge", "tazuo", "panel.json"), encoding="utf-8") as f:
            return json.load(f)

    def test_each_button_runs_its_script_under_the_panels_own_group_folder(self):
        w = World()
        api = tazuo_panel_api(w, loaded=["PackRat/" + n for n in ALL], prefix="PackRat/")
        seen = {}
        w.clock.at(1, lambda: api.click(self.control(api, "Scan here")))
        w.clock.at(2, lambda: api.click(self.control(api, "Quick refresh")))
        w.clock.at(3, lambda: api.click(self.control(api, "Blacklist a container")))
        w.clock.at(4, lambda: api.click(self.control(api, "Start bridge")))
        w.clock.at(7, lambda: seen.setdefault("on", self.labels(api)))
        w.clock.at(8, lambda: api.click(self.control(api, "Stop bridge")))
        w.clock.at(11, lambda: seen.setdefault("off", self.labels(api)))
        w.clock.at(12, lambda: api.click(self.control(api, "Close")))
        self.run_panel(w, api)
        self.assertEqual([c for c in api.log if c[0] != "hotkey"],
                         [("play", "PackRat/packrat-scanner.py"), ("play", "PackRat/packrat-refresh.py"),
                          ("play", "PackRat/packrat-blacklist.py"), ("play", "PackRat/packrat-bridge.py"),
                          ("stop", "PackRat/packrat-bridge.py")])
        self.assertIn("Stop bridge", seen["on"])
        self.assertIn("Bridge: on", seen["on"])
        self.assertIn("Start bridge", seen["off"])
        self.assertIn("Bridge: off", seen["off"])
        self.assertFalse(api.windows[0].IsVisible, "Close hides the window")
        self.assertGreaterEqual(w.clock.now - w.clock.start, 30, "and the panel keeps running")
        self.assertEqual(w.calls, [], "the panel takes no action in the world")

    def test_a_script_that_does_not_start_says_so(self):
        w = World()
        api = tazuo_panel_api(w)          # nothing loaded: PlayScript is the client's silent no-op
        w.clock.at(1, lambda: api.click(self.control(api, "Scan here")))
        self.run_panel(w, api, until_s=4)
        self.assertEqual([c for c in api.log if c[0] == "play"], [("play", "packrat-scanner.py")])
        self.assertIn("Didn't start. Try again in a moment;", self.labels(api))
        self.assertTrue(all(len(t) <= 48 for t in self.labels(api)), "every line fits the 380 px window")

    def test_the_hotkey_follows_the_apps_file_and_toggles_the_window(self):
        w = World()
        api = tazuo_panel_api(w)
        seen = {}
        w.clock.at(1, lambda: api.press("CTRL+SHIFT+P"))
        w.clock.at(2, lambda: seen.setdefault("hidden", api.windows[0].IsVisible))
        w.clock.at(3, lambda: self.prefs({"mods": ["SHIFT", "ALT"], "key": "F5"}))
        w.clock.at(8, lambda: seen.setdefault("label", self.labels(api)))

        def close_with_x():
            api.windows[0].IsDisposed = True
            api.queue.append(api.windows[0].on_disposed)
        w.clock.at(9, close_with_x)
        w.clock.at(10, lambda: api.press("ALT+SHIFT+F5"))
        w.clock.at(11, lambda: self.prefs({"mods": [], "key": "P"}))     # a bare letter is refused
        self.run_panel(w, api, until_s=16)
        self.assertIs(seen["hidden"], False)
        self.assertIn("Alt+Shift+F5 shows/hides this window.", seen["label"])
        self.assertEqual([c for c in api.log if c[0] == "hotkey"],
                         [("hotkey", "CTRL+SHIFT+P", True), ("hotkey", "CTRL+SHIFT+P", False),
                          ("hotkey", "ALT+SHIFT+F5", True), ("hotkey", "ALT+SHIFT+F5", False),
                          ("hotkey", "CTRL+SHIFT+P", True), ("hotkey", "CTRL+SHIFT+P", False)])
        self.assertEqual(len(api.windows), 2, "the hotkey rebuilt the window closed with its X")
        self.assertIn("Ctrl+Shift+P shows/hides this window.", self.labels(api))

    def test_the_heartbeat_runs_while_open_and_ends_stopped(self):
        inbox = os.path.join(self.data, "inbox", "tazuo")
        os.makedirs(inbox)
        open(os.path.join(inbox, "Tester-20260924-120000.json"), "w").close()
        w = World()
        api = tazuo_panel_api(w)
        api.Player.Name = ""              # not known yet right after login
        mid = {}
        w.clock.at(1, lambda: setattr(api.Player, "Name", "Tester"))
        w.clock.at(6, lambda: mid.update(self.heartbeat()))
        self.run_panel(w, api, until_s=8)
        self.assertEqual(mid.get("character"), "Tester")
        self.assertNotIn("stopped", mid)
        self.assertIs(self.heartbeat().get("stopped"), True)
        self.assertIn("Pack Rat - Tester", self.labels(api))
        self.assertIn("Last scan: just now", self.labels(api))

    def test_the_loop_is_bounded(self):
        with open(SCRIPT, encoding="utf-8") as f:
            src = f.read()
        self.assertRegex(src, r"(?m)^MAX_HOURS = 8$")
        self.assertRegex(src, r"(?m)^\s*deadline = time\.time\(\) \+ MAX_HOURS \* 3600$")
        self.assertRegex(src, r"(?m)^\s*while not API\.StopRequested and .*time\.time\(\) < deadline:$")


if __name__ == "__main__":
    unittest.main()
