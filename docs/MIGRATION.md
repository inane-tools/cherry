# Preparing Electron to become Cherry

Target: 1.7.1 Fukagawa. Keep normal semantic versions and the existing minor-city
codename mapping. The app/executable/installer are branded Cherry, while the
GitHub repository is still `inane-tools/cherry-electron`.

## Already prepared

- Windows NSIS, Linux AppImage and Flatpak targets; macOS deferred.
- GitHub Electron updater, existing Cherry update UI, manual install controls.
- Existing Electron userData and app ID retained so testers keep their settings
  and secrets across this rebranding. They remain separate from Tauri data.
- Public cherry-electron repository and CI for NSIS, AppImage and Flatpak.
- Complete tagged/manual releases publish matching Electron updater metadata.
- No repository rename; Tauri remains separate.

## When the repository switch is approved

1. Finish Linux packaging/integration and actual two-version update tests.
2. Ensure the new release repository is public before distributing an updater
   without authentication. Publish no access token in client configuration.
3. Rename the Tauri `cherry` repository to `cherry-legacy`. Keep its history,
   old releases and license. Do not delete it or its update-signing private key.
4. Rename `cherry-electron` to `cherry`. Update local origin/upstream remotes
   explicitly: reusing `cherry` stops GitHub's old-name redirect to the legacy
   repository. Verify by repository ID, not only the familiar URL.
5. Change `package.json` repository URL and `build.publish[0].repo`, the Settings
   source/release links, Flatpak metainfo bugtracker URL and documentation links
   to the new names. Build fresh packages so `app-update.yml` contains the new
   feed. Previously built installers retain their old feed configuration.
6. Update the website's download destinations and explain the one-time manual
   switch. Publish the Electron release assets and YAML together.
7. Decide whether to archive the legacy repository after its final migration
   notice. Keep the legacy updater endpoint explicit: old clients compiled with
   `inane-tools/cherry` do not automatically follow the new source repository's
   rename history and must never receive an Electron installer as a Tauri update.

## Existing users

Tauri and Electron updater formats, application identities and encrypted
credentials differ. No automatic Tauri data/keychain import or silent uninstall
is implemented. Tell users to install Electron Cherry and sign in again; back up
any settings they want to retain. Use the legacy uninstaller before installing
new Cherry if avoiding duplicate Start-menu/desktop shortcut names. Neither
installer should erase the other app's profile. Existing Electron testers keep
using their current `cherry-electron` profile and app ID after rebranding.

A repository rename remains pending explicit approval. Keep cherry-electron
available as an updater redirect when the name eventually changes.
