# Cherry

Cherry is a desktop YouTube Music player with a custom Svelte interface and an
Electron/Chromium host for Windows and Linux. **2.0.0 Furano** is in development;
no 2.0 installers have been released. Patch versions keep the same codename;
minor and major versions advance it automatically. macOS is deferred.

This is the original Cherry repository, now continuing development with Electron.
The Tauri implementation and its releases are preserved in
[inane-tools/cherry-tauri](https://github.com/inane-tools/cherry-tauri).
The last stable Tauri release is 1.7.0. The Electron 1.7.1 preview has been
withdrawn from public distribution and retained as a draft for updater testing.

## Features

- YouTube Music sign-in, including brand channels, home/explore, library,
  playlists, folders, pinned playlists and search.
- Audio playback, queue, stations, adaptive music videos with quality selection,
  and timed lyrics from LRCLIB with YouTube Music fallback.
- Themes, accent colors, tinted surfaces, app scaling and configurable controls.
- Windows Segoe caption glyphs that follow app scaling and light/dark themes.
- Tray playback/pinned playlists, Windows taskbar playback buttons and playlist
  Jump Lists, Chromium media-session controls, Discord Rich Presence and Last.fm.
- Encrypted saved sign-in and Last.fm credentials through Electron safeStorage.
  On Linux without a secure keyring, sign-in lasts for the current session only;
  credentials are never stored as plaintext.
- GitHub-based update checks for Windows and AppImage, with explicit Download
  and Install and restart actions. Flatpak uses its own update mechanism.
- Settings shows the full local profile size. Cache clearing preserves settings,
  queue and logins; clearing everything resets settings and credentials and
  restarts. Logout removes saved YouTube credentials and login-browser data.

## Run

Requires Node 22.12+ and npm. Rust and Tauri are not needed.

```sh
npm ci
npm run dev         # Vite on 127.0.0.1:1423 + Electron, frontend hot reload
npm run typecheck
npm test
npm run test:smoke  # hidden test with isolated data; never uses your login
npm run pack        # unpacked local app in release/
```

Restart Electron after editing main/preload code. `npm start` opens the built
frontend; `npm run dev:web` is a browser-only preview.

## Package

```sh
npm run dist:win       # Windows x64: one-click Cherry NSIS installer
npm run dist:linux     # Linux x64: AppImage and Flatpak bundle
npm run dist:appimage  # Linux: AppImage only
npm run dist:flatpak   # Linux: Flatpak only
```

Build Windows on Windows and Linux on Linux. Outputs go in `release/`.
Linux Flatpak builds require `flatpak`, `flatpak-builder`, Freedesktop 25.08
Platform/SDK and `org.electronjs.Electron2.BaseApp//25.08` from Flathub. See
[packaging and release instructions](docs/RELEASING.md) for setup and testing.
Windows produces NSIS only; there are no MSI, portable, DEB, RPM or macOS targets.
GitHub Actions checks types and runs tests on development pushes and pull requests.
Installer builds run only for an explicit manual run or a release tag. Tagged
releases publish NSIS, AppImage and Flatpak after both platforms pass. The installer is unsigned until code signing is configured.

## Updates and migration

New Electron builds use GitHub Releases in `inane-tools/cherry`.
The `cherry-electron` repository remains an update bridge for installed 1.7.1
previews; it mirrors future public Electron releases without rebuilding them.
Publish the installer/AppImage plus electron-builder's matching `latest*.yml`
and blockmaps to enable updates. This repository is public; no GitHub access
token is bundled in the app. Development builds
and Flatpaks do not download or execute self-updates.

The repository transition is documented in
[the migration checklist](docs/MIGRATION.md). Electron cannot consume the Tauri
update feed or signing files. Moving existing Tauri users requires a manual
installation; credentials are not imported from Tauri. Existing Electron test
settings remain in the `cherry-electron` data directory, independently of Tauri.

See [the architecture and test checklist](docs/ELECTRON.md). Windows packaged
smoke tests cover desktop IPC, captions/themes/scaling and native integrations.
Linux hardware, Flatpak sandbox integration and an update between two published
Electron versions still need release testing.

[Changelog](CHANGELOG.md) · [License](LICENSE) · [Contributors](CONTRIBUTORS.md)
