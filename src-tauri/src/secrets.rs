//! Small secrets (Last.fm API secret + session key) in the OS keychain.
//!
//! These used to live in the plaintext settings store (`cherry-settings.json`),
//! readable by anything that can read the user's app-data folder, while the
//! YouTube session already lived in the keychain (`auth_store.rs`). The
//! frontend's settings repository now splits them out and stores them here as
//! one small JSON value per *name*.
//!
//! Only names in `ALLOWED` are accepted, so the commands cannot be used to read
//! or overwrite arbitrary keychain entries (in particular not the YouTube
//! session, which has its own commands).

use keyring::Entry;

const SERVICE: &str = "cherry";
const ALLOWED: &[&str] = &["lastfm"];
/// Well under the Windows credential blob limit (1280 UTF-16 units).
const MAX_UTF16: usize = 1200;

fn entry(service: &str, name: &str) -> Result<Entry, String> {
    if !ALLOWED.contains(&name) {
        return Err(format!("unknown secret: {name}"));
    }
    Entry::new(service, &format!("secret.{name}")).map_err(|e| e.to_string())
}

fn save_to(service: &str, name: &str, value: &str) -> Result<(), String> {
    let entry = entry(service, name)?;
    if value.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    if value.encode_utf16().count() > MAX_UTF16 {
        return Err("secret too large".into());
    }
    entry.set_password(value).map_err(|e| e.to_string())
}

fn load_from(service: &str, name: &str) -> Result<Option<String>, String> {
    match entry(service, name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Remove every allowed secret (Settings → "Clear data").
pub fn clear_all() {
    for name in ALLOWED {
        let _ = save_to(SERVICE, name, "");
    }
}

/// Store `value` under `name`; an empty value deletes the entry. Async so the
/// keychain (which can block on a Secret Service / Keychain prompt) never runs
/// on the main thread.
#[tauri::command]
pub async fn secret_save(name: String, value: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || save_to(SERVICE, &name, &value))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn secret_load(name: String) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || load_from(SERVICE, &name))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_names_outside_the_allowlist() {
        assert!(entry(SERVICE, "ytmusic-session").is_err());
        assert!(entry(SERVICE, "../anything").is_err());
        assert!(entry(SERVICE, "lastfm").is_ok());
    }

    #[test]
    fn refuses_oversized_values() {
        let big = "x".repeat(MAX_UTF16 + 1);
        assert_eq!(save_to("cherry-selftest", "lastfm", &big).unwrap_err(), "secret too large");
    }

    /// Needs a real OS keychain (Secret Service on Linux).
    #[test]
    #[ignore = "keychain"]
    fn round_trips_and_deletes() {
        let service = "cherry-selftest-secrets";
        save_to(service, "lastfm", "{\"k\":1}").expect("save");
        assert_eq!(load_from(service, "lastfm").expect("load").as_deref(), Some("{\"k\":1}"));
        save_to(service, "lastfm", "").expect("delete");
        assert_eq!(load_from(service, "lastfm").expect("load"), None);
    }
}
