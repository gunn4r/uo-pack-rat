# Forms: the Import drawer, the setup wizard and Settings

Part of the UI docs: [`docs/ui.md`](../ui.md) has the hard rules, tokens, components and the dependency rules every screen follows.

## Code

### Where each part lives

| Module | What it draws and does |
| --- | --- |
| `ui/import.mts` | The Import drawer: a pasted scan or scan files, the preview, Import (`POST /api/import/paste`, `POST /api/import/rescan`) |
| `ui/import-preview.mts` | Pure: the preview card's counts and the primary button's sentence (`scanPreview`) |
| `ui/wizard.mts` | The setup wizard dialog (`openWizard`): shard, client, client folder, install (`/api/setup`, `/api/setup/locate`, `/api/setup/install`) |
| `ui/settings.mts` | The Settings screen's five sections, the update notice (`startUpdateChecks`) |
| `ui/adapter-copy.mts` | Pure: everything the page says about each game client, per adapter |
| `ui/adapters.mts` | Pure: which client the wizard and the Import drawer pick by default |
| `ui/shard.mts` | `changeShard`: the one place a shard switch is saved and applied |
| `ui/tazuo-panel.mts`, `ui/paste-scanner.mts` | Pieces the wizard and Settings share: the in-game panel options, the Copy scanner script button |
| `ui/kinds.mts` | Settings › Data's export and import of the player's item kinds |
| `ui/bridge.mts` | The data-folder banner (`renderDataDirNotice`), among the bridge's other jobs |
| `ui/import.css`, `ui/wizard.css`, `ui/settings.css` | Their stylesheets |

The page-side scan parser is `app/paste-scan.mts`, served at `/paste-scan.mjs`, the same code the paste route runs.

### Events and state

- Settings follows the inventory: the danger zone's character list redraws on `inventorychange` (`syncSettingsCharacters`).
- The blacklist is fetched again on every visit to Settings (`syncSettingsBlacklist`), since the in-game script writes it too.
- View choices (theme, a dismissed update, the copied scanner version) are saved through `prefs.mts`.

### Tests

- Pure: `app/import-preview.test.mts`, `app/adapter-copy.test.mts`, `app/wizard-default-adapter.test.mts`.
- Electron: `scripts/ui-forms.test.mts` covers the drawer, the wizard and Settings. `SCREENS` maps `import`, `import-preview`, `wizard`, `settings` and `shard` to it.

### How to extend it

- **A Settings row:** a `.set-row` in its section in `settings.mts` (title and help left, control right, anything spanning below in `.set-row-below`). A value the server keeps goes through its route; a view choice goes through `prefs.mts`.
- **A new game client:** its own entry in `adapter-copy.mts`, rather than text assembled from the adapter's README.

## Import drawer

`ui/import.mts` is the drawer. A pasted scan or a scan file is parsed in the page by `app/paste-scan.mts`. That is the same `parsePastedScan` that `POST /api/import/paste` runs, browser-safe and served at `/paste-scan.mjs`, so the preview can never call clean what the server then refuses.

Scan files (dropped anywhere on the window, or a chosen folder) are read in the page and sent through that same paste route one by one, so every file gets the same preview. The preview card's counts and the primary button's sentence come from the DOM-free `ui/import-preview.mts`. A re-render never drops focus out of the open drawer (Esc and the focus trap listen inside it).

## Client wording

`ui/adapter-copy.mts` holds everything the page says about a game client, written per adapter there, never assembled from an adapter's README title:

- short names;
- the wizard's client cards, per-step questions and help, and its step names;
- the Import drawer's client options.

An adapter the table doesn't know still gets plain text from its own name and summary. A new shipped adapter should get its own entry.

## Setup wizard

`ui/wizard.mts` is a `.dialog`. Each step has one primary button (`#wiz-primary`), which ↵ runs; the paste branch renames steps 3 and 4 as soon as a paste client is picked.

Step 3's typed path lives in the wizard's state, so it survives a failed "Use this path". The step 1 shard pick is held the same way and applied by Finish (the PUT and page reload of `ui/shard.mts`). So changing it keeps the wizard open, and Set up later or Esc leave the saved shard as it was.

## Update notice

`#update-notice` comes from `ui/settings.mts`'s `startUpdateChecks`. With Check automatically on (the default; settings `autoUpdateCheck`), the page calls `GET /api/update-check` 5 s after load and every 6 hours. A newer release shows one line above the screen with View release and Dismiss. Dismiss saves that version as the ui-prefs `dismissedUpdate`, so only a later release shows again. It only tells: nothing is downloaded.

## Data-folder banner

`#notice` is drawn by `ui/bridge.mts`'s `renderDataDirNotice`: one short line above every screen, with "Show details" (Settings › Data, where the full sentence with both paths stays) and Dismiss. It takes its own height in `.main`'s column, and the screen below (flex 1, min-height 0) shrinks to fit. `.shell`'s one grid row is pinned to the window.

## Settings

`ui/settings.mts` draws five sections:

- **General:** Theme, Appearance, Shard rules.
- **Game client:** the client's status, Run setup, Reinstall, and, for TazUO, the in-game panel card (show at login, and its hotkey). The panel card is `ui/tazuo-panel.mts`'s `panelControls`, which the wizard's install step shows too.
- **Data:** the data and logs folders, Blacklisted containers, export and import of the player's item kinds, Data retention with Clean up now, and the danger zone.
- **AI assistants (MCP):** the built-in MCP server's two switches and how to connect a client (issue #211).
- **Updates:** the version, Check for updates, Check automatically, and under them the Appropriate Legal Notices `LICENSE` asks for (`#set-legal`): the copyright, the author credit, the repository link, the GPL v3 with additional terms and no warranty, and a License link to the repository's `LICENSE`, both links opening in the browser.

The sections sit at the page's full width, like every other screen, with no section nav (the page is short; bring one back if it grows). A section that needs attention carries a warning dot beside its heading (Game client, when no client is set up). Setting rows are `.set-row`: title and help left, control right, anything spanning below in `.set-row-below`.

The Theme select lists every theme family and enables one once its id is in `ui/theme.mts`'s `BUILT_THEMES`. A choice applies at once and is saved with the other ui-prefs.

The data-folder mismatch (`dataDirNotice`) shows in the Data card as well as in the banner. Each folder row has Open in the desktop app, and Copy path in a plain browser (`GET /api/setup`'s `canOpenFolders` is true only when the desktop shell can open a folder). The danger zone's character list follows the inventory (`syncSettingsCharacters`, run on every `inventorychange`).

With the ClassicUO web client chosen, Game client has a Scanner script row. Its Copy scanner script button (`ui/paste-scanner.mts`, shared with the wizard's step 3) copies the app's bundled scanner from `GET /api/setup/scanner`. It also says when that version is newer than the one last copied (ui-prefs `copiedScanner`).

The Data section's Blacklisted containers card (Unblacklist per row) is fetched again on every visit to Settings (`syncSettingsBlacklist`), since the in-game script writes the list too.
