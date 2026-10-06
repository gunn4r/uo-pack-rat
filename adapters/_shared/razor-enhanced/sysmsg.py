def sysmsg(msg, hue=OK_HUE):
    # Misc.SendMessage prints to this client's own message area -- never a network speech packet,
    # unlike Player.ChatSay/ChatYell/ChatWhisper (see docs/bridge-protocol.md's "adapters never
    # speak publicly" rule, and README.md's Sources section for the citation on this distinction).
    Misc.SendMessage(msg, hue, False)
