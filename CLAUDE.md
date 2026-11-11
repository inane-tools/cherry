# Cherry — notes for Claude

Cherry is a desktop YouTube Music client (Electron + Svelte 5 + TypeScript +
Tailwind v4) for Windows, Linux (AppImage/Flatpak) and macOS.

## Commands (Node 24, npm)

```bash
npm ci
npm run dev          # Electron + Vite; restart after main/preload changes
npm run dev:web      # renderer only, Vite on :1423
npm run typecheck    # svelte-check
npm test             # vitest + UI suite (tests/ui) + node --test electron/ scripts/
npm run test:smoke   # build, then headless packaged-app smoke test
npm run pack         # unpacked build; dist:win / dist:linux / dist:mac for installers
```

The test baseline is in docs/STATUS.md. Keep it green.

## Layout

- `electron/`: main process (`main.mjs`), sandboxed `preload.cjs`, pure
  `policy.mjs`, `network.mjs` relays, login/updates/lastfm/discord/mpris/tray.
  Its tests are `*.test.mjs` and run with `node --test`.
- `src/lib/desktop/`: renderer adapters over `window.cherryDesktop` (IPC).
- `src/lib/infra/`: `ytmusic/` (InnertubeClient, raw*/mappers, decipher
  worker, media proxy) and `storage/` (settings, cache).
- `src/lib/core/`: pure UI-free logic (models, layout, filters).
- `src/lib/app/services/`: app state and behaviour (player, queue, playlists,
  auth, scrobble, sleepTimer, settings, theme …).
- `src/lib/ui/`: `views/`, `chrome/` (PlayerBar, Sidebar, Queue), `components/`.
- `tests/ui/`: component tests (`vitest.ui.config.ts`).
- `scripts/`: dev runner, icon generation, release publisher.
- `build/`: packaging assets and the Flatpak metainfo XML.
- `docs/`: ELECTRON, TESTING, RELEASING, MIGRATION, MACOS, `releases/X.Y.Z.md`.
- `logs/`: local command output (`*.txt`, gitignored).

## Conventions

- TypeScript strict (ES2022, `noUnused*`). Use the `$lib/*` alias for `src/lib`.
  The main process is plain ESM `.mjs`, and the preload is CJS.
- Tests sit beside the source as `*.test.ts` / `*.test.mjs`. Keep changes small
  and covered by tests, and confirm that a new test fails on the old code.
- Comments explain *why*, especially for race/handoff logic around
  `loadGeneration`.
- Logging is sparse and has no logging library: about 39 `console` calls in
  18 files, mostly `warn` (27) and `error` (7) for real failures. The rest are
  dev-only load messages, smoke-test pass markers and one sign-in notice.
- Icons are Phosphor classes written as full strings (see docs/ELECTRON.md).
- Never add arbitrary filesystem, shell or JS-eval IPC. IPC goes through the
  single `desktop:invoke` handler.
- Update `CHANGELOG.md` (Keep a Changelog) for user-visible fixes.
- After changing Settings structure, check the smoke-test selectors in
  `electron/main.mjs`. Its macOS-only branch clicks Settings UI, and Windows
  `npm run test:smoke` does not run it.

## Releasing (docs/RELEASING.md)

Run `npm version X.Y.Z --no-git-tag-version`, then update CHANGELOG,
`build/tools.inane.cherry.electron.metainfo.xml` and the new
`docs/releases/X.Y.Z.md` (these are the release notes). Commit, push main and
push the `vX.Y.Z` tag. **Never put `[skip ci]` in the release commit**,
because it also skips the tag build. The fallback is a manual Desktop builds run
on main with "Publish this version" ticked. `gh` is not installed here. Run
status is readable without auth at
`api.github.com/repos/inane-tools/cherry/actions/runs`.

## Read for context

- **Always:** `docs/STATUS.md` (done, open bugs, next).
- **Only when changing design:** `docs/ARCHITECTURE.md`, and add a line to
  `docs/DECISIONS.md`.
- For platform, security or test specifics, use docs/ELECTRON.md and
  docs/TESTING.md as needed.

Session rules: one task per session. At the end, update
docs/STATUS.md. Read files only as needed. Prefer reading
logs/ files over asking for pasted output.
