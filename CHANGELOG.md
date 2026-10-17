# Changelog

All notable changes to Cherry are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

## [1.7.1] — 2026-10-17

Fukagawa. First public Electron release for Windows and Linux.

### Changed

- Replaced the Tauri host with Electron/Chromium, retaining the Cherry frontend,
  version sequence and minor-version codenames. Repository names stay unchanged
  while the migration is prepared; macOS is deferred.
- Windows caption buttons use the system Segoe Fluent/MDL2 glyphs, scale with
  app zoom and use black or white ink for light and dark themes.
- Added a minimal one-click NSIS installer: progress, then launch Cherry.
  Setup uses the dedicated install-cherry artwork; the app icon stays unchanged.
  Windows packaging produces only NSIS; Linux targets AppImage and Flatpak.
- GitHub-based updates for Windows and AppImage use explicit download and
  install actions, progress in the accent color and the existing topbar badge.
  Flatpak stays managed by Flatpak. The Electron feed is separate from Tauri.

### Fixed

- Installed builds allow generated DASH manifests through the content security
  policy, preventing HD video from silently falling back to the 360p file.
- New queue entries get separate media clocks; late events and saved positions
  from an outgoing song cannot seek into or skip the following song.
- Queue opening mounts only visible rows, with overscan, keyboard navigation and
  drag sources retained while scrolling. Large queues no longer build every row.
- Media streams use Chromium's network backend to avoid an uncaught Node/Undici
  parser assertion when connections end while playback has buffered the response.
  Cancellation also handles a pending body read without touching a closed stream.
- Brand-channel login/session capture, streaming recovery and video-quality
  switching. Created playlists retain edit permissions and refresh after edits.
- Windows Jump Lists open the selected playlist; preview playback controls and
  media-card identity are wired to Electron.
- Cache clearing preserves preferences and credentials, full reset prevents
  stale settings writes, logout clears browser sign-in data, and Settings sizes
  the full local profile rather than only the HTTP cache.
- Ported Discord Rich Presence, Last.fm scrobbling and playlist-art uploads.

## [1.7.0] — 2026-10-16

Fukagawa.

### Added

- Lyrics above the compact player and in the expanded player's Lyrics tab,
  enabled by default. LRCLIB is preferred, with YouTube Music as a fallback.
  Timed lyrics follow playback and support click-to-seek; untimed lyrics remain
  readable without invented timestamps. Lyrics controls gray out when unavailable.
- Music-video playback in the expanded player, with adaptive HD up to 1080p,
  Highest, Auto and remembered resolution choices. Optional black letterboxing
  preserves the full frame without changing the layout.
- Station playback and Start radio, with continuation loading and bounded queues.

### Changed

- Expanded-player Art, Queue and Lyrics tabs use the artwork backdrop and retain
  the selected tab when collapsed. Video mode offers Video and Queue; lyrics
  pause in video mode to avoid mismatched timing.
- Video preference survives audio-only songs and app restarts. Restored video
  prepares without autoplaying; next-track video streams are prefetched and
  overlapping lookups are shared. Collapsing keeps playback running.
- Expanded artwork preloads and crossfades with the background and accent colors.
  The compact player slides down as the expanded player opens.
- Smoother shared animations, lyric highlighting and scrolling, respecting
  reduced motion and the existing Linux rendering workarounds.
- Startup reveals the initial content over a plain themed background, replacing
  the animated splash. Network and artwork waits have a bounded startup budget.
- Pasted YouTube links show clickable song or playlist previews. Closing search
  clears the query and results instead of replaying the previous search.
- Player settings have their own section. Playback library credits and LRCLIB
  attribution are included in Open Source & Contributors.
- Clicking the Cherry logo five times now disables Developer options as well as
  enabling them, including the DevTools shortcut and any open DevTools window.

### Fixed

- Homepage playlist and album play buttons play the displayed collection rather
  than an unrelated recommendation mix. Loading spinners rotate around their center.
- Expanded artwork rejects YouTube's tiny missing-thumbnail placeholder and tries
  available sizes, retaining maximum resolution wherever it exists.
- Stream caches are isolated by account and channel; stale requests cannot refill
  a cleared cache or overwrite a newer playback request.
- Compact lyrics no longer flash loading or untimed states before lookup finishes.
  Manual scrolling temporarily pauses lyric following without playback scrolling
  constantly revealing the scrollbar.
- Sleep timers retain their deadline when paused during the fade and use the
  remaining time when resumed.
- Updated devalue and source-map-js for security fixes.

## [1.6.2] — 2026-10-16

Shibetsu maintenance update.

### Added

- Signed app updates from GitHub Releases for Windows NSIS and Linux AppImage,
  with startup checks and a Settings download/install flow. Installation waits
  for your confirmation and preserves the queue and settings before restarting.
- Signed installer artifacts and update metadata in CI. Flatpak users get a
  link to the latest release bundle instead of attempting an in-app installation.

## [1.6.1] — 2026-10-15

Shibetsu maintenance update.

### Fixed

- Restoring a paused song at startup does not publish Discord presence until
  audio playback actually begins.
- Discord clears bypass the playback update delay, run after in-flight updates,
  and disconnect the IPC session so stale presence cannot linger or be restored
  by a pending update. Failed clears are reported and retried by the keep-alive.
- Restored and cued paused tracks now start the same one-minute presence cleanup
  timer as normal pauses. Playback errors clear presence instead of advertising
  a track that cannot play.

### Changed

- Installer CI produces only Windows NSIS and Linux AppImage/Flatpak, caches
  Rust dependencies, shares release-profile compilation with native tests,
  and builds the frontend once per installer job.
- Clicking Discord's album artwork opens the current song on YouTube; clicking
  the small Cherry icon opens inane.tools.

## [1.6.0] — 2026-10-14

Shibetsu — a refreshed Home experience, more playlist controls and desktop integration.

### Added

- Optional persistent queue sidebar with the same surface as the library rail.
  Queue content stays below the topbar, including with the expanded player.
  The player queue button returns when the window or app scale leaves too little room.
- Owned playlists can be deleted from their page or context menu, with an
  explicit permanent-deletion confirmation.
- Tray menu shows the current song, artist and album, with previous/next,
  shuffle, repeat and pinned-playlist controls.
- Windows taskbar Jump List includes pinned and recently used playlists, with
  artwork icons and playback shortcuts that work when Cherry is running or launching.

### Fixed

- Accent and theme changes no longer interpolate inherited colour tokens for
  700 ms. The backdrop uses a short crossfade, avoiding repeated gradient
  repaints and lag behind the colour picker.
- Accent-picker drag events are coalesced into one control preview per frame;
  expensive surface tinting and backdrop changes apply on release.
- Saving/removing playlists uses the correct structured Innertube target,
  fixing HTTP 400 responses. Rejected writes no longer report success locally.
- Expanded artwork keeps the image URL that actually loaded after a fallback,
  and retries failed images on connection recovery or returning to the app.
- Playlist artwork falls back through available sizes and refreshes stale
  library artwork URLs after repeated failures.
- Expanded player closes when navigating to a page, including pressing Home
  again, opening a search result, or going Back/Forward.
- Settings dropdown menus no longer get clipped by collapsible sections or the
  Settings scroll area. Menus open upward when needed to fit the window.

### Changed

- Softer two-colour top backdrop, with a matching secondary hue derived from
  the active accent and the existing surface tinting preserved.
- Rounded metadata chips and action buttons in playlist and album views, plus
  an artist subtitle chip. Queue headers align the title, count chip and buttons.
- Owned-playlist editing and deletion live in a three-dot menu beside Play and
  Shuffle; other playlists retain their save/remove library button.
- Song credits uses the shared sheet header, spacing and typography, with one
  close control instead of a redundant footer button.
- Explore is a separate page, opened from the sidebar below Home. Compact
  song-row play overlays are slightly transparent without blur.
- New folders, created playlists and newly saved playlists appear first below
  pins. Pins can be reordered only within their group; their thumbnails no
  longer start native image drags.
- Folder icons show the first four playlist covers in a rounded, inset grid,
  with an accent-tinted frame, clear dividers and a centered folder glyph.
- Home keeps YouTube's section/item ordering, supports additional card formats,
  filter chips, navigation buttons and paginated recommendations. Song shelves
  use the server's row count; unsupported stations remain hidden.
- Carousels keep the left inset and right-edge layout, scroll by whole columns,
  and show flat controls above the row. Hover play buttons start playback while
  clicking the rest of a collection card opens it.
- Refreshed Cherry's icon across the app, desktop launchers and installers.
- Release codename advances automatically to Shibetsu for the 1.6 series.

### Removed

- Close-to-tray behavior; closing the main window exits normally.
- Tray seek, mute and volume controls, and the playback-status line.

## [1.5.0] — 2026-10-11

### Added

- Window-controls preference in Appearance, with native GTK buttons on Linux.
- Linux Flatpak and AppImage downloads alongside the Windows NSIS installer.
- Native desktop build workflow for Windows NSIS, Linux DEB/AppImage and direct
  Flatpak distribution. macOS configuration is prepared; builds are deferred.

### Changed

- Search uses a compact floating bar above scrollable results, with focus on
  opening and songs first. The release codename advances to Sunagawa.
- Linux uses Secret Service directly for sandbox-compatible credential storage.
- Linux closes normally without relying on a tray host; macOS supports Dock reopen.
- Linux window controls follow desktop button placement, Cherry's light/dark
  theme and live app scaling, with rounded hover backgrounds at the window edges.
- Linux popup and artwork fades use frame-by-frame updates; hover feedback is
  immediate to avoid flickering CSS transitions in WebKit.

### Fixed

- Cleared, replaced or closed searches cannot restore stale responses.
- Linux mouse/touch window interaction no longer crashes under the GTK controls.
- Flatpak prevents duplicate generic WebKit media-player entries; direct Linux
  builds can use the filtered session-bus launcher.
- Linux data-size reporting includes WebKit storage and caches, and full data
  cleanup completes before the next webview starts.

## [1.4.2] — 2026-10-10

### Changed

- Folder, playlist creation/editing and search popups now follow the redesigned
  Settings view, with plain bold headings and compact fields without extra panels.
  New folder and playlist fields no longer show a redundant name label.
- Floating and expanded-player queues share a compact layout with opaque
  backgrounds, smaller artwork and consistent headings and controls.
- Playlist and album action buttons use the same corner rounding as compact
  sidebar artwork, and compact sidebar hover labels no longer have an outline.
- Codex (OpenAI) is credited for code review, bug fixes, regression tests and UI
  refinements.

### Fixed

- Pending streams can no longer restart playback after stopping or signing out.
- Signing out after restoring a saved session clears account and library state;
  failures to delete saved credentials are reported instead of hidden.
- Stale channel, library and cache requests cannot overwrite refreshed data or
  repopulate account state after sign-out.
- Failed Last.fm scrobbles keep the original song's timestamp when retried.

## [1.4.1] — 2026-10-10

### Added

- **Release codenames** — every release is named after a Japanese city, taken in
  ascending order of population (so later releases get bigger cities). The name
  shows beside the version in **Settings → About** and advances automatically
  when the minor version bumps; patch releases keep their minor's name.
- A **Releases** button in the About card, linking to the GitHub releases page.

### Changed

- **Settings was restyled** — flat, borderless sections with plain headings and
  no per-row icons, and the native dropdowns are now consistent in-app menus.
  The account and data sections were simplified.
- **Developer options are hidden by default** — tap the Cherry logo five times
  in Settings → About to unlock them.

## [1.4.0] — 2026-10-08

### Added

- **Tinted surfaces** (Appearance): a Material-You-style variant that mixes the
  accent into the neutral background and card colours (stronger on light theme).
- **Player button visibility** (Appearance): hide the previous, shuffle, repeat,
  sleep-timer or queue buttons from the player.

### Changed

- The app typeface is now **Gabarito** (was Zalando Sans).
- The default UI scale is 10% larger — the zoom slider's "100%" now renders at
  the size 110% used to.

## [1.3.0] — 2026-10-08

A feature release on top of the 1.2 layout work. Thanks to **jannuary** and
**Claude** for the audit, tests and player features (see
[CONTRIBUTORS.md](CONTRIBUTORS.md)).

### Added

- **Keyboard shortcuts**: Space / K play-pause, ← / → seek 5 s, J / L seek
  10 s, Ctrl + ← / → previous / next, Ctrl + ↑ / ↓ volume, M mute, S shuffle,
  R repeat, Ctrl + F or / search, Ctrl + , settings (⌘ on macOS). They never
  fire while typing. Listed in Settings → Keyboard shortcuts.
- **Sleep timer** in the player bar and full-screen player: 5, 15, 30, 45, 60
  or 90 minutes with a countdown and an 8-second fade-out, or "end of track",
  which lets the song finish and cues the next one paused.
- **Repeat button** (off / all / one). Repeat existed but had no control.
- **UI zoom** — a slider in Settings → Appearance scales the whole window
  (50–200%) with visible steps; the chosen level is restored on launch.
- **More Last.fm control** — toggle "now playing", choose how much of a track
  must play before scrobbling (50 / 75 / 90%) and skip tracks under a chosen
  length.
- The overlay scrollbar is now **draggable**.
- **Song credits** — right-click a song → "Song credits" to see writers,
  producers and performers (when YouTube Music provides them).
- **Square album art** option for the expanded player (Appearance): shows the
  cover as a square above the title, with a blurred copy behind it.
- Unit tests: a Vitest suite for the TypeScript layers (`npm test`).

### Fixed

- Skipping quickly could play the previous song while the next one was shown.
- Turning shuffle off jumped to a different song.
- Adding songs to the queue with shuffle on re-shuffled the whole queue
  (already-played songs came back); "Play next" landed in a random place.
- Songs played on repeat-one were scrobbled only once, and scrobbles that
  failed while a retry was running could be lost.
- A playlist that failed to load once looked empty for 30 minutes.
- Playlists without an explicit count could show absurd song counts (e.g. the
  year and the count glued together).
- The Stop media key resumed playback when paused.
- Some unrelated errors were reported as sign-in or rate-limit problems.
- Shuffle and repeat changes made from the player bar were not remembered.
- Reading the saved session no longer blocks the window at startup.
- The expanded player's cover no longer flashes black or **pops in** when
  opening or changing tracks: the previous cover stays until the next has
  loaded, then crossfades. It also no longer occasionally fails to load (the
  fallback chain restarts per track).
- **Album pages show the artist again** (the typed header's `author` is read as
  a string / `.text`, with the header's artist line as a fallback).
- The OS **window title now actually follows the current song** — a missing
  window permission had silently blocked `setTitle`.
- Pale album-art accents no longer wash out white text: the accent is clamped to
  a readable brightness, and the secondary accent stays legible as text.

### Changed

- The home loading skeleton now mirrors the real home layout (a hero row plus
  ordinary sections) instead of overflowing the page.
- The compact-sidebar toggle moved to Appearance, and the minimize-to-tray
  option was removed (the tray will be reworked).
- The Open source section is now **Open Source & Contributors** and credits the
  fork's authors alongside the dependency list.

### Security

- The built-in HTTP relay only talks to YouTube / Google hosts (redirects
  included); it used to forward requests anywhere, including `localhost`.
- YouTube's signature-deciphering script now runs in an isolated Web Worker
  without access to the app's internals, instead of inside the app page.
- The Last.fm API secret and session key moved from the plaintext settings file
  to the OS keychain (migrated automatically; removed by "Clear everything").

## [1.2.1] — 2026-10-08

### Fixed

- **In-app sign-in failed after "Clear data".** The main window's WebView2
  `additionalBrowserArgs` set the shared WebView2 environment, which broke the
  login window ("failed to receive message from webview"). Those browser flags
  (media-session de-duplication, hardware media keys and the autoplay policy)
  now go through the `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` environment
  variable — the path sign-in already relied on.
- **"Clear data" did not stick on installs upgraded from the previous "xylo"
  identity**: the next launch re-imported the old settings. The one-time
  migration is now recorded, so clearing the app's data is permanent.

## [1.2.0] — 2026-10-08

A big layout and polish release. The sidebar was rebuilt around folders and
drag-to-reorder, Home and Explore merged into one page, and the player gained a
full-screen view with the queue inline.

### Added

- **Rebuilt sidebar.** The rail is now a single, user-organised list of
  playlists and folders instead of fixed "created / folders / saved" sections.
  Drag to reorder, drop a playlist onto a folder to add it, drop it between a
  folder's open children to place it exactly, and reorder folders. The order is
  remembered.
- **Playlist folders** — create, rename and delete; drag playlists in and out.
  Open folders sit on an accent-tinted panel, and their open/closed state is
  remembered across restarts.
- **Pinned playlists** float to the top of the rail (right-click → Pin). Pinned
  rows show a pin badge, cannot be dragged, and pinning is offered only from the
  rail's context menu.
- **Resizable rail** — drag its right edge in the expanded layout (remembered).
- **Compact rail** — an icon-only mode with hover tooltips (Settings →
  Appearance).
- **Sidebar navigation** — Back, Home, Search and New now live in the rail.
- **Responsive layout** — below ~820px the rail becomes a slide-in drawer opened
  from the top bar.
- **Full-screen player** — click the album art to expand the player into a
  now-playing card with a "Next up" chip and the queue shown inline.
- **Time-based greeting** on the Home page.
- **Disable background gradients** option in Appearance.
- **Window title follows the current track.**
- Playlist / album / artist pages show the type, song count and total time as
  chips, top-aligned with the artwork.

### Changed

- **Home and Explore are one page.** Explore now loads lazily beneath the home
  feed; the separate Explore view and the "Your playlists" grid were removed.
- **Top bar** holds the account avatar (hover for a settings cog) and the
  narrow-mode menu; the now-playing summary was removed.
- **Player bar** is more compact and responsive — the controls wrap to a second
  row on small widths, the album art is the expand button, and the gradient and
  shadow were tuned.
- **Search** is a single-line sheet (field + submit + close) and remembers the
  last query; Settings and Search open as floating panels below the top bar.
- **Settings** — the Appearance tab was merged into Cherry, and option rows got
  icons.
- **Queue** — clear is now a trash button with an "N up next" count chip; the
  gradient header line and title icon were removed and the labels use
  normal-case text.
- **New/Edit playlist and New folder dialogs** restyled; the Edit sheet's cover
  image is itself the upload button (hover to change it).
- **Dark theme** surface colours neutralised (no blue/purple tint).
- **Windows** — removed the duplicate "Cherry" media-controls entry (WebView2's
  own media session), leaving only Cherry's session with metadata and controls.

### Fixed

- Dragging a sidebar item into the gap between rows no longer sends it to the
  bottom.
- The full-screen player's background artwork no longer occasionally fails to
  load (falls back hi-res → cover → a small thumbnail).
- Album pages always show the artist, falling back to the header's artist line.
- Removed a batch of dead code and unused exports.

## [1.1.0] — 2026-09-30

A large feature release: playlist editing, Last.fm, theming, queue management,
and a set of playback and search fixes.

### Added

- **Playlist editing** — create playlists, add and remove songs, rename, and
  edit descriptions. Only playlists you can edit are ever offered as targets.
- **Default save playlist** — Settings → Playlists. The track menu saves
  straight to it, and otherwise asks which playlist to use.
- **Save / unsave playlists** you did not create (add and remove from library).
- **Queue management** — the player's Up next panel (now "**Queue**") lists the
  whole remaining queue in play order and lets you jump to a track (dropping
  everything before it), drag-reorder, remove individual tracks, and clear.
- **Last.fm scrobbling** — Settings → Last.fm. Connect with your own Last.fm API
  key/secret through the desktop authorisation flow; Cherry sends "now playing"
  and scrobbles, and queues failed scrobbles for retry. Signing is done in Rust,
  so no key ships in the app.
- **Appearance** — Settings → Appearance. Choose the theme (System / Light /
  Dark) and the accent colour (follow the album art, or pick a custom colour).
- **Custom playlist images** — set a JPG/PNG cover from Edit details.
- **Pasted links** — dropping a YouTube / YouTube Music song or playlist URL
  into the search box opens that song or playlist.
- **Developer tools** — Settings → Developer: open the WebView DevTools
  (F12 / Ctrl+Shift+I once enabled).
- Playlist descriptions are now shown on the playlist page and loaded into Edit
  details.

### Changed

- **Settings is organised into tabs** — Profile (Account, Discord, Last.fm),
  Cherry (Playlists, Application, Data & Cache, Developer), Appearance, and
  About (Cherry info, Disclaimer, Open source).
- **Redesigned the New playlist, Edit playlist and Queue popups** to match the
  app's elevated-card look: rounded panels with a thin accent edge, an
  icon-tiled header with title/subtitle, and roomier rounded rows.
- **Playlist header metadata and single-track lookups are now cached**, so a
  playlist's description and artwork appear instantly on re-open instead of
  after a refetch.
- **Large playlists load progressively** — the first page appears immediately
  and the rest streams in; "Play playlist" starts playing on the first page
  instead of waiting for every page.
- **Faster track switching** — the next track's stream is prefetched and
  resolved stream URLs are cached, and the player remembers which Innertube
  client last worked so it does not retry a dead one each time.
- The playlist rail separates the playlists **you created** from ones you
  **saved**, with a divider.
- Removed the play-button loading equaliser; playback starts quickly enough now.
- The Open source list now credits `md5`, `sha1` and `webview2-com`.

### Fixed

- Adding a song to a playlist failed with **HTTP 400** — the edit endpoint
  needs the playlist id *without* the `VL` prefix.
- Queue drag-reorder dropped the track into the wrong slot (the target index was
  off by the current play position).
- The scrollbar no longer jitters on long playlists.
- **Custom playlist images now apply correctly**, and upload failures report the
  real reason (the resumable-upload start request needs a non-empty body —
  Google answered the previous empty request with `411 Length Required`).
- Playlist **descriptions** were not loaded — own playlists wrap the header in
  `musicEditablePlaylistDetailHeaderRenderer`, which the parser did not unwrap.
- The **editable-playlists** set now loads reliably (and reloads when the brand
  channel resolves), which fixes the missing rail divider and the Edit action
  appearing only after visiting Settings.
- Search now surfaces the **top-result artist** — an exact artist search
  (e.g. "Toby Fox") previously listed only related artists.
- You can no longer remove **your own** playlists from the library.

## [1.0.3] — 2026-09-25

Initial release: a lightweight, native-feeling YouTube Music desktop client on
Tauri v2 + Svelte 5, with in-app sign-in, multiple brand channels, OS media
controls, Discord Rich Presence, and a cached Innertube backend.

[1.7.0]: https://github.com/inane-tools/cherry/compare/v1.6.2...main
[1.6.2]: https://github.com/inane-tools/cherry/releases/tag/v1.6.2
[1.6.1]: https://github.com/inane-tools/cherry/releases/tag/v1.6.1
[1.6.0]: https://github.com/inane-tools/cherry/releases/tag/v1.6.0
[1.5.0]: https://github.com/inane-tools/cherry/releases/tag/v1.5.0
[1.4.1]: https://github.com/inane-tools/cherry/releases/tag/v1.4.1
[1.4.2]: https://github.com/inane-tools/cherry/releases/tag/v1.4.2
[1.4.0]: https://github.com/inane-tools/cherry/releases/tag/v1.4.0
[1.3.0]: https://github.com/inane-tools/cherry/releases/tag/v1.3.0
[1.2.1]: https://github.com/inane-tools/cherry/releases/tag/v1.2.1
[1.2.0]: https://github.com/inane-tools/cherry/releases/tag/v1.2.0
[1.1.0]: https://github.com/inane-tools/cherry/releases/tag/v1.1.0
[1.0.3]: https://github.com/inane-tools/cherry/releases/tag/v1.0.3
