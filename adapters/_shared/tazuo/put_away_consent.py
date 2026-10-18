PUT_AWAY_VAR = "packrat_putaway"   # Put away's consent, a client shared variable: the panel sets it, the bridge checks it


def put_away_consent(container, until):
    """PUT_AWAY_VAR's value while a Put away run on `container` may last until `until` (epoch seconds):
    "<container serial>:<until>". "" withdraws it."""
    return "%d:%f" % (container, until)


def put_away_parts(value):
    """(container, until) from PUT_AWAY_VAR's `value`, or None when it holds no consent."""
    try:
        serial, until = str(value).split(":")
        return int(serial), float(until)
    except Exception:
        return None
