def facet():
    """The map the player stands on (0 Felucca .. 5 Ter Mur), and so every ground root's: they are all
    within reach. None when the client cannot say. GetMap() is looked up with getattr, since the Legion
    stub is sometimes ahead of the running build; anything but 0-5 is left out."""
    get_map = getattr(API, "GetMap", None)
    try:
        m = int(get_map())
    except Exception:
        return None
    return m if 0 <= m <= 5 else None
