import ast, json, os, re, sys, tempfile, unittest
HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = ["packrat-scanner.py", "packrat-refresh.py", "packrat-bridge.py"]

def helper_source(text, name):
    m = re.search(r"^def %s\(.*?(?=^def |^[A-Z_]+ = |\Z)" % name, text, re.S | re.M)
    return m.group(0) if m else None

def constant_source(text, name):
    m = re.search(r"^%s = .*?(?=^[A-Za-z_]|\Z)" % name, text, re.S | re.M)
    return m.group(0) if m else None

def read_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()

class Paths(unittest.TestCase):
    def test_helpers_identical_and_present(self):
        srcs = {s: read_text(os.path.join(HERE, s)) for s in SCRIPTS}
        for name in ("data_dir", "write_json_atomic", "rfc3339_now"):
            bodies = {s: helper_source(t, name) for s, t in srcs.items()}
            for s, b in bodies.items(): self.assertIsNotNone(b, "%s lacks %s" % (s, name))
            self.assertEqual(len(set(bodies.values())), 1, "%s differs between scripts" % name)

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
        # Every script carries the adapter identity constants; the scanner and refresh (the two
        # that write scan files) emit schemaVersion 2 and drop the old top-level "version": 1 key.
        for s in SCRIPTS:
            t = read_text(os.path.join(HERE, s))
            self.assertIn('ADAPTER_ID = "tazuo"', t, s)
            self.assertIn('ADAPTER_VERSION = "2.5.0"', t, s)
            self.assertNotIn('"version": 1', t, s)
        for s in ("packrat-scanner.py", "packrat-refresh.py"):
            t = read_text(os.path.join(HERE, s))
            self.assertIn('"schemaVersion": 2', t, s)

    def test_capabilities_literal_matches_capabilities_json(self):
        # The scanner's CAPABILITIES dict literal (written into every scan's adapter.capabilities)
        # must be exactly what adapters/tazuo/capabilities.json advertises — ast.literal_eval parses
        # the Python literal (True/False/None are valid Python) without executing anything.
        t = read_text(os.path.join(HERE, "packrat-scanner.py"))
        src = constant_source(t, "CAPABILITIES")
        self.assertIsNotNone(src, "scanner lacks a CAPABILITIES literal")
        literal = ast.literal_eval(src.split("=", 1)[1].strip())
        with open(os.path.join(HERE, "capabilities.json"), encoding="utf-8") as f:
            caps = json.load(f)["capabilities"]
        self.assertEqual(literal, caps)

if __name__ == "__main__": unittest.main()
