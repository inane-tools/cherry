# Cherry

Cherry is a YouTube Music desktop client for **Windows and Linux**, with a custom
frontend that talks directly to YouTube Music's internal *Innertube* API. Built
with **Tauri v2 + Rust**, **Svelte 5**, **TypeScript** and **Tailwind v4**.

![Cherry](https://inane.tools/screenshot-compact.webp)

> ### ⚠️ Disclaimer
> Cherry is an unofficial client and is **not affiliated with, endorsed by, or
> associated with YouTube, Google or YouTube Music**. All trademarks and content
> belong to their respective owners. To use Cherry, you need your **own YouTube account**. You are responsible for how you use it
> and for any consequences, including any effect on your account. The software is
> provided **as is**, without warranty of any kind.

## Features

- **Fully custom UI** - Cherry is not a wrapper on the YouTube Music web app, it has a fully custom built user interface, with a focus on simplicity and good looks.
- **A customizable sidebar** - one user-organised list of playlists and folders. Drag to
  reorder, drop a playlist onto a folder to file it, **pin** favourites to the
  top, resize the sidebar (only when compact sidebar is turned off), or switch to a compact icon-only mode. Below ~820px it
  collapses into a slide-in drawer.
- **Expanded player** - click the album art for a larger music view with artwork,
  Art, Queue and Lyrics tabs, playback controls and optional music videos.
- **In-app sign in** - loads music.youtube.com and captures the session from the
  native cookie store; the session lives in the **OS keychain**, never in
  localStorage. Cherry also handles multiple brand accounts, as one YouTube account can have many, it is really easy to switch between them in Settings.
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
- **Desktop integration** - Windows media controls and Linux MPRIS, hardware
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
- **Signed updates** - startup checks and an updater inside the Cherry card in
  Settings for Windows NSIS and Linux AppImage installations. Download when you
  choose, then install and restart. Flatpak updates use the latest release bundle.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design notes,
measurements and the Windows landmines that were hit along the way.

## Changelog

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

**v1.6.2 (Shibetsu)** adds signed GitHub updates for Windows and AppImage installs.

**v1.6.1 (Shibetsu)** fixes Discord presence clearing and adds links to the
current song on album artwork and to inane.tools on the Cherry badge.

**v1.6.0 (Shibetsu)** refreshes Home with more YouTube Music layouts, filters
and pagination, separates Explore into its own page, and adds an optional queue
sidebar. It also adds confirmed playlist deletion, expanded tray controls and
Windows playlist shortcuts, with improved artwork recovery and accent gradients.
Windows NSIS and Linux Flatpak/AppImage are supported; macOS builds are deferred.
See [platform support](docs/platforms.md) and
[CHANGELOG.md](CHANGELOG.md) for the full history.

## Download

Get **[v1.7.0 Fukagawa](https://github.com/inane-tools/cherry/releases/tag/v1.7.0)**
(or check the [latest release](https://github.com/inane-tools/cherry/releases/latest)):

- **Windows x64:** [NSIS installer](https://github.com/inane-tools/cherry/releases/download/v1.7.0/Cherry_1.7.0_x64-setup.exe).
- **Linux x86_64:** [Flatpak](https://github.com/inane-tools/cherry/releases/download/v1.7.0/Cherry_1.7.0_x86_64.flatpak) or [AppImage](https://github.com/inane-tools/cherry/releases/download/v1.7.0/Cherry_1.7.0_amd64.AppImage).

Install the downloaded Flatpak with `flatpak install --user Cherry_1.7.0_x86_64.flatpak`,
then run `flatpak run tools.inane.cherry`. This is a self-distributed bundle;
Cherry is not listed on Flathub.

For AppImage, run `chmod +x Cherry_1.7.0_amd64.AppImage` before opening it, and
keep it in a writable location to use the updater. See [platform support](docs/platforms.md)
for Linux keyring requirements and known limitations, including animation flicker
that can remain on some Linux systems.

**Users on 1.6.1 or earlier need to install 1.7.0 manually once to add the updater.** The `.sig`
files and `latest.json` on the release are updater assets; manual installation
only needs the installer for your platform.

## Requirements

- **Windows 10/11** (with WebView2), or Linux x86_64. macOS builds are deferred.
- To develop: **Node 22+**, **Rust** stable, and the **VS Build Tools C++ workload**
  on Windows or the [Linux build dependencies](docs/platforms.md#linux).

## Develop

```bash
npm ci
npm run tauri -- dev   # desktop app with hot reload
```

On Linux, use `npm run dev:linux` instead to filter duplicate WebKit media-player
entries. Install `xdg-dbus-proxy` first; see [Linux development](docs/platforms.md#duplicate-media-players-in-direct-builds).

The editable logo source is `src/lib/assets/logo.png`. The copy in
`public/logo.png` is the browser favicon; `src-tauri/icons` contains generated
desktop launcher/installer assets. Regenerate those with
`npm run tauri -- icon src/lib/assets/logo.png`. Mobile/UWP output, root-level
Figma exports, build output and downloaded release artifacts are ignored.
Keep installed dependencies and Rust compilation caches locally for faster builds.

Other scripts:

```bash
npm run typecheck      # svelte-check
npm test               # Vitest suites + updater manifest tests
npm run build          # build the frontend to dist/
npm run tauri -- build --config src-tauri/tauri.unsigned.conf.json
                      # unsigned local validation installer (NSIS on Windows)
```

Release builds require the updater signing key. See [the updater guide](docs/updating.md)
for local signing and CI release steps. CI produces Windows NSIS, Linux AppImage
and Flatpak, with signatures and a combined updater manifest.

Linux/macOS builds, native window controls, direct Flatpak packaging and the
Flathub submission constraints are documented in [docs/platforms.md](docs/platforms.md).

## App updates

Starting with 1.6.2, Cherry checks GitHub Releases at startup. When a newer
version is available, a button beside the account image shows its version and
opens the updater. You can also open **Settings → Cherry card → Updates** to
check manually, read release notes, download, then choose **Install and restart**.
Downloading leaves playback running; installation saves your queue and settings
before restarting.

Self-updating supports Windows NSIS and Linux AppImage installations. Flatpak
installs link to the latest bundle for manual updating. Development builds do
not self-update. Updates are verified against Cherry's public signing key before
installation. See [the updater guide](docs/updating.md) for signing, release
assets, and testing the upgrade from 1.6.2 to 1.7.

## Project layout

```
src/lib/core/       pure domain models
src/lib/infra/      Innertube client, storage, caches
src/lib/app/        services (player, queue, auth, settings, …)
src/lib/ui/         chrome (titlebar/sidebar/player) and views
src-tauri/src/      Rust: tray, media controls, Discord, keychain, HTTP relay,
                    Last.fm, playlist images, signed app updates
scripts/           Linux launcher and updater manifest generation/validation
packaging/flatpak/  self-distributed Flatpak packaging
.github/workflows/  native builds, signing and release updater metadata
```

Dependencies point inward: `ui → services → infra → core`. Raw youtubei.js nodes
never leave `src/lib/infra/ytmusic/`.

## Tests

```bash
npm test                       # Vitest + updater manifest tests; no Tauri needed
cargo test --locked --manifest-path src-tauri/Cargo.toml  # Rust unit tests
```

TypeScript and Rust tests sit next to the code they cover (`*.test.ts`, Rust
`mod tests`); updater manifest tests live in `scripts/`. Rust
tests that need the network are `#[ignore = "network"]`, and the keychain tests
need a real OS keychain (on Linux, a running Secret Service such as
gnome-keyring). Include ignored tests with
`cargo test --locked --manifest-path src-tauri/Cargo.toml -- --include-ignored`. See
[`docs/TESTING.md`](docs/TESTING.md).

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
regression tests, UI refinements, Linux packaging and the signed GitHub updater.

**DeepSeek** v4.1 Flash contributed project scaffolding and most of the coding work from v1.0 to v1.4

## License

[MIT](LICENSE) © 2026 inane.tools
