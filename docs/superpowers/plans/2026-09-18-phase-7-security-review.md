# Phase 7 — Security Review (stub, not started)

> **Status: a stub.** This file records what the review will cover and how it will be run, so the scope is agreed before anyone starts looking. No review has been performed. Nothing here is a finding.

**Goal:** an adversarial pass over everything Pack Rat trusts, ending in a written threat model, a triaged findings list, and fixes for whatever is real — so that a stranger downloading an unsigned build from a public repository is trusting something that has actually been examined.

**Why now:** the app is public, it runs an HTTP server on the player's machine, it parses files written by scripts running inside a game client, it copies executable scripts into that client's folder, and it ships an Electron shell. Each of those is a trust boundary that has been reasoned about during development but never attacked on purpose.

**Spec:** `docs/superpowers/specs/2026-09-12-desktop-app-public-release-design.md` §12 row 7. Existing security notes live in `CONTRIBUTING.md`'s Security section, `SECURITY.md` and `PRIVACY.md`; the review checks those documents against the code as much as it checks the code.

## Scope

Each area below gets its own pass. The question in each case is not "is this correct" but "what does an attacker who controls this input get".

1. **The localhost HTTP server** (`app/vault-server.mjs`). The per-launch token, the `Host` and `Origin` checks, the content-type requirement, the CSP, and the one route that is deliberately exempt from the token (the event stream, which cannot carry headers). What can another process on the same machine reach? What can a web page open in the player's browser reach? What does a request from a different origin actually get?
2. **The scan and bridge parsers against hostile input** (`app/scan-schema.mjs`, `app/schema/validate.mjs`, `app/vault-lib.mjs`, `app/import.mjs`, `app/watcher.mjs`). A scan file is untrusted: it comes from a script running in a game client, and a player can be sent one by another player. Deeply nested containers, cyclic parentage, enormous strings, duplicate serials, prototype-polluting keys, numbers where strings are expected, and a file that is valid JSON but hostile in shape.
3. **The script installer's path handling** (`app/installer.mjs`). It writes executable files into a folder the player picks. Adapter id validation, traversal, symlinks, the `.new`-then-rename dance, the running-script guard, and what happens when the target folder is not what it appears to be.
4. **The Electron shell** (`electron/main.mjs`, `electron/server-entry.mjs`). Window settings against Electron's own security checklist, what the renderer can reach, the host bridge's surface, the single-instance lock, the per-launch token's generation and delivery, and what a crash or a restart leaves behind.
5. **The adapter scripts' posture inside a game client** (`adapters/*/`). These run with the player's account. Confirm each does only what its capabilities claim, that the bridge performs one action per command and refuses unknown ones, that nothing can be driven unattended, and that a hostile bridge queue file cannot make a script do something the player did not ask for.
6. **The supply chain and release path** (`package.json`, `package-lock.json`, `.github/workflows/`). The one runtime dependency and its WASM binary, the devDependencies, what the workflows can do with their tokens, whether a pull request from a fork can reach anything it should not, and what an attacker who compromises a release would be able to ship.
7. **The privacy claims** (`PRIVACY.md`, `README.md`). Every claim checked against the code: what is stored, what leaves the machine, what the update check sends, and what a scan file discloses about the player if they share one.

## Method

- One pass per area, each by an agent with the area's files and a brief written to attack rather than to verify. No agent reviews its own earlier work.
- Automated help where it is cheap and its output is triaged rather than pasted: a dependency audit, and a static-analysis pass if one can run without adding a dependency to the project.
- Every finding gets a concrete exploitation scenario — who does what, from where, and what they get. A finding without one is a note, not a vulnerability.
- Findings are triaged Critical / Important / Minor by impact and reachability, then fixed on a branch with a regression test where a test is possible.
- The threat model is written down as `docs/threat-model.md`: what the app trusts, what it does not, and which of those trusts are load-bearing.

## Out of scope

- The game client itself, the shard's servers, and anything that requires an attacker who already has the player's filesystem or account.
- Code signing, which is a separate pre-1.0 item in `RELEASING.md`.
- Anything that would require publishing a working exploit. Findings describe the class of problem and the fix, not a recipe.

## Done when

- Every area above has a pass with a written outcome, including the areas where nothing was found.
- Every Critical and Important finding is fixed, or has a recorded ruling saying why it stands.
- `docs/threat-model.md` exists and matches the code.
- `SECURITY.md`, `PRIVACY.md` and `CONTRIBUTING.md`'s Security section are corrected wherever the review found them overstating or understating what the code does.
