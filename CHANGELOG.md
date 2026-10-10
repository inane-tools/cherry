# Changelog

All notable changes to Cherry are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

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

[1.4.1]: https://github.com/inane-tools/cherry/releases/tag/v1.4.1
[1.4.2]: https://github.com/inane-tools/cherry/releases/tag/v1.4.2
[1.4.0]: https://github.com/inane-tools/cherry/releases/tag/v1.4.0
[1.3.0]: https://github.com/inane-tools/cherry/releases/tag/v1.3.0
[1.2.1]: https://github.com/inane-tools/cherry/releases/tag/v1.2.1
[1.2.0]: https://github.com/inane-tools/cherry/releases/tag/v1.2.0
[1.1.0]: https://github.com/inane-tools/cherry/releases/tag/v1.1.0
[1.0.3]: https://github.com/inane-tools/cherry/releases/tag/v1.0.3
