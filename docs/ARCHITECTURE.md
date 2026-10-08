# Cherry — lightweight YouTube Music desktop client

**Stack:** Tauri v2 (Rust) + Vite + Svelte 5 + TypeScript + Tailwind v4 · **Strategy B:** native frontend on YouTube Music's internal Innertube API via `youtubei.js`. No official API exists — this is the honest trade-off: fully custom UI, but keep `youtubei.js` updated.

## Layout (layered — dependencies point inward)

```
src/
  lib/core/          pure domain: models.ts, errors.ts (no Tauri/DOM/Innertube)
  lib/infra/ytmusic/ InnertubeClient.ts + mappers.ts (only place touching youtubei.js)
  lib/infra/storage/ settingsRepo.ts (tauri-plugin-store, localStorage fallback)
  lib/app/services/  player.ts, queue.ts, folders.ts, pins.ts, auth.ts, settings.ts, navigation.ts,
                     shortcuts.ts (in-app keys), sleepTimer.ts
  lib/ui/            chrome/ (Titlebar/Sidebar/PlayerBar) components/ views/
  App.svelte main.ts app.css
src-tauri/src/
  main.rs            plugins, tray, single-instance, close-to-tray (main window only)
  media_controls.rs  SMTC/MPRIS/NowPlaying via souvlaki → `media-key://…` events
  discord.rs         Rich Presence; application id configured at runtime
                     (a compile-time-only id silently disabled the feature)
  auth_store.rs      YTM session cookie in OS keychain, chunked across
                     credentials (Windows caps a blob at 2560 bytes)
  ytm_login.rs       in-app music.youtube.com sign-in window; captures the
                     session from the native cookie store
  http_proxy.rs      CORS-free HTTP relay (reqwest), Google/YouTube hosts only
  secrets.rs         small keychain-held secrets (Last.fm), allowlisted names
```

Rules: UI → services → infra → core. Raw youtubei.js nodes never leave `infra/ytmusic`. OS features (media keys, Discord, tray, keychain) live behind `invoke()` commands so the frontend stays testable in a plain browser.

## Run

```powershell
npm install
npm run tauri dev
```

Needs WebView2 (preinstalled on Win10/11) + VS Build Tools C++ workload (already installing on this machine if you just scaffolded).

## App identity (the old-name → Cherry rename)

The app was renamed, which changes two *identity* values that decide where data
lives — so both are handled, or the rename would silently sign the user out and
reset their settings:

- **Bundle identifier** `com.xylo.app` → `com.cherry.app`. This moves the
  app-data directory (`tauri-plugin-store` resolves relative paths against
  `BaseDirectory::AppData` = `%APPDATA%\com.cherry.app` on Windows) and the
  WebView2 user-data folder (`LocalData\{identifier}`).
- **Keychain service** `xylo` → `cherry` (`auth_store.rs`).

`migrate.rs` copies the settings store across (only when the new location is
empty, so it is idempotent) and runs from `main()` **before** the Tauri builder:
the config window is created before `setup` runs and immediately starts loading
the frontend, so migrating in `setup` would race the first settings read.
`auth_load` additionally falls back to the old keychain service and copies the
session forward (`load_with_fallback`), and `auth_clear` clears **both**
services — otherwise signing out would be undone by the fallback on the next
start. The old WebView2 profile is deliberately not copied (hundreds of MB of
cache); the migrated session is what keeps the user signed in.

## Playback notes

- Stream URLs are **always** deciphered, even when YouTube returns a plain
  `url`. Measured against a real library, using `format.url` verbatim returned
  **HTTP 403 for every URL carrying the `n` throttling parameter**; the
  deciphered URL returned 206. The `n` transform happens inside `decipher`, so
  the "direct url" shortcut was silently breaking a sizeable share of tracks.
- Candidate order is progressive (muxed itag 18 etc.) before adaptive audio,
  because adaptive audio URLs are frequently withheld behind a PO token.
- Playlists are returned one page (~100 tracks) at a time, so
  `getCollectionTracks` follows `getContinuation()` until exhausted. Without
  this, long playlists were silently truncated to their first hundred tracks.
  Verified on a large public playlist: 10 pages, 1067 tracks.
- **The queue and position survive a restart.** `services/queuePersistence.ts`
  stores the queue (items, play order, shuffle, repeat) plus the current
  position in `localStorage` and `restorePlayback()` puts it back on startup
  **paused, without autoplay**. The writer is a **throttle, not a debounce**:
  `timeupdate` fires every ~250 ms, so a debounce whose timer is cleared on each
  change never fires during continuous playback and the stored position stayed
  at 0 forever (measured — the queue persisted with 831 items but `position=0`).
  A write is now scheduled at most once per second, plus a `flushQueue()` on
  `beforeunload`/`pagehide`, because quitting from the tray tears the webview
  down before a pending timer would run. `queue.ts` deliberately does not import
  the persistence module (one-way dependency); `watchQueue()` skips each store's
  initial emission so the first empty write cannot race the restore and wipe the
  queue. Signing out clears both the live and the stored queue, so the next
  account does not inherit the previous one's music.
- **A restored track has metadata but no source** (streams are resolved lazily),
  so `toggle()` / `playQueueItem()` must call `loadCurrent()` rather than
  `el.play()` — otherwise the previously-playing song refuses to start while the
  rest of the queue plays fine. The remembered position is scoped to the track
  it was saved for (`pendingResume = { videoId, seconds }`) so starting a
  different song first cannot apply it there, and it is recorded via
  `rememberPosition` so quitting without pressing play does not lose it.
- **Shuffle play** (`playTracksShuffled`) turns shuffle on *before* `setQueue`,
  so the first track is genuinely random; the playlist/album headers expose it
  next to Play. The **Queue** panel (formerly "Up next") lists the **entire**
  remaining queue (it used to cap at the next 10) and reports the count. It is
  shown in **play order** (`upNextQueue`), so shuffle actually reorders the
  panel. Picking a row **cuts the queue to it** (`cutQueueTo`) — everything before
  the chosen track is dropped, so skipped songs do not linger behind it. Rows are
  **drag-reorderable** and individually **removable** (`reorderQueueTo` /
  `removeFromQueue`). A drag targets a *gap* index, so there is exactly one drop
  slot between two rows (dropping a row into its own gap is a no-op), and the
  queue is normalised to the new play order with the current track still playing.

- **Loads are generation-guarded.** Every `loadCurrent` takes a number and
  re-checks it after each `await`; an overtaken load never touches the
  `<audio>` element. Before this, a skip during `el.play()` made the old load's
  promise reject with `AbortError`, which the catch block took for an expired
  URL — it re-resolved the *old* track and set it as the source, so the previous
  song played under the new title. `AbortError` and stale loads are now ignored,
  the expired-URL retry is one per load, and an autoplay-policy rejection
  (`NotAllowedError`) leaves the track loaded and paused.
- **Shuffle keeps the play order stable.** `enqueue` under shuffle splices the
  new indices into `order` instead of reshuffling it: "Play next" goes right
  after the current track, other additions are shuffled into the unplayed tail.
  `setShuffle` reads the current item *before* flipping the flag (afterwards
  `currentItem` resolves through the other mapping and returns a different song).
- **Sleep timer / stop after track.** `sleepTimer.ts` starts the fade
  (`fadeOutAndPause`) `FADE_MS` before the deadline so silence lands exactly on
  time, then restores the volume. "End of track" sets the player's
  `stopAfterTrack`; `onEnded` then advances the queue and *cues* the next item
  (`cueCurrent`: paused at 0:00, no stream resolved) instead of playing it. Not
  persisted on purpose.

## Keyboard shortcuts

`services/shortcuts.ts` holds the binding table (`SHORTCUTS`, also rendered in
Settings) and `handleShortcut`, installed on `window` by `App.svelte`. A key
press is ignored when it belongs to the focused element: text fields,
`contenteditable`, sliders/listboxes, and Space/Enter on buttons and links.
Auto-repeat only applies to arrows (seek/volume). Ctrl and ⌘ are equivalent;
Shift is significant for letters only, because some layouts need Shift to type
`/` or `,`. The F12 / Ctrl+Shift+I DevTools keys stay in `App.svelte`, gated by
the Developer setting.

## Caching and request reduction

Measured on the real app (WebView2 request count for a full startup): **cold
profile 5 requests → warm profile 1**. The savings come from two layers:

- **Persistent youtubei.js cache** (`Platform.shim.Cache(true, …)`, backed by
  IndexedDB). Session config and the multi-megabyte player JS are fetched once
  and reused across restarts.
- **Response cache** (`infra/storage/cache.ts`): TTL + bounded memory tier, and
  localStorage for payloads under 3 MB (overall budget 4 MB). `cached()` also
  coalesces concurrent loads, so two views asking for the same playlist produce
  one request. Lifetimes: playlist 30 min, home 3 min, search 2 min, channels
  60 min. Keys are channel-scoped; a non-reversible hash of the session is used
  instead of the cookie. Cleared on sign-out. **Empty results from loaders that
  swallow errors are never cached** (`shouldCache`): `getCollectionTracks` maps a
  failure to `[]`, and caching that made a playlist look empty for 30 minutes. **Playlist header metadata
  (`meta:`) and single-track lookups (`track:`) are cached too** — the header
  was being refetched on every open, which is why a playlist's description
  always lagged behind its (already-streamed) track list.

Client reuse: Innertube clients are cached per `(cookie, channel, player)` in a
small LRU map, so a browse-only client and a player-capable client coexist
instead of evicting each other. **Listing endpoints pass
`retrievePlayer: false`**, so the player JS is only ever fetched when a stream
actually needs deciphering.

### Staying responsive on large playlists and skips

- **Playlist pages load progressively.** A playlist is one request per ~100
  tracks and continuations are serial, so awaiting every page made a big playlist
  look stuck. `streamCollectionTracks` emits the first page immediately (the
  list and its Play button become usable) and then each following page; the
  final list is cached exactly like the one-shot version, so re-opens are
  instant. "Play playlist" starts on the first page and enqueues the rest as it
  arrives.
- **Streams are cached and the next track is prefetched.** `getAudioStream`
  keeps a small TTL cache of resolved URLs, and the player warms the
  immediately-next queue item's stream while the current one plays, so a skip is
  instant. The post-error retry bypasses the cache with `{ refresh: true }`.
- **The last working player client is remembered.** WEB is tried first by
  default, but on accounts where it is bot-walled the client that worked
  (YTMUSIC / TV / ANDROID) moves to the front, saving a round trip per track.

## Look and feel

- **Never name a theme token `base`.** In Tailwind v4 every `--color-*` token
  generates colour utilities, so `--color-base` created a `text-base` *colour*
  class that silently overrode the font-size utility of the same name — every
  `<i class="… text-base">` rendered `#050506` (effectively invisible icons on
  every surface). The token is `--color-surface`; check for this class of
  collision before adding a new `--color-*` name.
- **Settings** uses two shared pieces so the page stays consistent instead of
  each section re-inventing its own card: `SettingsSection.svelte` (title,
  optional icon tile/description/trailing action, and a `tone` of
  default/accent/warn) and `Toggle.svelte` (a `role="switch"` button rather than
  a browser-default checkbox). Rows sit in a `divide-y divide-white/[0.06]`
  group, and the page header matches the other views' hero heading. The page is
  split into **tabs** — Profile (Account / Discord / Last.fm), Cherry (Playlists
  / Application / Data & Cache / Developer), Appearance, and About (Cherry info
  / Disclaimer / Open source).
- **Font:** Zalando Sans, self-hosted via `@fontsource-variable/zalando-sans`
  (bundled by Vite, no runtime network).
- **Theme:** near-black base with a red/amber wash from the top of the window
  (`.cherry-wash` in `app.css`); accent is `--color-accent` (#ff4d5e).
- **Shell layout:** the playlist rail is full window height. The top bar is an
  **overlay** inside the content column (`absolute`) and paints *nothing*: the
  scrolling content is masked instead (`.cherry-fade-top` on `main`, a 60px fade
  to transparent), so content disappears under the bar while the bar itself
  stays invisible against the background. `main` carries a matching top padding
  so the first row is not hidden, plus bottom padding for the floating player.
  The queue is a popup anchored to the player bar (`UpNextPanel.svelte`) in the
  collapsed-bar layout; in the full-screen player it is shown **inline** in the
  middle of the card instead (both render the shared `QueueList.svelte`). There
  is no Library page.
- **Home carousels:** plain horizontal scrollers (no edge fades) that bleed to
  the right window edge (`-mr-6`); the left edge stays on the content padding.
  Navigation arrows appear on hover.
- **Player bar:** a floating card (`inset-x-3 bottom-0`, rounded top, borderless)
  over a black-to-transparent gradient fade, with `.cherry-playerbar` — dark at
  the top fading into an accent tint at the bottom. Padding is a uniform `p-3`.
  The album art doubles as the "expand player" button (a chevron fades in on
  hover). At `sm` and up it is a single row: art, title/artist + scrub, then
  prev/play/next, shuffle, queue, and a volume icon whose slider **pops up on
  hover** (`.cherry-range-v`). Below `sm` the controls wrap to a second row
  (shuffle left, transport centred, queue + volume right). The full-screen card
  (same component, `playerExpanded`) shows a "Next up" chip on the left with the
  next track's art.
- **One 8px gutter:** the rail's nav rows and playlist rows both start at the
  rail's `px-2`; the compact rail centres 40px icon buttons that match the
  playlist covers. Playlist rows are two-line (title + author, from the library
  row's subtitle). The rail fades its list into black at the bottom, and the fade
  hides once the end of the list is reached. Pinned playlists float to the top of
  the rail with a small pin badge. The expanded rail is user-resizable by
  dragging its right edge (width persisted in `sidebarWidth`). The playlist page
  shows the author under the title with a play button sharing the album art's
  corner radius.
- **Scrollbars:** WebView2/Edge draws native scrollbars and ignores
  `::-webkit-scrollbar` and `scrollbar-color`. It *does* honour
  `scrollbar-width: none` **when set on the scroll container itself** — the
  property is not inherited, so setting it on `html` does nothing. The native
  bar is therefore hidden and a slim custom thumb is painted by the
  `overlayScrollbar` action (`lib/ui/actions/overlayScrollbar.ts`), revealed on
  hover/scroll and dragged like an overlay bar. The thumb is a child of the
  scroller (so it scrolls with the content), which is why it is positioned with
  **`transform` only, updated synchronously in the `scroll` handler**: geometry
  is measured on resize/mutation, never on scroll, so there is no per-frame
  reflow and no one-frame lag behind the content (the old source of "jitter" on
  long playlists). This deliberately avoids the `OverlayScrollbar` browser flag,
  which gives the same look but **breaks the login window** (see Auth). A slight
  dark scrim (`.cherry-btn-scrim`) keeps glyphs readable on buttons even when the
  accent is light.
- **State:** volume, mute, repeat and shuffle are persisted in settings and
  re-applied to the audio element at startup (`applyStoredPlaybackSettings`).
- **Navigation:** a small history stack in `services/navigation.ts` with both a
  back and a forward stack. `openPage(page)` remembers the current page
  (entity pages carry their Playlist/Artist/Album so Back restores the exact
  one), clears the forward stack, and ignores re-opens of the same page so Back
  never lands on an identical page. Every navigation resets the content scroll
  to the top. The rail (and, in the narrow layout, the top bar) holds the Back
  button that pops it, and the **mouse Back/Forward (X1/X2) buttons** are wired
  to the same stack (`startMouseNavigation`, `mouseup` with `button` 3/4).
  Navigation (Back, Home, Search, New) lives in the sidebar; the top bar only
  carries the narrow-mode menu button and the account button.
- **Album pages** fall back to the album cover for tracks that have no artwork
  of their own, take the artist/year from the detail header, and borrow the
  album artist for tracks that don't list one.
- **Icons:** Boxicons everywhere (`bx`/`bxs`/`bxl`). The only exception is the
  native window caption glyphs in the title bar, which stay Segoe Fluent Icons
  to look like real Windows controls.
- **Pages:** Home (the `FEmusic_home` feed; the `FEmusic_explore` shelves —
  moods & genres, new albums & singles, top songs — are appended beneath it, so
  Explore is *not* a separate page), Search, Playlist, Artist
  (`FEmusic`/`UC…` browse + `scanPageHeader`) and Album (`MPR…`) — the artist
  and album pages share the playlist page's header/track-list layout, with
  circular artist art and a clickable artist link on albums. Cards in every
  shelf open the matching page; songs play.
- **Home:** the real `FEmusic_home` feed rendered as carousels. Album/playlist
  cards and song rows are normalised into one `CarouselEntry` shape, so a
  section always scrolls as a carousel regardless of which renderer YouTube
  used for it. "Listen again" is the hero row. The "Listen together"
  (24/7 stations) shelf is filtered out via `HIDDEN_SECTIONS`, and the Explore
  shelves (`FEmusic_explore`) are appended beneath the home feed, so Explore is
  not a separate page.

Note for anyone verifying visually on a scaled display: the WebView surface is
larger than the OS window when `devicePixelRatio > 1` (e.g. 1.25), so
screen-scrape/`PrintWindow` captures can cut off the bottom of the window. Use
DOM measurement (`getBoundingClientRect` / `elementFromPoint`) instead.

## Channels, home feed and library

A single Google login can own several **brand channels**, and YouTube Music
answers *per channel*: library, home feed and recommendations all change with
the request context. Measured against a real account, the default context
returned 1 playlist while the correct channel returned 25 — the app looked
broken when it was simply asking as the wrong identity.

- `InnertubeClient.setActiveChannel(pageId)` sets `on_behalf_of_user`, which is
  part of the client cache key.
- `getChannels()` lists identities (name, avatar, page id). The account-level
  row has `has_channel: false` and no library, so the UI only offers real
  channels.
- `pickPrimaryChannel()` probes each channel's playlist count and selects the
  richest, so the app opens on the user's actual library. The choice is
  persisted and can be overridden in Settings.
- The home page is the real `FEmusic_home` feed parsed from raw JSON
  (`rawHome.ts`) into carousels of cards and songs; cards expand to playable
  tracks via the album/playlist parsers.

Library and home parsing both use raw-JSON scanners rather than youtubei.js's
typed parsers, which throw on unexpected node types (`ItemSection`).

## Auth (Premium)

Settings offers in-app YouTube Music sign-in: an embedded window loads
music.youtube.com and the app captures the session from the **native cookie
store** (HttpOnly included) once session cookies appear, then persists it in
the OS keychain via `auth_save`. A pasted `Cookie` header is available as a
fallback. The UI reports whether a session is loaded.

**Windows landmines** (each one broke login until found):

- `WebviewWindowBuilder::build()` deadlocks when called from a *synchronous*
  command — the window appears blank/frozen and cannot be closed. Every command
  that builds or closes the login window is therefore `async`.
- A WebView2 `additionalBrowserArgs` override breaks the login window: its
  webview is created but never initialises (`visible=false`, `url=""`, then
  "failed to receive message from webview" on every call). This is why the
  `OverlayScrollbar` scrollbar-flag idea was dropped — see Look and feel.
- wry `unwrap()`s the event-loop channel in window getters
  (`tauri-runtime-wry/src/lib.rs:1796`), so reading cookies while the webview is
  torn down panics the calling worker. All window access goes through
  `with_login_window`, which catches that, and `read_cookies` retries.

Sign-in persistence is deliberately forgiving:
- `restoreAuth` retries `auth_load` (a transient keychain hiccup must not look
  like being signed out) and **never deletes** a stored session — signing out is
  an explicit action. A malformed cookie stays on disk.
- `ytm_login_finish` persists once in Rust; the frontend only re-saves when it
  needs to attach an account label (a second multi-KB write is what triggered
  the transient credential failures).
- Because the login window shares the WebView2 profile, an existing Google
  session is picked up straight from the profile cookies — so re-opening the
  login window recovers the account even if the keychain was cleared.
- Channel enumeration is retried and is **never cached when empty/failed** (and
  never persisted). A transient empty channel list used to be remembered for an
  hour, which is what made a fresh login look like it hadn't worked — a blank
  profile that only fixed itself after several re-logins or a restart. After
  login the app re-resolves the channel and profile immediately.
- Settings → **Refresh playlists** drops the cached channel/feed data, re-inits
  the channel and reloads the rail + home feed, reporting the count.

Storage notes (all three were real bugs that were fixed):

- `keyring` 3.x has no default features and silently falls back to an
  in-memory mock store, so sessions vanish on restart. The platform backends
  are enabled per-target in `Cargo.toml`.
- Windows caps a credential blob at 2560 bytes (UTF-16), so a multi-KB
  `Cookie` header cannot fit in one entry. The payload is chunked into
  `ytmusic-session.p0..pN` with a small manifest entry, reassembled on load.
- Only **YouTube-scoped** cookies are captured. Google sets `SID`/`SAPISID`/…
  on both `.google.com` and `.youtube.com` with different values, and merging
  by name let Google's win — producing a session that authenticated as
  nobody. `accounts.google.com` is deliberately excluded.
- Credential writes are verified with bounded retries: Windows can accept a
  write and then transiently fail the immediate read-back when many
  credentials are written in quick succession.
Anonymous mode works for search; anonymous *playback* is currently bot-walled
by YouTube (WEB client UNPLAYABLE, TV/ANDROID responses carry no stream URLs),
so the player surfaces a sign-in nudge instead of a dead spinner.

## Discord

The application id is **compiled into the app** (`discord.rs`), so presence
works with no setup; a `CHERRY_DISCORD_APP_ID` build-time value overrides it.

Presence mirrors Spotify: the activity is sent as **`type: 2` (Listening)**,
which is what makes Discord show the music-note icon and the "Listening to …"
treatment.

The line shown **next to your name in a server's member list** is controlled by
Discord's **`status_display_type`**, a newer RPC field added specifically so
third-party apps can reproduce Spotify's "listening to the song/artist"
behaviour. The values are **`0 = name`, `1 = state`, `2 = details`** (Discord
docs, discord-api-docs PR #7674, and the official SDKs — getting these the
wrong way round silently swaps the song and artist lines, so
`status_display_values_match_discord_enum` guards it). The
`discord-rich-presence` 0.2.x crate predates the field, so `discord.rs` builds
the activity JSON with `serde_json` and sends it through the crate's IPC
`send()`. Settings → Discord Rich Presence exposes the choice (song title /
artist / app name), defaulting to the song title.

**details** = song title, **state** = artists, **assets.large_image** = album
art URL (external URLs are supported), **assets.large_text** = the album name
only when it is known (no placeholder app label). Images are only advertised
when we actually have artwork.

Presence state is pushed **on every transition** — play, pause, seek and track
change — not just on the periodic keep-alive, so it can never lag behind the
player:

- **Playing** sends `start`/`end`, so Discord renders the elapsed bar and total.
  The position is clamped to the duration (`elapsed_timer_is_clamped_to_the_
  duration`), so a stale value can never make the track look finished or send
  the end before the start.
- **Paused** sends `start`/`end` with `end` already elapsed, so Discord renders
  a **frozen** `0:00 left` instead of a "time since the last update" counter
  (Discord counts up when an activity sends no timestamps at all, which is what
  made a pause look like it was still running). The artist line also gets a
  `· Paused` marker, the only field that visibly changes on a card.
- **Stopped / queue finished** clears the presence outright instead of leaving
  a paused entry for a track that is no longer loaded. Emptying the queue does
  the same.

A 15-second keep-alive re-pushes while a track is loaded so presence recovers
if Discord starts after the app.

**The app icon is a Discord asset, not a URL.** `assets.small_image` is set to
`cherry` (overridable with `CHERRY_DISCORD_ICON`), which must be uploaded under
App → Rich Presence → Art Assets in the Discord Developer Portal. Discord draws
a missing asset as nothing, so the field is safe to send before the asset
exists — it simply does not appear. This is the only way to show the app's own
icon: Discord ignores the local exe icon for Rich Presence.

Unit tests in `discord.rs` assert the serialized fields (`type`,
`status_display_type`, details/state, album art, `small_image`, timestamps),
since none of that is observable without a live Discord client.

## Media keys

`media_controls.rs` drives the OS media session via `souvlaki`: SMTC on
Windows, MPRIS on Linux, Now Playing on macOS. SMTC is what powers the media
controls in the **taskbar window preview and the Action Center media card**, so
the `media_now_playing` payload carries everything those surfaces render:

- title / artist / album / artwork (the OS fetches the artwork URL itself), and
- **`positionSecs`** as well as `durationSecs` — without a position the SMTC
  timeline is stuck at zero. Windows does not advance that timeline on its own,
  so the player re-pushes the position every 5 s while playing.
- SMTC buttons map back to app events: play/pause/toggle, next, previous, plus
  `SetPosition`/`Seek`/`SeekBy` → `media-key://seek` / `media-key://seek-by`
  and `SetVolume` → `media-key://volume` (handled in `services/mediaKeys.ts`).
- **Taskbar thumbnail-preview buttons** (prev / play-pause / next) are added by
  `thumbar.rs`: Windows only shows them if the app calls
  `ITaskbarList3::ThumbBarAddButtons` itself (SMTC does not provide them). The
  window proc is subclassed to catch the `THBN_CLICKED` `WM_COMMAND`s and
  forward the same `media-key://…` events; the icons are Segoe glyphs drawn
  with GDI. The middle button flips play/pause with the playback state.
- **A paused track freezes its timeline**, and once it has been paused for a
  minute the OS media session and the Discord presence are **cleared**, so a
  forgotten pause stops advertising. Clearing alone is not enough: the 15 s
  Discord keep-alive (and every other push) must then be **suppressed**
  (`statusSuppressed` in `player.ts`) until playback resumes, otherwise it
  re-advertises the same paused track seconds later. (Discord, when an activity
  simply omits timestamps, renders "time since the last update" — which looks
  like a running paused counter; the Discord activity sends an already-elapsed
  `end` instead, so it reads a frozen `0:00 left`.)
- **The invoke must nest its payload** (`invoke('media_now_playing', { info })`)
  because the command takes an `info` argument. A flat object fails argument
  extraction, and since `invokeSafe` swallows errors that failure was silent —
  the media card simply never appeared.
- **Debug builds embed `../dist` at compile time**, which Cargo does not watch,
  so a frontend change followed by `cargo build` used to keep shipping the old
  UI (this is how the broken payload above stayed hidden). `build.rs` now emits
  `rerun-if-changed` for `dist/index.html` and `dist/assets`.
- Discord presence is **coalesced**: at most one update per ~4.1 s, always
  sending the latest state. Discord drops `SET_ACTIVITY` beyond 5 per 20 s, and
  unthrottled forced updates on rapid skipping/scrubbing were being dropped,
  which left presence stuck on a stale track.

### The Windows "Unknown app" media entries

Windows labels an SMTC session from the process's **AppUserModelID
registration** (the installed shortcut), not from anything souvlaki sets. A
debug build launched straight from `target\debug` has no registered identity, so
Windows shows **"Unknown app"**, and because there are genuinely two SMTC
sessions for the process — ours, plus one the WebView2 runtime creates for its
own audio — *two* Unknown entries appear (one carrying our metadata, one with
the browsers' controls).

`media_controls::set_app_user_model_id` calls
`SetCurrentProcessExplicitAppUserModelID("com.cherry.app")` at startup, and the
`display_name` is `Cherry`, which is what an unpackaged build needs to be
labelled correctly. A packaged (NSIS/MSI) build also gets the identity from the
installed shortcut, so Cherry shows as "Cherry" with the Cherry icon there.
There is no way to suppress the WebView2-created session from Rust; binding SMTC
to the real window HWND (`config.hwnd`) is what keeps *our* session's controls
correct, and the app-identity fix is what stops the label reading "Unknown app".

## Pinned playlists

Pins live in settings (`pins.ts`) and are mirrored in a store. A pinned playlist
floats to the top of the sidebar rail (in the order it was pinned). Pinning is
offered only from the rail's right-click menu and is not available for playlists
inside a folder; pinned rows cannot be dragged. Their artwork URLs can expire —
and auto-generated playlists change theirs — so `syncPins` re-reads
title/thumbnail from the loaded library whenever it lands.

## Sidebar organisation

The rail is one flat, user-ordered list of top-level entries — playlists and
folders mixed — persisted as `sidebarOrder` (ids in order). Ids missing from the
order are appended in library order, so a new playlist shows up without any
bookkeeping. `services/folders.ts` owns the mutations:

- **Folders** live in `playlistFolders` and hold their members in order
  (`playlistIds`); a playlist belongs to at most one folder.
- **Drag to organise** uses one delegated `dragover`/`drop` handler on the list,
  keyed off `data-top-*` / `data-folder-header` / `data-child-*` attributes (so
  compact and expanded layouts behave identically). It reorders top-level
  entries, drops a playlist on a folder header to add it, drops it between an
  open folder's children to place it precisely, and reorders folders.
  Indicators are compared inline in the markup because the component uses legacy
  reactivity (a helper function's closure state is not tracked by the compiler).
- **Pinned playlists** float to the top in pin order and cannot be dragged;
  pinning is offered only from the rail's context menu and never for folder
  members.
- The **compact** rail (`w-14`) shows icon-only buttons + covers with hover
  tooltips; the **expanded** rail shows labels and is user-resizable by dragging
  its right edge (width persisted in `sidebarWidth`).

## HTTP transport (CORS proxy)

The frontend runs in WebView2, where direct `fetch` to Google origins is
CORS-blocked. youtubei.js accepts an injected `fetch`, so
`infra/ytmusic/tauriFetch.ts` relays every request (session, player JS, API)
through the Rust `http_proxy_fetch` command and re-wraps the result as
a real `Response`. Only http(s) allowed, no cookie jar (auth uses explicit
headers). `<audio>`/`<img>` load Google media directly — no CORS for those.

**Host allowlist.** The relay deliberately ignores CORS, so without a limit any
script running in the webview could use it to reach `localhost`, the LAN or an
arbitrary server. `allowed_host` accepts only YouTube/Google domains
(`youtube.com`, `youtu.be`, `google.com`, `googleapis.com`, `googlevideo.com`,
`googleusercontent.com`, `gstatic.com`, `ytimg.com`, `ggpht.com` and their
subdomains), and the reqwest redirect policy re-checks every hop. If a future
youtubei.js release starts calling a new host, it fails with
`refused host: …` — add the domain to `allowed_host` (and its test).

**Decipher sandbox.** youtubei.js needs a JS evaluator for the signature / `n`
transform it extracts from YouTube's player script (`evaluator.ts`). That code
is fetched at run time, so it runs in a dedicated Web Worker (no DOM, no
`__TAURI_INTERNALS__`, therefore no IPC), with a 10 s timeout that replaces a
hung worker. Its result is `{ sig, n }` strings, which cross the worker boundary
unchanged. In-page evaluation is only a fallback where `Worker` is missing.

**Remote content cannot call commands.** The sign-in window loads
`music.youtube.com`; Tauri applies the ACL to non-local origins even for app
commands (`webview/mod.rs`: `plugin_command.is_some() || has_app_acl_manifest ||
!is_local`), and no capability grants a remote URL, so that page has no IPC.
Keep it that way: never add a `remote` entry to a capability.

**The relay adds a browser-style `Origin` header** for Google/YouTube hosts.
youtubei.js only sets `Origin` on its *server* shim, which the webview does not
use. Verified live: without it, `accounts_list` returns a 1.8 KB context-only
body containing **no** account entries (0 channels, so no profile and no
channel list); with it, the same request returns 15 KB and every channel.
A `User-Agent` alone does not fix it.

## Auth gate

Cherry is a client for a **signed-in Premium account**: anonymous Innertube
streams are PO-token gated and do not resolve, so a signed-out visitor could
search but never play. Rather than let the UI *look* functional and fail at
playback, `services/gate.ts` blocks both up front:

- `SearchView.run()` returns early with `SIGN_IN_REQUIRED` when there is no
  session, and `player.playTracks()` / `toggle()` refuse to load (covering every
  play path — search, album, playlist, autoplay). `loadCurrent()` re-checks so
  autoplay cannot advance after a sign-out.
- Blocked actions publish a `cherry:notice` window event, which `App.svelte`
  renders as a small banner (click → Settings). This exists because there is no
  Toast system yet; the gate must never be silent.
- **The gate is a full-window overlay** (`AuthGate.svelte`), rendered by
  `App.svelte` at the shell level (`inset-0`, so its top gradient is identical
  to the app's — a gate starting below the titlebar restarts the gradient and
  shows a seam). The sidebar is hidden while signed out and the `Titlebar` gets
  `minimal`: only the native window controls remain, with the whole bar still
  draggable and transparent so the gate's gradient shows through. The gate
  requires **accepting the disclaimer** (the same text as Settings, a shared
  `DISCLAIMER` constant, memorised in `localStorage`) before Settings — where
  sign-in lives — becomes reachable. The disclaimer stays on screen after
  accepting; only the button enables.

## Offline-ish playlist cache

Playlist *contents* (`collection:*`) and the playlist rail (`library:*`) are
persisted to `localStorage` so they survive a restart and re-open instantly.
Three things had to change for that to actually work:

- `PERSIST_MAX_BYTES` was 250 KB — a full track list is larger, so playlist
  contents were never persisted at all. It is now 3 MB per entry, with a 4 MB
  overall budget enforced in `prunePersisted`.
- `prunePersisted` protects `collection:` / `library:` / `channels:` entries:
  they are evicted **last**, so a transient search result cannot push out the
  thing the user expects to be remembered.
- `getLibraryPlaylists` is now `cached` (it was not), with
  `shouldCache: (v) => v.length > 0` so an empty/failed read is never cached —
  that is how the rail could otherwise come back permanently empty.

`loadLibrary`'s signed-out early return used to skip the `finally` that clears
`inflight`, leaving a resolved promise cached forever; every later load (e.g.
the sidebar "Retry" right after signing in) was then a silent no-op. The whole
body is inside the `try`, and the sidebar Retry now calls `refreshLibrary()`
(a genuine refetch) instead of `loadLibrary()`.

**Sign-in forces a genuine refetch.** `reloadAll()` (used by the auth
subscription and the post-login flow) resets the in-flight guards *and* the
channel cache before reloading, so a login right after clearing the cache cannot
resolve to a leftover promise from the signed-out state — which is what left the
rail empty until a manual refresh.

## Clear data and cache

Settings → Data and cache. Clearing spans three layers:
`clearAllData()` (`services/maintenance.ts`) drops the in-page caches
(`cacheClear`, `localStorage`, `sessionStorage`, service-worker caches and every
IndexedDB database — youtubei.js's persistent cache lives in IndexedDB, and
`deleteDatabase` is time-boxed because `onblocked` never settles while a
connection is open), then Rust `clear_local_data` removes the settings store and
any on-disk WebView2 cache folders it can get at, and the action also signs out
(clearing the keychain session).

The **WebView2 profile cannot be deleted while the app runs** (the runtime holds
files open), so `clear_disk` writes a `.pending-clear` marker when anything was
skipped, and `maintenance::run_startup_cleanup()` (called from `main()` before
the builder, when the profile is not yet open) finishes the job on the next
start.

The action is a **no-op, not an error, when there is nothing left to clear**, and
it relaunches only when something actually changed — a second press used to fail
because the relaunch was attempted unconditionally. The relaunch is caught
separately so its failure can never be mistaken for the clear failing.

Anything referenced by URL from the UI (the app logo in Settings) is a **bundled
import**, not a `/public` path: a public absolute path is served by the asset
protocol, which can 404 in the window right after the cache is cleared.

## Right-click context menu

One menu instance lives in `App.svelte` (`ui/components/ContextMenu.svelte`),
driven by `services/contextMenu.ts` (a store plus `openContextMenu`). Surfaces
call `openContextMenu(event, items)` from `oncontextmenu`; the menu clamps itself
to the viewport (measured after mount) and closes on outside click, Escape,
resize or scroll. The shell also `preventDefault`s the native context menu, so
the browser's ("Save image", "Reload") never appears.

Item builders are shared in `services/menus.ts`: `trackMenu` (Play, copy YouTube
Music / YouTube links) and `playlistMenu` (Play, Shuffle play, Pin/Unpin, copy
links). They are wired to track rows (playlist/album/search), the currently
playing track in the player bar, and every playlist surface (the rail, the home
grid, the search grid). `links.ts` builds the URLs — playlist ids strip
Innertube's `VL` prefix — and `copyText` falls back to a hidden textarea when the
async Clipboard API is unavailable. "Play playlist" resolves the collection in
the background and does not navigate away.

Pinning is offered only from the rail's right-click menu (never on the playlist
page or other surfaces), and pinned playlists float to the top of the rail.

## Window chrome

Frameless main window with a custom `Titlebar`. Dragging is driven explicitly
via `getCurrentWindow().startDragging()` on header mousedown (buttons opt
out); requires the `core:window:allow-start-dragging` capability.

Double-click-to-maximize is handled in the **same mousedown handler** by
checking `event.detail === 2` (before starting a drag), because
`startDragging()` hands the mouse to the OS and the native `dblclick` event is
never delivered. Tauri 2 ships a `data-tauri-drag-region` script that does this
too, but it did **not** fire for this undecorated window (verified by UI
automation: dragging stopped working with the attribute alone), so Cherry owns the
logic instead. The `data-tauri-drag-region` attributes must stay off, otherwise
a real double-click could be toggled twice (once by each handler).

**`dragDropEnabled` must stay `false`** on the main window. The Tauri default
(`true`) makes Tauri intercept OS drag-and-drop, and on Windows that stops HTML5
`dragstart`/`drop` events from firing in WebView2 altogether — which silently
broke the queue's drag-to-reorder. Cherry needs no native file drops, so turning
it off costs nothing. (Changing this is a config/Rust change: a frontend reload
is not enough.)

## Playlist editing

The only **mutating** Innertube calls in the app. `client.playlist`
(`PlaylistManager`) needs a logged-in session and throws otherwise, so every
action goes through the same signed-in gate as playback and reports the real
error (e.g. *"This playlist cannot be edited."*) rather than failing silently.

- `createPlaylist` / `addTracksToPlaylist` / `removeTrackFromPlaylist` /
  `renamePlaylist` / `setPlaylistDescription` live in `InnertubeClient` next to
  the read paths — raw youtubei.js still never leaves `infra/ytmusic`.
- A created id may come back `PL…`; it is normalised to the browse form `VL…`
  so routing and links stay consistent.
- **Browse ids and edit ids are different.** `browse/edit_playlist` takes the
  playlist id **without** the `VL` prefix, while browsing takes it **with**.
  Passing the browse form made every mutation fail with **HTTP 400** (the
  original "add to playlist is broken" bug). `editPlaylistId()` strips `VL` for
  the mutation calls; `getPlaylistMeta` (a browse) keeps it. Removal is subtle:
  `PlaylistManager.removeVideos` browses the playlist internally (re-adding
  `VL`) and uses the setVideoId it finds, but sends the edit with the id it was
  given — so it must also be handed the stripped id.
- Writes are **optimistic**. A full playlist refetch follows continuations (one
  request per ~100 tracks) and YouTube's read-after-write can lag, so reloading
  after every add was both slow and occasionally showed the old list.
  `services/playlistEdit.ts` instead updates the open playlist's track store
  immediately (append for add, drop the first match for remove, in-place title
  for rename) and drops **only the changed playlist's** cache key
  (`collection:<channel>:<browseId>`, plus `library:<channel>:` for renames and
  creates), so the next open refetches fresh. Created playlists are inserted into
  the rail optimistically; the real thumbnail/author appear on the next library
  refresh.
- Renaming only re-points the page when that playlist is the one open, so a
  rename from the rail does not navigate away.
- **The edit dialog reads the live description before writing it.** The rail row
  has no description and `setDescription('')` erases it, so `getPlaylistMeta`
  fetches the current header; if that read fails, the description is left
  untouched (`updatePlaylistDetails(..., null)`). Losing a user's description to
  a failed fetch would be worse than not editing it.
- Renaming updates the open page **without a history entry**: `openPage` replaces
  the entity when the page key (the browse id) is unchanged.
- **Default save playlist** (`settingsRepo.defaultPlaylistBrowseId`): the track
  menu's "Add to …" saves straight there; with none set it opens the picker and
  asks. The picker (`PlaylistPickerDialog`) also creates playlists, as does the
  `+` beside the sidebar search.
- **Only editable playlists are offered.** The library
  (`FEmusic_liked_playlists`) also lists playlists the user merely *saved*, which
  reject writes. The add-to-playlist menu (`playlist/get_add_to_playlist` →
  `getAddablePlaylists`, parsed by `scanAddablePlaylists`) returns the writable
  set, and both the picker and the default-playlist setting read from it
  (`services/addablePlaylists.ts`, cached per account/channel). The menu is
  normally opened *for a video*, so a caller without one (the setting) passes the
  current track or a probe — with no video ids the request comes back empty,
  which is what made the setting list only some playlists. A stored default that
  is not in that set is treated as unset, so Cherry asks instead of attempting a
  write that would 400.

## Last.fm scrobbling

Uses the user's **own** Last.fm API key + secret (entered in Settings) — nothing
is bundled, so the public repo carries no credentials. Auth is the desktop token
flow: `auth.getToken` → the user approves in the browser → `auth.getSession`
yields a long-lived session key.

- **The API secret and session key live in the OS keychain**, not the settings
  file. They are ordinary fields of `CherrySettings` for the UI, but
  `settingsRepo.ts` strips `SECRET_KEYS` before writing the store and keeps them
  in one keychain entry through `secret_save` / `secret_load` (`secrets.rs`,
  which only accepts allowlisted names). Values written in plaintext by older
  versions are moved on first load, and only removed from the file once the
  keychain write succeeded. If the keychain is unavailable the rest of the
  settings still save; the secrets then last for the current run only, the same
  rule as the YouTube session.

- Signing (`api_sig = md5(sorted params + secret)`) and the HTTP POST happen in
  **Rust** (`lastfm.rs`, `md5` crate), not the webview: no MD5 in JS, no CORS,
  and the key/secret/session never leave the app's own transport. A unit test
  pins the documented example signature.
- `services/scrobble.ts` owns the accounting: a track longer than 30 s is
  scrobbled after **half its length or 4 minutes, whichever is first**, measured
  as wall time while the player reports `playing` (a seek does not count). The
  scrobble timestamp is when the track started, not when the threshold was hit.
- Failed scrobbles (offline / Last.fm down) are queued in `localStorage` and
  retried, so a play is not lost. Only one flush runs at a time, and it removes
  exactly the items it sent from the *current* queue: writing back the list read
  at the start dropped scrobbles that failed while the flush was waiting.
- A track that starts over after being scrobbled (repeat-one, replay) counts as
  a new play; seeking back before the scrobble point does not reset progress. "Now playing" is sent on the transition into
  playback and is best-effort (never queued).
- `lastfmEnabled` gates everything; scrobbling is a no-op unless connected.

## Developer tools

`Settings → Developer` exposes the WebView inspector. `WebviewWindow::open_devtools`
is only compiled in debug builds unless the `tauri` crate's **`devtools` feature**
is enabled (it is, in `Cargo.toml`), so a packaged build can still reach it. A
Rust command (`devtools.rs`) wraps it, which keeps the frontend off the
`core:webview:allow-open-devtools` capability and lets a browser build no-op. The
section is hidden behind `devToolsEnabled` (default off); when on, **F12 /
Ctrl+Shift+I** opens it too.

## Appearance (light/dark + accent)

Settings → Appearance offers a three-way theme (System default, Light, Dark) and
an accent source (album art, or a fixed custom colour).

- **The theme is one class on `<html>`.** Every Tailwind colour utility resolves
  to `var(--color-*)` (verified in the built CSS), so the whole UI flips by
  overriding the neutral tokens under `html.light` in `app.css` — `text-white`
  becomes dark ink and `bg-white/5` / `border-white/10` become subtle *dark*
  overlays on light surfaces. A handful of previously hardcoded dark hexes
  (cards, menus, fields, avatars, popovers) were promoted to semantic tokens
  (`--color-card/elevated/field/avatar/art/popover`) so they flip too, with the
  dark values left unchanged. Status colours (amber / rose / emerald / red) are
  darkened on light so warnings and errors stay readable, and the white inane
  wordmark SVG is inverted.
- **`services/appearance.ts` is the only place that touches the DOM for this.**
  It subscribes to settings, applies the class + accent, listens for OS
  `prefers-color-scheme` changes while on System, and only writes when a
  relevant field actually changed (the settings store also emits for volume, the
  queue, …).
- **Accent source** is `song` (default) or `custom`. `theme.ts` owns that choice:
  artwork theming no-ops while the source is custom, and switching back
  re-derives from the current track. A custom colour is parsed by
  `themeColor.fromHex` and applied *without* `vividify` (the user picked it).

## Search, pasted links and the library rail

- **Search maps the "Top result" as any kind.** The top-result card can be a
  song, artist, album or playlist; treating it as track-only dropped the artist
  from an artist search (the artist *is* the top result), which is why searching
  "Toby Fox" listed related artists but never him. `mapCardShelfResult` reads the
  card's browse endpoint / page type and files it in the right bucket (artists
  go first). `mapArtistRef` also reads the browse id from navigation endpoints,
  not just `id`.
- **Pasted links open.** `parseYouTubeLink` recognises `watch?v=`, `youtu.be/…`
  and `playlist?list=…` URLs; the Search popup opens the linked song (metadata
  resolved by `getTrack`) or playlist (`getPlaylistMeta` for title + art) instead
  of searching for the URL text.
- **Saved vs created playlists.** The editable set (`get_add_to_playlist`) tells
  created from merely *saved* playlists. This only decides which context-menu
  actions appear (Edit details vs Save/Remove), not the rail's order — the rail
  is one flat, user-ordered list. `scanAddablePlaylists` detects an option by
  its *shape* (a `*Renderer` with a playlist id + title) rather than a fixed
  renderer-name list, because a name mismatch silently returned an empty set —
  which made ownership look unknown (no rail grouping, and a "Remove from
  library" action offered on your own playlists). The set is **per brand
  channel**, and the first request runs before the channel is resolved (so it can
  come back empty and only "fix itself" once something re-triggered a load);
  `addablePlaylists.ts` now reloads on a channel change. Until the set has loaded,
  ownership is treated as unknown and **no** library action is offered, and
  `unsavePlaylist` refuses to remove a playlist you can edit. A playlist you did
  not create offers **Save to library / Remove from library** (the `like/like`
  endpoint via `addPlaylistToLibrary`), in the context menu and the page header;
  your own playlists show **Edit details** instead.
- **Custom playlist images are implemented.** `Settings`-free: the edit dialog's
  **Change image** uploads a JPG/PNG. The upload endpoints are *not* Innertube
  calls, so `playlist_image.rs` signs them with the browser `SAPISIDHASH` scheme
  (SHA-1 of `<unix> <SAPISID> https://music.youtube.com`) and performs the
  two-step resumable upload to `playlist_image_upload/playlist_custom_thumbnail`;
  the returned encrypted blob id is attached through the normal edit endpoint
  with `ACTION_SET_CUSTOM_THUMBNAIL`. The chosen image is applied to the rail and
  page **immediately** (YouTube's own header can lag behind a new custom
  thumbnail, and re-applying its old URL would visibly revert the change), then
  swapped for the server URL once it differs. YT Music may require a verified
  phone number on the account.

