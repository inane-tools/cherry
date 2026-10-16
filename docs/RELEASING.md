# Packaging and releasing Cherry

## Windows

Run `npm ci`, `npm run typecheck`, `npm test`, `npm run test:smoke`, then
`npm run dist:win`. The output is `release/Cherry-Setup-1.7.1-x64.exe`.
The compact NSIS page uses the Cherry icon, current version, a destination
picker and an Install action. Installs are per-user. A chosen parent directory
gets a Cherry subfolder. NSIS handles replacement, shortcuts and uninstall;
updater installs run silently through the same engine. Uninstall keeps app data.

`build/installer.nsh` customizes the supported electron-builder hooks rather
than copying its installation engine. Signing is currently disabled: configure
Windows signing and publisher verification together before shipping signed
updates. The updater's SHA-512 metadata is not a replacement for code signing.

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

Outputs: `release/Cherry-1.7.1-x64.AppImage` and
`release/Cherry-1.7.1-x64.flatpak`.

```sh
chmod +x release/Cherry-1.7.1-x64.AppImage
./release/Cherry-1.7.1-x64.AppImage
flatpak install --user release/Cherry-1.7.1-x64.flatpak
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
`inane-tools/cherry-electron`. This also generates the packaged `app-update.yml`.
Do not point this at the Tauri repository while it is still serving Tauri builds.
Never embed a GitHub token in the runtime. A public release repository is needed
for ordinary users; private repositories require user-side authentication and
are not a public distribution solution.

For release v1.7.1 upload these files to the same GitHub release:

- Windows NSIS `.exe`, its `.exe.blockmap`, and `latest.yml`.
- Linux `.AppImage`, its blockmap if generated, and `latest-linux.yml`.
- The `.flatpak` bundle for manual installation.

Keep filenames unchanged: the YAML names the files and their SHA-512 checksums.
Retain previous releases' assets for differential updates. Do not upload `.nsis.7z`,
`win-unpacked`, build logs, builder debug configuration or Tauri `.sig` files.
Artifacts are generated locally with `--publish never`; publication is explicit.
Draft releases are invisible to the normal updater until published.

Test 1.7.1 -> a higher test version from installed NSIS and real AppImage builds:
check, download, disconnect/retry, restart/install, verify version and preserved
settings/queue/login. The updater checks at startup and every four hours but
never downloads automatically or installs on ordinary quit. A downloaded
update is installed only after the user chooses Install and restart.

The Tauri app will not automatically migrate to Electron. See MIGRATION.md.
CI remains intentionally absent; no workflow has been added.
