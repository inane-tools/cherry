# Status

Last updated 2026-11-11. Current release: **2.3.1 Nayoro** (tag `v2.3.1`).
Test baseline (2026-11-11): typecheck clean; 577 unit + 66 UI + 105 node tests
passing, with 1 platform-only node test skipped (the Windows-only test on
Linux, the KDE MPRIS test on Windows).

## Done

- 2.3.1 Nayoro (2026-11-11): released the fixes for known bugs 1–5 (notes in
  `docs/releases/2.3.1.md`). Typecheck and the full suite were re-run on
  Windows before tagging. The tag build (Actions run 42958530843) passed all
  jobs and published the release with NSIS, AppImage, Flatpak, both DMGs and
  the updater YAMLs. The fixes:
  - Scrobble time is accrued from wall-clock deltas on each tick and each
    player state change (gaps over 90 s are ignored as sleep/clock jumps), and
    the previous track is checked before a track change. The offline-queue
    flush is time-based (every 60 s) instead of every 60th tick.
  - Tray click, tray "Show Cherry" and MPRIS raise use
    `electron/raise-window.mjs` (`restore()` before `show()`).
  - `setQueueState` keeps a saved `order` only if it is a permutation of the
    item indices.
  - `SettingsView` login polls carry a `loginAttempt` token; a poll that
    resolves after Cancel, a new attempt or sign-out is dropped.
  - `removeTrackFromPlaylist` returns the `setVideoId` it removed and
    `recordPlaylistRemoval(playlist, track, entryId)` records it in
    `confirmedRemovals`.
- 2.3.0 Nayoro (2026-11-10): one-page Settings with section chips (Account,
  Appearance, Player, Integrations, Data, Shortcuts, About;
  Integrations/Shortcuts collapsed), glass surfaces, account panel in the
  sidebar, experimental visualizer and video background. The first tag build
  failed because the macOS-only branch of the smoke test in `electron/main.mjs`
  clicks Settings UI. The tag was moved to the fix.
- 2.2.1 (2026-11-10, 3fac0b6), from `cherry-fixes.patch` and the second review:
  - Sleep timer fade now follows the current media element, fades from the
    stored volume and cancels a pending load.
  - `prev()` on a restored/unloaded track restarts it (uses
    `playerStore.positionSeconds`, goes through `seekTo(0)`).
  - Last.fm timestamp of restored tracks is set when playback starts.
  - Removed a duplicate `'updater-state'` entry in `electron/preload.cjs`.
  - Truncated playlists/albums are no longer cached (`loadAllRows` reports
    `complete`; truncated results go to `truncatedResults`).
  - Removed tracks no longer reappear on reload (`confirmedRemovals` in
    `playlists.ts`).
- First Claude review covered `electron/` (main, preload, policy, network),
  `player.ts`, `sleepTimer.ts`, `scrobble.ts` and a codebase-wide smell scan.
  The security posture (IPC sender checks, host allowlist, redirect
  revalidation, sandboxed renderer, CSP) looked solid.

## In progress

- Nothing active.

## Known bugs

- None open. Bug 5's fix (removal without an entry id) assumes the reload's
  rows carry entry ids, which is true for fresh reads; it was never reproduced.
- Not verified on a real desktop yet: the tray restore (Windows/Linux) and
  scrobbling with the window hidden and muted.

## Next

- Move the ~350 lines of smoke-test code from `electron/main.mjs` (where it
  ships in production) to `electron/smoke.mjs`.
- Stop rebuilding the tray context menu on every `update_tray`.
- Split large files. Largest non-test sources (lines, 2026-11-11):
  `InnertubeClient.ts` 1707, `SettingsView.svelte` 1390, `player.ts` 1126,
  `PlayerBar.svelte` 826, `electron/main.mjs` 747 (the smoke-test move shrinks
  it), `Sidebar.svelte` 715, `playlists.ts` 568, `rawHome.ts` 562. `queue.ts` is
  332 lines, so it is not a candidate.
