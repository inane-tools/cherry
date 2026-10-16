# Cherry Electron

Experimental Electron fork of [Cherry](https://github.com/inane-tools/cherry),
starting from 1.7.0 Fukagawa. The Svelte frontend is retained; Electron replaces
the Rust/Tauri host. This experimental port compares Chromium playback,
animations and resource usage, not a replacement stable release.

## Run

Requires Node 22.12+ and npm. Rust and the Tauri CLI are not needed.

```sh
npm ci
npm run dev        # Vite on 127.0.0.1:1423 + Electron, frontend hot reload
npm run typecheck
npm test
npm run test:smoke # hidden startup/IPC test in an isolated temporary profile
npm run pack       # build an unpacked local desktop app
```

Restart Electron after editing main/preload code. After building, npm start
opens the production frontend. npm run dev:web is a browser-only UI preview.
Manual packaging uses npm run dist (NSIS on Windows, AppImage on Linux).
No CI, release workflows, signing, automatic updates or publishing are configured.

## Port status

- Electron BrowserWindow, custom caption buttons, native dragging, zoom,
  single-instance handling and normal close-to-exit behavior.
- Context-isolated, sandboxed renderer with an allowlisted IPC command registry.
  Remote sign-in windows have no preload or Node access. Chromium web security
  stays enabled. Local assets use a secure custom protocol; API and media relays
  validate destinations and redirects, and DASH media streams without base64 IPC.
- Persistent settings and encrypted auth/Last.fm secrets using Electron
  safeStorage. Login captures both YouTube cookie scopes, including after the
  login window closes. Data lives in a separate cherry-electron directory. Existing
  Cherry settings and credentials are never imported or modified. On Linux without
  a secure keyring, sign-in works for the current session only,
  with a visible notice; credentials are never written as plaintext.
- YouTube Music sign-in/cookie capture, manual cookie fallback, home/library,
  audio/video playback, lyrics, tray playback/pinned playlists, and Chromium
  Media Session integration are wired for local testing. Google may reject
  embedded sign-in; the existing cookie fallback remains available.
- Discord Rich Presence (including artwork links and clear/reconnect behavior),
  Last.fm authorization/now-playing/scrobbling, and custom playlist cover uploads
  are ported. Windows has playback buttons in taskbar previews and pinned/recent
  playlist Jump Lists with cached artwork. These integrations need live-account
  testing alongside the automated protocol and IPC checks.
- Manual video-quality changes replace buffered segments so downgrades do not
  wait for the old high-resolution buffer to drain. Auto remains adaptive.
- Still to port: native GTK caption glyphs, Flatpak,
  installers/signing polish and an Electron-specific updater. Unsupported
  native commands reject explicitly; they do not impersonate a working port.
  The updater cannot consume the upstream Tauri NSIS/AppImage feed.

See [docs/ELECTRON.md](docs/ELECTRON.md) for the architecture and test checklist.
The inherited changelog describes upstream Cherry; it is not a compatibility
claim for this experimental host. Upstream licensing and attribution are kept.
