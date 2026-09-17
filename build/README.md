# Build resources

electron-builder reads this folder (`directories.buildResources`) for packaging inputs.

**Missing: an application icon.** Drop `icon.png` here — one square PNG, 1024×1024, and electron-builder generates the `.icns` and `.ico` variants itself. Until then every build carries the default Electron icon, which is fine for a pre-release but is a blocker for 1.0 (see `RELEASING.md`).
