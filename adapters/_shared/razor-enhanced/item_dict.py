def item_dict(it, lines, container_serial, layer=None):
    d = {
        "serial": as_int(getattr(it, "Serial", 0)),
        "graphic": as_int(getattr(it, "ItemID", 0)),
        "hue": as_int(getattr(it, "Hue", 0)),
        "amount": as_int(getattr(it, "Amount", 1), 1) or 1,
        "name": lines[0] if lines else str(getattr(it, "Name", "") or ""),
        "tooltip": lines,
        "container": container_serial,
        "nameSource": "opl",
    }
    if layer:
        d["layer"] = layer
    return d
