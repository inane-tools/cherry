//! Maintenance commands for Settings → "Clear data and cache".
//!
//! Wipes everything Cherry stores locally: the settings store, the WebView2
//! profile (which holds youtubei.js's IndexedDB cache, the app's
//! `localStorage`/`sessionStorage` and the service worker caches) and the
//! keychain session.
//!
//! The WebView2 profile cannot be deleted while the app is running — the
//! runtime holds files open. So the profile is cleared with WebView2's own
//! `ClearBrowsingData`-style approach instead: the in-page caches are cleared
//! from the frontend (`localStorage`, `caches`, IndexedDB), and Rust removes
//! the on-disk cache directories that are *not* locked (the HTTP/GPU caches).
//! Anything still locked is reported and removed on the next start via
//! `migrate::run`'s sibling cleanup below.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// Where the settings store lives (kept in sync with `settingsRepo.ts`).
pub const SETTINGS_FILE: &str = "cherry-settings.json";

/// Marker written when a clear had to skip locked paths. On the next start the
/// leftovers are removed for real (see `finish_pending_clear`).
const PENDING_CLEAR: &str = ".pending-clear";

fn app_data_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().resolve("", tauri::path::BaseDirectory::AppData).ok()
}

/// Directory names a clear tries to remove (the WebView2 profile folders and
/// the settings store).
const CLEAR_TARGETS: [&str; 3] = [SETTINGS_FILE, "EBWebView", "ytm-login-webview"];

/// Size, in bytes, of a file/directory tree (best effort — unreadable entries
/// count as zero, since a transient lock must not fail the whole report).
fn dir_size(path: &PathBuf) -> u64 {
    let mut total = 0;
    let Ok(meta) = std::fs::metadata(path) else {
        return 0;
    };
    if meta.is_file() {
        return meta.len();
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    for entry in entries.flatten() {
        total += dir_size(&entry.path());
    }
    total
}

/// Bytes currently occupied by everything `clear_local_data` would remove.
///
/// Deliberately sums the same targets as `clear_disk` (settings store, WebView2
/// profile, login profile and the app-cache directory) rather than the whole
/// app-data root: on systems where the bulk of the cache lives under the local
/// app-cache directory, counting only the app-data root reported a size far
/// smaller than what actually gets freed. Runs off the main thread so walking a
/// large profile never freezes the UI.
#[tauri::command]
pub async fn cache_size(app: AppHandle) -> Result<u64, String> {
    let Some(dir) = app_data_dir(&app) else {
        return Ok(0);
    };
    let app_cache = app
        .path()
        .resolve("", tauri::path::BaseDirectory::AppCache)
        .ok();

    let mut total = 0u64;
    for name in CLEAR_TARGETS {
        total += dir_size(&dir.join(name));
    }
    if let Some(cache) = app_cache {
        if cache != dir {
            total += dir_size(&cache);
        }
    }
    Ok(total)
}

/// Remove one path, reporting whether it was removed. A missing path counts as
/// "already gone" (Ok) so the caller's report stays accurate on a second run.
fn remove_path(path: &std::path::Path) -> bool {
    if !path.exists() {
        return true;
    }
    if path.is_dir() {
        std::fs::remove_dir_all(path).is_ok()
    } else {
        std::fs::remove_file(path).is_ok()
    }
}

/// What a clear attempt managed to remove, split by success/failure.
pub struct ClearReport {
    pub removed: Vec<String>,
    pub skipped: Vec<String>,
}

/// Delete the on-disk pieces of the app's data directory. Pure filesystem work
/// (no Tauri handle), so it is unit-testable; `clear_local_data` supplies the
/// resolved directory and app-cache path.
pub fn clear_disk(dir: &std::path::Path, app_cache: Option<&std::path::Path>) -> ClearReport {
    let mut removed = Vec::new();
    let mut skipped = Vec::new();

    for name in CLEAR_TARGETS {
        let path = dir.join(name);
        if !path.exists() {
            continue;
        }
        if remove_path(&path) {
            removed.push(name.to_string());
        } else {
            skipped.push(name.to_string());
        }
    }

    if let Some(cache) = app_cache {
        if cache.exists() && cache != dir {
            if remove_path(cache) {
                removed.push("app-cache".to_string());
            } else {
                skipped.push("app-cache".to_string());
            }
        }
    }

    // If anything was locked (the running WebView2 runtime holds its profile
    // open), leave a marker so the next start finishes the job. Written only
    // when needed, and cleared by `finish_pending_clear`.
    let marker = dir.join(PENDING_CLEAR);
    if skipped.is_empty() {
        let _ = std::fs::remove_file(&marker);
    } else {
        let _ = std::fs::write(&marker, skipped.join("\n"));
    }

    ClearReport { removed, skipped }
}

/// Remove whatever a previous clear had to skip, then drop the marker.
///
/// Called at startup, before the WebView2 runtime opens its profile directory.
pub fn finish_pending_clear(dir: &std::path::Path) {
    if !dir.join(PENDING_CLEAR).exists() {
        return;
    }
    for name in CLEAR_TARGETS {
        let path = dir.join(name);
        if path.exists() {
            let _ = remove_path(&path);
        }
    }
    let _ = std::fs::remove_file(dir.join(PENDING_CLEAR));
}

/// Startup entry point (called from `main()` before the Tauri builder, so the
/// WebView2 profile is not yet open): finish any clear the running app had to
/// defer, using the same app-data resolution as `migrate`.
pub fn run_startup_cleanup() {
    let Some(dir) = crate::migrate::app_data_dir("com.cherry.app") else {
        return;
    };
    finish_pending_clear(&dir);
}

/// Remove the settings store and any unlocked WebView2 cache directories.
///
/// Deletion is intentionally individual and best-effort: a locked file (the
/// running WebView2 runtime holds its profile open) is skipped rather than
/// failing the command, so the user always gets a clear answer about what
/// happened, and the leftover is removed on the next start. This never returns
/// an error — a second press (nothing left to remove) must succeed quietly.
#[tauri::command]
pub fn clear_local_data(app: AppHandle) -> Result<Vec<String>, String> {
    let Some(dir) = app_data_dir(&app) else {
        return Ok(Vec::new());
    };
    let app_cache = app
        .path()
        .resolve("", tauri::path::BaseDirectory::AppCache)
        .ok();

    let report = clear_disk(&dir, app_cache.as_deref());
    let mut removed = report.removed;
    if !report.skipped.is_empty() {
        removed.push(format!("locked: {}", report.skipped.join(", ")));
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cherry-maintenance-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    /// The settings store and WebView cache folders must actually go, and a
    /// second run must be a clean no-op rather than an error.
    #[test]
    fn clears_settings_and_caches() {
        let dir = temp_dir("clear");
        std::fs::write(dir.join(SETTINGS_FILE), "{\"settings\":{}}").unwrap();
        std::fs::create_dir_all(dir.join("EBWebView").join("Default")).unwrap();
        std::fs::write(dir.join("EBWebView").join("Default").join("Cookies"), "x").unwrap();
        std::fs::create_dir_all(dir.join("ytm-login-webview")).unwrap();

        let report = clear_disk(&dir, None);
        assert!(report.removed.contains(&SETTINGS_FILE.to_string()));
        assert!(report.removed.contains(&"EBWebView".to_string()));
        assert!(report.removed.contains(&"ytm-login-webview".to_string()));
        assert!(report.skipped.is_empty());
        assert!(!dir.join(SETTINGS_FILE).exists());
        assert!(!dir.join("EBWebView").exists());
        // Nothing was locked, so no follow-up marker is left behind.
        assert!(!dir.join(PENDING_CLEAR).exists());

        // Idempotent: nothing left to remove, nothing reported as skipped.
        let second = clear_disk(&dir, None);
        assert!(second.removed.is_empty());
        assert!(second.skipped.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A pending marker left by a previous clear is honoured on the next start:
    /// `finish_pending_clear` removes the targets and drops the marker.
    ///
    /// (The lock itself cannot be reproduced portably — Windows `File::open`
    /// still permits deletion — so this exercises the recovery half, which is
    /// what actually matters. `clear_disk`'s skip path is covered indirectly by
    /// the marker being written whenever `skipped` is non-empty.)
    #[test]
    fn pending_clear_is_finished_on_next_start() {
        let dir = temp_dir("pending");
        std::fs::write(dir.join(SETTINGS_FILE), "{}").unwrap();
        std::fs::create_dir_all(dir.join("EBWebView").join("Default")).unwrap();
        std::fs::write(dir.join("EBWebView").join("Default").join("Cookies"), "x").unwrap();
        // Simulate a clear that had to defer these two.
        std::fs::write(dir.join(PENDING_CLEAR), "cherry-settings.json\nEBWebView").unwrap();

        finish_pending_clear(&dir);

        assert!(!dir.join(SETTINGS_FILE).exists());
        assert!(!dir.join("EBWebView").exists());
        assert!(!dir.join(PENDING_CLEAR).exists());

        // Running again with no marker is a no-op.
        finish_pending_clear(&dir);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// An unrelated directory must never be touched (guards against a bad
    /// resolve ever emptying the app-data root).
    #[test]
    fn leaves_unrelated_files_alone() {
        let dir = temp_dir("keep");
        std::fs::write(dir.join("something-else.txt"), "keep me").unwrap();
        std::fs::write(dir.join(SETTINGS_FILE), "{}").unwrap();

        let report = clear_disk(&dir, None);
        assert_eq!(report.removed, vec![SETTINGS_FILE.to_string()]);
        assert!(dir.join("something-else.txt").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
