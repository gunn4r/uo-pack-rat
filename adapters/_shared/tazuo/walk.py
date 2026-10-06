def was_opened(serial):
    """The client's own word that a container's contents arrived (its gump opened)."""
    try:
        it = API.FindItem(int(serial))
        return it is not None and bool(getattr(it, "Opened", False))
    except Exception:
        return False


def note_if_closed(serial):
    """Remember a container whose window is not open yet, just before this run opens it, so
    close_opened() closes exactly the windows the run opened and never one the player had open. The
    client's own item object is kept rather than the serial: once Stop is pressed the client cancels
    the script's lookups (FindItem answers nothing), while an item object still reaches its window."""
    try:
        it = API.FindItem(int(serial))
        if it is not None and not bool(getattr(it, "Opened", False)):
            OPENED_HERE.append(it)
    except Exception:
        pass


def scan_root(root_serial, kind, label, containers, items, seen):
    """Open root + every nested container, list everything. Returns the item count, or -1 when the
    root must not be recorded at all (it did not open, or Stop was pressed): the app's fold replaces a
    whole root at once, so a partial read would erase what it knew. A bag INSIDE the root that did not
    open, or sits deeper than MAX_NEST, is recorded with "opened": False, and the fold keeps whatever
    it last knew inside that one bag."""
    root_serial = int(root_serial)
    opened, to_open, listing = set(), [root_serial], []
    for _ in range(MAX_NEST):
        fresh = [c for c in to_open if c not in opened]
        if not fresh:
            break
        for c in fresh:
            if API.StopRequested:
                return -1
            note_if_closed(c)
            try:
                API.UseObject(c)
            except Exception:
                pass
            API.Pause(PAUSE_OPEN)
            opened.add(c)
        listing = API.ItemsInContainer(root_serial, True) or []
        for it in listing:
            try:
                nm = str(it.Name or "")
            except Exception:
                nm = ""
            s = int(it.Serial)
            if is_container(it, nm) and s not in opened and s not in to_open and s not in BLACKLIST and not is_trash(s, nm):
                to_open.append(s)
    listing = without_skipped(listing)
    if API.StopRequested:
        return -1
    if not listing:
        # Opened-but-empty is a fact worth recording (the app then clears whatever it last knew about
        # this container). Not opened (too far, locked) is not: return -1 so the app keeps its memory.
        if was_opened(root_serial):
            containers[root_serial] = root_entry(root_serial, kind, label)
            return 0
        return -1
    # The same test for every bag inside: one that lists nothing and never opened (locked, or its
    # contents lagged) cannot be told apart from an empty one, and nor can one found past MAX_NEST.
    parents = set(int(getattr(it, "Container", 0) or 0) for it in listing)
    unopened = set(c for c in opened if c != root_serial and c not in parents and not was_opened(c))
    unopened.update(c for c in to_open if c not in opened)
    listed = set(int(it.Serial) for it in listing if int(it.Serial) in BLACKLIST)
    SKIPPED.update(listed)
    unopened.update(listed)       # never opened: the fold keeps what it last knew inside a blacklisted bag
    try:
        API.RequestOPLData([int(it.Serial) for it in listing])
        API.Pause(0.5)
    except Exception:
        pass
    containers[root_serial] = root_entry(root_serial, kind, label)
    n = 0
    for it in listing:
        s = int(it.Serial)
        if s in seen:
            continue
        seen.add(s)
        lines = tooltip_lines(s)
        parent = int(getattr(it, "Container", root_serial) or root_serial)
        if s in opened or s in unopened:
            cname = lines[0] if lines else str(it.Name or "")
            containers[s] = {"serial": s, "name": cname, "parent": parent, "root": root_serial,
                             "kind": "container", "tooltip": lines}
            if s in unopened:
                containers[s]["opened"] = False
            if s in unopened and s not in BLACKLIST:
                sysmsg(f"  {cname or 'a container'} in {label} was not opened — its contents are kept from the last scan", ALARM_HUE)
            continue
        items.append(item_dict(it, lines, parent))
        n += 1
    return n


def without_skipped(listing):
    """A root's listing minus everything inside a blacklisted bag or a trash container: the client may
    still hold their contents from an earlier open. A blacklisted bag itself stays, and scan_root
    records it unopened; a trash container is left out too."""
    parent = dict((int(it.Serial), int(getattr(it, "Container", 0) or 0)) for it in listing)
    trash = set()
    for it in listing:
        nm = str(getattr(it, "Name", "") or "")
        if is_container(it, nm) and is_trash(int(it.Serial), nm):
            trash.add(int(it.Serial))
    TRASHED.update(trash)
    skip = BLACKLIST | trash
    out = []
    for it in listing:
        if int(it.Serial) in trash:
            continue
        s = parent.get(int(it.Serial))
        for _ in range(MAX_NEST + 2):
            if s is None or s in skip:
                break
            s = parent.get(s)
        if s not in skip:
            out.append(it)
    return out


def close_opened():
    """Close the container windows this run opened, innermost first. Runs once everything has been
    read and the scan file written, or after a Stop or an error, so it never changes what is recorded.
    Every call is looked up with getattr: a client build without GetContainerGump() or Dispose()
    leaves the window open rather than raising. API.CloseGump(serial) is no fallback, since it finds
    gumps by their server gump id and a container window has none.

    A container showing a name plate cannot be closed this way. GetContainerGump() asks
    UIManager.GetGump(serial), which walks the gump list from its Last node and returns the first gump
    of ANY kind with that serial, then checks it is a container window. UIManager.Add() puts a window
    in front (AddFirst), but a name plate is added with front=false (AddLast), behind every window, so
    while the item has a plate the lookup finds the plate and answers None, whenever it is asked. Such
    windows stay open and are counted in a message. Upstream: PlayTazUO/TazUO#1087 and PR #1088.

    After a Stop the loop is bounded by STOP_CLOSE_S. Stop sets StopRequested, cancels the script's
    token and interrupts its thread (a ThreadInterruptedException at the next blocking call, such as
    API.Pause, which is why this finally still runs), and the client detaches a stopped script's
    thread after 2 s. Each GetContainerGump() waits on the client's main thread, so a long list could
    outlive that and leave the script unable to restart: whatever is not closed in time stays open."""
    started, left = time.time(), 0
    for it in reversed(OPENED_HERE):
        if API.StopRequested and time.time() - started >= STOP_CLOSE_S:
            break
        try:
            get_gump = getattr(it, "GetContainerGump", None)
            gump = get_gump() if get_gump is not None else None
            dispose = getattr(gump, "Dispose", None) if gump is not None else None
            if dispose is not None:
                dispose()
                continue
            if not bool(getattr(it, "Opened", True)):
                continue          # it never opened (locked, out of reach): there is no window
        except Exception:
            pass
        left += 1
    del OPENED_HERE[:]
    if left:
        try:
            sysmsg(f"Pack Rat: {left} container window{'s' if left != 1 else ''} this run opened could not be "
                   f"closed (TazUO cannot find a window while its name plate shows) - close by hand.", INFO_HUE)
        except Exception:
            pass
