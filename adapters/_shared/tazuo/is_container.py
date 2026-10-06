def is_container(item, name):
    try:
        graphic = int(getattr(item, "Graphic", 0) or 0)
    except Exception:
        graphic = 0
    try:
        if bool(getattr(item, "IsCorpse", False)) or graphic == 0x2006:
            return False          # corpses are containers to the client; never open them
    except Exception:
        pass
    if NOT_A_CONTAINER_RE.search(name or "") or graphic in NOT_A_CONTAINER_GRAPHICS:
        return False              # "Wooden Chest deed", "a bag of sending", a spellbook: see NOT_A_CONTAINER_RE
    try:
        if bool(getattr(item, "IsContainer", False)):
            return True
    except Exception:
        pass
    if graphic in CONTAINER_GRAPHICS:
        return True
    # Last, the name, which the client's own flags have not vouched for: never for armour or clothing
    # ("Platemail Chest", "Gargish Stone Chest"), by its name or by the client's tiledata calling it
    # wearable.
    if WEARABLE_RE.search(name or ""):
        return False
    try:
        get_data = getattr(item, "GetItemData", None)
        if get_data is not None and bool(getattr(get_data(), "IsWearable", False)):
            return False
    except Exception:
        pass
    return bool(CONTAINER_RE.search(name or ""))
