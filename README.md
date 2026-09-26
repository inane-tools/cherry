# Cherry

**A lightweight, native-feeling YouTube Music desktop client.**

Cherry is a custom UI over YouTube Music's internal *Innertube* API (via
[`youtubei.js`](https://github.com/LuanRT/YouTube.js)) — there is no official
API, so it speaks the same endpoints the web player does. Built with
**Tauri v2 + Rust**, **Svelte 5**, **TypeScript** and **Tailwind v4**.

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
  a floating player bar and an "Up next" queue. No embedded web view of YouTube.
- **Sign in in-app** — loads music.youtube.com and captures the session from the
  native cookie store; the session lives in the **OS keychain**, never in
  localStorage.
- **Multiple brand channels** — a single login can own several; Cherry picks the
  one with the real library and lets you switch from Settings.
- **OS media integration** — SMTC / MPRIS / Now Playing, taskbar preview
  buttons, hardware media keys, and album-art-driven theming.
- **Discord Rich Presence** — optional "Listening to …" activity.
- **Built to feel fast** — a persistent Innertube cache, a TTL response cache
  and an offline-ish playlist cache so re-opens are instant.

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
src-tauri/src/      Rust: tray, media controls, Discord, keychain, HTTP relay
```

Dependencies point inward: `ui → services → infra → core`. Raw youtubei.js nodes
never leave `src/lib/infra/ytmusic/`.

## License

[MIT](LICENSE) © 2026 inane.tools

---

Made with **DeepSeek V4.1 Flash**.
