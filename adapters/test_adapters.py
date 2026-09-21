"""test_adapters.py — the adapter conventions and the bridge's untrusted-input guards, checked
against EVERY adapter directory rather than tazuo alone (adapters/tazuo/test_paths.py still covers
the TazUO-specific header/contract details; this file is what a second and third adapter pick up for
free just by existing).

Two halves:

1. Conventions — none of the three banned unbounded-loop literals (see scripts/no-unbounded-loop.
   test.mts, which spells them out; this file must not, since TazUO refuses a script whose text
   contains one anywhere, comments included) in any adapter .py, the shared path/atomic-write
   helpers identical within each adapter, and each adapter's `CAPABILITIES` dict literal matching its
   own capabilities.json. These were machine-checked for tazuo only.
2. The bridge's untrusted-input guards (Phase 7 security review, area 5). Every bridge carries a
   byte-identical block of PURE functions — no game API, no files — bounded by the constants above
   them; this file extracts that block, execs it, and drives it directly, the same way
   adapters/tazuo/test_paths.py execs `data_dir` without a running client.

Run: python3 adapters/test_adapters.py  (app/adapters.test.mts also spawns it, so `npm test` does).
"""
import ast, json, os, re, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
BANNED_LOOPS = re.compile(r"while\s*\(?\s*(true|1)\b", re.I)
# The block every packrat-bridge.py carries verbatim; see the bridges' own comment on why it is
# ASCII and .format()-only (Razor Enhanced runs IronPython).
BLOCK_RE = re.compile(r"^# ---- untrusted input.*?^# ---- end of the untrusted-input section.*?$",
                      re.S | re.M)


def read_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def helper_source(text, name):
    m = re.search(r"^def %s\(.*?(?=^def |^[A-Z_]+ = |^# ----|\Z)" % name, text, re.S | re.M)
    return m.group(0).rstrip() if m else None


def constant_source(text, name):
    m = re.search(r"^%s = .*?(?=^[A-Za-z_]|\Z)" % name, text, re.S | re.M)
    return m.group(0).rstrip() if m else None


def adapter_dirs():
    out = []
    for name in sorted(os.listdir(HERE)):
        d = os.path.join(HERE, name)
        if os.path.isdir(d) and os.path.exists(os.path.join(d, "capabilities.json")):
            out.append((name, d))
    return out


def py_files(d):
    return sorted(f for f in os.listdir(d) if f.endswith(".py") and not f.startswith("test_"))


def bridge_dirs():
    return [(n, d) for n, d in adapter_dirs() if os.path.exists(os.path.join(d, "packrat-bridge.py"))]


def load_block(bridge_path):
    """exec the bridge's untrusted-input block in a bare namespace and hand back its globals."""
    m = BLOCK_RE.search(read_text(bridge_path))
    if m is None:
        return None
    ns = {}
    exec(compile(m.group(0), bridge_path, "exec"), ns)
    return ns


class Item(object):
    """A stand-in for the client's item object — only the attributes the code reads."""
    def __init__(self, container=0, **kw):
        self.Container = container
        for k, v in kw.items():
            setattr(self, k, v)


def fresh(**over):
    """A legitimate command exactly as POST /api/bridge writes it, at t=1000000."""
    cmd = {"id": "1700000000000-4213", "action": "grab", "serial": 0x40000010, "name": "Ring",
           "chain": [0x40000001, 0x40000002], "pos": None, "queuedAt": "1970-01-12T13:46:40Z"}
    cmd.update(over)
    return cmd


NOW = 1000000.0   # matches the queuedAt above, so a `fresh()` command is 0 seconds old


class Conventions(unittest.TestCase):
    def test_at_least_the_three_shipped_adapters_are_seen(self):
        names = [n for n, _ in adapter_dirs()]
        self.assertIn("tazuo", names)
        self.assertIn("razor-enhanced", names)
        self.assertIn("classicuo-web", names)

    def test_no_banned_unbounded_loop_literal(self):
        for name, d in adapter_dirs():
            for f in py_files(d):
                t = read_text(os.path.join(d, f))
                self.assertIsNone(BANNED_LOOPS.search(t), "%s/%s" % (name, f))

    def test_import_api_alone_on_its_own_line(self):
        # TazUO's ScriptFile.cs deletes the line matching exactly `import API` and injects the real
        # API as a builtin; `import API, json` does not match and the script then imports the editor
        # stub instead. Only adapters that use the API global at all are checked.
        for name, d in adapter_dirs():
            for f in py_files(d):
                t = read_text(os.path.join(d, f))
                if "import API" not in t:
                    continue
                self.assertRegex(t, r"(?m)^import API$", "%s/%s" % (name, f))

    def test_shared_helpers_identical_within_each_adapter(self):
        for name, d in adapter_dirs():
            files = [f for f in py_files(d) if "def data_dir(" in read_text(os.path.join(d, f))]
            if len(files) < 2:
                continue
            srcs = {f: read_text(os.path.join(d, f)) for f in files}
            for helper in ("data_dir", "write_json_atomic", "rfc3339_now"):
                bodies = {f: helper_source(t, helper) for f, t in srcs.items()}
                for f, b in bodies.items():
                    self.assertIsNotNone(b, "%s/%s lacks %s" % (name, f, helper))
                self.assertEqual(len(set(bodies.values())), 1,
                                 "%s: %s differs between %s" % (name, helper, files))

    def test_capabilities_literal_matches_capabilities_json(self):
        # ast.literal_eval parses the Python literal (True/False/None are valid Python) without
        # executing anything. Every script carrying a CAPABILITIES literal must match the manifest —
        # razor-enhanced keeps its copy in two files, with only a comment asking for it to stay in
        # sync until now.
        for name, d in adapter_dirs():
            caps = json.loads(read_text(os.path.join(d, "capabilities.json")))["capabilities"]
            found = 0
            for f in py_files(d):
                src = constant_source(read_text(os.path.join(d, f)), "CAPABILITIES")
                if src is None:
                    continue
                found += 1
                self.assertEqual(ast.literal_eval(src.split("=", 1)[1].strip()), caps,
                                 "%s/%s CAPABILITIES differs from capabilities.json" % (name, f))
            if os.path.exists(os.path.join(d, "packrat-scanner.py")):
                self.assertGreaterEqual(found, 1, "%s ships no CAPABILITIES literal" % name)

    def test_adapter_version_agrees_with_the_manifest(self):
        for name, d in adapter_dirs():
            version = json.loads(read_text(os.path.join(d, "capabilities.json")))["version"]
            for f in py_files(d):
                t = read_text(os.path.join(d, f))
                if "ADAPTER_VERSION" not in t:
                    continue
                self.assertIn('ADAPTER_VERSION = "%s"' % version, t,
                              "%s/%s does not carry the manifest's version %s" % (name, f, version))

    def test_bridges_never_call_a_public_speech_primitive(self):
        # Every in-game message an adapter prints is client-local. API.Msg / Player.ChatSay et al are
        # network speech packets: a nearby player would see the character announcing its inventory.
        # Matched as a CALL (receiver, name, immediate open paren) so the bridges' own comments
        # explaining which calls they avoid -- "unlike Player.ChatSay/ChatYell/ChatWhisper (see ...)"
        # -- are not mistaken for one.
        speech = re.compile(r"(API\.Msg|Player\.ChatSay|Player\.ChatYell|Player\.ChatWhisper)\(")
        for name, d in adapter_dirs():
            for f in py_files(d):
                t = read_text(os.path.join(d, f))
                self.assertIsNone(speech.search(t), "%s/%s calls a public-speech primitive" % (name, f))

    def test_is_container_in_the_bridge_matches_the_scanner(self):
        # The bridge double-clicks whatever `chain` names, and double-click is UO's universal "use"
        # verb. It must apply the scanner's own container test — including its corpse refusal —
        # rather than a second, drifting copy.
        for name, d in bridge_dirs():
            scanner = os.path.join(d, "packrat-scanner.py")
            if not os.path.exists(scanner):
                continue
            a = helper_source(read_text(scanner), "is_container")
            b = helper_source(read_text(os.path.join(d, "packrat-bridge.py")), "is_container")
            self.assertIsNotNone(a, "%s scanner lacks is_container" % name)
            self.assertIsNotNone(b, "%s bridge lacks is_container" % name)
            self.assertEqual(a, b, "%s: the bridge's is_container has drifted from the scanner's" % name)

    def test_every_bridge_carries_the_same_untrusted_input_block(self):
        blocks = {}
        for name, d in bridge_dirs():
            m = BLOCK_RE.search(read_text(os.path.join(d, "packrat-bridge.py")))
            self.assertIsNotNone(m, "%s's bridge has no untrusted-input block" % name)
            blocks[name] = m.group(0)
        self.assertGreaterEqual(len(blocks), 2, "expected at least two bridges to compare")
        self.assertEqual(len(set(blocks.values())), 1,
                         "the untrusted-input block differs between %s" % sorted(blocks))

    def test_the_block_is_ascii_and_free_of_f_strings(self):
        # Razor Enhanced runs IronPython and the block is shared verbatim, so it stays on the
        # dialect both clients can parse.
        for name, d in bridge_dirs():
            block = BLOCK_RE.search(read_text(os.path.join(d, "packrat-bridge.py"))).group(0)
            block.encode("ascii")   # raises if anything outside ASCII crept in
            self.assertIsNone(re.search(r'f"', block), "%s: f-string in the shared block" % name)


class UntrustedInput(unittest.TestCase):
    """The pure guards, driven directly — once per adapter that ships a bridge."""

    def each(self):
        for name, d in bridge_dirs():
            ns = load_block(os.path.join(d, "packrat-bridge.py"))
            self.assertIsNotNone(ns, "%s has no untrusted-input block" % name)
            yield name, ns

    # ---- freshness -----------------------------------------------------------------------------
    def test_a_stale_command_is_refused_as_expired(self):
        for name, ns in self.each():
            cmd, why = ns["check_command"](fresh(), ["grab"], NOW + 3600)
            self.assertIsNone(cmd, name)
            self.assertIn("expired", why, name)

    def test_a_command_from_the_future_is_refused(self):
        for name, ns in self.each():
            cmd, why = ns["check_command"](fresh(), ["grab"], NOW - 600)
            self.assertIsNone(cmd, name)
            self.assertIn("expired", why, name)

    def test_small_clock_skew_is_tolerated(self):
        for name, ns in self.each():
            cmd, why = ns["check_command"](fresh(), ["grab"], NOW - 2)
            self.assertIsNotNone(cmd, "%s: %s" % (name, why))

    def test_a_missing_or_unreadable_queuedAt_is_refused(self):
        for name, ns in self.each():
            for bad in (None, "", "yesterday", 17, "2026-13-99T99:99:99Z"):
                cmd, why = ns["check_command"](fresh(queuedAt=bad), ["grab"], NOW)
                self.assertIsNone(cmd, "%s accepted queuedAt=%r" % (name, bad))

    def test_parse_rfc3339_reads_both_the_server_and_adapter_stamp_forms(self):
        for name, ns in self.each():
            p = ns["parse_rfc3339"]
            self.assertEqual(p("1970-01-01T00:00:00Z"), 0, name)
            self.assertEqual(p("2026-01-01T12:00:00.000Z"), 1767268800, name)
            self.assertEqual(p("2026-01-01T12:00:00+00:00"), 1767268800, name)
            self.assertEqual(p("2026-01-01T05:00:00-07:00"), 1767268800, name)
            self.assertEqual(p("2026-01-01T14:00:00+02:00"), 1767268800, name)

    # ---- the whole command ---------------------------------------------------------------------
    def test_a_legitimate_command_passes_untouched(self):
        for name, ns in self.each():
            cmd, why = ns["check_command"](fresh(), ["highlight", "grab", "goto"], NOW)
            self.assertIsNotNone(cmd, "%s: %s" % (name, why))
            self.assertEqual(cmd["action"], "grab", name)
            self.assertEqual(cmd["serial"], 0x40000010, name)
            self.assertEqual(cmd["chain"], [0x40000001, 0x40000002], name)
            self.assertEqual(cmd["pos"], None, name)

    def test_a_non_object_payload_is_refused_rather_than_raising(self):
        # A line that PARSES but is not an object used to raise AttributeError outside the per-line
        # handler, which consumed every command behind it in the same read.
        for name, ns in self.each():
            for payload in (None, 17, "grab", [1, 2, 3], True):
                cmd, why = ns["check_command"](payload, ["grab"], NOW)
                self.assertIsNone(cmd, "%s accepted %r" % (name, payload))
                self.assertIn("not a JSON object", why, name)

    def test_an_unknown_action_is_refused(self):
        for name, ns in self.each():
            cmd, why = ns["check_command"](fresh(action="delete-everything"), ["highlight", "grab", "goto"], NOW)
            self.assertIsNone(cmd, name)
            self.assertEqual(why, "unknown action", name)

    def test_a_bad_serial_or_id_is_refused(self):
        for name, ns in self.each():
            for bad in (0, -1, "0x40000010", 1.5, None, True):
                cmd, _ = ns["check_command"](fresh(serial=bad), ["grab"], NOW)
                self.assertIsNone(cmd, "%s accepted serial=%r" % (name, bad))
            for bad in ("", None, 5):
                cmd, _ = ns["check_command"](fresh(id=bad), ["grab"], NOW)
                self.assertIsNone(cmd, "%s accepted id=%r" % (name, bad))

    # ---- chain ---------------------------------------------------------------------------------
    def test_a_chain_longer_than_the_cap_is_refused(self):
        for name, ns in self.each():
            cap = ns["MAX_CHAIN"]
            ok, _ = ns["check_command"](fresh(chain=list(range(1, cap + 1))), ["grab"], NOW)
            self.assertIsNotNone(ok, "%s refused a chain of exactly MAX_CHAIN" % name)
            cmd, why = ns["check_command"](fresh(chain=list(range(1, cap + 2))), ["grab"], NOW)
            self.assertIsNone(cmd, name)
            self.assertIn("longer than", why, name)

    def test_a_chain_entry_that_is_not_a_serial_is_refused(self):
        for name, ns in self.each():
            for bad in ("0x4001", 1.5, None, [], 0, -3, True):
                cmd, _ = ns["check_command"](fresh(chain=[0x40000001, bad]), ["grab"], NOW)
                self.assertIsNone(cmd, "%s accepted a chain entry %r" % (name, bad))
            cmd, _ = ns["check_command"](fresh(chain="0x40000001"), ["grab"], NOW)
            self.assertIsNone(cmd, "%s accepted a string chain" % name)

    # ---- pos -----------------------------------------------------------------------------------
    def test_pos_must_be_null_or_a_bounded_xyz(self):
        for name, ns in self.each():
            good = {"x": 1520, "y": 1631, "z": 0}
            cmd, why = ns["check_command"](fresh(action="goto", pos=good), ["goto"], NOW)
            self.assertIsNotNone(cmd, "%s: %s" % (name, why))
            self.assertEqual(cmd["pos"], good, name)
            cmd, _ = ns["check_command"](fresh(pos={**good, "facet": 1}), ["grab"], NOW)
            self.assertEqual(cmd["pos"]["facet"], 1, name)
            for bad in ({}, {"x": "1", "y": 2, "z": 0}, {"x": 1, "y": 2},
                        {"x": -1, "y": 2, "z": 0}, {"x": 99999, "y": 2, "z": 0},
                        {"x": 1, "y": 99999, "z": 0}, {"x": 1, "y": 2, "z": 9999},
                        {"x": 1, "y": 2, "z": 0, "facet": 9}, {"x": 1, "y": 2, "z": 0, "cmd": "rm"},
                        [1, 2], "1,2", 5):
                cmd, _ = ns["check_command"](fresh(pos=bad), ["grab"], NOW)
                self.assertIsNone(cmd, "%s accepted pos=%r" % (name, bad))

    def test_a_destination_further_than_the_walk_bound_is_refused(self):
        for name, ns in self.each():
            limit = ns["MAX_WALK_TILES"]
            self.assertTrue(ns["within_walk"](1000, 1000, 1000 + limit, 1000), name)
            self.assertTrue(ns["within_walk"](1000, 1000, 1000, 1000 - limit), name)
            self.assertFalse(ns["within_walk"](1000, 1000, 1000 + limit + 1, 1000), name)
            self.assertFalse(ns["within_walk"](1000, 1000, 1500, 1631), name)

    # ---- name ----------------------------------------------------------------------------------
    def test_a_name_is_a_bounded_string(self):
        for name, ns in self.each():
            cmd, _ = ns["check_command"](fresh(name="A" * 5000), ["grab"], NOW)
            self.assertEqual(len(cmd["name"]), ns["MAX_NAME"], name)
            cmd, _ = ns["check_command"](fresh(name=None), ["grab"], NOW)
            self.assertEqual(cmd["name"], "", name)
            cmd, _ = ns["check_command"](fresh(name={"x": 1}), ["grab"], NOW)
            self.assertIsNone(cmd, name)

    # ---- the burst budget ----------------------------------------------------------------------
    def test_a_twenty_five_piece_grab_all_fits_the_budget(self):
        # app/ui/bridge.mts queues one grab per fetch-list piece, 300 ms apart; a suit is 10-20
        # pieces. The budget exists to refuse a flood, and must never refuse this.
        for name, ns in self.each():
            stamps, now = [], NOW
            for i in range(25):
                self.assertTrue(ns["budget_ok"](stamps, now), "%s refused grab %d of a Grab all" % (name, i + 1))
                stamps.append(now)
                now += 0.3

    def test_a_flood_trips_the_budget(self):
        for name, ns in self.each():
            limit = ns["MAX_CMDS_PER_WINDOW"]
            stamps = [NOW] * limit
            self.assertFalse(ns["budget_ok"](stamps, NOW + 1), name)
            # ... and the window rolls: once they age out, clicking works again.
            self.assertTrue(ns["budget_ok"](stamps, NOW + ns["BUDGET_WINDOW_S"] + 1), name)
            self.assertEqual(stamps, [], "%s did not drop aged-out stamps" % name)

    # ---- reading the queue file ----------------------------------------------------------------
    def test_a_trailing_partial_line_is_left_for_the_next_poll(self):
        for name, ns in self.each():
            lines, consumed = ns["split_lines"](b'{"a":1}\n{"b":2}\n{"half"', False)
            self.assertEqual(lines, ['{"a":1}', '{"b":2}'], name)
            self.assertEqual(consumed, 16, name)

    def test_an_over_long_line_is_refused_without_being_parsed(self):
        for name, ns in self.each():
            huge = b'{"x":"' + b"A" * (ns["MAX_LINE_BYTES"] + 10) + b'"}'
            lines, consumed = ns["split_lines"](b'{"a":1}\n' + huge + b"\n", False)
            self.assertEqual(lines, ['{"a":1}', None], name)
            self.assertEqual(consumed, len(huge) + 9, name)

    def test_a_chunk_with_no_newline_at_all_still_advances_when_the_read_was_full(self):
        # Otherwise a single enormous line is re-read forever and the offset never moves.
        for name, ns in self.each():
            lines, consumed = ns["split_lines"](b"A" * 64, True)
            self.assertEqual((lines, consumed), ([None], 64), name)
            self.assertEqual(ns["split_lines"](b"A" * 64, False), ([], 0), name)

    def test_blank_lines_are_skipped(self):
        for name, ns in self.each():
            lines, _ = ns["split_lines"](b'\n\n{"a":1}\n\n', False)
            self.assertEqual(lines, ['{"a":1}'], name)

    # ---- grab source ---------------------------------------------------------------------------
    def test_resolve_root_stops_at_the_player_and_finds_the_backpack(self):
        # item -> backpack -> (the player mobile, which is not an item, so find() returns None)
        pack, player, item = 0x40000001, 0x00000abc, 0x40000010
        world = {item: Item(container=pack), pack: Item(container=player)}
        for name, ns in self.each():
            self.assertEqual(ns["resolve_root"](item, world.get), pack, name)

    def test_resolve_root_finds_a_ground_chest_through_nested_bags(self):
        chest, bag, item = 0x40000001, 0x40000002, 0x40000010
        world = {item: Item(container=bag), bag: Item(container=chest), chest: Item(container=0)}
        for name, ns in self.each():
            self.assertEqual(ns["resolve_root"](item, world.get), chest, name)

    def test_resolve_root_survives_a_cycle_and_an_unknown_item(self):
        a, b = 0x40000001, 0x40000002
        cyclic = {a: Item(container=b), b: Item(container=a)}
        for name, ns in self.each():
            self.assertIn(ns["resolve_root"](a, cyclic.get), (a, b), name)
            self.assertEqual(ns["resolve_root"](0x40000099, {}.get), 0x40000099, name)

    def test_resolve_root_refuses_to_climb_into_another_players_pack(self):
        # A friend's backpack the client happens to know: the root resolves to THEIR pack, which is
        # not the player's backpack/bank and not in the command's chain, so do_grab refuses it.
        their_pack, them, item = 0x40000077, 0x00000def, 0x40000078
        world = {item: Item(container=their_pack), their_pack: Item(container=them)}
        my_pack, my_bank = 0x40000001, 0x40000002
        for name, ns in self.each():
            root = ns["resolve_root"](item, world.get)
            self.assertEqual(root, their_pack, name)
            self.assertNotIn(root, set([my_pack, my_bank]) | set([0x40000003]), name)


if __name__ == "__main__":
    unittest.main()
