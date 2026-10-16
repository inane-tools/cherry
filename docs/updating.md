# GitHub updates

Cherry 1.6.2 introduces signed updates for Windows NSIS and Linux AppImage
installations. It checks GitHub Releases after startup. Settings → Cherry lets
you check manually, read release notes, download, then choose **Install and
restart**. Downloading does not interrupt playback. Installation pauses playback,
saves the queue and pending settings, and clears Discord presence before exit.

Flatpak installations must be updated using the newly downloaded Flatpak bundle
(`flatpak install --user Cherry.flatpak`, using its actual filename). A sandbox
must not replace its own package. Development builds and other package types
offer the release page instead of self-updating. AppImages must be in a writable
location. macOS remains out of scope.

## Signing

The public key is in `src-tauri/tauri.conf.json`. The matching private key is
stored outside Git at `%USERPROFILE%\.tauri\cherry-updater.key`, with restricted
file permissions, and in the repository's `TAURI_SIGNING_PRIVATE_KEY` Actions
secret. Its password is empty. **Back up the private key securely.** Keeping the
same key is necessary for installed 1.6.2 clients to trust 1.7 and later versions.
Never commit the private key or rotate it casually.

CI signs builds from this repository's pushes. Pull requests build unsigned
validation installers and cannot produce release update metadata. Local signed
builds require `TAURI_SIGNING_PRIVATE_KEY` (key contents or absolute key path)
and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty). For an unsigned local validation
build, append `--config src-tauri/tauri.unsigned.conf.json` to the Tauri build command.

## Releasing

1. Bump package.json, package-lock.json, Cargo.toml, Cargo.lock and tauri.conf.json
   together; add the release changelog. Run the checks and Desktop builds.
2. Download `cherry-windows-x64`, `cherry-linux-x64`, and `cherry-updater` artifacts
   from the **same commit** as the release tag.
3. Attach the NSIS `.exe`, AppImage, Flatpak, **both `.sig` files**, and
   `latest.json` to the corresponding stable `vX.Y.Z` GitHub release. Do not
   rename installers after generating metadata. Do not publish MSI or extra formats.
4. Publish only once all assets are attached. The Publish updater manifest workflow
   also regenerates metadata from the published assets. If assets were uploaded
   after publishing, rerun it using workflow_dispatch and the release tag.
   A missing installer or signature fails instead of publishing partial metadata.

The app reads `https://github.com/inane-tools/cherry/releases/latest/download/latest.json`.
Only a newer stable version is offered. Signatures are verified by Tauri before
installation; GitHub hosting alone is not the trust mechanism.

Users on 1.6.1 or earlier need to install 1.7.0 manually once, because those
versions do not contain an updater.

## Testing 1.6.2 → 1.7

Install the released 1.6.2 NSIS or AppImage. Publish a signed 1.7.0 with the same
key and complete metadata. Launch 1.6.2, check for the offer, download while music
plays, then install and verify version, saved settings, queue and playback position.
Repeat on Linux with a writable AppImage. Check offline errors, retry, and a
tampered download/signature being rejected. This installed upgrade test can only
be completed once the next release exists; unit/build checks do not substitute for it.
