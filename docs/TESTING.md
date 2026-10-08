# Testing

## TypeScript (Vitest)

```bash
npm test             # run once
npm run test:watch   # re-run on change
```

- Config: `vitest.config.ts` — jsdom environment, the `$lib` alias, tests in
  `src/**/*.test.ts` next to the code they cover.
- Services are written to run without Tauri (`platform.ts` reports
  `isTauri() === false` in jsdom), so most tests need no mocks at all. Where a
  module talks to Tauri or YouTube, mock that boundary with `vi.mock`:
  - `$lib/infra/ytmusic/InnertubeClient` for stream / browse results
    (`player.test.ts` returns deferred promises so overlapping loads can be
    ordered exactly);
  - `@tauri-apps/plugin-store` and `@tauri-apps/api/core` for settings and
    keychain commands (`settingsRepo.test.ts` keeps an in-memory "file" and
    "keychain" the assertions inspect);
  - `./lastfm`, `./player`, `./overlays` when testing a service in isolation.
- `HTMLMediaElement.play/pause/load` are not implemented by jsdom; spy on the
  prototype (see `player.test.ts`).
- Svelte components are not compiled in tests. Keep logic in services; the
  components only bind it to the DOM.
- `npm run typecheck` also type-checks the tests.

| Area | Suite |
| --- | --- |
| Queue order, shuffle, editing, restore | `services/queue.test.ts` |
| Player load races, retry, stop-after-track, repeat cycle | `services/player.test.ts` |
| Queue persistence (throttle, bounds) | `services/queuePersistence.test.ts` |
| Scrobble threshold, repeat plays, offline queue | `services/scrobble.test.ts` |
| Sleep timer | `services/sleepTimer.test.ts` |
| Keyboard shortcuts | `services/shortcuts.test.ts` |
| Sidebar folders | `services/folders.test.ts` |
| Link parsing / canonical URLs | `services/links.test.ts` |
| Settings store + keychain split | `infra/storage/settingsRepo.test.ts` |
| Response cache | `infra/storage/cache.test.ts` |
| Innertube mappers | `infra/ytmusic/mappers.test.ts` |
| Raw library scanners | `infra/ytmusic/rawLibrary.test.ts` |
| Decipher evaluator (worker protocol, timeout) | `infra/ytmusic/evaluator.test.ts` |
| Models, error classification | `core/*.test.ts` |

## Rust

```bash
cd src-tauri
cargo test                         # offline unit tests
cargo test -- --include-ignored    # + network and keychain tests
```

- Tests marked `#[ignore = "network"]` call music.youtube.com / i.ytimg.com.
- Keychain tests (`auth_store`, `secrets`) use real OS credential storage under
  test-only service names, never the user's session. On Windows and macOS they
  just work. On a Linux machine without a desktop session, start a throwaway
  Secret Service first:

  ```bash
  dbus-run-session -- sh -c '
    echo -n test | gnome-keyring-daemon --unlock --components=secrets >/dev/null
    cargo test -- --include-ignored'
  ```

  Without one, `auth_store` tests fail with "Unable to autolaunch a
  dbus-daemon" — an environment problem, not a regression.
- Building on Linux needs the Tauri system libraries (`libwebkit2gtk-4.1-dev`,
  `libayatana-appindicator3-dev`, `librsvg2-dev`, `libdbus-1-dev`,
  `libssl-dev`).
