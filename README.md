# Cherry

**Your music, my way.**

Cherry is a YouTube Music desktop client that is not just another wrapper, it has a completely custom frontend, that speaks directly to YouTube Music's internal *Innertube* API (via [`youtubei.js`](https://github.com/LuanRT/YouTube.js))

Since there is no official API, it uses the same endpoints that the Web Player does. Built with
**Tauri v2 + Rust**, **Svelte 5**, **TypeScript** and **Tailwind v4**.

> **Latest release: v1.3.0** — see the [changelog](CHANGELOG.md) for what's new.

![Cherry](https://inane.tools/screenshot-compact.webp)

> ### Disclaimer
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
  playlist**; and **save / unsave** playlists you did not create. (This functionality is still work in progress so there are still certain things you cannot do, like deleting playlists)
- **Queue control** - jump to any track (dropping the ones before it),
  drag-reorder, remove tracks, and clear.
- **Paste a link** - drop a YouTube / YouTube Music song or playlist URL into the
  search box to open it.
- **OS media integration** - SMTC / MPRIS / Now Playing, taskbar preview
  buttons, hardware media keys, and album-art-driven theming.
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

## Requirements

- **Windows 10/11** (WebView2 is preinstalled), or Linux/macOS.
- **Node 20+**, **Rust** stable, and the **VS Build Tools C++ workload** on
  Windows.

## Develop

```bash
npm install
npm run tauri dev      # desktop app with hot reload
```

Other scripts:

```bash
npm run typecheck      # svelte-check
npm test               # unit tests (Vitest)
npm run build          # build the frontend to dist/
npm run tauri build    # package a release (NSIS/MSI on Windows)
```

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

Cherry is built by DeepSeek V4.1 Flash, working from the ideas and feedback of [inane.tools](https://inane.tools).

Thanks to **[jannuary](https://github.com/jannuary/cherry)**, whose fork
contributed the code audit, the Vitest test suite, keyboard shortcuts, the sleep
timer and the repeat button. Those commits were authored by **Claude**
(Anthropic) and are preserved in this repository's history. See
[CONTRIBUTORS.md](CONTRIBUTORS.md).

## License

[MIT](LICENSE) © 2026 inane.tools
