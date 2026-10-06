def is_container(it):
    # Only the client's own IsContainer flag says yes; there is no name fallback, so armour named
    # like a chest ("Platemail Chest") is never taken for one.
    try:
        if bool(getattr(it, "IsCorpse", False)) or as_int(getattr(it, "ItemID", 0)) == 0x2006:
            return False          # corpses are containers to the client; never open them
    except Exception:
        pass
    try:
        if NOT_A_CONTAINER_RE.search(str(getattr(it, "Name", "") or "")):
            return False          # "Wooden Chest deed", "a bag of sending", a spellbook: see NOT_A_CONTAINER_RE
        if as_int(getattr(it, "ItemID", 0)) in NOT_A_CONTAINER_GRAPHICS:
            return False
        return bool(getattr(it, "IsContainer", False))
    except Exception:
        return False
