def house_capture(px, py):
    """The house the player stands in, from the client's own house tiles (issue #10), or None outside a house or on a build without the multi calls. Only the tiles connected to the player's tile are kept (8-connected in x/y, across every z), so a neighbouring house is left out. What stands on the ground inside that footprint is recorded too (both left out when the ground cannot be read): furniture and fixtures as `items`, and every container as `containers` (2.11.0), opened or not, so the map shows a chest from the first scan even when it stood too far away to open; corpses, trash containers and blacklisted ones are left out (trash by name, or because the roots pass, which runs first, read its tooltip; a far trash container whose cached name is generic cannot be told apart without a tooltip query, which this never makes). Names come from tiledata in the app, so this asks the server nothing. A house of more than HOUSE_MAX_TILES tiles is left out and its count noted in HOUSE_TOO_LARGE."""
    at = getattr(API, "GetMultisAt", None)
    area = getattr(API, "GetMultisInArea", None)
    if at is None or area is None:
        return None
    try:
        if not list(at(px, py) or []):
            return None
        found = list(area(px - HOUSE_RADIUS, py - HOUSE_RADIUS, px + HOUSE_RADIUS, py + HOUSE_RADIUS) or [])
    except Exception:
        return None
    cells = {}
    for m in found:
        try:
            t = [int(m.Graphic), int(m.X), int(m.Y), int(m.Z), 1 if bool(getattr(m, "Impassible", False)) else 0]
        except Exception:
            continue
        cells.setdefault((t[1], t[2]), []).append(t)
    if (px, py) not in cells:
        return None
    keep = {(px, py)}
    todo = [(px, py)]
    while todo:
        x, y = todo.pop()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                n = (x + dx, y + dy)
                if n in cells and n not in keep:
                    keep.add(n)
                    todo.append(n)
    tiles = sorted(t for c in keep for t in cells[c])
    if len(tiles) > HOUSE_MAX_TILES:
        HOUSE_TOO_LARGE.append(len(tiles))
        return None
    house = {"capturedAt": rfc3339_now(), "at": {"x": int(px), "y": int(py)}, "tiles": tiles}
    f = facet()
    if f is not None:
        house["facet"] = f
    # The furniture: when the ground cannot be read, items is left out, so the app erases nothing it knew from an earlier capture (an empty list would say the house stands empty).
    on_ground = getattr(API, "GetItemsOnGround", None)
    try:
        ground = list(on_ground(HOUSE_ITEM_REACH) or []) if on_ground is not None else None
    except Exception:
        ground = None
    if ground is None:
        return house
    items, chests = [], []
    for g in ground:
        try:
            if (int(g.X), int(g.Y)) not in keep:
                continue
            row = [int(g.Serial), int(getattr(g, "Graphic", 0) or 0), int(g.X), int(g.Y), int(getattr(g, "Z", 0) or 0)]
            name = str(getattr(g, "Name", "") or "")
            if not is_container(g, name):
                items.append(row)
            elif row[0] not in BLACKLIST and row[0] not in TRASHED and not TRASH_RE.search(name):
                chests.append(row)
        except Exception:
            continue

    def nearest(row):
        return (max(abs(row[2] - px), abs(row[3] - py)), row[0])
    # The house itself is an Item whose graphic is its multi id (ServUO Scripts/Multis/HousePlacementTool.cs: 0x13EC to 0x147B), standing at the plot centre. ServUO's Telescope addon (Scripts/Items/Addons/Telescope.cs) also has a component with graphic 0x147B, so only the one in-range item nearest the centre of the tiles' x/y bounds is dropped (ties to the lowest serial), and only when it is within HOUSE_ITEM_CENTRE_RADIUS of that centre.
    multis = [r for r in items if HOUSE_MULTI_IDS[0] <= r[1] <= HOUSE_MULTI_IDS[1]]
    if multis:
        xs, ys = [c[0] for c in keep], [c[1] for c in keep]
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        best = min(multis, key=lambda r: ((r[2] - cx) ** 2 + (r[3] - cy) ** 2, r[0]))
        if max(abs(best[2] - cx), abs(best[3] - cy)) <= HOUSE_ITEM_CENTRE_RADIUS:
            items.remove(best)
    items.sort(key=nearest)
    HOUSE_LEFT_OUT.update(i[0] for i in items[HOUSE_MAX_ITEMS:])
    house["items"] = sorted(items[:HOUSE_MAX_ITEMS])
    chests.sort(key=nearest)
    house["containers"] = sorted(chests[:HOUSE_MAX_CONTAINERS])
    return house
