# Cherry's Electron transition

**2.0.0 Furano** is the next development version. No 2.0 installers have been
built or released. Electron 1.7.1 remains a withdrawn preview for updater testing.

## Repositories

- `inane-tools/cherry` keeps the original repository identity, stars, issues,
  Tauri release history and shared Git history. Its main branch now develops
  Electron, and future Electron packages use this repository for updates.
- `inane-tools/cherry-tauri` preserves the Tauri source, branches, tags and
  historical release assets. Its original build workflows are disabled.
- `inane-tools/cherry-electron` remains a compatibility update feed for already
  installed previews. Its old installer workflow is disabled; Update bridge
  mirrors future public Electron releases from cherry once an hour or on manual
  dispatch. Releases are copied byte-for-byte, not rebuilt. The 1.7.1 release is
  a draft, preserving its original assets for testing.

No repository names were swapped. New Electron source/release links point at
cherry. Keep the Electron app ID `tools.inane.cherry.electron` and profile name
`cherry-electron`: changing them would split existing testers' installations,
settings and encrypted secrets. Repository names do not determine app identity.

## Existing users and updater formats

Tauri and Electron updater formats and encrypted credential storage differ.
Tauri users must install Electron manually and sign in again until an importer
is implemented. The installers must not erase each other's data. Their matching
Cherry shortcut names can overlap; an eventual migration flow should manage
that only after a verified import.

Tauri clients are compiled to request cherry's latest release `latest.json`.
Every future Electron release therefore includes the pinned final Tauri manifest
from `build/tauri-latest.json`, version 1.7.0, with signed binary URLs in
cherry-tauri. Electron consumes `latest.yml` and `latest-linux.yml` instead.
Never rewrite the Tauri JSON to offer an Electron package as a Tauri update.

Installed Electron 1.7.1 previews can receive a future public 2.0 update through
the cherry-electron bridge. That update installs normally and its packaged
`app-update.yml` switches subsequent checks to cherry. Development pushes run
checks only; explicit manual runs and release tags are required to build installers.

## Feasibility of a Tauri data migrator

A migrator is possible, but is not implemented in 2.0.0 yet. The repositories
still share most of the settings schema. On Windows, Tauri reads
`%APPDATA%/com.cherry.app/cherry-settings.json`, with settings under the
`settings` key; Electron writes the settings object directly to
`%APPDATA%/cherry-electron/settings.json`. Pins, folders, sidebar order, theme,
player preferences and other supported settings can be translated and validated.
Existing Electron settings must not be silently overwritten.

Credentials need a separate bridge: Tauri uses the OS keychain under service
`cherry`, user `ytmusic-session` (a manifest plus `.pN` chunks), and
`secret.lastfm`. Electron uses safeStorage-encrypted profile files. Credentials
must be read through the platform's credential API and re-encrypted in the new
profile, never exported as plaintext files or logs. Tauri's saved session lacks
some of Electron's newer account/brand context, so imported sign-in needs to be
validated and may still require signing in again. Browser caches and webview
profiles should not be copied between the runtimes.

An opt-in Windows migration should close the legacy app, back up and validate
supported data, import it once, verify the new profile, and only then offer to
run the legacy application's registered uninstaller. Identify the Tauri install
by its installation identity and verified executable path, not only the shared
Cherry display name. Keep a migration marker so resetting Electron data does
not unexpectedly re-import old data. Removing the legacy app must not erase
the backup or the Electron profile. Linux packages need their own package-manager
removal flow; a Windows uninstaller does not cover Flatpak/AppImage installs.
