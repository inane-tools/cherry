//! One-time migration from the app's previous "xylo" identity.
//!
//! Renaming the bundle identifier moves the app-data directory, so without this
//! the settings store and the saved YouTube Music session would both look
//! missing: settings would reset to defaults and the user would appear signed
//! out even though their data is still on disk.
//!
//! This runs from `main()` **before** the Tauri builder, because the config
//! window is created (and starts loading the frontend, which reads settings)
//! before `setup` runs. Doing it here makes the order deterministic instead of
//! racing the frontend's first read.

use std::path::PathBuf;

const LEGACY_IDENTIFIER: &str = "com.xylo.app";
const NEW_IDENTIFIER: &str = "com.cherry.app";
const LEGACY_STORE: &str = "xylo-settings.json";
const NEW_STORE: &str = "cherry-settings.json";
/// Records that the one-time carry-over has been decided. Without it, "Clear
/// data" (which deletes `cherry-settings.json` but never touches the old xylo
/// store) would let the next launch re-import the old settings, so clearing the
/// app's data appeared not to work.
const MIGRATION_MARKER: &str = ".migrated-from-xylo";

/// The app-data directory Tauri resolves `BaseDirectory::AppData` to, which is
/// where `tauri-plugin-store` keeps relative paths.
#[cfg(target_os = "windows")]
pub fn app_data_dir(identifier: &str) -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|dir| PathBuf::from(dir).join(identifier))
}

#[cfg(target_os = "macos")]
pub fn app_data_dir(identifier: &str) -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(|dir| PathBuf::from(dir).join("Library").join("Application Support").join(identifier))
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn app_data_dir(identifier: &str) -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|dir| PathBuf::from(dir).join(".local/share")))
        .map(|dir| dir.join(identifier))
}

/// Copy the settings store across if (and only if) the new location is empty
/// and the old one exists. Never overwrites, so a second run is a no-op.
pub fn run() {
    let (Some(old_dir), Some(new_dir)) = (app_data_dir(LEGACY_IDENTIFIER), app_data_dir(NEW_IDENTIFIER))
    else {
        return;
    };
    // Already decided once — never look again (so a later clear sticks).
    let marker = new_dir.join(MIGRATION_MARKER);
    if marker.exists() {
        return;
    }

    let old_store = old_dir.join(LEGACY_STORE);
    let new_store = new_dir.join(NEW_STORE);
    if new_store.exists() || !old_store.exists() {
        // Nothing to carry over; record the decision.
        if std::fs::create_dir_all(&new_dir).is_ok() {
            let _ = std::fs::write(&marker, b"1");
        }
        return;
    }
    if let Err(e) = std::fs::create_dir_all(&new_dir) {
        eprintln!("[cherry] could not migrate settings: {e}");
        return;
    }
    match std::fs::copy(&old_store, &new_store) {
        Ok(_) => {
            eprintln!("[cherry] migrated settings from the previous installation");
            let _ = std::fs::write(&marker, b"1");
        }
        Err(e) => eprintln!("[cherry] could not migrate settings: {e}"),
    }
}
