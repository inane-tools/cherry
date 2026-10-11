# Linux and macOS builds

Cherry 1.5.0 is Sunagawa. The desktop-builds workflow checks the frontend and
builds Windows NSIS and Linux DEB/AppImage/Flatpak on native GitHub runners.
It uploads artifacts only and does not publish releases. macOS is deferred.

## Window controls

Windows keeps Cherry's existing caption buttons. Linux keeps Cherry's custom
navigation bar and overlays real GTK 3 buttons, following GTK's icon theme and
`gtk-decoration-layout` button order. Theme/layout changes update them while
Cherry runs. These match GTK applications, not necessarily KDE's KWin decoration.
Tauri's WebKitGTK 4.1 backend uses GTK 3; GTK 4 widgets cannot be embedded here.
macOS uses native decorations. Settings → Appearance → Window controls hides
Linux GTK buttons or Windows caption buttons, and removes macOS decorations.
The in-app drag handle remains available. Test zoom, left/right button layouts,
maximize/restore, themes, and decorated/undecorated modes on real desktops.

Linux caption buttons use 46-pixel hit areas like Windows, with transparent
resting backgrounds and GTK theme glyphs. The Linux surface is transparent only
at its rounded 12-pixel corners; app content stays opaque. Maximized/fullscreen
windows use square corners. Compositors control surrounding window shadows.

The vendored Tauri runtime patch in `src-tauri/vendor/tauri-runtime-wry` fixes
Linux mouse/touch resizing: upstream assumes a fixed webview parent hierarchy
and aborts on Cherry's GTK overlay. Copy this directory together with Cargo.toml
and Cargo.lock when testing local changes on another computer. Keep the VM's
`src-tauri/target` directory so incremental builds can reuse compiled dependencies.

Linux closes normally because GNOME commonly lacks a tray host. Windows hides
to the tray; macOS can reopen from the Dock. Auxiliary windows close normally.

## Linux

Windows-based testing instructions are in [the WSL guide](wsl.md).
Build on Linux with Rust, Node 22 and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
On Ubuntu 24.04:

```sh
sudo apt-get install libwebkit2gtk-4.1-dev build-essential libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev libdbus-1-dev patchelf
npm ci
npm run tauri -- build --bundles deb,appimage
```

The Linux desktop ID is `tools.inane.cherry`. Settings from earlier direct
Linux builds are copied once to the new directory. Flatpak uses private data.
Credentials use Secret Service, without the kernel-keyring backend blocked by
Flatpak. An unlocked GNOME Keyring or compatible service is required.

### Duplicate media players in direct builds

WebKit may register an additional MPRIS player with the generic Cherry name,
alongside Cherry's `org.mpris.MediaPlayer2.cherry` session with track metadata.
For development, install `xdg-dbus-proxy` (`sudo dnf install xdg-dbus-proxy`
on Fedora), close Cherry completely, and run `npm run dev:linux`.
The app-local launcher filters bus-name ownership for Cherry and its children;
it does not change the desktop's bus configuration. Desktop service calls
remain available, while WebKit cannot register its separate MPRIS player.
It can also wrap a direct binary with
`bash scripts/linux-session.sh ./src-tauri/target/release/cherry`.
Direct launches without this wrapper may still show duplicates. This workaround
needs native verification of playback, login persistence, media keys and tray.
Flatpak already grants ownership only to Cherry's MPRIS and single-instance names.

### Direct Flatpak distribution

After the Ubuntu x86_64 build, install flatpak and flatpak-builder, then:

```sh
bash packaging/flatpak/build.sh
flatpak install --user packaging/flatpak/out/Cherry_1.5.0_x86_64.flatpak
flatpak run tools.inane.cherry
```

This script uses Ubuntu dpkg packages and cannot currently package a Fedora
build. The GNOME 50 runtime supplies GTK, WebKit, codecs and OpenSSL; small
tray/xdo dependencies and license notices are copied into the package.
Permissions cover audio, display, network, Secret Service, tray and MPRIS,
without home-directory access or an unrestricted session bus. Discord IPC
may be unavailable because its filesystem access is intentionally omitted.

### Flathub

The [Flathub policy](https://docs.flathub.org/docs/for-app-authors/requirements#generative-ai-policy)
allows disclosed AI-generated application material at reviewer discretion,
but forbids AI-generated or AI-assisted manifests and agent-generated submission
interactions. This AI-assisted direct-distribution manifest must not be submitted
to Flathub. A human must independently write and maintain the manifest, disclose
affected application parts and approximate extent, and handle submission/review.
Acceptance is not assured. Source-available apps must build offline from source;
this binary manifest does not qualify. A human package needs pinned source,
npm/Cargo dependency sources, current runtime, validated AppStream metadata
with screenshots and desktop smoke tests.

## macOS

Deferred and excluded from the active workflow. Manual configuration remains.
With Xcode command line tools, Rust and Node 22:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm ci
npm run tauri -- build --target universal-apple-darwin --bundles app,dmg
```

The universal DMG supports Apple Silicon and Intel, with minimum macOS 13.3
for Tailwind 4's Safari 16.4 floor. Public distribution needs Developer ID signing
and notarization; see [Tauri's guide](https://v2.tauri.app/distribute/sign/macos/).
Manual builds without credentials are unsigned. Keep secrets out of the repo.
Test playback, sign-in, Keychain persistence, media controls and Dock reopening.

## Validation status

Common frontend and Windows Rust checks run locally. This workspace has no
Linux or macOS environment. Linux GTK code has not yet been compiled or visually
verified here. Native builds and playback, login persistence, media keys and
window controls must be tested before considering these platforms release-ready.
