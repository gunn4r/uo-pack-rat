# Build resources

electron-builder reads this folder (`directories.buildResources`) for packaging inputs.

`icon.png` is the application icon: one square 1024×1024 PNG, named by `build.icon` in `package.json`. electron-builder generates the macOS `.icns`, the Windows `.ico` and the Linux icon set from it, so there are no per-platform icon files. This folder does not ship inside the app; the running app's own copies (the window icon and the page's favicon) are the 256 px and 64 px versions in `app/assets/`. When the logo changes, regenerate all three from the same source image and keep them palette-optimised (the packaging tests cap their sizes).

The committed files were made with ImageMagick from the maintainer's 1080×1080 master (`logo.png` below), quantised to a 256-colour palette with alpha:

```
magick logo.png -filter Lanczos -resize 1024x1024 -strip -colors 256 -define png:compression-level=9 build/icon.png
magick logo.png -filter Lanczos -resize 256x256 -strip -colors 256 -define png:compression-level=9 app/assets/icon.png
magick logo.png -filter Lanczos -resize 64x64 -strip -colors 256 -define png:compression-level=9 app/assets/favicon.png
```
