#!/usr/bin/env bash
# Self-distributed Flatpak, assembled from the Linux release build.
set -euo pipefail
cd "$(dirname "$0")"
test "$(uname -m)" = x86_64 || { echo 'This packaging path currently supports x86_64 only.' >&2; exit 1; }
test -f ../../src-tauri/target/release/cherry
mkdir -p payload/bin payload/lib payload/share/applications payload/share/metainfo payload/share/icons/hicolor/256x256/apps payload/share/licenses/tools.inane.cherry out
install -m755 ../../src-tauri/target/release/cherry payload/bin/cherry
install -m644 tools.inane.cherry.desktop payload/share/applications/
install -m644 tools.inane.cherry.metainfo.xml payload/share/metainfo/
install -m644 ../../src-tauri/icons/128x128@2x.png payload/share/icons/hicolor/256x256/apps/tools.inane.cherry.png
install -m644 ../../LICENSE payload/share/licenses/tools.inane.cherry/LICENSE
# GTK/WebKit/OpenSSL are supplied by the runtime. Include the small Ubuntu
# libraries used by Tauri's tray and xdo support that are absent from it.
for package in libayatana-appindicator3-1 libayatana-indicator3-7 libayatana-ido3-0.4-0 libdbusmenu-gtk3-4 libdbusmenu-glib4 libxdo3; do
  while IFS= read -r library; do
    if [[ "$library" == *.so.* && -f "$library" ]]; then
      cp -L "$library" payload/lib/
    fi
  done < <(dpkg -L "$package")
  mkdir -p "payload/share/licenses/tools.inane.cherry/$package"
  cp "/usr/share/doc/$package/copyright" "payload/share/licenses/tools.inane.cherry/$package/"
done
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak-builder --user --assumeyes --install-deps-from=flathub --force-clean --repo=repo build tools.inane.cherry.yml
version=$(node -p "require('../../package.json').version")
flatpak build-bundle --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo repo "out/Cherry_${version}_x86_64.flatpak" tools.inane.cherry
