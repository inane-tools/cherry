# Electron scaffold

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
