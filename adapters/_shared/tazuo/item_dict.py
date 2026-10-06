def item_dict(it, lines, container, layer=None):
    d = {"serial": int(it.Serial), "graphic": int(getattr(it, "Graphic", 0) or 0),
         "hue": int(getattr(it, "Hue", 0) or 0), "amount": int(getattr(it, "Amount", 1) or 1),
         "name": lines[0] if lines else str(getattr(it, "Name", "") or ""),
         "tooltip": lines, "container": container, "nameSource": "opl"}
    if layer:
        d["layer"] = layer
    return d
