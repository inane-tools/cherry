# Changelog

All notable changes to Cherry are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

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

[1.1.0]: https://github.com/inane-tools/cherry/releases/tag/v1.1.0
[1.0.3]: https://github.com/inane-tools/cherry/releases/tag/v1.0.3
