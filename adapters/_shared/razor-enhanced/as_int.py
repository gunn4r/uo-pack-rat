def as_int(v, default=0):
    try:
        return int(v)
    except Exception:
        return default
