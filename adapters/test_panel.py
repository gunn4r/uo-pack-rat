"""test_panel.py -- the TazUO in-game panel (adapters/tazuo/packrat-panel.py) run end to end against the fake client.

The fake is fake_clients.tazuo_panel_api: its window, what each button starts or stops and under which relative path, the show/hide hotkey read from the app's tazuo-panel.json, and the heartbeat the installer reads.

Covers: each button's script path under a group folder, the bridge button following state, the three scan buttons reading Stop scan while their script runs and stopping it (issue #298; stopping the scan a Put away waits for cancels the Put away), the not-started message, the hotkey re-read from `tazuo-panel.json` (a bare letter refused), the window hidden and rebuilt, starting hidden when `showAtLogin` is off, the Show at login button, and the heartbeat. Put away (issue #131): the target cursor (nothing picked, not a container, a book, a corpse, trash, another mobile's pack, a chest out of reach, a blacklisted bag, each refused with its reason, and only a chest in reach starting a scan), the refresh run for a bag in the pack, the request written after its scan file with the picked container, the character and where it stands, the shared variable set to that container for the run and cleared after it, each trip's result followed and a new request after a trip that put everything, the bridge required, an app that does not answer, Cancel put away (the stop flag written, the button's name back), a trip that never reports back ending the run with the stop flag written, and a client whose shared variable does not hold ending the run before any request. Also (2.12.0, issue #10) the House map refresh button beside Character refresh starting `packrat-house-map-refresh.py`, refused while a Put away runs, a `-house` file neither the last scan nor the scan Put away waits for, the Running line within 48 characters with all five scripts running, and every button and line inside the window with no two buttons overlapping. Claim this house (issue #299): the claim written to `house-claims.json` with the house's id, facet, bounds and character, the button then reading Unclaim this house, which takes back every claim the house overlaps and keeps the rest; greyed outside a house, where a click changes and says nothing; the house worked out again only after the player moves, while not being in a house is looked at again every pass (the tiles arriving after a recall); no claim before the character's name has loaded; a house sign naming a stranger as its owner refusing the claim, one naming this character, a character with a scan file, or no owner claiming, and a stranger's sign beside one naming this character not refusing it.

Run: python3 adapters/test_panel.py  (app/adapters.test.mts also spawns it, so `npm test` does).
"""
import json, os, shutil, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fake_clients import PLAYER, STRANGER, World, adapter_path, house_tiles, run_script, tazuo_panel_api  # noqa: E402

SCRIPT = adapter_path("tazuo", "packrat-panel.py")
ALL = ("packrat-scanner.py", "packrat-character-refresh.py", "packrat-house-map-refresh.py", "packrat-bridge.py", "packrat-blacklist.py")
PACK, POUCH, BOOK, CHEST, FAR, CORPSE, TRASH, THEIRS, RING, BLACK = (0x40000001, 0x40000002, 0x40000003, 0x40000004, 0x40000005,
                                                                    0x40000006, 0x40000007, 0x40000008, 0x40000009, 0x4000000a)
SIGN = 0x4000000b


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

    def test_a_scan_button_reads_stop_scan_while_its_script_runs_and_stops_it(self):
        w = World()
        api = tazuo_panel_api(w, loaded=list(ALL))
        seen, buttons = {}, []
        for at, text in ((1, "Scan here"), (2, "Character refresh"), (3, "House map refresh")):
            w.clock.at(at, lambda text=text: buttons.append(self.control(api, text)) or api.click(buttons[-1]))
        w.clock.at(6, lambda: seen.setdefault("on", self.labels(api)))
        for at in (7, 8, 9):
            w.clock.at(at, lambda at=at: api.click(buttons[at - 7]))
        w.clock.at(12, lambda: seen.setdefault("off", self.labels(api)))
        self.run_panel(w, api, until_s=14)
        self.assertEqual(seen["on"].count("Stop scan"), 3)
        self.assertNotIn("Scan here", seen["on"])
        self.assertEqual(sorted(c[1] for c in api.log if c[0] == "stop"), sorted(["packrat-scanner.py", "packrat-character-refresh.py", "packrat-house-map-refresh.py"]))
        self.assertNotIn("Stop scan", seen["off"])
        self.assertFalse(any("finished" in t for t in seen["off"]), "a stopped scan is not reported as finished")
        for text in ("Scan here", "Character refresh", "House map refresh"):
            self.assertIn(text, seen["off"])

    def test_a_stop_scan_click_after_the_scan_ended_starts_nothing(self):
        w = World()
        api = tazuo_panel_api(w, loaded=list(ALL))
        button = []
        w.clock.at(1, lambda: button.append(self.control(api, "Scan here")) or api.click(button[0]))
        # The scan ends and the click lands before the panel's next look at the running scripts.
        w.clock.at(3, lambda: (api.running.remove("packrat-scanner.py"), api.click(button[0])))
        self.run_panel(w, api, until_s=3.5)
        self.assertEqual([c for c in api.log if c[0] == "play"], [("play", "packrat-scanner.py")])
        self.assertIn("The scan already finished.", self.labels(api))

    def claims(self):
        try:
            with open(os.path.join(self.data, "house-claims.json"), encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            return None

    def in_house(self, sign=None):
        """The player inside a 12 by 12 house from (5, 5) on Trammel, with a house sign over its front step
        whose tooltip is `sign` when given."""
        w = World()
        w.facet = 1
        w.multis = house_tiles(5, 5, 12, 12)
        if sign is not None:
            w.add(SIGN, 0, name="sign", container_like=False, Graphic=0x0BD2, Tooltip=sign, X=10, Y=17)
        return w, tazuo_panel_api(w, loaded=list(ALL))

    def test_claim_this_house_writes_the_claim_and_unclaim_takes_it_back(self):
        w, api = self.in_house()
        seen = {}
        w.clock.at(1, lambda: api.click(self.control(api, "Claim this house")))
        w.clock.at(2, lambda: seen.update(claimed=self.claims(), labels=self.labels(api)))
        w.clock.at(3, lambda: api.click(self.control(api, "Unclaim this house")))
        w.clock.at(4, lambda: seen.update(unclaimed=self.claims(), after=self.labels(api)))
        self.run_panel(w, api, until_s=6)
        [c] = seen["claimed"]
        self.assertEqual((c["id"], c["facet"], c["bounds"], c["by"]), ("1-5-5", 1, {"x0": 5, "y0": 5, "x1": 16, "y1": 16}, "Tester"))
        self.assertRegex(c["claimedAt"], r"^\d{4}-\d\d-\d\dT")
        self.assertIn("Unclaim this house", seen["labels"])
        self.assertIn("Claimed this house.", seen["labels"])
        self.assertEqual(seen["unclaimed"], [])
        self.assertIn("Claim this house", seen["after"])
        self.assertIn("Unclaimed this house.", seen["after"])
        self.assertEqual(w.calls, [], "a claim takes no action in the world")

    def test_unclaim_takes_back_a_claim_the_house_overlaps_and_keeps_the_others(self):
        w, api = self.in_house()
        other = {"id": "1-100-100", "facet": 1, "bounds": {"x0": 100, "y0": 100, "x1": 110, "y1": 110}, "claimedAt": "2026-10-01T10:00:00Z", "by": "Tester"}
        old = {"id": "1-6-6", "facet": 1, "bounds": {"x0": 6, "y0": 6, "x1": 14, "y1": 14}, "claimedAt": "2026-10-01T10:00:00Z", "by": "Tester"}
        with open(os.path.join(self.data, "house-claims.json"), "w", encoding="utf-8") as f:
            json.dump([other, old], f)
        w.clock.at(1, lambda: api.click(self.control(api, "Unclaim this house")))
        self.run_panel(w, api, until_s=3)
        self.assertEqual(self.claims(), [other])

    def test_outside_a_house_the_claim_button_is_greyed_and_claims_nothing(self):
        w = World()
        api = tazuo_panel_api(w, loaded=list(ALL))
        w.clock.at(1, lambda: api.click(self.control(api, "Claim this house")))
        self.run_panel(w, api, until_s=3)
        self.assertEqual(self.control(api, "Claim this house").TextHue, 902)
        self.assertFalse(any("claim" in t.lower() for t in self.labels(api) if t != "Claim this house"), "a click there changes nothing and says nothing")
        self.assertIsNone(self.claims())
        w, api = self.in_house()
        self.run_panel(w, api, until_s=1)
        self.assertEqual(self.control(api, "Claim this house").TextHue, 0, "inside a house it keeps its own hue")

    def test_a_sign_naming_someone_else_refuses_the_claim(self):
        w, api = self.in_house(sign="A House Sign\nName: Fort\nOwner: Some Stranger")
        w.clock.at(1, lambda: api.click(self.control(api, "Claim this house")))
        self.run_panel(w, api, until_s=3)
        self.assertIsNone(self.claims())
        self.assertIn("This house's sign names Some Stranger as the owner,", self.labels(api))
        self.assertIn("so it was not claimed.", self.labels(api))
        self.assertIn("Claim this house", self.labels(api))

    def test_the_house_is_worked_out_again_only_when_the_player_moves(self):
        w, api = self.in_house()
        area, reads = api.GetMultisInArea, []
        api.GetMultisInArea = lambda *a: (reads.append(w.clock.now), area(*a))[1]
        w.clock.at(9, lambda: setattr(w, "px", 11))
        self.run_panel(w, api, until_s=20)
        self.assertEqual(len(reads), 2, "once at the start and once after the step, over ten status passes")

    def test_a_house_whose_tiles_arrive_after_the_panel_looked_lights_the_button_without_a_step(self):
        w = World()
        w.facet = 1
        w.multis = []      # a recall or a login: the client has not got the house's tiles yet
        api = tazuo_panel_api(w, loaded=list(ALL))
        w.clock.at(3, lambda: w.multis.extend(house_tiles(5, 5, 12, 12)))
        seen = {}
        w.clock.at(2, lambda: seen.setdefault("before", self.control(api, "Claim this house").TextHue))
        self.run_panel(w, api, until_s=6)
        self.assertEqual((seen["before"], self.control(api, "Claim this house").TextHue), (902, 0))

    def test_a_character_whose_name_has_not_loaded_cannot_claim(self):
        w, api = self.in_house()
        api.Player.Name = ""
        w.clock.at(1, lambda: api.click(self.control(api, "Claim this house")))
        self.run_panel(w, api, until_s=3)
        self.assertIsNone(self.claims())
        self.assertIn("Pack Rat does not know this character's", self.labels(api))

    def test_a_neighbours_sign_naming_a_stranger_does_not_refuse_when_this_houses_sign_names_you(self):
        w, api = self.in_house(sign="A House Sign\nOwner: Tester")
        w.add(SIGN + 1, 0, name="sign", container_like=False, Graphic=0x0BD2, Tooltip="A House Sign\nOwner: Some Stranger", X=17, Y=10)
        w.clock.at(1, lambda: api.click(self.control(api, "Claim this house")))
        self.run_panel(w, api, until_s=3)
        self.assertEqual([c["id"] for c in self.claims()], ["1-5-5"])

    def test_a_sign_naming_one_of_your_characters_or_no_owner_line_claims(self):
        os.makedirs(os.path.join(self.data, "scans"))
        open(os.path.join(self.data, "scans", "Alt_Smith-20261001T120000Z.json"), "w").close()
        for sign in ("A House Sign\nOwner: Alt Smith", "A House Sign\nOwner: tester", "A House Sign"):
            with self.subTest(sign=sign):
                if os.path.exists(os.path.join(self.data, "house-claims.json")):
                    os.remove(os.path.join(self.data, "house-claims.json"))
                w, api = self.in_house(sign=sign)
                w.clock.at(1, lambda: api.click(self.control(api, "Claim this house")))
                self.run_panel(w, api, until_s=3)
                self.assertEqual([c["id"] for c in self.claims()], ["1-5-5"])

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

    def test_show_at_login_button_writes_an_invalid_hotkey_as_the_default(self):
        path = os.path.join(self.data, "tazuo-panel.json")
        for doc in ({"hotkey": {"mods": [], "key": "P"}, "showAtLogin": True}, {"hotkey": "CTRL+P", "showAtLogin": True},
                    {"showAtLogin": True}, {"hotkey": {"mods": ["SHIFT", "CTRL", "CTRL"], "key": "P"}, "showAtLogin": True}):
            with open(path, "w", encoding="utf-8") as f:
                json.dump(doc, f)
            w = World()
            api = tazuo_panel_api(w)
            w.clock.at(1, lambda: api.click(self.control(api, "Show at login: On")))
            self.run_panel(w, api, until_s=2)
            with open(path, encoding="utf-8") as f:
                self.assertEqual(json.load(f), {"hotkey": {"mods": ["CTRL", "SHIFT"], "key": "P"}, "showAtLogin": False}, doc)

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
        # the shapes of app/fixtures/contract-cases/heartbeat.json's first two cases, which the app's install guard reads
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "fixtures", "contract-cases", "heartbeat.json"), encoding="utf-8") as f:
            running, stopped = [c["doc"] for c in json.load(f)["cases"][:2]]
        for got, case in ((mid, running), (self.heartbeat(), stopped)):
            self.assertEqual({k: type(v) for k, v in got.items()}, {k: type(v) for k, v in case.items()})
            self.assertRegex(got["alive"], r"\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})\Z")
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
            reply = {"id": reqs[-1]["id"], "ok": True, "msg": "Nothing to put away.", "detail": "1 with no rule stays in that container"}
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
        # the shape app/fixtures/contract-cases/put-away.json's first valid request has, which the app's check takes
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "fixtures", "contract-cases", "put-away.json"), encoding="utf-8") as f:
            case = json.load(f)["valid"][0]
        for req in reqs:
            self.assertEqual(sorted(req), sorted(case))
            self.assertEqual({k: type(v) for k, v in req.items()}, {k: type(v) for k, v in case.items()})
            self.assertEqual({k: type(v) for k, v in req["at"].items()}, {k: type(v) for k, v in case["at"].items()})
            self.assertRegex(req["id"], r"\A[A-Za-z0-9-]{1,64}\Z")
        pouch, until = seen["consent"].split(":")
        self.assertEqual(int(pouch), POUCH, "the consent names the picked container")
        self.assertGreater(float(until), w.clock.start, "for as long as the run lasts")
        self.assertIn("Cancel put away", seen["running"])
        self.assertIn("Putting away 2 items...", seen["trip"])
        self.assertIn("Put away done: 2 put away.", self.labels(api))
        self.assertIn("1 with no rule stays in that container", self.labels(api))
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
                                     "That is a trash container.", "Pick your pack, a container in it, or one on the ground.", "Stand next to it first.",
                                     "That container is blacklisted."])
        self.assertEqual(said[-1], "Put away: reading the container...")
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

    def test_stopping_the_scan_a_put_away_waits_for_cancels_the_put_away(self):
        w, api = self.house([CHEST])
        w.clock.at(1, lambda: api.click(self.control(api, "Put away...")))
        w.clock.at(3, lambda: api.click(self.control(api, "Stop scan")))
        w.clock.at(4, lambda: self.write({}, "inbox", "tazuo", "Tester-20260930-120000.json"))   # what the stopped scan wrote
        self.run_panel(w, api, until_s=8)
        self.assertIn(("stop", "packrat-scanner.py"), api.log)
        self.assertIn("Put away canceled.", self.labels(api))
        self.assertFalse(os.path.exists(self.path("inbox", "tazuo", "putaway-request.json")), "no request from the stopped scan's file")
        self.assertEqual(api.shared.get("packrat_putaway", ""), "")

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
        self.assertIn("Put away canceled.", seen["cancelled"])
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
