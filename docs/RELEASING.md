# Packaging and releasing Cherry

## Windows

Run `npm ci`, `npm run typecheck`, `npm test`, `npm run test:smoke`, then
`npm run dist:win`. The output is `release/Cherry-Setup-2.0.0-x64.exe`.
The one-click NSIS installer immediately shows a small progress window, installs
for the current Windows account in its default location, then launches Cherry.
There is no destination picker, wizard or completion page. NSIS handles
replacement, shortcuts and uninstall; updates use the same engine silently.
Uninstall keeps app data.

The 2.0 shortcut is **inane → Cherry** in the Start menu (`menuCategory: inane`).
Desktop shortcut creation is disabled to avoid overwriting the legacy Tauri
shortcut. Keep the Electron app ID and profile name unchanged so updates still
find their installation and credentials. Test coexistence with Tauri and
upgrades from the previous Electron release.

`install-cherry.png` is the installer artwork. `npm run dist:win` converts it to
`build/install-cherry.ico` for the setup executable and progress window; the
installed app keeps its existing icon. Regenerate just the ICO with
`npm run installer:icon`. There is no custom NSIS installation script to maintain.

Signing is currently disabled: configure Windows signing and publisher
verification together before shipping signed updates. The updater's SHA-512
metadata is not a replacement for code signing.

If local Electron archive extraction fails, an already installed matching runtime
can be used with `npm run dist:win -- --config.electronDist=node_modules/electron/dist`.

## Linux

Build on the Fedora VM or another Linux machine. For Fedora:

```sh
sudo dnf install flatpak flatpak-builder
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.freedesktop.Platform//25.08 org.freedesktop.Sdk//25.08 org.electronjs.Electron2.BaseApp//25.08
npm ci
npm run typecheck
npm test
npm run dist:linux
```

Outputs: `release/Cherry-2.0.0-x86_64.AppImage` and
`release/Cherry-2.0.0-x86_64.flatpak`.

The Flatpak builds libsecret 0.21.7 with its `secret-tool` executable retained
under `/app/bin`. Electron2.BaseApp includes the library but removes that tool;
the migrator needs it to read Tauri's Secret Service entries within the sandbox.
The module uses the same pinned source and checksum as the 25.08 base, and ships
its license. AppImage uses the system `/usr/bin/secret-tool` instead.

```sh
chmod +x release/Cherry-2.0.0-x86_64.AppImage
./release/Cherry-2.0.0-x86_64.AppImage
flatpak install --user release/Cherry-2.0.0-x86_64.flatpak
flatpak run tools.inane.cherry.electron
```

Flatpak uses the Electron BaseApp/Zypak wrapper, Wayland/X11, GPU, audio,
network, notifications, keyring and Discord socket permissions. It does not
request general home-directory access. Verify login persistence, cover uploads,
media controls, Discord and tray behavior on KDE/GNOME and Steam Deck; the
sandbox can change integration availability. macOS is deliberately excluded.

The generated Flatpak is a standalone bundle, not a Flathub submission or hosted
update repository. New GitHub bundles must be installed manually. Automatic
Flatpak updates need a published Flatpak repository (or Flathub); the in-app
updater never overwrites a Flatpak installation.

## GitHub updates

The only feed configuration is `build.publish` in `package.json`, currently
`inane-tools/cherry`. This also generates the packaged `app-update.yml`.
The final Tauri updater manifest is pinned separately to the preserved Tauri
release; never point a Tauri manifest at an Electron executable.
Never embed a GitHub token in the runtime. A public release repository is needed
for ordinary users; private repositories require user-side authentication and
are not a public distribution solution.

For release v2.0.0 upload these files to the same GitHub release:

- Windows NSIS `.exe`, its `.exe.blockmap`, and `latest.yml`.
- Linux `.AppImage`, its blockmap if generated, and `latest-linux.yml`.
- The `.flatpak` bundle for manual installation.

Keep filenames unchanged: the YAML names the files and their SHA-512 checksums.
Retain previous releases' assets for differential updates. Do not upload `.nsis.7z`,
`win-unpacked`, build logs, builder debug configuration or Tauri `.sig` files.
The publisher also uploads `latest.json`, copied from the checked-in
`build/tauri-latest.json`. It deliberately stays at the final Tauri version 1.7.0,
with signed binary URLs in cherry-tauri. Existing Tauri clients continue using
that JSON; Electron clients use the YAML feeds.
Artifacts are generated locally with `--publish never`; publication is explicit.
Draft releases are invisible to the normal updater until published.

Test the previous Electron release -> candidate from installed NSIS and real AppImage builds:
check, download, disconnect/retry, restart/install, verify version and preserved
settings/queue/login. The updater checks at startup and every four hours but
never downloads automatically or installs on ordinary quit. A downloaded
update is installed only after the user chooses Install and restart.

The Tauri app will not automatically migrate to Electron. See MIGRATION.md.
Linux filenames use `x86_64`; Windows filenames use `x64`.

## Automated builds and publication

`.github/workflows/desktop-builds.yml` checks types and runs the full test suite
on Windows and Linux. Development pushes and pull requests run checks only.
Installer builds run only for an explicit manual run or a release tag, produce
NSIS/AppImage/Flatpak, and smoke-test the packaged Windows application.
Documentation-only pushes skip checks.

To publish a new version, update package.json/lockfile, the changelog and Flatpak
metainfo, commit and push, then push the matching `vX.Y.Z` tag. Alternatively,
run Desktop builds on main with **Publish this version** enabled. The release
job checks versions, required files, sizes and updater SHA-512 hashes, uploads
all assets to a draft, then publishes it as the latest release. It refuses to
replace an already-public release. It never builds MSI, DEB, RPM or macOS.

The workflow uses Node 24 and pinned official Actions. Only the release job has
write access; no personal token or updater secret is required. A failed build
leaves publication blocked. Linux integration still needs hardware testing;
packaging success alone does not verify keyring, tray or Flatpak permissions.

The same installed version will not offer itself as an update: test using an
older installed release. On a future repository rename, change build.publish
and links, publish a transition release, and keep the old repository name unused
so GitHub's redirect remains valid.
