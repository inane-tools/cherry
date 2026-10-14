# Cherry

Cherry is a YouTube Music desktop client, it features a completely custom frontend that speaks directly to YouTube Music's internal *Innertube* API, Cherry uses the same endpoints that the official YouTube Music Web app does. Built with **Tauri v2 + Rust**, **Svelte 5**, **TypeScript** and **Tailwind v4**.

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
- **Full-screen player** - click the album art to open the full-screen music view.
- **In-app sign in** - loads music.youtube.com and captures the session from the
  native cookie store; the session lives in the **OS keychain**, never in
  localStorage. Cherry also handles multiple brand accounts, as one YouTube account can have many, it is really easy to switch between them in Settings.
- **Edit your library** - Currently you can create playlists, add or remove songs, rename, edit
  descriptions and set a **custom cover image**; pick a **default save
  playlist**; **save / unsave** playlists you did not create; and **delete your
  own playlists** with an explicit permanent-deletion confirmation.
- **Queue control** - jump to any track (dropping the ones before it),
  drag-reorder, remove tracks, and clear. Keep the queue in a right sidebar
  when there is room, with the player queue button available in smaller windows.
- **Home & Explore** - browse recommendations, filter the Home feed, and open
  moods, genres, charts and new releases from the separate Explore page.
- **Paste a link** - drop a YouTube / YouTube Music song or playlist URL into the
  search box to open it.
- **OS media integration** - SMTC / MPRIS / Now Playing, taskbar preview
  buttons, hardware media keys, and album-art-driven theming. Tray controls and
  Windows taskbar shortcuts provide quick playback of pinned/recent playlists.
- **Light & dark themes** - follow the system or pick one, with the accent taken
  from the album art or a custom colour and optional background gradients. The
  window title follows the current track.
- **Keyboard shortcuts** - Space to play/pause, arrows to seek, Ctrl+arrows
  to skip and change volume, S/R for shuffle/repeat, Ctrl+F to search (full
  list in Settings).
- **Sleep timer** - stop after 5 minutes to 1.5 hours with a gentle fade, or
  at the end of the current track.
- **Integrations** - Cherry currently has the ability to display your currently playing music as an activity on Discord and you can also scrobble songs to last.fm.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design notes,
measurements and the Windows landmines that were hit along the way.

## Changelog

**v1.6.0 (Shibetsu)** refreshes Home with more YouTube Music layouts, filters
and pagination, separates Explore into its own page, and adds an optional queue
sidebar. It also adds confirmed playlist deletion, expanded tray controls and
Windows playlist shortcuts, with improved artwork recovery and accent gradients.
Windows NSIS and Linux Flatpak/AppImage are supported; macOS builds are deferred.
See [platform support](docs/platforms.md) and
[CHANGELOG.md](CHANGELOG.md) for the full history.

## Download

Get **[v1.6.0 Shibetsu](https://github.com/inane-tools/cherry/releases/tag/v1.6.0)**:

- **Windows:** [NSIS installer](https://github.com/inane-tools/cherry/releases/download/v1.6.0/Cherry_1.6.0_x64-setup.exe).
- **Linux x86_64:** [Flatpak](https://github.com/inane-tools/cherry/releases/download/v1.6.0/Cherry_1.6.0_x86_64.flatpak) or [AppImage](https://github.com/inane-tools/cherry/releases/download/v1.6.0/Cherry_1.6.0_amd64.AppImage).

Install the downloaded Flatpak with `flatpak install --user Cherry_1.6.0_x86_64.flatpak`,
then run `flatpak run tools.inane.cherry`. For AppImage, make the downloaded file
executable before opening it. See [platform support](docs/platforms.md) for
Linux keyring requirements and known limitations.

## Requirements

- **Windows 10/11** (with WebView2), or Linux x86_64. macOS builds are deferred.
- To develop: **Node 22+**, **Rust** stable, and the **VS Build Tools C++ workload**
  on Windows or the [Linux build dependencies](docs/platforms.md#linux).

## Develop

```bash
npm install
npm run tauri -- dev   # desktop app with hot reload
npm run dev:linux      # Linux dev launcher; prevents duplicate media players
```

Other scripts:

```bash
npm run typecheck      # svelte-check
npm test               # unit tests (Vitest)
npm run build          # build the frontend to dist/
npm run tauri -- build # package a release (NSIS on Windows)
```

Linux/macOS builds, native window controls, direct Flatpak packaging and the
Flathub submission constraints are documented in [docs/platforms.md](docs/platforms.md).

## Project layout

```
src/lib/core/       pure domain models
src/lib/infra/      Innertube client, storage, caches
src/lib/app/        services (player, queue, auth, settings, …)
src/lib/ui/         chrome (titlebar/sidebar/player) and views
src-tauri/src/      Rust: tray, media controls, Discord, keychain, HTTP relay,
                    Last.fm, playlist images
```

Dependencies point inward: `ui → services → infra → core`. Raw youtubei.js nodes
never leave `src/lib/infra/ytmusic/`.

## Tests

```bash
npm test                       # TypeScript unit tests (jsdom, no Tauri needed)
cd src-tauri && cargo test     # Rust unit tests
```

Tests sit next to the code they cover (`*.test.ts`, Rust `mod tests`). Rust
tests that need the network are `#[ignore = "network"]`, and the keychain tests
need a real OS keychain (on Linux, a running Secret Service such as
gnome-keyring). Run everything with `cargo test -- --include-ignored`. See
[`docs/TESTING.md`](docs/TESTING.md).

## Credits

Cherry is built with the use of LLM's (Majority of code has been generated with DeepSeek v4.1 Flash) additional work done with Claude (jannuary fork features). 

As of update 1.4.2, Codex with GPT-6.1 Sol working from the ideas and feedback of [inane.tools](https://inane.tools).

Thanks to **[jannuary](https://github.com/jannuary/cherry)**, whose fork
contributed the code audit, the Vitest test suite, keyboard shortcuts, the sleep
timer and the repeat button. Those commits were authored by **Claude**
(Anthropic) and are preserved in this repository's history. See
[CONTRIBUTORS.md](CONTRIBUTORS.md).

**Codex (OpenAI)** contributed code review, playback and sign-out fixes,
regression tests and UI refinements.

**DeepSeek** v4.1 Flash contributed project scaffolding and most of the coding work from v1.0 to v1.4

## License

[MIT](LICENSE) © 2026 inane.tools
