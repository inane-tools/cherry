//! Maintenance commands for Settings → "Clear data and cache".
//!
//! Wipes everything Cherry stores locally: the settings store, the webview
//! profile (which holds youtubei.js's IndexedDB cache, the app's
//! `localStorage`/`sessionStorage` and the service worker caches) and the
//! keychain session.
//!
//! The frontend clears in-page caches. Windows removes unlocked profile files
//! immediately and retries at startup. Linux schedules disk cleanup before the
//! next webview starts: unlinking active WebKit databases can lose the reset
//! when the running network process writes them back.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// Where the settings store lives (kept in sync with `settingsRepo.ts`).
pub const SETTINGS_FILE: &str = "cherry-settings.json";

/// Marker written when a clear had to skip locked paths. On the next start the
/// leftovers are removed for real (see `finish_pending_clear`).
const PENDING_CLEAR: &str = ".pending-clear";

fn app_data_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resolve("", tauri::path::BaseDirectory::AppData)
        .ok()
}

/// Directory names a clear tries to remove (the WebView2 profile folders and
/// the settings store).
const CLEAR_TARGETS: [&str; 3] = [SETTINGS_FILE, "EBWebView", "ytm-login-webview"];

// Tauri's Linux directory is Wry's WebKit base-data/base-cache directory.
// Names follow WebKit's GLib defaults; Wry's persistent cookie jar is `cookies`.
// Preserve migration markers and unrelated files by using an explicit allowlist.
#[cfg(any(target_os = "linux", test))]
const LINUX_WEBKIT_TARGETS: &[&str] = &[
    "cookies", "cookies-journal", "cookies-wal", "cookies-shm",
    "localstorage", "databases", "storage", "serviceworkers", "CacheStorage",
    "WebKitCache", "MediaCache", "applications", "itp", "mediakeys",
    "deviceidhashsalts", "mediakeyshashsalts", "AlternativeServices",
    "isolatedsites", "resourcemonitorthrottler", "hsts-storage.sqlite",
    "hsts-storage.sqlite-journal", "hsts-storage.sqlite-wal", "hsts-storage.sqlite-shm",
];

fn clear_targets() -> Vec<&'static str> {
    let targets = CLEAR_TARGETS.to_vec();
    #[cfg(target_os = "linux")]
    let targets = targets.into_iter().chain(LINUX_WEBKIT_TARGETS.iter().copied()).collect();
    targets
}

fn disk_size(dir: &std::path::Path, app_cache: Option<&std::path::Path>, targets: &[&str]) -> u64 {
    let mut total = targets.iter().map(|name| dir_size(&dir.join(name))).sum();
    if let Some(cache) = app_cache {
        if cache != dir { total += dir_size(&cache.to_path_buf()); }
    }
    total
}

/// Size, in bytes, of a file/directory tree (best effort — unreadable entries
/// count as zero, since a transient lock must not fail the whole report).
fn dir_size(path: &PathBuf) -> u64 {
    let mut total = 0;
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return 0;
    };
    if meta.is_symlink() { return 0; }
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

    tauri::async_runtime::spawn_blocking(move || disk_size(&dir, app_cache.as_deref(), &clear_targets()))
        .await.map_err(|e| e.to_string())
}

/// Remove one path, reporting whether it was removed. A missing path counts as
/// "already gone" (Ok) so the caller's report stays accurate on a second run.
fn remove_path(path: &std::path::Path) -> bool {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) => return error.kind() == std::io::ErrorKind::NotFound,
    };
    if meta.is_dir() && !meta.is_symlink() {
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
    finish_pending_clear_with_cache(dir, None, &clear_targets());
}

fn finish_pending_clear_with_cache(
    dir: &std::path::Path,
    app_cache: Option<&std::path::Path>,
    targets: &[&str],
) {
    if !dir.join(PENDING_CLEAR).exists() {
        return;
    }
    let mut complete = true;
    for name in targets {
        let path = dir.join(name);
        complete &= remove_path(&path);
    }
    if let Some(cache) = app_cache {
        if cache != dir { complete &= remove_path(cache); }
    }
    // Retry on a later launch if permissions or a surviving process prevented
    // cleanup. Do not silently discard the user's reset request.
    if complete {
        let _ = std::fs::remove_file(dir.join(PENDING_CLEAR));
    }
}

/// Startup entry point (called from `main()` before the Tauri builder, so the
/// WebView2 profile is not yet open): finish any clear the running app had to
/// defer, using the same app-data resolution as `migrate`.
pub fn run_startup_cleanup() {
    let Some(dir) = crate::migrate::app_data_dir(crate::migrate::NEW_IDENTIFIER) else {
        return;
    };
    #[cfg(target_os = "linux")]
    {
        let cache = std::env::var_os("XDG_CACHE_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")))
            .map(|base| base.join(crate::migrate::NEW_IDENTIFIER));
        finish_pending_clear_with_cache(&dir, cache.as_deref(), &clear_targets());
    }
    #[cfg(not(target_os = "linux"))]
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
    #[cfg(target_os = "linux")]
    {
        // Unix permits unlinking live databases, but WebKit can keep using open
        // files or recreate them. Clear before constructing the next webview.
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join(PENDING_CLEAR), b"linux-webkit-reset")
            .map_err(|e| format!("Could not schedule data cleanup: {e}"))?;
        crate::secrets::clear_all();
        Ok(vec!["locked: settings and Linux WebKit data".into()])
    }
    #[cfg(not(target_os = "linux"))]
    {
    let app_cache = app
        .path()
        .resolve("", tauri::path::BaseDirectory::AppCache)
        .ok();

    let report = clear_disk(&dir, app_cache.as_deref());
    // The Last.fm secrets live in the keychain, not on disk.
    crate::secrets::clear_all();
    let mut removed = report.removed;
    if !report.skipped.is_empty() {
        removed.push(format!("locked: {}", report.skipped.join(", ")));
    }
    Ok(removed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("cherry-maintenance-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn linux_profile_size_and_startup_reset_use_the_same_targets() {
        let dir = temp_dir("linux-profile");
        let cache = temp_dir("linux-cache");
        let targets: Vec<_> = CLEAR_TARGETS.iter().copied()
            .chain(LINUX_WEBKIT_TARGETS.iter().copied()).collect();
        for name in &targets {
            if LINUX_WEBKIT_TARGETS.contains(name) && *name != "cookies" && !name.contains('.') {
                std::fs::create_dir_all(dir.join(name).join("origin")).unwrap();
                std::fs::write(dir.join(name).join("origin/data"), b"data").unwrap();
            } else {
                std::fs::write(dir.join(name), b"data").unwrap();
            }
        }
        std::fs::write(cache.join("cached-image"), b"cache").unwrap();
        for name in [".migrated-from-cherry", ".migrated-from-xylo", "unrelated-file"] {
            std::fs::write(dir.join(name), b"keep").unwrap();
        }
        assert_eq!(disk_size(&dir, Some(&cache), &targets), (targets.len() * 4 + 5) as u64);
        // A running Linux profile is untouched until a reset was scheduled.
        finish_pending_clear_with_cache(&dir, Some(&cache), &targets);
        assert!(dir.join("cookies").exists());
        std::fs::write(dir.join(PENDING_CLEAR), b"linux-webkit-reset").unwrap();
        finish_pending_clear_with_cache(&dir, Some(&cache), &targets);
        assert_eq!(disk_size(&dir, Some(&cache), &targets), 0);
        assert!(!dir.join(PENDING_CLEAR).exists());
        for name in [".migrated-from-cherry", ".migrated-from-xylo", "unrelated-file"] {
            assert!(dir.join(name).exists());
        }
        // Repeated cleanup remains a no-op.
        finish_pending_clear_with_cache(&dir, Some(&cache), &targets);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn linux_profile_size_counts_nested_storage_once() {
        let dir = temp_dir("linux-size");
        std::fs::create_dir_all(dir.join("databases/indexeddb/origin")).unwrap();
        std::fs::write(dir.join("databases/indexeddb/origin/db"), b"123456").unwrap();
        assert_eq!(disk_size(&dir, Some(&dir), LINUX_WEBKIT_TARGETS), 6);
        let _ = std::fs::remove_dir_all(&dir);
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
