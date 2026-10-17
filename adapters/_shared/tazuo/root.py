def root_pos(serial, kind):
    """World position of a ground container (so the bridge can walk to it later), with its facet when
    the client says; None for pack/bank."""
    if kind != "ground":
        return None
    try:
        it = API.FindItem(int(serial))
        if it is None:
            return None
        pos = {"x": int(it.X), "y": int(it.Y), "z": int(getattr(it, "Z", 0) or 0)}
    except Exception:
        return None
    f = facet()
    if f is not None:
        pos["facet"] = f
    return pos


def look(it):
    """A container's graphic and hue (issue #174), for its art in the app; empty when the client has no
    item for it or cannot say."""
    try:
        graphic, hue = int(getattr(it, "Graphic", 0) or 0), int(getattr(it, "Hue", 0) or 0)
        return {"graphic": graphic, "hue": hue} if 0 < graphic <= 0xFFFF and 0 <= hue <= 0xFFFF else {}
    except Exception:
        return {}


def root_entry(serial, kind, label):
    """A root's containers entry. A ground root carries its tooltip too, as a nested bag does: its
    Contents line ("Contents: 13/125 Items, 95 Stones") is how the app knows the room left in it, and
    an engraving on it names it."""
    entry = {"serial": serial, "name": label, "parent": None, "root": serial, "kind": kind, "pos": root_pos(serial, kind)}
    if kind == "ground":
        entry["tooltip"] = tooltip_lines(serial)
    try:
        entry.update(look(API.FindItem(int(serial))))
    except Exception:
        pass
    return entry
