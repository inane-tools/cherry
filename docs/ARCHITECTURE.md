# Cherry — lightweight YouTube Music desktop client

**Stack:** Tauri v2 (Rust) + Vite + Svelte 5 + TypeScript + Tailwind v4 · **Strategy B:** native frontend on YouTube Music's internal Innertube API via `youtubei.js`. No official API exists — this is the honest trade-off: fully custom UI, but keep `youtubei.js` updated.

## Layout (layered — dependencies point inward)

```
src/
  lib/core/          pure domain: models.ts, errors.ts (no Tauri/DOM/Innertube)
  lib/infra/ytmusic/ InnertubeClient.ts + mappers.ts (only place touching youtubei.js)
  lib/infra/storage/ settingsRepo.ts (tauri-plugin-store, localStorage fallback)
  lib/app/services/  player.ts, queue.ts, auth.ts, settings.ts, mediaKeys.ts, navigation.ts
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
  http_proxy.rs      CORS-free HTTP relay (reqwest) — see below
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
  next to Play. The "Up next" panel lists the **entire** remaining queue (it
  used to cap at the next 10) and reports the count.

## Caching and request reduction

Measured on the real app (WebView2 request count for a full startup): **cold
profile 5 requests → warm profile 1**. The savings come from two layers:

- **Persistent youtubei.js cache** (`Platform.shim.Cache(true, …)`, backed by
  IndexedDB). Session config and the multi-megabyte player JS are fetched once
  and reused across restarts.
- **Response cache** (`infra/storage/cache.ts`): TTL + bounded memory tier, and
  localStorage for payloads under 250 KB. `cached()` also coalesces concurrent
  loads, so two views asking for the same playlist produce one request.
  Lifetimes: playlist 30 min, home 3 min, search 2 min, channels 60 min.
  Keys are channel-scoped; a non-reversible hash of the session is used instead
  of the cookie. Cleared on sign-out.

Client reuse: Innertube clients are cached per `(cookie, channel, player)` in a
small LRU map, so a browse-only client and a player-capable client coexist
instead of evicting each other. **Listing endpoints pass
`retrievePlayer: false`**, so the player JS is only ever fetched when a stream
actually needs deciphering.

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
  group, and the page header matches the other views' hero heading.
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
  The queue ("Up next") is a popup anchored to the player bar
  (`UpNextPanel.svelte`), not a page — there is no Library page.
- **Home carousels:** plain horizontal scrollers (no edge fades) that bleed to
  the right window edge (`-mr-6`); the left edge stays on the content padding.
  Navigation arrows appear on hover.
- **Player bar:** a floating card (`inset-x-3 bottom-3`, rounded, bordered) over
  a black-to-transparent gradient fade, with `.cherry-playerbar` — dark at the top
  fading into a subtle accent tint at the bottom. Uniform `p-3` inside. Layout
  is a single row: 64px art on the left, then title/artist + the scrub bar
  (which ends next to the art) stretching across, then prev/play/next followed
  by shuffle, up-next and a volume icon whose slider **pops up vertically on
  hover** (`.cherry-range-v`, bottom = min), aligned to the icon's right edge. The
  scrub shows only the current position, on its right; the full length is a
  hover tooltip. All control icons are the same size (`text-2xl`); only the play
  button is larger (h-10).
- **One 8px gutter:** the rail's home button and playlist rows both start at the
  rail's `px-2` (no extra inner padding); the top bar's pins use the same
  `pl-2` / `gap-2`. Playlist thumbnails match the 32px home button. The gap
  between the rail's top row and the list also matches that gutter. There is no
  rail header (refresh lives in Settings); the rail fades its list into black at
  the bottom, and the fade hides once the end of the list is reached. The pin
  button is a dark pill overlay that appears only on hover, so titles get full
  width. Playlist rows are two-line (title + author, extracted from the library
  row's subtitle), the top-bar avatar is a square matching the pins, and the
  playlist page shows the author under the title with a play button sharing the
  album art's corner radius.
- **Scrollbars:** WebView2/Edge draws native scrollbars and ignores
  `::-webkit-scrollbar` and `scrollbar-color`. It *does* honour
  `scrollbar-width: none` **when set on the scroll container itself** — the
  property is not inherited, so setting it on `html` does nothing. The native
  bar is therefore hidden and a slim custom thumb is painted by the
  `overlayScrollbar` action (`lib/ui/actions/overlayScrollbar.ts`), revealed on
  hover/scroll and dragged like an overlay bar. This deliberately avoids the
  `OverlayScrollbar` browser flag, which gives the same look but **breaks the
  login window** (see Auth). A slight dark scrim (`.cherry-btn-scrim`) keeps
  glyphs readable on buttons even when the accent is light.
- **State:** volume, mute, repeat and shuffle are persisted in settings and
  re-applied to the audio element at startup (`applyStoredPlaybackSettings`).
- **Navigation:** a small history stack in `services/navigation.ts` with both a
  back and a forward stack. `openPage(page)` remembers the current page
  (entity pages carry their Playlist/Artist/Album so Back restores the exact
  one), clears the forward stack, and ignores re-opens of the same page so Back
  never lands on an identical page. Every navigation resets the content scroll
  to the top. The top bar's Back button pops it, and the **mouse Back/Forward
  (X1/X2) buttons** are wired to the same stack (`startMouseNavigation`,
  `mouseup` with `button` 3/4). The top bar holds Back, Home, Explore and the
  pinned playlists (all plain white, with a backdrop blur); the rail is just the
  search field.
- **Album pages** fall back to the album cover for tracks that have no artwork
  of their own, take the artist/year from the detail header, and borrow the
  album artist for tracks that don't list one.
- **Icons:** Boxicons everywhere (`bx`/`bxs`/`bxl`). The only exception is the
  native window caption glyphs in the title bar, which stay Segoe Fluent Icons
  to look like real Windows controls.
- **Pages:** Home, Explore (the `FEmusic_explore` shelves — moods & genres,
  new albums & singles, top songs), Search, Playlist, Artist
  (`FEmusic`/`UC…` browse + `scanPageHeader`) and Album (`MPR…`) — the artist
  and album pages share the playlist page's header/track-list layout, with
  circular artist art and a clickable artist link on albums. Cards in every
  shelf open the matching page; songs play.
- **Home:** the real `FEmusic_home` feed rendered as carousels. Album/playlist
  cards and song rows are normalised into one `CarouselEntry` shape, so a
  section always scrolls as a carousel regardless of which renderer YouTube
  used for it. "Listen again" is the hero row. The "Listen together"
  (24/7 stations) shelf is filtered out via `HIDDEN_SECTIONS`, and a grid of
  every playlist from the rail is appended at the bottom of the page.

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

Pins live in settings (`pins.ts`) and are mirrored in a store. Their artwork
URLs can expire — and auto-generated playlists change theirs — so a pinned
playlist that isn't the user's own would eventually lose its icon. Two guards:
`syncPins` re-reads title/thumbnail from the loaded library whenever it lands,
and the top-bar button renders a music-icon fallback *underneath* the image, so
a broken URL degrades to the icon instead of a broken image.

## HTTP transport (CORS proxy)

The frontend runs in WebView2, where direct `fetch` to Google origins is
CORS-blocked. youtubei.js accepts an injected `fetch`, so
`infra/ytmusic/tauriFetch.ts` relays every request (session, player JS, API)
through the Rust `http_proxy_fetch` command and re-wraps the result as
a real `Response`. Only http(s) allowed, no cookie jar (auth uses explicit
headers). `<audio>`/`<img>` load Google media directly — no CORS for those.

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

Pinning lives in the **playlist page header** (a pin button beside Play /
Shuffle), not the rail: an icon that only appears on hover was easy to miss and
competed with the row's own click target.

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
