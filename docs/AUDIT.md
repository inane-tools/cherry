# Code audit — October 2026

A full read of the Rust backend (`src-tauri/src`) and the TypeScript services and
infra layers (`src/lib`), looking for correctness bugs and security problems.
Every fixed item has a regression test that fails on the old code, unless noted.

Severity: **High** = user-visible misbehaviour or a security boundary;
**Medium** = wrong results in common situations; **Low** = edge cases.

## Fixed

| # | Severity | Area | Finding | Fix |
| --- | --- | --- | --- | --- |
| 1 | High | Security | `http_proxy_fetch` relayed to **any** host (incl. `localhost`, LAN) and followed redirects anywhere. With `csp: null`, any script injection in the main window would get a CORS-free request primitive. | Host allowlist (YouTube/Google domains) checked on the URL and on every redirect hop. `http_proxy.rs` tests. |
| 2 | High | Security | The decipher script extracted from YouTube's player JS ran via `new Function` **in the main page**, with full IPC access (keychain, relay, every command). | Runs in a Web Worker (no DOM, no Tauri internals) with a 10 s timeout. Verified in Chromium that results match and the worker scope has no `window` / `__TAURI_INTERNALS__`. `evaluator.test.ts`. |
| 3 | Medium | Security | Last.fm API secret and session key stored in plaintext in `cherry-settings.json`, unlike the YouTube session. | Kept in the OS keychain (`secrets.rs`, allowlisted entry names); migrated on first load; removed by "Clear everything". `settingsRepo.test.ts`, `secrets.rs` tests (keychain verified with gnome-keyring). |
| 4 | High | Player | Rapid skipping played the **previous** song under the new title: the old load's `play()` rejected with `AbortError`, which was treated as an expired URL, so the old track was re-resolved and set as the source. | Generation-guarded loads; `AbortError` ignored; one retry per load; autoplay rejection leaves the track paused. `player.test.ts`. |
| 5 | High | Queue | Turning shuffle **off** jumped to a different song (`setShuffle` read `currentItem` after flipping the flag). | Read before flipping. `queue.test.ts`. |
| 6 | Medium | Queue | `enqueue` under shuffle reshuffled the whole order: played tracks came back, the current track moved to a random position, "Play next" landed randomly. | Splice into the order; play-next after current, others into the unplayed tail. `queue.test.ts`. |
| 7 | Medium | Scrobbling | A flush overwrote the retry queue with its starting snapshot, losing scrobbles that failed meanwhile; overlapping flushes could double-scrobble. | Single-flight flush removing only what it sent. `scrobble.test.ts`. |
| 8 | Medium | Scrobbling | Repeat-one plays after the first were never scrobbled (same video id = "same play"). | A restart after the scrobble counts as a new play. `scrobble.test.ts`. |
| 9 | Medium | Cache | `getCollectionTracks` maps failures to `[]`, which was cached and persisted for 30 min — the playlist looked empty. | `shouldCache: tracks.length > 0`. |
| 10 | Medium | Mappers | `mapPlaylist` stripped all non-digits from the whole subtitle: "… • 2024 • 25 songs" → 202425 songs. | Count from the run naming songs/tracks/episodes. `mappers.test.ts`. |
| 11 | Low | Errors | `toCherryError` substring matches: "author" → sign-in error, "generate"/"moderate" → rate limit. | Word-boundary patterns. `errors.test.ts`. |
| 12 | Low | Media keys | The OS **Stop** key toggled, so it *resumed* playback when paused. | Stop only pauses. |
| 13 | Low | UI | Two subscribers set the window title in different formats; the visible one depended on ordering. | Single writer (player). |
| 14 | Low | Innertube | A failed client creation deleted the map entry by key, evicting a newer client created under the same key. | Delete only if it is still the same promise. |
| 15 | Low | Auth | Resolved stream URLs and the preferred player client survived sign-out. | `clearStreamCache()` on sign-out. |
| 16 | Low | Rust | `auth_load/save/clear` were synchronous → ran on the main thread, so keychain retries (and unlock prompts) froze the window. | Async + `spawn_blocking`. |
| 17 | Low | Tests | A `#[test]` attribute in `discord.rs` was merged into the preceding doc comment, so the status-display regression test never ran. | Restored (found by clippy). |
| 18 | Low | UI | Repeat had no control anywhere; shuffle/repeat changes from the bar were not saved to settings. | `RepeatButton`, `toggleShuffle` / `cycleRepeat` persist. |
| 19 | Low | Queue | A persisted queue over 2000 items truncated `items` but not `order`/`index`, so a shuffled restore fell back to list order at a clamped position. | `boundedQueue` stores the play sequence from the current track on. `queuePersistence.test.ts`. |

## Verified, no change needed

- **The sign-in window cannot invoke commands.** It loads `music.youtube.com`
  and is listed in the `default` capability, but Tauri 2.11 applies the ACL to
  non-local origins even for app commands, and no capability grants a remote
  URL. Do not add `remote` URLs to capabilities.
- No `{@html}` / `innerHTML` sinks in the UI; all YouTube-provided text is
  rendered as text.
- Keychain chunking (`auth_store.rs`) round-trips large sessions and survives
  across processes (tested against a real Secret Service).
- Last.fm signing matches the documented example.

## Open recommendations (not changed)

These are real but either need testing on Windows/WebView2, which was not
available here, or are design decisions for the maintainer.

1. **Set a Content-Security-Policy** (`tauri.conf.json` has `csp: null`). A
   starting point: `default-src 'self'; script-src 'self'; worker-src blob:;
   img-src 'self' data: blob: https:; media-src https: blob:; style-src 'self'
   'unsafe-inline'; font-src 'self' data:; connect-src 'self' ipc:
   http://ipc.localhost`. Needs a pass over WebView2 to confirm nothing breaks
   (the decipher worker evaluates code, which may need `'unsafe-eval'` scoped to
   the worker).
2. **The previous track keeps playing while the next stream resolves**, and its
   `timeupdate` events briefly overwrite the new track's position. Pausing the
   element at the start of a load needs care because the `pause` event would set
   the status to *paused* during loading.
3. **`tauriFetch` converts bodies to text** in both directions, which would
   corrupt binary payloads, and ignores `AbortSignal`. youtubei.js currently only
   exchanges JSON/JS through it, so this is latent.
4. **Discord commands are synchronous** (IPC connect on the main thread). Fast
   when Discord is absent, but a wedged Discord could stall the UI.
5. **Permanently rejected scrobbles** (e.g. invalid parameters) are retried
   forever (the queue is capped at 100). Drop items Last.fm rejects with a
   non-retryable error code.
6. **Settings are not validated on load** (`{ ...DEFAULT_SETTINGS, ...raw }`);
   a hand-edited or corrupted file can put wrong types into the store.
7. `thumbar.rs` and other Windows-only code was not compiled in this audit
   (Linux container).
