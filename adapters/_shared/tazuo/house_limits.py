HOUSE_RADIUS = 40        # tiles searched around the player for the house's tiles (a castle is about 32 across)
HOUSE_MAX_TILES = 20000  # a capture larger than this is left out rather than bloating the scan
HOUSE_ITEM_REACH = 18    # the server sends ground items within about this many tiles
HOUSE_MULTI_IDS = (0x13EC, 0x147B)   # custom-house multi ids (ServUO HousePlacementTool.cs)
HOUSE_ITEM_CENTRE_RADIUS = 2   # the bounds include steps and the rim, so their centre sits up to about a tile off the multi origin, and an even-sized plot has a .5 centre
HOUSE_MAX_ITEMS = 5000   # the scan schema's cap on house items: past it the nearest are kept, so the scan file still validates
HOUSE_MAX_CONTAINERS = 5000  # the scan schema's cap on the house's containers: past it the nearest are kept
