def is_trash(serial, name):
    """A container is trash by its tooltip name ("A Trash Barrel"): the client's own cached name for the
    art may be just "barrel". The cached name is the fallback when the tooltip reads nothing."""
    lines = tooltip_lines(serial)
    return bool(TRASH_RE.search(lines[0] if lines else name or ""))
