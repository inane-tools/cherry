# Cherry's Electron transition

**2.0.0 Furano** replaces the Tauri host with Electron.

## Repositories

- `inane-tools/cherry` keeps the original repository identity, stars, issues,
  Tauri release history and shared Git history. Its main branch now develops
  Electron, and future Electron packages use this repository for updates.
- `inane-tools/cherry-tauri` preserves the Tauri source, branches, tags and
  historical release assets. Its original build workflows are disabled.

No repository names were swapped. New Electron source/release links point at
cherry. Keep the Electron app ID `tools.inane.cherry.electron` and profile name
`cherry-electron`: changing them would split existing installations,
settings and encrypted secrets. Repository names do not determine app identity.

## Existing users and updater formats

Tauri and Electron updater formats and encrypted credential storage differ.
Tauri users must install Electron manually. The welcome screen now offers
**Migrate from 1.x** after the disclaimer is accepted. Windows installs its
shortcut under **inane → Cherry**, separate from the Tauri shortcut, and creates
no desktop shortcut. The Electron app ID/profile remain unchanged for preview
upgrades. The importer leaves the Tauri installation and data in place.

**Keep Cherry 1.x installed until migration is complete.** Close it before
importing into 2.0. Check your imported preferences, library organization and
sign-ins, then optionally uninstall the old version. Removing the old app or
its stored credentials first can prevent a complete sign-in migration.

Tauri clients are compiled to request cherry's latest release `latest.json`.
Every future Electron release therefore includes the pinned final Tauri manifest
from `build/tauri-latest.json`, version 1.7.0, with signed binary URLs in
cherry-tauri. Electron consumes `latest.yml` and `latest-linux.yml` instead.
Never rewrite the Tauri JSON to offer an Electron package as a Tauri update.

The Electron 1.7.1 → 2.0 updater transition was verified and its temporary bridge
has been retired. Installed 2.0 builds check cherry directly. Development pushes
run checks only; explicit manual runs and release tags build installers.

## Importing Tauri data

1. Close the old Cherry app. Launch 2.0, accept the welcome-screen disclaimer,
   then choose **Migrate from 1.x**.
2. Review the detected settings file and pin/folder counts. Use **Choose settings
   file** if it is elsewhere, including a Flatpak profile or another computer.
3. Leave **Carry over YouTube Music sign-in and Last.fm** checked to include
   locally saved credentials. Importing a JSON file from another machine does
   not bring that machine's keychain with it. You can also import settings alone.
4. Choose **Import data**, then **Restart Cherry** after verification completes.
   The result reports each sign-in as imported, kept, absent or skipped.

Pins are stored per YouTube channel. Imported 1.x pins belong to the channel
selected in the old settings (or the personal account when no channel was saved).
They merge with Electron pins for that channel; other channels stay separate.
Existing Electron profiles with the old global pin list are converted automatically.

Known appearance/player preferences replace their Electron counterparts. Pins,
recent playlists, folders and sidebar order are merged without duplicate IDs;
existing Electron edits and folder membership take priority. Developer switches,
unknown fields and invalid values are excluded. Existing Electron accounts and
their account/channel settings are kept. Cloud playlists reload from YouTube
after sign-in. The saved queue, browsing history and browser/cache files are not
copied between runtimes.

Automatic detection checks `%APPDATA%/com.cherry.app/cherry-settings.json` on
Windows, `$XDG_DATA_HOME/tools.inane.cherry/cherry-settings.json` on Linux
(default `~/.local/share`), previous app IDs and the old Linux Flatpak profile.
The native file picker handles files that a Flatpak sandbox cannot access
directly. Tauri stores `{settings: {...}}`; Electron writes the supported settings
object directly into its `settings.json`.

### Credentials

Windows reads only Cherry's fixed Generic Credential targets using `CredReadW`
in a bundled PowerShell helper. The `ytmusic-session.cherry` manifest and `.pN`
chunks are reassembled, with the old `xylo` service as a fallback. Last.fm uses
`secret.lastfm.cherry`. The helper runs hidden, does not enumerate other
credentials, and does not write plaintext exports.

Linux reads the matching `service`, `username` and `target` attributes using
Secret Service's `secret-tool`. The Flatpak bundles this under `/app/bin`; an
AppImage uses `/usr/bin/secret-tool` from `libsecret` on Fedora or `libsecret-tools`
on Debian/Ubuntu. The keyring must be unlocked and accessible to the app.
If the helper or secure storage is unavailable, the import fails with a message;
you can retry after fixing it or explicitly import settings without accounts.

Credentials stay in main-process memory and are re-encrypted using Electron
safeStorage, verified, then written as `auth.encrypted`/`lastfm.encrypted`.
The renderer receives only status labels. Older plaintext Last.fm keys in a
Tauri settings file are also encrypted; they never enter the new settings JSON
or a copy of the old file. Tauri credentials are read, never deleted or modified.

Google may have expired a saved cookie. Tauri also did not persist Electron's
newer Google account-slot context, so multi-account users may need to sign in
again if the wrong account opens. Existing brand-channel preference is imported.
No live network validation is performed during migration.

### Backup and recovery

Before replacing anything, the importer backs up the Electron settings,
encrypted credential files and previous migration marker under
`<Electron profile>/migration-backups/<transaction-id>`. A manifest records which
files existed and their SHA-256 hashes. Copies are verified before writing.
The original Tauri JSON is never copied into this backup because older files
can contain plaintext Last.fm credentials.

Replacements use temporary files and atomic renames, followed by read-back
verification. A failure restores the original files. A pending transaction
record allows startup recovery before settings/auth load after a process exit;
a completed commit marker preserves successful imports. The UI requires a
restart and stale renderer saves are blocked until then.

The result displays the backup directory. To restore manually, close Cherry and
copy the backed-up files into the Electron profile; files marked `existed: false`
in the manifest should be removed. Backups are local and encrypted credentials
depend on the same OS user's keyring. **Clear everything** removes Electron's
migration backups and marker too. Imports only happen after an explicit click;
clearing data never silently re-imports Tauri data.

Automatic Tauri uninstallation is not implemented. Keep the old installation
until the imported data and both accounts have been checked, then remove it
using its normal uninstaller/package manager. macOS remains deferred.
