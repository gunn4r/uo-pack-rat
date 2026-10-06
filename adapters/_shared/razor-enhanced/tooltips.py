def tooltip_lines(it):
    """RAW tooltip lines for one Item, via Item.Properties (List[Property]; Property.ToString()
    renders one line, per razorenhanced.readthedocs.io/api/Property.html). Requests the read first
    with WaitForProps -- an Item's Properties can be empty/stale until the client has asked the
    server for them at least once."""
    try:
        Items.WaitForProps(it, PROPS_WAIT_MS)
    except Exception:
        pass
    lines = []
    try:
        props = it.Properties or []
    except Exception:
        props = []
    for p in props:
        try:
            line = str(p).strip()
        except Exception:
            continue
        if line:
            lines.append(line)
    return lines


def name_of(it):
    """An item's tooltip name ("A Trash Barrel"), which the client's own cached Name may not carry
    (just "barrel" for that art); the cached Name is the fallback when the tooltip reads nothing."""
    lines = tooltip_lines(it)
    return lines[0] if lines else str(getattr(it, "Name", "") or "")
