TRASH_WAIT_S = 2         # the longest wait for a container's tooltip name, so a recall among many bags is caught soon


def is_trash(serial, name):
    """A container is trash by its tooltip name ("A Trash Barrel"): the client's own cached name for the
    art may be just "barrel". The cached name is the fallback when the tooltip reads nothing within
    TRASH_WAIT_S."""
    lines = tooltip_lines(serial, True, TRASH_WAIT_S)
    return bool(TRASH_RE.search(lines[0] if lines else name or ""))
