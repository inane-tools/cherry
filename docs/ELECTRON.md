# Electron desktop host

Main: electron/main.mjs. Sandboxed preload: electron/preload.cjs. Renderer
adapters: src/lib/desktop. Pure request/path/IPC policy: electron/policy.mjs.
The source contains no Tauri package imports or Rust build requirements.

UI icons use `@phosphor-icons/web`, bundled locally. Use fill for primary
playback controls and active navigation/toggles, regular for inactive toggles, saved/pinned states and
secondary actions and small chevrons/actions, and duotone for artwork
placeholders and appearance controls. Examples: `ph-fill ph-play`,
`ph ph-bookmark-simple`, `ph ph-caret-down`, `ph-duotone ph-music-notes`.
Keep dynamic icons as full class strings so their names are visible to the
style generator. `npm run icons:generate` refreshes `src/lib/ui/icons.css`;
dev/build scripts run it automatically. Only used glyph selectors and three
WOFF2 files ship, without external requests or fallback font formats. Windows
caption buttons retain their native Segoe glyphs. The inane footer keeps the
original GitHub and X brand marks as inline SVGs; it does not load Boxicons fonts.

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
- Clear data, restart, and confirm the Electron profile alone is reset.
- Repeat the animation comparison on Linux hardware/VM with acceleration on;
  shared transitions use Chromium's native animations on every platform.
- Compare packaged builds and resource usage, rather than Vite dev overhead.
- Test the installed updater across versions before removing the preview feed.

GitHub Actions runs typecheck, Vitest and Node tests on Windows and Linux, builds
NSIS/AppImage/Flatpak, and smoke-tests the packaged Windows app. Release jobs
validate updater assets before publication. macOS is deferred. GitHub updates
use electron-updater with opt-in download/install.
See RELEASING.md and MIGRATION.md before publishing or changing the feed.
Do not reuse the Tauri updater key or feed.

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


Playlist state follow-up:

- Creation invalidates the cached editable menu; successful local create/rename
  evidence is merged with delayed menu responses. Deleted IDs cannot be revived
  by an older response. Account slots, channels and reset generations are checked.
- Opening a playlist also checks the editable header as positive permission
  evidence. Metadata caches include account identity and ignore old cache records
  that lacked permission information.
- Adding songs refreshes that playlist's header and, if open, contents in place.
  Existing rows stay visible while refreshing; unrelated playlists and playback
  are untouched. Counts and artwork update in the rail/page/home card.


Windows shell and playback follow-up:

- Jump Lists open playlists. Launch flags use `--open-playlist=ID`; older paired
  arguments remain supported through single-instance additionalData, because
  Chromium can reorder switches away from their values on a second launch.
- Enabled thumbnail buttons omit flags: Electron's native implementation rejects
  the literal `enabled` flag and clears its callback map on that failed update.
  The startup smoke test now checks actual native toolbar creation and launches
  a second Electron process to exercise both argument formats and IPC delivery.
- Windows branding registers this fork's DisplayName/IconUri under the current
  user's AppUserModelId key. Real icon files are copied out of app.asar into
  userData/branding; window relaunch details use the same app ID. Executable
  resource editing is enabled independently of code signing.
- Track handoffs retain the paused outgoing source while the next URL resolves.
  Timeline ticks reuse unchanged MediaMetadata; loading retains playback intent
  rather than explicitly pausing/removing the system media card.
- Last.fm counting excludes paused time and submits one scrobble per play.
  New-track and resume notifications update the separate Now Playing status.
  Last.fm's documented API has no explicit pause/clear-Now-Playing operation;
  its profile status can linger after pausing. Completed scrobbles remain history.


Media network backend:

- `createMediaFetch` uses Electron `net.fetch` (Chromium), preserving validated
  destinations/redirects, Range headers, header/idle timeouts and cancellation.
  Signed googlevideo URLs need no session cookies. API/login transport is unchanged.
- Avoid Node's HTTP fetch for buffered media: its bundled Undici parser can raise
  an uncaught `assert(!this.paused)` when a peer sends FIN under backpressure.
  The real-backend smoke test exercises paused consumption at EOF, repeated
  cancel/abort, truncated responses and subsequent successful playback requests.
- Do not suppress the error using a blanket uncaughtException handler. Streaming
  failures must reach the player as ordinary failed requests so recovery can run.


Installed video and queue follow-up:

- DASH's generated Blob manifests require `blob:` in `connect-src`. The packaged
  smoke test loads one through XMLHttpRequest under the production CSP; a dev
  server alone cannot catch this installed-only failure.
- Each queue entry gets a fresh media element once its stream resolves. The
  outgoing source remains attached while resolving, but its events cannot mutate
  the next entry. Resume targets are scoped by queue ID and video ID, including
  duplicate songs and audio/video counterparts.
- QueueList windows fixed-height rows in all three queue surfaces. Native scrolling
  still spans the full queue. An active drag row stays mounted outside the window;
  reordering uses full queue indexes. Arrow/Home/End keys materialize and focus
  distant rows. UI tests mount 10,000 tracks and exercise scrolling/reordering.
- `npm test` includes the Svelte UI suite in `tests/ui`; `npm run test:ui` runs it
  separately. The normal service tests retain their existing isolated config.

Resource maintenance:

- Cache parsed lyrics endpoints and video metadata, not full recommendation
  response trees. Preserve request sharing and account/channel isolation.
- Enforce the 48-entry memory cache limit on both disk reads and writes, discard
  expired entries first, and keep recently accessed entries. Persisted playlist
  data remains available after memory eviction.
- Healthy artwork needs no global recovery listeners. Failed images share one
  set, removed again after recovery or teardown. Theme extraction releases its
  decoded image and canvas before awaiting artwork presentation.
- Playback position/volume ticks must not recreate thumbnail candidates or
  schedule tray/Jump List work. Preserve media buffering, hardware acceleration,
  artwork resolution and the current/next-track preload behavior.
- To compare RAM, use the same packaged version/profile and workload after
  warm-up: play a long queue, browse several large playlists, alternate video,
  Art/Queue/Lyrics and settings, then return to the same view. Compare all Cherry
  processes and retained renderer heap after settling; do not compare a Vite
  session with a packaged app or force garbage collection during playback.
