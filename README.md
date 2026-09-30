# Cherry

**A lightweight, native-feeling YouTube Music desktop client.**

Cherry is a custom UI over YouTube Music's internal *Innertube* API (via
[`youtubei.js`](https://github.com/LuanRT/YouTube.js)) — there is no official
API, so it speaks the same endpoints the web player does. Built with
**Tauri v2 + Rust**, **Svelte 5**, **TypeScript** and **Tailwind v4**.

> **Latest release: v1.1.0** — see the [changelog](CHANGELOG.md) for what's new.

![Cherry](https://inane.tools/screenshot.png)

> ### Disclaimer
> Cherry is an unofficial client and is **not affiliated with, endorsed by, or
> associated with YouTube, Google or YouTube Music**. All trademarks and content
> belong to their respective owners. Cherry needs your **own account and a valid
> Premium subscription** to play music. You are responsible for how you use it
> and for any consequences, including any effect on your account. The software is
> provided **as is**, without warranty of any kind.

## Features

- **Fully custom UI** — home feed, Explore, search, playlists, artists, albums,
  a floating player bar and a full **Queue** panel. No embedded web view of
  YouTube.
- **Sign in in-app** — loads music.youtube.com and captures the session from the
  native cookie store; the session lives in the **OS keychain**, never in
  localStorage.
- **Multiple brand channels** — a single login can own several; Cherry picks the
  one with the real library and lets you switch from Settings.
- **Edit your library** — create playlists, add or remove songs, rename, edit
  descriptions and set a **custom cover image**; pick a **default save
  playlist**; and **save / unsave** playlists you did not create.
- **Queue control** — jump to any track (dropping the ones before it),
  drag-reorder, remove tracks, and clear.
- **Paste a link** — drop a YouTube / YouTube Music song or playlist URL into the
  search box to open it.
- **OS media integration** — SMTC / MPRIS / Now Playing, taskbar preview
  buttons, hardware media keys, and album-art-driven theming.
- **Light & dark themes** — follow the system or pick one, with the accent taken
  from the album art or a custom colour.
- **Last.fm scrobbling** — optional, using your own Last.fm API key.
- **Discord Rich Presence** — optional "Listening to …" activity.
- **Built to feel fast** — progressive playlist loading, next-track prefetching
  and a persistent response cache so re-opens are instant.
- **Dev tools when you need them** — open the WebView inspector from Settings
  (F12).

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

## Changelog

**v1.1.0** is the latest release. See [CHANGELOG.md](CHANGELOG.md) for the full
history.

## License

[MIT](LICENSE) © 2026 inane.tools

---

Made with **DeepSeek V4.1 Flash**.
