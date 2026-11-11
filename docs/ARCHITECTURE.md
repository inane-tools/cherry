# Architecture

Platform details, the security rules and the manual checklists are in
[ELECTRON.md](ELECTRON.md). This page is the map.

## Components

```
┌──────────────── Electron main process (electron/*.mjs) ────────────────┐
│ main.mjs      window, protocols (cherry://, cherry-media://), IPC hub │
│ policy.mjs    pure request/path/IPC policy (host allowlist, schemes)  │
│ network.mjs   API + googlevideo relay, redirect revalidation, ranges  │
│ login.mjs     YouTube/Google sign-in window, cookie capture           │
│ updates.mjs   electron-updater (Windows/AppImage), manual on macOS    │
│ lastfm, discord, mpris (Linux), taskbar, jump-list, macos, tray …     │
│ migration.mjs / legacy-credentials.*  import from the Tauri-era app   │
└──────────────▲──────────────────────────────────────────────────────────┘
               │ ipcMain.handle('desktop:invoke', command, args) + events
┌──────────────┴── preload.cjs (sandboxed, contextBridge) ───────────────┐
│ window.cherryDesktop = { platform, invoke, subscribe }                │
└──────────────▲──────────────────────────────────────────────────────────┘
               │
┌──────────────┴── Renderer: Svelte 5 SPA (src/) ────────────────────────┐
│ lib/desktop   typed adapters over cherryDesktop (invoke, store,       │
│               window, media session, opener)                          │
│ lib/infra     ytmusic/ InnertubeClient + raw*/mappers (YouTube Music  │
│               API), evaluator (decipher Web Worker), mediaProxy;      │
│               storage/ settingsRepo, cache                            │
│ lib/core      pure, UI-free logic (models, layout, filters, errors)   │
│ lib/app/services  app state + behaviour (player, queue, playlists,    │
│               auth, scrobble, sleepTimer, settings, theme …)          │
│ lib/ui        views/, chrome/ (PlayerBar, Sidebar, Queue…),           │
│               components/, actions/                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

Dependencies go from top to bottom: `ui` → `app/services` → `infra`/`core`
→ `desktop`. `core` has no runtime imports from other layers. Three files
(`browseLayout`, `listenAgain`, `profileSections`) import only the
`HomeSection` *type* from `infra/ytmusic/rawHome`, which is erased at build
time. Some `core` tests import `svelte/store` and `app/services/queue`.

## How they talk

- **Renderer → main:** `invoke(command, args)` in `src/lib/desktop/core.ts`
  calls `window.cherryDesktop.invoke`, which goes through the preload to the
  single `desktop:invoke` handler in `main.mjs`. Off Linux, `media_now_playing`
  and `media_cleared` stay in the renderer (Chromium Media Session); Linux
  sends them to MPRIS.
- **Main → renderer:** named events through `cherryDesktop.subscribe`
  (updater state, media keys, tray/jump-list actions, second instance).
- **Network:** the renderer never calls Google hosts directly. The API and
  stream requests go through main-process relays that enforce the host
  allowlist, add desktop User-Agent/Origin headers, revalidate redirects and
  support ranges. Media is served to `<audio>/<video>` as
  `cherry-media://stream/`.
- **Persistence:** settings, queue, pins, folders and credentials go through
  `settings:get/set` IPC. The main process owns the fixed data paths, and
  secrets use OS-encrypted storage (sign-in is temporary without it).
- **App shell:** the packaged renderer loads from `cherry://app`. In
  development it loads from a fixed dev origin (Vite on port 1423, from
  `scripts/dev.mjs`).

## Key design decisions

- **Electron replaced Tauri** (2.0) for parity: one Chromium engine on every
  OS instead of each system's WebView, which on Linux needed heavy workarounds
  and still felt worse. No OS should feel second-class, so prefer fixes that
  hold everywhere over per-platform patches. There are no Tauri or Rust dependencies.
  Legacy profiles and credentials are migrated on startup (see MIGRATION.md).
  The Tauri updater key/feed must not be reused.
- **Narrow IPC surface.** IPC is accepted only from the main frame at the
  app origin, and the preload never exposes `ipcRenderer`. There is never any
  arbitrary filesystem, shell or JS-eval IPC.
- **Sandboxed renderer, strict CSP.** `unsafe-eval` is allowed only for the
  time-boxed decipher Web Worker that runs YouTube's extracted player code.
  Remote scripts are never allowed.
- **Main-process media relay.** This gives one place for host policy, cookies
  and range/stall handling. Canceling media cancels the upstream transfer.
  A stream failure refreshes once, keeping position and play state.
- **Load generations.** Async player and collection loads carry a
  `loadGeneration`, and stale results are dropped. Comment the reason for any
  handoff logic.
- **A fresh media element per queue entry.** Code that outlives a track
  (fades, timers) must follow the *current* element (see the sleep-timer fix
  in 2.2.1).
- **Native MPRIS on Linux** (`org.mpris.MediaPlayer2.cherry`) for writable
  Shuffle/LoopStatus. Other platforms use Chromium Media Session.
- **Local icons only.** Phosphor glyphs are subset into
  `src/lib/ui/icons.css` by `scripts/icons.mjs`, with no external font
  requests.
- **The smoke test is built into the app** (`--smoke-test`). It runs headless
  with a temporary profile. The macOS branch drives the Settings UI, so it
  breaks when Settings structure changes.

See [DECISIONS.md](DECISIONS.md) for dated decisions going forward.
