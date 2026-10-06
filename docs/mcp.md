# AI assistants (MCP)

Pack Rat has a built-in [Model Context Protocol](https://modelcontextprotocol.io) server, so Claude Code and other MCP clients can answer questions about your gear ("what's my best LRC ring?", "where are my slayer weapons?"), read character sheets and saved runs, and run the Suit Builder. With a second switch they can also act in game through the same bridge as the app's buttons. It is part of the app: nothing to install or start, and it runs whenever Pack Rat runs.

## Turning it on

**Settings › AI assistants (MCP)**:

- **MCP server** — off by default. On, Pack Rat listens on `http://127.0.0.1:47615/mcp` (this computer only). Off, nothing listens.
- **Allow in-game actions** — off by default. On, clients may also Highlight, Go to, Grab and run Organize trips.
- **Address** and **Token** — what a client connects with. The token is hidden until **Show**; **Copy** copies it. **New token** makes a new one after asking; every client set up with the old one stops connecting at once, so copy the command or the JSON into it again.
- **Claude Code** — **Copy command** copies one line to run once in a terminal:

  ```
  claude mcp add --transport http --scope user pack-rat http://127.0.0.1:47615/mcp --header "Authorization: Bearer <token>"
  ```

  `--scope user` makes Pack Rat available in every project. Leave it out to add it to the current project only.
- **Other MCP clients** — **Copy JSON** copies a snippet for a client's MCP settings (Streamable HTTP):

  ```json
  {
    "mcpServers": {
      "pack-rat": {
        "type": "http",
        "url": "http://127.0.0.1:47615/mcp",
        "headers": {
          "Authorization": "Bearer <token>"
        }
      }
    }
  }
  ```

The port and the token stay the same across restarts, so a client is set up once. If another program holds port 47615 when Pack Rat starts the MCP server (at launch, or when you turn it on), Pack Rat uses a free port for that run and Settings says so; clients set up with the usual address can't connect until the next launch frees it (or copy the command again). Both live in `mcp.json` in the data folder; to use another port for good, quit Pack Rat and change `port` there.

## What a client gets

Every client receives a short usage guide when it connects (the `instructions` of MCP's `initialize`), so there is no skill to install. Paged lists take `limit` (25 by default, 100 at most) and `offset` and answer with `total`. Item rows are compact (serial, name, kind, slot, rarity, where it is, the serials of the container it sits in and of that container's root, who wears it, its properties); `get_item` has the full tooltip. Slots, kinds, slayers and tags match whatever their case, and a property rule that does not parse, or names a property no item has, is refused with the forms it takes.

Tools that wait (`build_suit` for its result, the in-game tools for the bridge's report) wait 45 seconds by default and 50 at most, inside the 60-second timeout most MCP clients use; past that they answer with an id to poll (`get_suit_build`, `get_action_status`).

**Reading** (never change anything):

| Tool | What it answers |
|---|---|
| `inventory_facets` | The characters, slots, kinds, rarities, slayers, weapon skills, yes/no flags and property keys a search can name |
| `search_items` | The Inventory screen's search and filters: free text, character, slot, kind, location, container, rarity, slayer, property rules (`lrc:20`, `lrc:le:20`, `lrc:eq:20`), flags, weapon skills, tags, sort, grouped by name |
| `get_item` | Up to 20 items in full, with the containers they sit in |
| `container_contents` | What is inside one container, nested bags included |
| `list_characters`, `character_sheet` | The characters, and one character's stats, resists, skills, worn gear and its totals |
| `list_item_kinds`, `list_scrolls` | Item kinds and their counts (and the kinds you set by hand); power scrolls and Scrolls of Transcendence by name |
| `list_runs`, `get_run`, `compare_runs` | Saved Suit Builder runs, one run's suit and totals, two or three side by side |
| `scan_status` | Each character's last scan and whether the bridge is running |
| `organize_plan`, `organize_proposal` | The trips your Organize setup would run now, and what Auto organize would set up (not saved) |

**Computing** (no effect in game):

| Tool | What it does |
|---|---|
| `build_suit`, `get_suit_build` | Runs the Suit Builder for a character with their saved profile, or a template, the buffs you name (the character's Automatic buffs by default), pinned pieces, or No character; waits for the result or answers with an id to poll. A finished build is saved as a run, like one from the app, so it counts toward the saved runs kept per character (Settings › Data retention). One runs at a time: a new call replaces one still running, and the replaced one says so |
| `score_suit` | Totals a hand-picked suit against a profile, with Manual's buffs (or those you name), the way Manual does |

**In game** (need **Allow in-game actions** and the bridge running in the game client):

| Tool | What it does |
|---|---|
| `highlight_item`, `go_to_item`, `grab_item` | The Highlight, Go to and Grab buttons |
| `organize_trip` | Runs one trip of the Organize plan, with the stamp `organize_plan` gave |
| `get_action_status` | Where a command or trip stands, with the bridge's report of each step |
| `stop_actions` | Organize's Stop: the trip halts after its current step. Works with the switch off |

These go through the same routes and checks as the app's buttons: the bridge must be online, one trip runs at a time, a plan that changed since it was read is refused, and the bridge script re-checks every command itself. **Put away** stays a button on the in-game panel.

## Safety

- The server listens on `127.0.0.1` only, on its own port, and every request needs the token. A request naming any other host, or carrying an `Origin` header (which every web page's request does), is refused, so a website you visit cannot reach it.
- The token is stored in `mcp.json` in the data folder, a file only your account can read (on Windows, the data folder's own permissions decide). A program on this computer that has the token can read your inventory, so make a new token if it leaks.
- What a client reads goes where that client sends it. Claude Code, for one, sends tool results to its model like anything else in the conversation. Pack Rat itself still sends nothing anywhere.
- In-game actions are a second switch on purpose: you can leave MCP read-only. Turning it off refuses new commands; one already queued still runs.
- A program that takes port 47615 while Pack Rat is not listening on it receives the token from every client set up for it. Pack Rat assumes a computer used by one person; on a shared one, make a new token if you suspect this.

`docs/threat-model.md` (boundary 14) has the reasoning.
