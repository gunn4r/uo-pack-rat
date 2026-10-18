def cut_utf16(s, units):
    """s cut to at most `units` UTF-16 code units, the unit the app's maxLength counts (a character outside the
    Basic Multilingual Plane is two), never splitting a character. IronPython's strings are UTF-16 already, so
    there a pair's first half is dropped rather than left alone at the end."""
    out, n = [], 0
    for c in s:
        w = 2 if ord(c) > 0xFFFF else 1
        if n + w > units:
            break
        out.append(c)
        n += w
    if out and 0xD800 <= ord(out[-1]) <= 0xDBFF:
        out.pop()
    return "".join(out)
