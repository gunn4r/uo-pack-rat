def facet():
    """The map the player stands on (Player.Map: 0 Felucca .. 5 Ter Mur), and so every ground root's:
    they are all within reach. None when this build cannot say, or says anything but 0-5."""
    try:
        m = int(getattr(Player, "Map"))
    except Exception:
        return None
    return m if 0 <= m <= 5 else None


def root_pos(it, kind):
    """World position of a ground container (so the bridge can walk to it later), with its facet when
    the client says; None for pack/bank."""
    if kind != "ground":
        return None
    try:
        p = it.Position
        pos = {"x": as_int(p.X), "y": as_int(p.Y), "z": as_int(p.Z)}
    except Exception:
        return None
    f = facet()
    if f is not None:
        pos["facet"] = f
    return pos


def root_entry(it, kind, label):
    """A root's containers entry. A ground root carries its tooltip too, as a nested bag does: its
    Contents line ("Contents: 13/125 Items, 95 Stones") is how the app knows the room left in it, and
    an engraving on it names it."""
    serial = as_int(getattr(it, "Serial", 0))
    entry = {"serial": serial, "name": label, "parent": None, "root": serial, "kind": kind, "pos": root_pos(it, kind)}
    if kind == "ground":
        entry["tooltip"] = tooltip_lines(it)
    return entry


def container_entry(cont, root_serial, opened):
    lines = tooltip_lines(cont)
    entry = {"serial": as_int(getattr(cont, "Serial", 0)),
             "name": lines[0] if lines else str(getattr(cont, "Name", "") or ""),
             "parent": as_int(getattr(cont, "Container", 0), root_serial) or root_serial,
             "root": root_serial, "kind": "container", "tooltip": lines}
    if not opened:
        entry["opened"] = False
    return entry


def scan_root(root_item, kind, label, containers, items, seen):
    """Open root_item and every nested container inside it, breadth-first, up to MAX_NEST levels
    deep, listing everything. Returns (item_count, opened) -- opened=False means the root itself
    could not be opened (too far, locked, a slow server): the app's fold then keeps whatever it last
    knew about this root instead of wiping it (see docs/scan-schema.md's Fold rules). A bag INSIDE
    the root that did not open, or sits deeper than MAX_NEST, is recorded with "opened": False, and
    the fold keeps whatever it last knew inside that one bag while the rest of the root updates."""
    root_serial = as_int(getattr(root_item, "Serial", 0))
    queue = [root_item]
    seen_containers = set()
    n_items = 0
    depth = 0
    while queue and depth < MAX_NEST:
        depth += 1
        next_queue = []
        for cont in queue:
            cserial = as_int(getattr(cont, "Serial", 0))
            if cserial in seen_containers:
                continue
            seen_containers.add(cserial)
            note_if_closed(cont)
            try:
                arrived = bool(Items.WaitForContents(cont, CONTENTS_WAIT_MS))
            except Exception:
                arrived = False
            try:
                kids = list(cont.Contains or [])
            except Exception:
                kids = []
            # WaitForContents timed out and the client holds nothing for it: unopened, not empty.
            # (Whether RE answers True for a bag that opened EMPTY is undocumented; if it does not,
            # an empty bag lands here too, which only keeps its -- empty -- old contents.)
            unopened = not arrived and not kids
            if cserial == root_serial:
                if unopened:
                    return 0, False
                containers[root_serial] = root_entry(root_item, kind, label)
            else:
                containers[cserial] = container_entry(cont, root_serial, not unopened)
                if unopened:
                    note_unopened(containers[cserial], label)
            for kid in kids:
                ks = as_int(getattr(kid, "Serial", 0))
                if ks in seen:
                    continue
                seen.add(ks)
                if ks in BLACKLIST:       # recorded unopened, never opened: the fold keeps what it knew inside
                    SKIPPED.add(ks)
                    containers[ks] = container_entry(kid, root_serial, False)
                    continue
                if is_container(kid):
                    if TRASH_RE.search(name_of(kid)):
                        TRASHED.add(ks)   # not recorded, never opened
                    else:
                        next_queue.append(kid)
                else:
                    items.append(item_dict(kid, tooltip_lines(kid), cserial))
                    n_items += 1
        queue = next_queue
    # Anything still queued here was found (its parent container was already opened) but MAX_NEST
    # was reached before it could be opened itself: recorded as a bag not opened, so the fold keeps
    # what it knew inside it -- the same handling adapters/tazuo/packrat-scanner.py gives the case.
    for cont in queue:
        entry = container_entry(cont, root_serial, False)
        containers[entry["serial"]] = entry
        note_unopened(entry, label)
    return n_items, True


def note_if_closed(cont):
    """Remember a container this run is about to open for the first time, so close_opened() closes
    only windows the run opened. Item.ContainerOpened is RE's documented "the container was opened"
    flag: RE sets it when the contents first arrive and never clears it when the window closes, so a
    container opened any time earlier this session (by the player, or by an earlier scan) counts as
    already open and is left open. That errs on the side of never closing a window the player opened."""
    try:
        if not bool(getattr(cont, "ContainerOpened", False)):
            OPENED_HERE.append(as_int(getattr(cont, "Serial", 0)))
    except Exception:
        pass


def close_opened():
    """Close the container windows this run opened, innermost first, with RE's documented
    Items.Close(serial) ("Close opened container window"). Runs once everything has been read and the
    scan file written, or after the script is stopped or fails, so it never changes what is recorded.
    A build without Items.Close leaves the windows open rather than raising."""
    close = getattr(Items, "Close", None)
    for serial in reversed(OPENED_HERE):
        if close is None:
            break
        try:
            close(serial)
        except Exception:
            pass
    del OPENED_HERE[:]


def note_unopened(entry, label):
    sysmsg("  {0} in {1} was not opened -- its contents are kept from the last scan".format(
        entry["name"] or "a container", label), ALARM_HUE)
