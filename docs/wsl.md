# Testing Cherry in WSL

Use Ubuntu 24.04 on WSL 2 with WSLg. WSLg displays Linux GUI windows and routes
audio to Windows. See [Microsoft's GUI setup guide](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gui-apps).
It requires Windows 11 or Windows 10 build 19044+ and current GPU drivers.

## 1. Install WSL

In **Administrator PowerShell**:

```powershell
wsl --install -d Ubuntu-24.04
```

Restart Windows if requested, then open Ubuntu and create your Linux username
and password. In PowerShell, update WSL and check that Ubuntu uses version 2:

```powershell
wsl --update
wsl --list --verbose
```

If Ubuntu is listed as version 1, run `wsl --set-version Ubuntu-24.04 2`.

## 2. Install Linux build tools

The remaining commands run in the **Ubuntu terminal**, as your normal user.
Do not run Cherry or npm with sudo.

```bash
sudo apt update
sudo apt install -y build-essential curl git rsync pkg-config \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
  libxdo-dev libssl-dev libdbus-1-dev patchelf \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad \
  gstreamer1.0-plugins-ugly gstreamer1.0-libav \
  dbus-x11 gnome-keyring seahorse flatpak flatpak-builder
```

Install Linux Node 22 with [nvm](https://github.com/nvm-sh/nvm), and Rust using
[rustup](https://rustup.rs). These commands download their official installers:

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh -o /tmp/cherry-nvm-install.sh
bash /tmp/cherry-nvm-install.sh
source ~/.bashrc
nvm install 22
nvm use 22
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/cherry-rustup-install.sh
sh /tmp/cherry-rustup-install.sh -y
source ~/.cargo/env
```

Check `which node`, `which npm` and `which cargo`: these must point to Linux
tools, not executables under `/mnt/c/`. Windows node_modules cannot be reused.

## 3. Copy the current source

The 1.5 changes are currently local, so cloning GitHub will get older code.
Copy the current checkout into WSL's Linux filesystem for better file-watching
and build performance. This command copies source without Windows dependencies
or generated build files, and does not change the original Windows checkout:

```bash
mkdir -p ~/src/cherry
rsync -a \
  --exclude='.git/' --exclude='node_modules/' --exclude='dist/' \
  --exclude='src-tauri/target/' --exclude='src-tauri/gen/' \
  --exclude='packaging/flatpak/payload/' --exclude='packaging/flatpak/build/' \
  --exclude='packaging/flatpak/repo/' --exclude='packaging/flatpak/out/' \
  --exclude='.flatpak-builder/' \
  /mnt/c/Users/same/Documents/GitHub/cherry/ ~/src/cherry/
cd ~/src/cherry
npm ci
```

This copy has no Git metadata, so its Settings build stamp will say `nogit`.
After changes are pushed, a fresh Linux clone is also suitable. To pick up later
Windows edits, stop the Linux app and repeat the rsync command.

## 4. Start the Linux app

```bash
npm run tauri -- dev
```

This launches the actual GTK/WebKit Linux app through WSLg. `npm run dev` alone
only runs the website and does not test native window controls or keychains.
The first Rust compile can take several minutes.

Try sign-in, song playback and seeking, queue controls, search, and the
Appearance → Window controls toggle. Restart Cherry and check that settings
and saved sign-in survive. Close the Linux window and verify the app exits.
Run automated checks separately:

```bash
npm run typecheck
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

## 5. Secret Service and D-Bus

WSL is not a complete desktop login session, so it may not start or unlock a
keyring automatically. If Cherry reports D-Bus/Secret Service errors, open a
shared session shell:

```bash
dbus-run-session -- bash
eval "$(gnome-keyring-daemon --start --components=secrets)"
seahorse
```

In Passwords and Keys, create/unlock a password keyring and make it the default
if one does not exist. Then, **in the same shell**, run Cherry or Flatpak.
Use `exit` when finished. Do not disable the app's keychain storage to work
around a missing desktop session.

Modern Ubuntu WSL installations normally use systemd. If needed, follow
[Microsoft's systemd guide](https://learn.microsoft.com/en-us/windows/wsl/systemd):
merge `[boot]` / `systemd=true` into `/etc/wsl.conf`, then run
`wsl --shutdown` from PowerShell and reopen Ubuntu. Do not overwrite unrelated
WSL configuration. Systemd alone does not unlock a password keyring.

## 6. Build and test Flatpak

First verify the development app, then build the release and direct Flatpak:

```bash
npm run tauri -- build --bundles deb
bash packaging/flatpak/build.sh
flatpak install --user packaging/flatpak/out/Cherry_1.5.0_x86_64.flatpak
flatpak run tools.inane.cherry
```

The first Flatpak build downloads the GNOME runtime and SDK. This packaging
script currently supports x86_64 only. Treat sign-in and saved credentials,
audio playback, display and window-controls tests as separate checks inside
the sandbox. The Flatpak has a separate settings and login profile.

## Limits and troubleshooting

- A display error: check `echo "$DISPLAY"` and `echo "$WAYLAND_DISPLAY"`; WSLg
  normally sets them. Update WSL and restart it rather than manually replacing
  the display variables with a Windows host IP.
- A black window: as a temporary diagnostic, try
  `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri -- dev`; keep the normal path
  unless this is needed.
- No sound: check Windows' volume mixer and confirm the GStreamer packages are
  installed. Capture the Linux terminal error before changing codecs/settings.
- WSLg tests Linux compilation, WebKit, audio and sandbox behavior. It does not
  reproduce a normal GNOME/KDE login session, tray host or desktop theme. Verify
  final button placement/glyphs, keyring auto-unlock, tray and media-key behavior
  in a Linux VM or on an actual Linux desktop before release.

These instructions are prepared for this repository; WSL was not installed on
the Windows development machine when they were written, so they still need a
local test run.
