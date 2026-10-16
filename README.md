# Cherry

Cherry is a desktop YouTube Music player with a custom Svelte interface and an
Electron/Chromium host. **1.7.1 Fukagawa** prepares the move from Tauri to Electron
for Windows and Linux. Patch versions keep the same codename; minor versions
advance automatically. macOS is deferred.

The repository is still named `cherry-electron` while the migration is prepared.
The existing Tauri app and repository remain available at
[inane-tools/cherry](https://github.com/inane-tools/cherry). No repository has
been renamed and no Electron stable release has been published yet.

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
CI remains disabled. The installer is unsigned until code signing is configured.

## Updates and migration

The Electron feed currently uses GitHub Releases in `inane-tools/cherry-electron`.
Publish the installer/AppImage plus electron-builder's matching `latest*.yml`
and blockmaps to enable updates. Public distribution needs a public release
repository; no GitHub access token is bundled in the app. Development builds
and Flatpaks do not download or execute self-updates.

The planned repository rename is documented in
[the migration checklist](docs/MIGRATION.md). Electron cannot consume the Tauri
update feed or signing files. Moving existing Tauri users requires a manual
installation; credentials are not imported from Tauri. Existing Electron test
settings remain in the `cherry-electron` data directory, independently of Tauri.

See [the architecture and test checklist](docs/ELECTRON.md). Windows packaged
smoke tests cover desktop IPC, captions/themes/scaling and native integrations.
Linux hardware, Flatpak sandbox integration and an update between two published
Electron versions still need release testing.

[Changelog](CHANGELOG.md) · [License](LICENSE) · [Contributors](CONTRIBUTORS.md)
