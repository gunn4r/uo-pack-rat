def data_dir():
    """<script folder>/packrat-paths.json {"dataDir": "..."} → $PACKRAT_DATA → ~/.pack-rat"""
    try:
        here = os.path.dirname(os.path.abspath(__file__))
    except NameError:                    # a host that runs the script text without defining __file__
        try:
            here = str(API.ScriptPath)
        except Exception:
            here = ""
    cfg = os.path.join(here, "packrat-paths.json") if here else ""
    if cfg and os.path.exists(cfg):
        with open(cfg, "r", encoding="utf-8") as f:
            d = json.load(f).get("dataDir")
        if d:
            # app/schema/packrat-paths.v1.schema.json's shapes: a relative path would land under the client's own
            # working folder and ~user/ elsewhere, unseen by the app, so refuse to start instead.
            drive = len(d) > 2 and "a" <= d[0].lower() <= "z" and d[1] == ":" and d[2] in "/\\"
            if not (drive or d == "~" or d.startswith(("/", "\\\\", "~/", "~\\"))):
                raise ValueError("packrat-paths.json: dataDir must be an absolute folder or start with ~/")
            return os.path.expanduser(d)
    return os.path.expanduser(os.environ.get("PACKRAT_DATA") or "~/.pack-rat")


def write_json_atomic(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, path)
