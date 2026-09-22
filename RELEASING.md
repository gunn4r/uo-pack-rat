# Releasing

## Repository setup (settings that live on GitHub, not in this repository)

Some of what this project's documents promise is a checkbox in the repository's own settings rather than a file anyone can review in a pull request. None of these turn themselves on, and nothing in CI can turn them on either — so they are listed here, with their state, and a maintainer has to go and flip the ones still off.

Done:

- **Private vulnerability reporting** — *Settings → Advanced Security → Private vulnerability reporting*. Enabled. This is what makes the Security tab's **Report a vulnerability** button in `SECURITY.md` actually exist.
- **Discussions** — *Settings → General → Features → Discussions*. Enabled. This is what `.github/ISSUE_TEMPLATE/config.yml`'s "Questions and discussion" contact link points at, and where the issue templates route anything that isn't a bug or a feature request.
- **Secret scanning and push protection** — *Settings → Advanced Security*. Enabled.

Still to do:

- **Dependabot alerts** and **Dependabot security updates** — *Settings → Advanced Security → Dependabot* (`https://github.com/gunn4r/uo-pack-rat/settings/security_analysis`). Both are currently **off**. `.github/dependabot.yml` is committed and configures *version* updates — the weekly npm and github-actions pull requests — but alerts and security updates are a separate switch that a config file cannot set. Until they are on, an advisory against a transitive dependency of `electron-builder`, or against Electron itself, notifies nobody: this project's lockfile is fully pinned by design and never moves on its own, and CI does not run `npm audit`, so nothing would ever go red.
- **Require actions to be pinned to a full-length commit SHA** — *Settings → Actions → General → Actions permissions* (`https://github.com/gunn4r/uo-pack-rat/settings/actions`). Currently **off**. Every `uses:` in both workflows is already pinned to a SHA by hand (see below); this setting is what stops a future workflow, or a careless edit to an existing one, from quietly going back to a mutable `@v4` tag.

## How the release workflow is put together

`.github/workflows/release.yml` runs three jobs, and the split between them is deliberate — it is the whole reason the workflow looks more complicated than "build and upload."

1. **`create-release`** (`contents: write`) — checks the tag against `package.json`'s version and creates the single draft release. Runs on a tag push only.
2. **`build`** (`contents: read`, **no release token at all**) — the three-platform matrix. Runs `npm ci --ignore-scripts` and `npm run dist`, which is `electron-builder --publish never`, and uploads the installers as **workflow artifacts** rather than to the release.
3. **`publish`** (`contents: write`) — downloads those artifacts, generates `SHA256SUMS`, and uploads everything to the draft release with `gh release upload`. It does not check out the repository and installs nothing: its entire dependency surface is `actions/download-artifact`, coreutils and the `gh` CLI.

The point of the split is that job 2 executes about three hundred development packages as ordinary code on the runner — electron-builder, TypeScript, and everything underneath them — and job 2 is the one job that holds no token and cannot write to anything. A compromised build dependency can corrupt an installer, but it cannot publish one, and it cannot reach the repository. Step 6 of the checklist below (download each artifact and actually launch it) is what stands between a corrupted artifact and a published release, which is why that step is not optional.

The honest limitation: `publish` uploads bytes built on three other runners without re-verifying them, because there is nothing to verify them against while builds are unsigned. That trust already existed when each build runner uploaded to the release directly — the split does not add it, it just shrinks what sits on the trusted side of it.

A `workflow_dispatch` run is **build-only**. Both `create-release` and `publish` are gated on `github.event_name == 'push'` and a `refs/tags/v` ref, so a run dispatched by hand from any branch builds installers, leaves them on the workflow run as artifacts, and stops — it cannot create a release, upload to one, or obtain a write-scoped token from any ref.

### Actions are pinned to commit SHAs

Every `uses:` in `.github/workflows/*.yml` names a full 40-character commit SHA with the human-readable tag in a trailing comment:

```yaml
- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
```

`@v4` is a git tag, and a tag is a mutable pointer — whoever controls the repository it lives in can retarget it at a different commit, and every workflow run picks that up immediately with no lockfile, no integrity hash and no review. A SHA cannot move. The trailing comment is not decoration: it is what makes the pin readable, and it is what Dependabot's `github-actions` updater rewrites when it opens a pull request to move a pin forward. Keep both parts when adding or updating an action, and resolve the SHA from GitHub rather than copying one from memory:

```
gh api repos/actions/checkout/git/ref/tags/v4.4.0 --jq '.object.sha'
```

(If that returns an annotated tag object rather than a commit, follow it: `gh api repos/actions/checkout/git/tags/<sha> --jq '.object.sha'`.)

### Installs skip lifecycle scripts

Both workflows install with `npm ci --ignore-scripts`. The only package in the tree with an install script is `electron-winstaller`, which arrives solely as a dependency of the peer `electron-builder-squirrel-windows`, and `app-builder-lib` requires that lazily inside its Squirrel target branch — this project builds `nsis` and `portable`, never Squirrel. Electron's own binary does not come from an install script in the version pinned here (`node_modules/electron/index.js` fetches it on first `require`), and TypeScript's native compiler arrives as platform-gated `optionalDependencies` that are integrity-pinned in the lockfile. If a Squirrel target is ever added, that install step has to be run back explicitly.

## Rehearsing a release before the first tag

`.github/workflows/release.yml` can be triggered by hand from the Actions tab (`workflow_dispatch`), with no tag needed. A dispatched run builds installers on all three platforms exactly the way a tagged run would, but creates no release and uploads nothing to one — the installers land as workflow artifacts on the run itself, where they can be downloaded and launched. Run it by hand at least once before the first tag: it's the first real exercise of the NSIS, AppImage and DMG builders, it's the first exercise of `npm ci --ignore-scripts` on a real Windows build, and there's no icon yet either (`build/README.md`), so it's worth seeing what a build actually looks like before it's also the public first impression.

## Cutting a release

The checklist, in order:

1. **The full suite passes on all three platforms in CI.** `.github/workflows/ci.yml` runs `npm test` on `macos-latest`, `windows-latest` and `ubuntu-latest` for every push and pull request — check the latest run on the branch you're releasing from is green on all three before doing anything else.
2. **Bump the version, before tagging.** Edit `package.json`'s `version` field (semver: patch for a fix, minor for a feature, major for a breaking change) and commit it — together with `productName`, this field builds every artifact's file name (see below). **The tag you push in step 4 must equal `v` + this field, exactly** (`v0.1.1` for `"version": "0.1.1"`) — the Release workflow's first job checks this and fails immediately, before creating anything, if the two disagree. Doing this step out of order (tagging before bumping, or a typo in the tag) is exactly the case that check exists to catch: every artifact's filename is built from the version, so a mismatched tag would otherwise leave you with a draft named for the tag full of files named for a different version.
3. **Update `CHANGELOG.md`.** Move the `Unreleased` section's entries under a new `## X.Y.Z — YYYY-MM-DD` heading matching the version you just set, and start a fresh empty `Unreleased` section above it.
4. **Tag and push.** `git tag vX.Y.Z && git push origin vX.Y.Z` — the tag name must start with `v` (`.github/workflows/release.yml` triggers on `push: tags: ["v*"]`) and must match the version from step 2.
5. **Let the Release workflow build.** Pushing the tag starts the three jobs described above: `create-release` checks the tag against `package.json`'s version (failing fast on a mismatch, per step 2) and creates a single **draft** release for the tag, or reuses one already there if you're re-running a partly-failed release; the three-platform `build` matrix then runs `npm run dist` and uploads each platform's installers as workflow artifacts; finally `publish` collects all of them, generates `SHA256SUMS`, and uploads the installers and that file into the draft. Nothing is public yet, and there is never more than one draft. Watch all five jobs finish before moving on.
6. **Download and actually launch each artifact.** Pull every file off the draft release and run it for real, on a clean machine or user account if you can manage one. This is the step that catches a corrupted build, and it is the only check standing between the build matrix and a published release:
   - macOS: confirm Gatekeeper calls the app damaged/unverified, and that the right-click-Open (or `xattr -dr com.apple.quarantine`) workaround from the README actually gets it running.
   - Windows: confirm SmartScreen's "Windows protected your PC" appears, and that More info → Run anyway gets it running.
   - Linux: confirm the AppImage needs `chmod +x` first, then runs.

   This is the one step that catches "it builds" not being the same as "a player can actually get past the warning and open it."
7. **Check "Check for updates" against the new release.** From a build of the *previous* version, open Settings and press Check for updates — it should report the new version as available. From the new build itself, the same button should report up to date.
8. **Check `SHA256SUMS` against what you downloaded.** In the folder you downloaded everything into, run the verification command from the next section. Every file you have should say `OK`. If one doesn't, stop — do not publish the draft, and work out which of the build and the upload went wrong before anything goes public.
9. **Publish the draft.** Once every artifact has been launched, the update check confirmed and the checksums verified, publish the draft release on GitHub so it becomes the public `latest` release.
10. **Announce.** Post wherever this project's users will see it.

## Verifying a download

Every release carries a `SHA256SUMS` file listing the SHA-256 hash of each installer by filename. Anyone — a maintainer at step 8, or a player who got a link from somewhere — can check a downloaded file against it. Download `SHA256SUMS` from the release into the same folder as the installer, then:

- **macOS:** `shasum -a 256 -c SHA256SUMS --ignore-missing`
- **Linux, or Windows under WSL or Git Bash:** `sha256sum -c SHA256SUMS --ignore-missing`
- **Windows PowerShell:** `Get-FileHash '.\Pack Rat-0.1.0-win-x64.exe' -Algorithm SHA256` and compare the hash it prints against the matching line in `SHA256SUMS` (PowerShell has no `-c` equivalent, so this one is a read-and-compare).

`--ignore-missing` is what lets a player who downloaded only their own platform's installer get an `OK` instead of a wall of "No such file" for the other five.

Be clear about what this does and does not prove. `SHA256SUMS` is generated by the same workflow that built the files, so it is no defence at all against a compromised release token or a poisoned build dependency — the same run would simply publish matching hashes for the tampered file. What it does prove is that the copy in your hands is byte-for-byte the copy this project uploaded, which is exactly the question worth asking when a build arrives from anywhere other than the Releases page: a Discord repost, a shard forum mirror, an "easier installer" someone rehosted, or a download that silently truncated. `SECURITY.md` says a copy from anywhere else has no way to be verified against what this project actually built; `SHA256SUMS` is how that stops being true.

## Before 1.0

Deliberately outstanding, tracked here rather than hidden in an issue nobody sees before shipping:

- **A real application icon.** `build/icon.png` doesn't exist yet — see `build/README.md`. Every build today carries Electron's default icon.
- **README screenshots.** None ship this phase. The shot list, once there's an icon and a stable UI to capture: the inventory tab, a character sheet, a suit-builder result, the setup wizard, and the macOS Gatekeeper dialog a player will meet on first launch.
- **Code signing on macOS and Windows.** Every build is unsigned (see `SECURITY.md`) — `identity: null` in `package.json`'s `build.mac` and `CSC_IDENTITY_AUTO_DISCOVERY: "false"` in the release workflow are both explicit opt-outs, not defaults. Signing removes the Gatekeeper/SmartScreen warnings this README currently has to explain, and it is also what would let the `publish` job verify the artifacts it uploads rather than trusting the runners that produced them.
- **Automatic updates via `electron-updater`.** Today "Check for updates" only reports whether a newer version exists and links to the release page — it doesn't download or install anything. Do not add it before Dependabot alerts and SHA-pinning enforcement are switched on above: an auto-updater turns a compromised release into code that installs itself on every player's machine, instead of something each player has to choose to download.
