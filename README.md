# Cherry

Cherry is a YouTube Music desktop client for **Windows and Linux**, with a custom
frontend that talks directly to YouTube Music's internal *Innertube* API. Built
with **Electron + Chromium**, **Svelte 5**, **TypeScript** and **Tailwind v4**.

![Cherry](https://inane.tools/screenshot-compact.webp)

> ### ⚠️ Disclaimer
> Cherry is an unofficial client and is **not affiliated with, endorsed by, or
> associated with YouTube, Google or YouTube Music**. All trademarks and content
> belong to their respective owners. To use Cherry, you need your **own YouTube account**. You are responsible for how you use it
> and for any consequences, including any effect on your account. The software is
> provided **as is**, without warranty of any kind.

## Platform status

**Cherry 2.0.0 (Furano) is in development.** The desktop host is moving from
Tauri to Electron on both Windows and Linux, keeping Cherry's custom frontend.
No 2.0 installers have been built or released yet. macOS remains deferred.

The Electron version uses Chromium on both platforms. Steam Deck testing has
eliminated the observed WebKit rendering glitches and felt much smoother;
the Fedora VM remains more sluggish. Desktop integrations, account handling,
playback and video support have been ported, with further testing ongoing.

**The stable downloads below are still Tauri 1.7.0.** Windows is its most polished
version. Linux uses WebKitGTK and can still show animation flicker, rendering
glitches and inconsistent responsiveness despite the existing workarounds.
The original Tauri source and releases are preserved in
[cherry-tauri](https://github.com/inane-tools/cherry-tauri); this repository now
continues development with Electron. The Electron 1.7.1 preview has been
withdrawn from public distribution and retained as a draft for updater testing.

## Features

- **Fully custom UI** - Cherry is not a wrapper on the YouTube Music web app, it has a fully custom built user interface, with a focus on simplicity and good looks.
- **A customizable sidebar** - one user-organised list of playlists and folders. Drag to
  reorder, drop a playlist onto a folder to file it, **pin** favourites to the
  top, resize the sidebar (only when compact sidebar is turned off), or switch to a compact icon-only mode. Below ~820px it
  collapses into a slide-in drawer.
- **Expanded player** - click the album art for Art, Queue and Lyrics tabs over
  the artwork background. The selected tab is remembered when collapsed, and
  artwork preloads and transitions with the background and accent colors.
- **Lyrics** - enabled by default, with a centered strip above the compact player
  and a larger expanded view. LRCLIB is preferred, with YouTube Music as a
  fallback. Timed lyrics follow playback and support click-to-seek; lyrics
  without timestamps stay readable. Configure them in Settings → Player.
- **Music videos** - switch from the expanded player to adaptive HD video up to
  1080p where available. Choose Highest, Auto or a remembered resolution, with
  optional black letterboxing. Collapsing keeps playback running; video
  preference survives audio-only tracks and restarts. Lyrics pause in video mode.
- **Stations & radio** - play station recommendations or start radio from a song,
  with more tracks loaded as playback continues.
- **In-app sign in** - loads music.youtube.com and captures the session from the
  native cookie store. Saved credentials are **encrypted using OS secure storage**,
  never kept in localStorage or plaintext files. On Linux without a secure
  keyring, sign-in lasts for the current session only. Cherry also handles
  multiple brand accounts, with account switching in Settings.
- **Edit your library** - create playlists, add or remove songs, rename, edit
  descriptions and set a **custom cover image**; pick a **default save
  playlist**; **save / unsave** playlists you did not create; and **delete your
  own playlists** with an explicit permanent-deletion confirmation.
- **Queue control** - jump to any track (dropping the ones before it),
  drag-reorder, remove tracks, and clear. Keep the queue in a right sidebar
  when there is room, with the player queue button available in smaller windows.
- **Home & Explore** - browse recommendations, filter the Home feed, and open
  moods, genres, charts and new releases from the separate Explore page.
- **Paste a link** - drop a YouTube / YouTube Music song or playlist URL into the
  search box to preview it, then click the result to play or open it.
- **Desktop integration** - OS media controls through Chromium Media Session, hardware
  media keys, tray playback controls and pinned playlists. Windows also gets
  taskbar preview buttons and Jump Lists for pinned and recent playlists.
  Closing the window exits Cherry; minimizing keeps it on the taskbar.
- **Light & dark themes** - follow the system or pick one, with the accent taken
  from the album art or a custom colour and optional background gradients. The
  window title follows the current track.
- **Keyboard shortcuts** - Space to play/pause, arrows to seek, Ctrl+arrows
  to skip and change volume, S/R for shuffle/repeat, Ctrl+F to search (full
  list in Settings).
- **Sleep timer** - stop after 5 minutes to 1.5 hours with a gentle fade, or
  at the end of the current track.
- **Integrations** - Discord Rich Presence with clickable artwork linking to the
  current song, plus Last.fm scrobbling.
- **GitHub updates** - startup checks and an updater inside the Cherry card in
  Settings for Windows NSIS and Linux AppImage installations. Download when you
  choose, then install and restart. Flatpak updates use the latest release bundle.

See [`docs/ELECTRON.md`](docs/ELECTRON.md) for the desktop architecture and
platform checks, and [the migration notes](docs/MIGRATION.md) for the transition
from Tauri.

## Changelog

**v2.0.0 (Furano), in development,** replaces the Tauri host with Electron on
Windows and Linux. It brings Chromium rendering to Linux, ports the desktop
integrations and GitHub updater, improves account and playlist handling, fixes
HD video in packaged builds and track-transition skips, and makes large queues
faster to open. Existing Tauri installations require a manual switch; a data
importer is not implemented yet. Installed Electron 1.7.1 previews will be able
to test updating to 2.0 through the compatibility feed.

**v1.7.0 (Fukagawa)** adds lyrics, music videos and station playback, with
smoother transitions, improved artwork handling and a calmer startup.

Lyrics are enabled by default. Hide the strip with the captions button, or
configure lyrics and player buttons under **Settings → Player**. Lyrics prefer
LRCLIB, then YouTube Music. Only provider-supplied timestamps are used; untimed
lyrics stay readable. LRCLIB receives song title, artist, album and duration,
without sign-in data, and its lookup can be disabled in Settings.

The expanded player has **Art, Queue and Lyrics** tabs and remembers the selected
tab when collapsed. Video controls sit beside Collapse, with **Highest**, adaptive
**Auto** and remembered resolution choices. Music videos use adaptive HD up to
1080p where available, with progressive fallback. Video mode survives audio-only
songs and app restarts; restored video loads paused. Collapsing keeps playback
running. Lyrics are suspended during video playback. Optional letterboxing adds
black bars without resizing the player.

**v1.6.2 (Shibetsu)** adds signed GitHub updates for Tauri Windows and AppImage installs.

**v1.6.1 (Shibetsu)** fixes Discord presence clearing and adds links to the
current song on album artwork and to inane.tools on the Cherry badge.

**v1.6.0 (Shibetsu)** refreshes Home with more YouTube Music layouts, filters
and pagination, separates Explore into its own page, and adds an optional queue
sidebar. It also adds confirmed playlist deletion, expanded tray controls and
Windows playlist shortcuts, with improved artwork recovery and accent gradients.
Windows NSIS and Linux Flatpak/AppImage are supported; macOS builds are deferred.
See [CHANGELOG.md](CHANGELOG.md) for the full history.

## Download

**2.0 is not released yet.** The latest stable version is the Tauri-based
**[v1.7.0 Fukagawa](https://github.com/inane-tools/cherry-tauri/releases/tag/v1.7.0)**:

- **Windows x64:** [NSIS installer](https://github.com/inane-tools/cherry-tauri/releases/download/v1.7.0/Cherry_1.7.0_x64-setup.exe).
- **Linux x86_64:** [Flatpak](https://github.com/inane-tools/cherry-tauri/releases/download/v1.7.0/Cherry_1.7.0_x86_64.flatpak) or [AppImage](https://github.com/inane-tools/cherry-tauri/releases/download/v1.7.0/Cherry_1.7.0_amd64.AppImage).

Install the downloaded Tauri Flatpak with
`flatpak install --user Cherry_1.7.0_x86_64.flatpak`, then run
`flatpak run tools.inane.cherry`. This is a self-distributed bundle; Cherry is
not listed on Flathub. For the Tauri AppImage, run
`chmod +x Cherry_1.7.0_amd64.AppImage` before opening it. Read the
[platform status](#platform-status) before downloading these Linux packages.
The [preserved platform notes](https://github.com/inane-tools/cherry-tauri/blob/main/docs/platforms.md)
cover Tauri-specific requirements and limitations.

Future Electron releases will be published in
[this repository's releases](https://github.com/inane-tools/cherry/releases),
with **NSIS for Windows** and **Flatpak / AppImage for Linux**. The Electron
1.7.1 preview is no longer a public download. Switching from Tauri will require
a manual installation; see [migration](docs/MIGRATION.md).

**Tauri users on 1.6.1 or earlier need to install 1.7.0 manually once to add its updater.**
The `.sig` files and `latest.json` on Tauri releases are updater assets; manual
installation only needs the installer for your platform.

## Requirements

- **Windows 10/11 x64**, or Linux x86_64. Electron bundles Chromium and does not
  require WebView2. macOS builds are deferred.
- To develop: **Node 22.12+** and **npm**. Rust and the Tauri toolchain are no
  longer required. CI uses Node 24.
- To package Linux Flatpaks: `flatpak`, `flatpak-builder`, Freedesktop Platform / SDK
  25.08 and Electron BaseApp 25.08. See [packaging](docs/RELEASING.md).

These requirements apply to the Electron source. The stable Tauri downloads
have their original [platform requirements](https://github.com/inane-tools/cherry-tauri/blob/main/docs/platforms.md).

## Develop

```bash
npm ci
npm run dev           # Vite on 127.0.0.1:1423 + Electron, with frontend hot reload
```

Restart Electron after changing the main process or preload. `npm run dev:web`
starts a browser-only preview; `npm start` opens the built frontend.

The editable logo source is `src/lib/assets/logo.png`. The copy in
`public/logo.png` is the browser favicon; `electron/assets` contains the desktop
app icons. Windows setup uses the separate `install-cherry.png` artwork;
`npm run installer:icon` generates its ICO. Build output and installed
dependencies remain local and are ignored by Git.

Other scripts:

```bash
npm run typecheck      # svelte-check
npm test               # service, Svelte UI, desktop and release-tool tests
npm run test:smoke     # isolated local startup check; builds the frontend only
npm run build          # build the frontend to dist/
npm run pack           # unpacked local app in release/
npm run dist:win       # Windows x64 NSIS installer
npm run dist:linux     # Linux x86_64 AppImage and Flatpak
npm run dist:appimage  # AppImage only
npm run dist:flatpak   # Flatpak only
```

Build Windows packages on Windows and Linux packages on Linux. Outputs go in
`release/`. Development pushes and pull requests run checks only; installer
builds require an explicit manual workflow run or a release tag. **No 2.0
installers have been built yet.** See [the release guide](docs/RELEASING.md)
for packaging, update metadata and release testing.

## App updates

Cherry checks GitHub Releases at startup and every four hours. When a newer
version is available, a button beside the account image shows its version and
opens the updater. You can also open **Settings → Cherry card → Updates** to
check manually, read release notes, download, then choose **Install and restart**.
Downloading leaves playback running; installation saves your queue and settings
before restarting.

Electron self-updating supports Windows NSIS and Linux AppImage installations.
Downloads are checked against the published SHA-512 checksums. Windows installers
are currently unsigned. Flatpak installs link to the latest bundle for manual
installation; development builds do not self-update.

New Electron builds use the `inane-tools/cherry` feed. Installed 1.7.1 previews
still use `cherry-electron`, which is kept as a compatibility bridge: it mirrors
future public Electron releases once an hour, or on manual dispatch, without
rebuilding them. After installing a canonical release, subsequent checks use
`cherry` directly.

Tauri uses a different, signed update format. Its final manifest remains pinned
to 1.7.0 so existing Tauri installations receive Tauri-compatible metadata.
They will not automatically install Electron. See [the release guide](docs/RELEASING.md)
and [migration notes](docs/MIGRATION.md) for both update paths.

## Project layout

```text
src/lib/core/       pure domain models
src/lib/infra/      Innertube client, storage, caches
src/lib/app/        services (player, queue, auth, settings, …)
src/lib/ui/         chrome (titlebar/sidebar/player) and views
src/lib/desktop/    typed renderer adapters for the desktop host
electron/          main process, sandboxed preload, tray, native integrations,
                    encrypted storage, HTTP/media relay and app updates
scripts/           dev launcher, installer artwork and release tools
build/             installer assets, Flatpak metadata and pinned Tauri manifest
tests/ui/          Svelte component tests
.github/workflows/  checks and explicit packaging/release jobs
```

Dependencies point inward: `ui → services → infra → core`. Raw youtubei.js nodes
never leave `src/lib/infra/ytmusic/`. The renderer stays sandboxed, with validated
IPC to the Electron main process.

## Tests

```bash
npm run typecheck
npm test               # Vitest service/UI tests + Node desktop/release tests
npm run test:smoke     # isolated local desktop startup test
```

TypeScript and Node tests sit next to the code they cover (`*.test.ts`,
`*.test.mjs`); Svelte UI tests live in `tests/ui/`, and release-tool tests live in
`scripts/`. Rust is no longer needed. The local smoke test uses a temporary
profile and leaves your account and settings alone. It checks startup, desktop
IPC, renderer isolation, encrypted storage and media transport without signing
in to YouTube or validating live playback.

See [`docs/TESTING.md`](docs/TESTING.md) and
[`docs/ELECTRON.md`](docs/ELECTRON.md) for the manual platform and playback checks.

## Credits

Cherry is developed with LLM assistance, from the ideas and feedback of
[inane.tools](https://inane.tools). DeepSeek v4.1 Flash generated much of the
original code through 1.4. Codex with GPT-6.1 Sol has contributed since 1.4.2,
with additional work by Claude through the jannuary fork.

Thanks to **[jannuary](https://github.com/jannuary/cherry)**, whose fork
contributed the code audit, the Vitest test suite, keyboard shortcuts, the sleep
timer and the repeat button. Those commits were authored by **Claude**
(Anthropic) and are preserved in this repository's history. See
[CONTRIBUTORS.md](CONTRIBUTORS.md).

**Codex (OpenAI)** contributed code review, playback and sign-out fixes,
regression tests, UI refinements, Linux packaging, the signed Tauri updater
and the Electron port.

**DeepSeek** v4.1 Flash contributed project scaffolding and most of the coding work from v1.0 to v1.4

## License

[MIT](LICENSE) © 2026 inane.tools
