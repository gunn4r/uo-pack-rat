def tooltip_lines(serial, wait=True):
    """The item's tooltip lines. `wait`: the client waits up to 10 s for a tooltip it does not have yet
    (TazUO's ItemNameAndProps); without it, a missing tooltip reads as none at once."""
    try:
        data = API.ItemNameAndProps(int(serial), wait)
    except Exception:
        data = None
    return [ln.strip() for ln in str(data or "").splitlines() if ln.strip()]
