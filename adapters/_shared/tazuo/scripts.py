SCANNER, REFRESH, HOUSE = "packrat-scanner.py", "packrat-character-refresh.py", "packrat-house-map-refresh.py"


def script_prefix(self_name):
    """The folder of the running script `self_name`, relative to LegionScripts ('' or 'Group/'): PlayScript
    and IsScriptRunning match on that relative path exactly, and a bare name misses a script inside a group
    folder. Read off the script's own entry in API.ListRunningScripts(); the Pack Rat scripts are siblings."""
    try:
        running = API.ListRunningScripts() or []
    except Exception:
        running = []
    for p in running:
        p = str(p).replace("\\", "/")
        if p == self_name or p.endswith("/" + self_name):
            return p[: len(p) - len(self_name)]
    return ""
