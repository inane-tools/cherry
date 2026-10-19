# Testing

Run `npm run typecheck`, `npm test`, `npm run test:smoke` and `npm run pack`.

The smoke test opens no visible window and uses a separate temporary profile.
It verifies app startup, renderer isolation, settings, encrypted credentials and
network policy. It does not sign in or validate live music playback.

See [ELECTRON.md](ELECTRON.md) for manual playback and platform checks.

For video controls, verify that idle playback slides the header upward and
footer downward with a fade, then restores both on movement/keyboard input.
Pausing, switching to audio/queue or opening a control menu keeps chrome visible.
Check fullscreen at the bottom right and volume at the bottom left of the
expanded view, including narrow windows. Enter fullscreen for songs and videos,
switch between audio/video, and exit with its button or Escape without resetting
the media clock. Quality menus must remain visible in fullscreen; collapsing the
player or opening Settings/Search must exit fullscreen cleanly.

For loading recovery, test several song changes in fullscreen for both audio and
video. Throttle the connection to check the play-button spinner appears after
300 ms in either player size, then clears on recovery. A sustained buffer stall
should retry once at the same position; skipping or pausing must cancel that
watchdog, and a failed retry must show an error rather than spin forever.

Migration tests use temporary JSON profiles and synthetic credentials. They
cover schema validation, backups, secret encryption envelopes, rollback and
startup recovery after killing a child process during import. The Windows
helper test compiles its P/Invoke code and checks struct layout with
`-ValidateOnly`; it never calls Credential Manager. UI tests check disclaimer
gating, preview-before-import, account opt-out, duplicate clicks and restart.

Before releasing 2.0, manually test migration using disposable Tauri profiles on
Windows and Linux (including Flatpak). Confirm restored pins, folders, theme,
YouTube account/brand channel and Last.fm scrobbling after restart. Check missing
or locked keyrings and expired Google cookies. Verify the Start menu retains
the legacy shortcut while adding `inane/Cherry`, including an Electron 1.7.1
upgrade. No 2.0 installers have been built for the initial migrator work.

The current electron-builder dependency tree reports moderate development-only
logger advisories through sprintf-js, for which no patched version is published.
Runtime production dependencies have no reported npm advisories. Do not apply
`npm audit fix --force` blindly; review packaging-tool changes separately.
