"""test_panel.py -- the TazUO in-game panel (adapters/tazuo/packrat-panel.py) run end to end against
the fake client (fake_clients.tazuo_panel_api): its window, what each button starts or stops and under
which relative path, the show/hide hotkey read from the app's tazuo-panel.json, and the heartbeat the
installer reads.

Run: python3 adapters/test_panel.py  (app/adapters.test.mts also spawns it, so `npm test` does).
"""
import json, os, shutil, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fake_clients import PLAYER, STRANGER, World, adapter_path, run_script, tazuo_panel_api  # noqa: E402

SCRIPT = adapter_path("tazuo", "packrat-panel.py")
ALL = ("packrat-scanner.py", "packrat-character-refresh.py", "packrat-house-map-refresh.py", "packrat-bridge.py", "packrat-blacklist.py")
PACK, POUCH, BOOK, CHEST, FAR, CORPSE, TRASH, THEIRS, RING, BLACK = (0x40000001, 0x40000002, 0x40000003, 0x40000004, 0x40000005,
                                                                    0x40000006, 0x40000007, 0x40000008, 0x40000009, 0x4000000a)


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
        w.clock.at(2, lambda: api.click(self.control(api, "Character refresh")))
        w.clock.at(3, lambda: api.click(self.control(api, "Blacklist a container")))
        w.clock.at(3.5, lambda: api.click(self.control(api, "House map refresh")))
        w.clock.at(4, lambda: api.click(self.control(api, "Start bridge")))
        w.clock.at(7, lambda: seen.setdefault("on", self.labels(api)))
        w.clock.at(8, lambda: api.click(self.control(api, "Stop bridge")))
        w.clock.at(11, lambda: seen.setdefault("off", self.labels(api)))
        w.clock.at(12, lambda: api.click(self.control(api, "Close")))
        self.run_panel(w, api)
        self.assertEqual([c for c in api.log if c[0] != "hotkey"],
                         [("play", "PackRat/packrat-scanner.py"), ("play", "PackRat/packrat-character-refresh.py"),
                          ("play", "PackRat/packrat-blacklist.py"), ("play", "PackRat/packrat-house-map-refresh.py"),
                          ("play", "PackRat/packrat-bridge.py"),
                          ("stop", "PackRat/packrat-bridge.py")])
        self.assertIn("Stop bridge", seen["on"])
        self.assertIn("Bridge: on", seen["on"])
        self.assertIn("Start bridge", seen["off"])
        self.assertIn("Bridge: off", seen["off"])
        self.assertFalse(api.windows[0].IsVisible, "Close hides the window")
        self.assertGreaterEqual(w.clock.now - w.clock.start, 30, "and the panel keeps running")
        self.assertEqual(w.calls, [], "the panel takes no action in the world")

    def test_every_button_and_line_fits_the_window_and_no_two_buttons_overlap(self):
        w = World()
        api = tazuo_panel_api(w)
        self.run_panel(w, api, until_s=1)
        g = api.windows[0]
        buttons = [c for c in g.children if c.Width]
        self.assertIn("House map refresh", [b.Text for b in buttons])
        refresh, house = self.control(api, "Character refresh"), self.control(api, "House map refresh")
        self.assertEqual(refresh.Y, house.Y, "the two refreshes sit side by side")
        for c in g.children:
            self.assertTrue(0 <= c.X and c.X + c.Width <= g.Width and 0 <= c.Y and c.Y + max(c.Height, 16) <= g.Height, c.Text)
        for i, a in enumerate(buttons):
            for b in buttons[i + 1:]:
                self.assertFalse(a.X < b.X + b.Width and b.X < a.X + a.Width and a.Y < b.Y + b.Height and b.Y < a.Y + a.Height, (a.Text, b.Text))
        status = [c.Y for c in g.children if not c.Width and c.Y > 14]   # every line but the title
        self.assertGreaterEqual(min(status), max(b.Y + b.Height for b in buttons if b.Text != "Close"), "the status lines sit below the buttons")

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
        w.clock.at(11, lambda: self.prefs({"mods": ["CTRL"], "key": "P\n"}))   # not exactly a key: refused
        w.clock.at(12, lambda: self.prefs({"mods": [], "key": "P"}))     # a bare letter is refused too
        w.clock.at(13, lambda: api.queue.append(api.windows[0].on_disposed))   # a late close of the OLD window
        w.clock.at(15, lambda: api.press("CTRL+SHIFT+P"))
        self.run_panel(w, api, until_s=17)
        self.assertIs(seen["hidden"], False)
        self.assertIn("Alt+Shift+F5 shows/hides this window.", seen["label"])
        self.assertEqual([c for c in api.log if c[0] == "hotkey"],
                         [("hotkey", "CTRL+SHIFT+P", True), ("hotkey", "CTRL+SHIFT+P", False),
                          ("hotkey", "ALT+SHIFT+F5", True), ("hotkey", "ALT+SHIFT+F5", False),
                          ("hotkey", "CTRL+SHIFT+P", True), ("hotkey", "CTRL+SHIFT+P", False)])
        self.assertEqual(len(api.windows), 2, "the hotkey rebuilt the window closed with its X")
        self.assertFalse(api.windows[1].IsVisible, "the old window's close did not orphan the new one")
        self.assertIn("Ctrl+Shift+P shows/hides this window.", self.labels(api))

    def test_show_at_login_button_writes_the_choice_keeping_the_hotkey_and_follows_the_app(self):
        path = os.path.join(self.data, "tazuo-panel.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"hotkey": {"mods": ["ALT"], "key": "F5"}, "showAtLogin": True, "junk": "x" * 50}, f)
        w = World()
        api = tazuo_panel_api(w)
        seen = {}

        def read():
            with open(path, encoding="utf-8") as f:
                return json.load(f)

        def app_writes():
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"hotkey": {"mods": ["ALT"], "key": "F5"}, "showAtLogin": True}, f)
        w.clock.at(1, lambda: api.click(self.control(api, "Show at login: On")))
        w.clock.at(2, lambda: seen.update(written=read(), labels=self.labels(api)))
        w.clock.at(3, app_writes)
        w.clock.at(8, lambda: seen.update(after=self.labels(api)))
        self.run_panel(w, api, until_s=9)
        self.assertEqual(seen["written"], {"hotkey": {"mods": ["ALT"], "key": "F5"}, "showAtLogin": False})
        self.assertIn("Show at login: Off", seen["labels"])
        self.assertIn("Saved. Applies from your next login.", seen["labels"])
        self.assertIn("Show at login: On", seen["after"])
        self.assertTrue(api.windows[0].IsVisible, "the choice applies at the next login, not now")

    def test_the_window_starts_hidden_when_show_at_login_is_off_and_the_hotkey_shows_it(self):
        for doc, visible in (({"showAtLogin": False, "hotkey": {"mods": ["ALT"], "key": "F5"}}, False),
                             ({"openAtLogin": False}, False),          # an older app's name for it
                             ({"showAtLogin": True}, True)):
            with open(os.path.join(self.data, "tazuo-panel.json"), "w", encoding="utf-8") as f:
                json.dump(doc, f)
            w = World()
            api = tazuo_panel_api(w)
            seen = {}
            w.clock.at(1, lambda: seen.update(start=api.windows[0].IsVisible))
            hk = "ALT+F5" if "hotkey" in doc else "CTRL+SHIFT+P"
            w.clock.at(2, lambda: api.press(hk))
            self.run_panel(w, api, until_s=3)
            self.assertIs(seen["start"], visible, doc)
            self.assertIs(api.windows[0].IsVisible, not visible, "the hotkey toggles it either way")
            ready = [m for m in w.messages if m.startswith("Pack Rat panel ready")]
            self.assertEqual(ready, [] if visible else ["Pack Rat panel ready - %s to show" % ("Alt+F5" if "hotkey" in doc else "Ctrl+Shift+P")])

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

    # ---- Put away (issue #131) ------------------------------------------------------------------
    def path(self, *parts):
        return os.path.join(self.data, *parts)

    def read(self, *parts):
        with open(self.path(*parts), encoding="utf-8") as f:
            return json.load(f)

    def write(self, doc, *parts):
        os.makedirs(os.path.dirname(self.path(*parts)), exist_ok=True)
        with open(self.path(*parts), "w", encoding="utf-8") as f:
            json.dump(doc, f)

    def house(self, picks):
        """A world with the player's backpack (a pouch in it), a chest in reach, one out of reach, a corpse,
        a trash barrel, a spellbook and a stranger's pack; the panel's cursor answers `picks` in turn."""
        w = World()
        w.facet = 1
        w.add(PACK, PLAYER, name="Backpack", OnGround=False, Opened=True)
        w.add(POUCH, PACK, name="Pouch", OnGround=False)
        w.add(BOOK, PACK, name="Spellbook", Graphic=0x0EFA, OnGround=False)
        w.add(CHEST, 0, name="Wooden Chest", X=11, Y=10)
        w.add(FAR, 0, name="Far Chest", X=20, Y=10)
        w.add(CORPSE, 0, name="a corpse", IsCorpse=True, X=10, Y=11)
        w.add(TRASH, 0, name="barrel", Tooltip="A Trash Barrel", X=9, Y=10)
        w.add(THEIRS, STRANGER, name="Backpack", OnGround=False)
        w.add(RING, PACK, name="Ring", container_like=False, OnGround=False)
        api = tazuo_panel_api(w, loaded=list(ALL))
        api.Backpack = PACK
        api.running.append("packrat-bridge.py")
        left = list(picks)
        api.RequestTarget = lambda timeout: left.pop(0) if left else 0
        return w, api

    def test_put_away_picks_a_container_refreshes_asks_the_app_follows_each_trip_and_asks_again_until_nothing_is_left(self):
        w, api = self.house([POUCH])
        seen, reqs = {}, []

        def refreshed():
            api.running.remove("packrat-character-refresh.py")
            self.write({}, "inbox", "tazuo", "Tester-20260930-120000-quick.json")

        def answer(trip):
            reqs.append(self.read("inbox", "tazuo", "putaway-request.json"))
            seen.setdefault("consent", api.shared.get("packrat_putaway"))
            reply = {"id": reqs[-1]["id"], "ok": True, "msg": "Nothing to put away.", "detail": "1 with no rule stays in that bag"}
            self.write(dict(reply, trip=trip, msg="Putting away 2 items...") if trip else reply, "bridge", "tazuo", "putaway.json")

        steps = [{"op": "put", "serial": 1, "ok": True, "msg": "put"}, {"op": "put", "serial": 2, "ok": True, "msg": "put"}]
        w.clock.at(1, lambda: api.click(self.control(api, "Put away...")))
        w.clock.at(2, lambda: seen.setdefault("running", self.labels(api)))
        w.clock.at(3, refreshed)
        w.clock.at(5, lambda: answer("trip-1"))
        w.clock.at(6, lambda: seen.setdefault("trip", self.labels(api)))
        w.clock.at(7, lambda: self.write({"results": {"trip-1": {"ok": True, "msg": "trip 1: 2 put away", "steps": steps}}}, "bridge", "tazuo", "status.json"))
        w.clock.at(9, lambda: answer(None))
        self.run_panel(w, api, until_s=12)
        self.assertEqual([c for c in api.log if c[0] == "play"], [("play", "packrat-character-refresh.py")], "a bag in the pack: the character refresh reads it")
        self.assertEqual(len(reqs), 2, "a second request after the trip that put everything")
        self.assertEqual(reqs[0]["container"], POUCH)
        self.assertEqual(reqs[0]["character"], "Tester")
        self.assertEqual(reqs[0]["at"], {"x": w.px, "y": w.py, "facet": 1})
        self.assertNotEqual(reqs[0]["id"], reqs[1]["id"])
        pouch, until = seen["consent"].split(":")
        self.assertEqual(int(pouch), POUCH, "the consent names the picked container")
        self.assertGreater(float(until), w.clock.start, "for as long as the run lasts")
        self.assertIn("Cancel put away", seen["running"])
        self.assertIn("Putting away 2 items...", seen["trip"])
        self.assertIn("Put away done: 2 put away.", self.labels(api))
        self.assertIn("1 with no rule stays in that bag", self.labels(api))
        self.assertIn("Put away...", self.labels(api))
        self.assertEqual(api.shared["packrat_putaway"], "", "and not after it")
        self.assertEqual(w.calls, [], "the panel takes no action in the world")

    def test_put_away_refuses_what_is_not_your_pack_a_bag_in_it_or_a_chest_in_reach(self):
        picks = [0, RING, BOOK, CORPSE, TRASH, THEIRS, FAR, BLACK, CHEST]
        w, api = self.house(picks)
        w.add(BLACK, PACK, name="Bag", OnGround=False)
        self.write([{"serial": BLACK, "name": "Bag", "addedAt": "2026-09-30T12:00:00Z"}], "scan-blacklist.json")
        said = []
        for k in range(len(picks)):
            w.clock.at(1 + k, lambda: api.click(self.control(api, "Put away...")))
            w.clock.at(1.5 + k, lambda: said.append(self.labels(api)[4]))
        self.run_panel(w, api, until_s=len(picks) + 2)
        self.assertEqual(said[:-1], ["Put away: nothing picked.", "That is not a container.", "That is not a container.", "That is not a container.",
                                     "That is a trash container.", "Pick your pack, a bag in it, or a chest.", "Stand next to it first.",
                                     "That container is blacklisted."])
        self.assertEqual(said[-1], "Put away: reading the chest...")
        self.assertEqual([c for c in api.log if c[0] == "play"], [("play", "packrat-scanner.py")], "only the chest in reach starts a scan")
        self.assertFalse(os.path.exists(self.path("inbox", "tazuo", "putaway-request.json")))

    def test_put_away_needs_the_bridge_and_says_when_the_app_does_not_answer(self):
        w, api = self.house([CHEST, CHEST])
        api.running.remove("packrat-bridge.py")
        seen = {}
        w.clock.at(1, lambda: api.click(self.control(api, "Put away...")))
        w.clock.at(2, lambda: seen.setdefault("off", self.labels(api)))
        w.clock.at(3, lambda: api.running.append("packrat-bridge.py"))
        w.clock.at(4, lambda: api.click(self.control(api, "Put away...")))
        w.clock.at(6, lambda: (api.running.remove("packrat-scanner.py"), self.write({}, "inbox", "tazuo", "Tester-20260930-120000.json")))
        self.run_panel(w, api, until_s=60)
        self.assertIn("Start the bridge first: Put away", seen["off"])
        self.assertEqual([c for c in api.log if c[0] == "play"], [("play", "packrat-scanner.py")])
        self.assertEqual(self.read("inbox", "tazuo", "putaway-request.json")["container"], CHEST)
        self.assertIn("Pack Rat did not answer.", self.labels(api))

    def test_the_house_map_refresh_waits_while_a_put_away_runs(self):
        w, api = self.house([PACK])
        seen = {}
        w.clock.at(1, lambda: api.click(self.control(api, "Put away...")))
        w.clock.at(2, lambda: api.click(self.control(api, "House map refresh")))
        w.clock.at(3, lambda: seen.setdefault("refused", self.labels(api)))
        self.run_panel(w, api, until_s=4)
        self.assertEqual([c for c in api.log if c[0] == "play"], [("play", "packrat-character-refresh.py")], "its file would read as the run's scan")
        self.assertIn("Put away is running;", seen["refused"])

    def test_a_house_map_refresh_is_not_a_scan_for_the_last_scan_line_or_put_aways_wait(self):
        w, api = self.house([PACK])
        seen = {}
        self.write({}, "scans", "Tester-20261002T120000+0000-house.json")
        w.clock.at(0.5, lambda: seen.setdefault("only_house", self.labels(api)))
        w.clock.at(1, lambda: api.click(self.control(api, "Put away...")))
        w.clock.at(3, lambda: self.write({}, "inbox", "tazuo", "Tester-20261002-120005-house.json"))
        w.clock.at(5, lambda: seen.setdefault("asked", os.path.exists(self.path("inbox", "tazuo", "putaway-request.json"))))
        w.clock.at(6, lambda: (api.running.remove("packrat-character-refresh.py"), self.write({}, "inbox", "tazuo", "Tester-20261002-120010-quick.json")))
        w.clock.at(8, lambda: seen.setdefault("asked_after", os.path.exists(self.path("inbox", "tazuo", "putaway-request.json"))))
        self.run_panel(w, api, until_s=9)
        self.assertIn("Last scan: none yet", seen["only_house"])
        self.assertFalse(seen["asked"], "a house file is not the scan Put away waits for")
        self.assertTrue(seen["asked_after"])

    def test_the_running_line_fits_with_every_script_running(self):
        w = World()
        api = tazuo_panel_api(w, loaded=list(ALL))
        api.running.extend(ALL)
        self.run_panel(w, api, until_s=4)
        line = next(t for t in self.labels(api) if t.startswith("Running:"))
        self.assertLessEqual(len(line), 48, line)
        self.assertEqual(line.count(","), 4, line)

    def test_a_trip_that_never_reports_back_ends_the_run_and_writes_the_stop_flag(self):
        w, api = self.house([PACK])

        def answer():
            req = self.read("inbox", "tazuo", "putaway-request.json")
            self.write({"id": req["id"], "ok": True, "msg": "Putting away 1 item...", "trip": "trip-1"}, "bridge", "tazuo", "putaway.json")
        w.clock.at(1, lambda: api.click(self.control(api, "Put away...")))
        w.clock.at(3, lambda: (api.running.remove("packrat-character-refresh.py"), self.write({}, "inbox", "tazuo", "Tester-20260930-120000-quick.json")))
        w.clock.at(5, answer)
        self.run_panel(w, api, until_s=200)
        self.assertIn("The trip did not report back.", self.labels(api))
        self.assertTrue(os.path.isfile(self.path("bridge", "stop")), "a slow trip never goes on unattended")
        self.assertEqual(api.shared["packrat_putaway"], "")

    def test_put_away_can_be_cancelled_and_ends_at_once_on_a_client_without_shared_variables(self):
        w, api = self.house([PACK, PACK])
        seen = {}
        w.clock.at(1, lambda: api.click(self.control(api, "Put away...")))
        w.clock.at(3, lambda: api.click(self.control(api, "Cancel put away")))
        w.clock.at(4, lambda: seen.setdefault("cancelled", self.labels(api)))
        # A build whose shared variables do not hold a value: the run ends before any request.
        w.clock.at(5, lambda: (setattr(api, "SetSharedVar", lambda name, v: None), api.running.remove("packrat-character-refresh.py")))
        w.clock.at(6, lambda: api.click(self.control(api, "Put away...")))
        w.clock.at(8, lambda: (api.running.remove("packrat-character-refresh.py"), self.write({}, "inbox", "tazuo", "Tester-20260930-120000-quick.json")))
        self.run_panel(w, api, until_s=12)
        self.assertIn("Put away cancelled.", seen["cancelled"])
        self.assertIn("Put away...", seen["cancelled"])
        self.assertTrue(os.path.isfile(self.path("bridge", "stop")), "a trip under way halts after its step")
        self.assertIn("Put away needs shared variables,", self.labels(api))
        self.assertFalse(os.path.exists(self.path("inbox", "tazuo", "putaway-request.json")))

    def test_the_loop_is_bounded(self):
        with open(SCRIPT, encoding="utf-8") as f:
            src = f.read()
        self.assertRegex(src, r"(?m)^MAX_HOURS = 24\b")
        self.assertRegex(src, r"(?m)^\s*deadline = time\.time\(\) \+ MAX_HOURS \* 3600$")
        self.assertRegex(src, r"(?m)^\s*while not API\.StopRequested and .*time\.time\(\) < deadline:$")


if __name__ == "__main__":
    unittest.main()
