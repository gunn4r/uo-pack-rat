def tooltip_lines(serial):
    try:
        data = API.ItemNameAndProps(int(serial), True)
    except Exception:
        data = None
    return [ln.strip() for ln in str(data or "").splitlines() if ln.strip()]
