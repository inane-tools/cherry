# macOS packaging and installation

Cherry's Electron host now has local macOS packaging for Apple Silicon (`arm64`)
and Intel (`x64`). GitHub Releases include a DMG for each architecture. Builds
are ad-hoc signed and not notarized. Playback, login and integrations still need
testing on real Macs.

## Run and package

On a Mac with Node 24:

```sh
npm ci
npm run typecheck
npm test
npm run dev
```

`npm run pack:mac` builds an app bundle for the host architecture in
`release/mac-arm64/Cherry.app` or `release/mac/Cherry.app`.
`npm run dist:mac` builds separate ad-hoc DMG and ZIP packages for both architectures:

- `release/Cherry-<version>-mac-arm64.dmg` and `.zip`
- `release/Cherry-<version>-mac-x64.dmg` and `.zip`

Both commands explicitly use ad-hoc signing, disable hardened runtime and skip
notarization. These packages do not carry a Developer ID signature or establish
a trusted distribution path on other Macs.
The builder converts the existing PNG app icon for the macOS bundle. The DMG
volume uses `install-cherry.png`, the same artwork as the Windows installer,
converted by `npm run dmg:icon`; the installed app keeps its current record icon.

The **Desktop builds** workflow builds and smoke-tests each architecture on a
matching macOS runner for release tags and manual runs. The publisher requires
both DMGs before making the GitHub release public. CI artifacts are named
`cherry-macos-arm64` and `cherry-macos-x64`. Pull requests also run typechecks and
tests on macOS.

To install, open the DMG and drag Cherry into Applications. macOS may require
approval in System Settings → Privacy & Security for a downloaded build. To
update, quit Cherry and replace the app in Applications. The profile is retained;
ad-hoc builds may prompt for Keychain access or require signing in again.

## Native behavior

The sidebar reserves a 48px draggable strip for native traffic-light controls,
with an additional 8px gap before its first button. Both inline sidebar modes
share the topbar background. The shared header adjusts its spacing for expanded,
compact and drawer layouts; native controls stay vertically centered as UI
zoom changes. The window controls preference also controls their visibility.
The macOS application menu
provides About, Hide, Quit, clipboard commands, fullscreen and window actions.
macOS does not create a menu-bar tray. Activating Cherry from the Dock restores
a minimized window, and reopening the app focuses the existing instance. Closing
the main window quits, matching Cherry's existing desktop behavior.

The Electron profile is `~/Library/Application Support/cherry-electron`.
Credentials use Electron safeStorage (macOS Keychain). Smoke tests use a separate
temporary profile. Legacy Tauri credential import is not implemented on macOS;
use a fresh login. In-app updates remain manual until signed release delivery
and an installed update cycle are verified.

## Validation and future signed releases

- Test native controls, dragging, double-click, fullscreen, minimize/Dock
  activation, Cmd+Q/Cmd+W, clipboard shortcuts and the window controls preference.
- Complete the playback checklist in [ELECTRON.md](ELECTRON.md), including audio,
  video, seeking, queue changes, media keys, login persistence, Last.fm, Discord,
  sleep/wake and output-device changes on both architectures.
- Configure Developer ID signing, hardened runtime and notarization using secure
  build credentials. Current scripts deliberately override these settings;
  add a separate signed release build path before shipping signed builds.
- Verify the signed app on a clean Mac after downloading and installing it from
  a DMG. Check the icon, Keychain prompts, retained settings and login.
- Add macOS updater support and validate the ZIP/feed metadata, cross-version
  installation and architecture selection before enabling automatic updates.
  Current releases deliberately publish DMGs only, without a macOS updater feed.

References: [Electron title bars](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar),
[electron-builder v26 macOS options](https://www.electron.build/v26/docs/mac/).
