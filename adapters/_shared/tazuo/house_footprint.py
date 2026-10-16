def house_footprint(px, py):
    """The house the player stands in, from the client's own house tiles (issue #10): its tiles, sorted, each [graphic, x, y, z, impassable], and the (x, y) cells they cover; or None outside a house or on a build without the multi calls. Only the tiles connected to the player's tile are kept (8-connected in x/y, across every z), so a neighbouring house is left out. It reads only tiles the client has: it records nothing and asks the server nothing."""
    at = getattr(API, "GetMultisAt", None)
    area = getattr(API, "GetMultisInArea", None)
    if at is None or area is None:
        return None
    try:
        if not list(at(px, py) or []):
            return None
        found = list(area(px - HOUSE_RADIUS, py - HOUSE_RADIUS, px + HOUSE_RADIUS, py + HOUSE_RADIUS) or [])
    except Exception:
        return None
    cells = {}
    for m in found:
        try:
            t = [int(m.Graphic), int(m.X), int(m.Y), int(m.Z), 1 if bool(getattr(m, "Impassible", False)) else 0]
        except Exception:
            continue
        cells.setdefault((t[1], t[2]), []).append(t)
    if (px, py) not in cells:
        return None
    keep = {(px, py)}
    todo = [(px, py)]
    while todo:
        x, y = todo.pop()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                n = (x + dx, y + dy)
                if n in cells and n not in keep:
                    keep.add(n)
                    todo.append(n)
    return sorted(t for c in keep for t in cells[c]), keep


def house_here():
    """The house the player stands in as (id, facet, bounds), or None (house_footprint, so only tiles are read). The id is the app's (app/house-capture.mts houseIdOf: "<facet>-<x0>-<y0>", the facet "x" when the client cannot say), and bounds {x0, y0, x1, y1} span every tile."""
    try:
        fp = house_footprint(int(API.Player.X), int(API.Player.Y))
    except Exception:
        return None
    if fp is None:
        return None
    xs, ys = [c[0] for c in fp[1]], [c[1] for c in fp[1]]
    f = facet()
    bounds = {"x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys)}
    return "%s-%d-%d" % ("x" if f is None else f, bounds["x0"], bounds["y0"]), f, bounds
