"""test_paths.py -- the TazUO adapters' shared data-directory resolver and script header rules.

The resolver reads `packrat-paths.json` beside the script, else `PACKRAT_DATA`, else `~/.pack-rat`, matching `app/config.mts`'s precedence. It is Python, but it is not a separate runner step: `app/adapters.test.mts` walks `adapters/` for every `test_*.py` and spawns each one (`python3 -W error`, or `python`) as its own `[fast]` case, skipped with a note if no Python 3 interpreter is on PATH.

Run: python3 -W error adapters/tazuo/test_paths.py
"""
import json, os, re, sys, tempfile, unittest
HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = ["packrat-scanner.py", "packrat-character-refresh.py", "packrat-house-map-refresh.py", "packrat-bridge.py", "packrat-panel.py"]

def helper_source(text, name):
    m = re.search(r"^def %s\(.*?(?=^def |^[A-Z_]+ = |\Z)" % name, text, re.S | re.M)
    return m.group(0) if m else None

def read_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()

class Paths(unittest.TestCase):
    def test_no_while_true_and_import_api_alone(self):
        for s in SCRIPTS:
            t = read_text(os.path.join(HERE, s))
            self.assertIsNone(re.search(r"while\s*\(?\s*(true|1)\b", t, re.I), s)
            self.assertRegex(t, r"(?m)^import API$")

    def test_data_dir_resolution(self):
        t = read_text(os.path.join(HERE, SCRIPTS[0]))
        ns = {"os": os, "json": json}
        exec(helper_source(t, "data_dir") + "\n" + helper_source(t, "write_json_atomic"), ns)
        with tempfile.TemporaryDirectory() as d:
            ns["__file__"] = os.path.join(d, "x.py")
            prev = os.environ.get("PACKRAT_DATA")
            os.environ["PACKRAT_DATA"] = "/env/dir"
            try:
                self.assertEqual(ns["data_dir"](), "/env/dir")
                with open(os.path.join(d, "packrat-paths.json"), "w") as f: json.dump({"dataDir": "/cfg/dir"}, f)
                self.assertEqual(ns["data_dir"](), "/cfg/dir")
                p = os.path.join(d, "a", "b.json"); ns["write_json_atomic"](p, {"k": 1})
                with open(p) as f:
                    self.assertEqual(json.load(f), {"k": 1})
                self.assertFalse(os.path.exists(p + ".tmp"))
            finally:
                if prev is None:
                    os.environ.pop("PACKRAT_DATA", None)
                else:
                    os.environ["PACKRAT_DATA"] = prev

    def test_rfc3339_now_shape(self):
        t = read_text(os.path.join(HERE, SCRIPTS[0]))
        ns = {"time": __import__("time")}
        exec(helper_source(t, "rfc3339_now"), ns)
        stamp = ns["rfc3339_now"]()
        self.assertRegex(stamp, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$")

    def test_scan_v2_header_fields(self):
        # Every script carries the adapter identity constants; the scanner and the two refreshes (the
        # three that write scan files) emit schemaVersion 2 and drop the old top-level "version": 1 key.
        for s in SCRIPTS:
            t = read_text(os.path.join(HERE, s))
            self.assertIn('ADAPTER_ID = "tazuo"', t, s)
            self.assertNotIn('"version": 1', t, s)
        for s in ("packrat-scanner.py", "packrat-character-refresh.py", "packrat-house-map-refresh.py"):
            t = read_text(os.path.join(HERE, s))
            self.assertIn('"schemaVersion": 2', t, s)

if __name__ == "__main__": unittest.main()
