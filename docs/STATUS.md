# Status

Last updated 2026-11-11. Current release: **2.3.0 Nayoro** (tag `v2.3.0` at
c76558d). Test baseline (checked 2026-11-11): typecheck clean; 566 unit +
65 UI + 102 node tests passing.

## Done

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

- Nothing active. The working tree has no uncommitted code changes.

## Known bugs

1. Scrobble listening time counts 1 s `setInterval` ticks. Hidden, inaudible
   pages (e.g. muted) get intensive timer throttling, so long tracks may never
   reach the scrobble threshold. Fix: wall-clock deltas.
2. A tray icon click shows the window but does not restore it when minimized.
3. `setQueueState` trusts the contents of the persisted `order` (it checks only
   the length).
4. A login poll that is in flight during Cancel can overwrite `popupStatus`.
5. Possible, from reading the code; not reproduced. Removing a song whose
   `Track` has no `playlistEntryId` works (InnertubeClient looks up the
   `setVideoId` itself), but `recordPlaylistRemoval` can only record it in
   `removedOpenTracks`. That set matches by object identity and is cleared on
   the next load, so if YouTube's read lags, the song can reappear after a
   reload. Only affects entries the mapper found no entry id for, which should
   be rare. Fix: have the remove call return the `setVideoId` it resolved and
   record that in `confirmedRemovals`.

## Next

- Move the ~350 lines of smoke-test code from `electron/main.mjs` (where it
  ships in production) to `electron/smoke.mjs`.
- Stop rebuilding the tray context menu on every `update_tray`.
- Fix known bugs 1–5.
- Split large files. Largest non-test sources (lines, 2026-11-11):
  `InnertubeClient.ts` 1707, `SettingsView.svelte` 1390, `player.ts` 1126,
  `PlayerBar.svelte` 826, `electron/main.mjs` 747 (the smoke-test move shrinks
  it), `Sidebar.svelte` 715, `playlists.ts` 568, `rawHome.ts` 562. `queue.ts` is
  332 lines, so it is not a candidate.
