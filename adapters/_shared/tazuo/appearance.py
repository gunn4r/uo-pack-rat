LOOK_LAYERS = [("hair", "Hair"), ("beard", "Beard"), ("face", "Face")]


def read_appearance(p):
    """The character's look for the app's paperdoll (issue #57): the body graphic and skin hue of the player mobile `p`,
    and the graphic and hue of the item on the hair, beard and face layers (None for an empty layer). None when the
    client cannot say, so the scan leaves it out and the app keeps the last one it knew. Never added to `equipped`."""
    def worn(layer):
        it = API.FindLayer(layer)
        return None if it is None else {"graphic": int(it.Graphic), "hue": int(it.Hue)}
    try:
        look = {"body": int(p.Graphic), "hue": int(p.Hue)}
        for key, layer in LOOK_LAYERS:
            look[key] = worn(layer)
        return look
    except Exception:
        return None
