# Electron port

Main: electron/main.mjs. Sandboxed preload: electron/preload.cjs. Renderer
adapters: src/lib/desktop. Pure request/path/IPC policy: electron/policy.mjs.
The source contains no Tauri package imports or Rust build requirements.

The main window only accepts IPC from its main frame at cherry://app (or the
fixed development origin). Preload forwards payloads without exposing ipcRenderer.
Handlers own fixed data paths and validate network schemes/hosts and redirects.
Never add arbitrary filesystem, shell-command or JavaScript-evaluation IPC.
YouTube deciphering remains isolated in a time-boxed renderer Web Worker.
The packaged CSP permits unsafe-eval for that worker's extracted player code,
but never remote script tags; renderer Node integration stays disabled.

Local test checklist:

- Sign in using a test account (or manual cookie fallback); restart and verify
  encrypted session/settings restoration and separate app data.
- Browse home/library, play audio, seek, queue/skip tracks, open/collapse Art,
  Queue/Lyrics, enable video, change quality and check playback continuity.
- Check captions, window controls, native dragging/double-click, UI zoom,
  media keys, Media Session and tray controls. Closing must exit.
- Clear data, restart, and confirm the experimental profile alone is reset.
- Repeat the animation comparison on Linux hardware/VM with acceleration on;
  Electron does not enable Cherry's WebKitGTK animation workaround.
- Compare packaged builds and resource usage, rather than Vite dev overhead.
- Review all remaining ports before considering releases or automatic updates.

CI was deliberately removed. Run typecheck, Vitest, Node policy tests and
local packaging manually. Windows/macOS/Linux signed installers and CI are
future work. Do not reuse the stable Cherry updater key or release repository.

Login and streaming follow-up:

- Capture YouTube Music and www.youtube.com cookies; require signing and session
  cookies, excluding Google-domain collisions. The login can finish after the
  remote window closes. Without secure OS storage, sign-in is explicitly temporary.
- API relays preserve requested mobile identities and add browser User-Agent and
  Origin defaults for desktop requests. Googlevideo progressive/DASH/fallback
  requests use the same range-aware relay.
- Connection and stalled-body waits are bounded; active streams have no fixed
  total-duration cutoff. Canceling media cancels its upstream transfer.
- Runtime stream failures refresh once with the play/pause state and position
  retained. Repeat failures display an error instead of retrying indefinitely.

Brand-channel handling captures SESSION_INDEX and DELEGATED_SESSION_ID from the
YouTube Music login page. Google account slots and brand page IDs are separate.
Clients/cache identities include the account slot; brand requests retain the
on-behalf-of context. Secure-prefixed signing cookies are adapted for youtubei.js
without overwriting a real SAPISID cookie. Existing sessions can sign in again
to capture the selected account slot.

The player-script cache remains enabled. The shared youtubei.js session cache is
disabled so restoring a brand session cannot leak its page context into personal
account discovery. Signed API requests preserve the origin used by SAPISIDHASH.


Native integration follow-up:

- Manual DASH quality changes use segment replacement; initial selection does not
  discard the buffer, and preferences resolving to the same stream are deduplicated.
  See [dash.js quality selection](https://dashif.org/dash.js/api/module-MediaPlayer.html#setRepresentationForTypeById).
- Discord IPC uses Node sockets (Windows pipes, Unix runtime paths and Linux
  Flatpak/Snap locations), bounded frame parsing, handshake/request timeouts and
  acknowledged activity changes. Clear disconnects even when the request fails;
  the next playback update reconnects. Quit drops the socket. No new packages.
- Last.fm auth and scrobbles use the existing renderer lifecycle and encrypted
  secret storage. Requests are signed in the main process against a fixed HTTPS
  endpoint, with redirects disabled and bounded response sizes.
- Playlist image uploads retain account slot and brand page headers, sign against
  the Music origin, validate the resumable upload destination, and return the blob
  ID to the existing playlist edit API. No upload occurs until the user chooses it.
- Windows taskbar preview playback buttons and pinned/recent playlist Jump Lists
  are native. Removed shortcuts are respected; cached 64px artwork is wrapped in
  ICO files under this fork's userData. Launch requests queue until the renderer
  listens, including cold starts and reloads. Other platforms skip Jump Lists.
- Live verification still needed: Discord profile display, Last.fm authorization
  and accepted scrobbles, playlist image uploads, Windows shell menus, and quality
  switching on the Deck. Tests use synthetic data and local/mock services.
