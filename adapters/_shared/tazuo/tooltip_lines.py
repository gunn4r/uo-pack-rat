def tooltip_lines(serial, wait=True, timeout=None):
    """The item's tooltip lines. `wait`: the client waits for a tooltip it does not have yet, up to
    `timeout` s (TazUO's ItemNameAndProps, 10 s when not given); without it, a missing tooltip reads as
    none at once. A build whose ItemNameAndProps takes no timeout gets the read without one (its own
    10 s wait), never none: a trash check must not fall back to a cached name ("barrel") over it."""
    try:
        data = API.ItemNameAndProps(int(serial), wait) if timeout is None else API.ItemNameAndProps(int(serial), wait, timeout)
    except Exception:
        try:
            data = API.ItemNameAndProps(int(serial), wait) if timeout is not None else None
        except Exception:
            data = None
    return [ln.strip() for ln in str(data or "").splitlines() if ln.strip()]
