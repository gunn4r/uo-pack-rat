# Releasing

## Repository setup (one-time, done when the repository is first created)

Two GitHub features this project's own documents point at are off by default on a brand new public repository, and neither turns itself on:

- **Private vulnerability reporting.** Settings → Security → enable **Private vulnerability reporting**. This is what makes the Security tab's **Report a vulnerability** button in `SECURITY.md` actually exist; without it, a reporter following `SECURITY.md` falls back to its second route (a regular issue asking to be pointed at a private channel) instead of the preferred one.
- **Discussions.** Settings → General → Features → enable **Discussions**. This is what `.github/ISSUE_TEMPLATE/config.yml`'s "Questions and discussion" contact link points at, and where the issue templates route anything that isn't a bug or a feature request.

Do both before announcing the repository anywhere, so both documents are telling the truth from the start.

## Rehearsing a release before the first tag

`.github/workflows/release.yml` can be triggered by hand from the Actions tab (`workflow_dispatch`), with no tag needed. A dispatched run builds installers on all three platforms exactly the way a tagged run would, but never creates a release or uploads anything — that only happens on an actual `v*` tag push. Run it by hand at least once before the first tag: it's the first real exercise of the NSIS, AppImage and DMG builders, and there's no icon yet either (`build/README.md`), so it's worth seeing what a build actually looks like before it's also the public first impression.

## Cutting a release

The checklist, in order:

1. **The full suite passes on all three platforms in CI.** `.github/workflows/ci.yml` runs `npm test` on `macos-latest`, `windows-latest` and `ubuntu-latest` for every push and pull request — check the latest run on the branch you're releasing from is green on all three before doing anything else.
2. **Bump the version, before tagging.** Edit `package.json`'s `version` field (semver: patch for a fix, minor for a feature, major for a breaking change) and commit it — this is also `productName`'s companion field used to build every artifact's file name (see below) and what `npm run dist:publish` embeds into each installer. **The tag you push in step 4 must equal `v` + this field, exactly** (`v0.1.1` for `"version": "0.1.1"`) — the Release workflow's first job checks this and fails immediately, before creating anything, if the two disagree. Doing this step out of order (tagging before bumping, or a typo in the tag) is exactly the case that check exists to catch: electron-builder's own publish step matches a release by version rather than by tag, so a mismatched tag would otherwise leave you with two drafts and artifacts split across both.
3. **Update `CHANGELOG.md`.** Move the `Unreleased` section's entries under a new `## X.Y.Z — YYYY-MM-DD` heading matching the version you just set, and start a fresh empty `Unreleased` section above it.
4. **Tag and push.** `git tag vX.Y.Z && git push origin vX.Y.Z` — the tag name must start with `v` (`.github/workflows/release.yml` triggers on `push: tags: ["v*"]`) and must match the version from step 2.
5. **Let the Release workflow build.** Pushing the tag starts the workflow: the first job checks the tag against `package.json`'s version (failing fast on a mismatch, per step 2) and then creates a single **draft** release for the tag (or reuses one already there, if you're re-running a partly-failed release); the three-platform build matrix then runs (`npm run dist:publish`, i.e. `electron-builder --publish always`) and each platform uploads its artifacts into that same draft — nothing public yet, and never more than one draft. Watch all four jobs finish before moving on.
6. **Download and actually launch each artifact.** Pull every file off the draft release and run it for real, on a clean machine or user account if you can manage one:
   - macOS: confirm Gatekeeper calls the app damaged/unverified, and that the right-click-Open (or `xattr -dr com.apple.quarantine`) workaround from the README actually gets it running.
   - Windows: confirm SmartScreen's "Windows protected your PC" appears, and that More info → Run anyway gets it running.
   - Linux: confirm the AppImage needs `chmod +x` first, then runs.

   This is the one step that catches "it builds" not being the same as "a player can actually get past the warning and open it."
7. **Check "Check for updates" against the new release.** From a build of the *previous* version, open Settings and press Check for updates — it should report the new version as available. From the new build itself, the same button should report up to date.
8. **Publish the draft.** Once every artifact has been launched and the update check confirmed, publish the draft release on GitHub so it becomes the public `latest` release.
9. **Announce.** Post wherever this project's users will see it.

## Before 1.0

Deliberately outstanding, tracked here rather than hidden in an issue nobody sees before shipping:

- **A real application icon.** `build/icon.png` doesn't exist yet — see `build/README.md`. Every build today carries Electron's default icon.
- **README screenshots.** None ship this phase. The shot list, once there's an icon and a stable UI to capture: the inventory tab, a character sheet, a suit-builder result, the setup wizard, and the macOS Gatekeeper dialog a player will meet on first launch.
- **Code signing on macOS and Windows.** Every build is unsigned (see `SECURITY.md`) — `identity: null` in `package.json`'s `build.mac` and `CSC_IDENTITY_AUTO_DISCOVERY: "false"` in the release workflow are both explicit opt-outs, not defaults. Signing removes the Gatekeeper/SmartScreen warnings this README currently has to explain.
- **Automatic updates via `electron-updater`.** Today "Check for updates" only reports whether a newer version exists and links to the release page — it doesn't download or install anything.
