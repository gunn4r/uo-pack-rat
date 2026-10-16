CLAIMS_PATH = os.path.join(data_dir(), "house-claims.json")
NOT_CLAIMED = "Not in one of your houses, so only your pack was scanned. Use Claim this house in the Pack Rat panel if this house is yours."


def read_claims(path):
    """The valid entries of <data directory>/house-claims.json, the houses the player claimed (issue #299:
    {id, facet, bounds: {x0, y0, x1, y1}, claimedAt, by?}), the same checks app/store/house-claims.mts makes.
    A bad entry is dropped, and a missing, unreadable or oversized file reads as none: a scan then reads
    no ground container."""
    def ok(e):
        b = e.get("bounds") if isinstance(e, dict) else None
        return (isinstance(b, dict) and isinstance(e.get("id"), str) and re.match(r"^(\d{1,3}|x)-\d{1,6}-\d{1,6}$", e["id"])
                and "facet" in e and (e["facet"] is None or (type(e["facet"]) is int and 0 <= e["facet"] <= 5))
                and all(type(b.get(k)) is int and 0 <= b[k] <= 999999 for k in ("x0", "y0", "x1", "y1")) and b["x0"] <= b["x1"] and b["y0"] <= b["y1"]
                and isinstance(e.get("claimedAt"), str) and len(e["claimedAt"]) <= 40 and (e.get("by") is None or (isinstance(e["by"], str) and len(e["by"]) <= 64)))
    try:
        if os.path.getsize(path) > 256 * 1024:
            return []
        with open(path, "r", encoding="utf-8") as f:
            doc = json.load(f)
        return [e for e in doc if ok(e)][:500]
    except Exception:
        return []


def claims_over(here, claims):
    """The claims the house `here` (house_here's (id, facet, bounds), or None) falls under: on its facet,
    with bounds overlapping its own, so a house customized since it was claimed still counts."""
    if here is None:
        return []
    f, b = here[1], here[2]
    return [c for c in claims if c.get("facet") == f and c["bounds"]["x0"] <= b["x1"] and b["x0"] <= c["bounds"]["x1"]
            and c["bounds"]["y0"] <= b["y1"] and b["y0"] <= c["bounds"]["y1"]]
