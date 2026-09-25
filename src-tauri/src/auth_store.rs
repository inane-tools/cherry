//! YouTube Music session cookie persisted in the OS keychain.
//! Never touches localStorage / disk in plaintext.
//!
//! ## Why the payload is chunked
//!
//! Windows Credential Manager caps a credential blob at
//! `CRED_MAX_CREDENTIAL_BLOB_SIZE` = 2560 **bytes**, and `keyring` stores the
//! value as UTF-16 (`encode_utf16().count() * 2`). A real music.youtube.com
//! `Cookie` header is several KB, so a single credential can never hold it and
//! `set_password` fails with:
//!
//! > Attribute "password" encoded as UTF-16 is longer than platform limit
//!
//! So the JSON payload is split into fixed-size parts stored under sibling
//! credentials, with a small manifest entry recording the part count. Reads
//! reassemble; legacy single-entry payloads still load.

use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "cherry";
/// Service name used before the app was renamed to Cherry. Read once so an
/// existing sign-in survives the rename (see `load_with_fallback`).
const LEGACY_SERVICE: &str = "xylo";
const USER: &str = "ytmusic-session";

/// Max UTF-16 code units per stored part. The platform limit is 1280
/// (2560 bytes / 2); stay well under it to leave room for future metadata.
const MAX_PART_UTF16: usize = 1000;
/// Upper bound on parts (≈1 MB) — guards against a corrupt manifest.
const MAX_PARTS: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    #[serde(default = "default_kind")]
    pub kind: String,
    #[serde(default)]
    pub cookie: String,
    #[serde(default)]
    pub account_label: Option<String>,
    #[serde(default)]
    pub saved_at: i64,
}

fn default_kind() -> String {
    "cookie".to_string()
}

#[derive(Debug, Serialize, Deserialize)]
struct Manifest {
    v: u32,
    parts: usize,
}

/// A namespaced keychain location. Tests use their own namespace so they can
/// never clobber the user's real stored session.
#[derive(Clone, Copy)]
struct Store {
    service: &'static str,
    user: &'static str,
}

impl Store {
    const fn main() -> Self {
        Self { service: SERVICE, user: USER }
    }

    /// Where the session was stored before the rename.
    const fn legacy() -> Self {
        Self { service: LEGACY_SERVICE, user: USER }
    }

    fn manifest(&self) -> Result<Entry, String> {
        Entry::new(self.service, self.user).map_err(|e| e.to_string())
    }

    fn part(&self, index: usize) -> Result<Entry, String> {
        Entry::new(self.service, &format!("{}.p{index}", self.user)).map_err(|e| e.to_string())
    }

    fn delete_all(&self) -> Result<(), String> {
        match self.manifest()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(e.to_string()),
        }
        for index in 0..MAX_PARTS {
            match self.part(index)?.delete_credential() {
                Ok(()) => {}
                Err(keyring::Error::NoEntry) => break,
                Err(e) => return Err(e.to_string()),
            }
        }
        Ok(())
    }
}

/// Split a payload into parts that each fit the platform's UTF-16 blob limit.
/// Splits on `char` boundaries (never inside a surrogate pair).
fn chunk_payload(payload: &str) -> Vec<String> {
    let mut parts: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut units = 0usize;
    for ch in payload.chars() {
        let width = ch.len_utf16();
        if units + width > MAX_PART_UTF16 && !current.is_empty() {
            parts.push(std::mem::take(&mut current));
            units = 0;
        }
        current.push(ch);
        units += width;
    }
    if !current.is_empty() {
        parts.push(current);
    }
    parts
}

/// Write a credential and verify it reads back.
///
/// Windows Credential Manager can *accept* a write and then fail the immediate
/// read-back when several credentials are written concurrently ("No matching
/// entry found in secure storage"). Saving a large cookie writes many parts in
/// quick succession, so retry briefly instead of reporting a bogus failure.
fn set_verified(entry: &Entry, value: &str) -> Result<(), String> {
    let mut last = String::from("unknown error");
    for attempt in 0..4u64 {
        match entry.set_password(value) {
            Ok(()) => match entry.get_password() {
                Ok(read) if read == value => return Ok(()),
                Ok(_) => last = "credential store returned a different value".into(),
                Err(e) => last = e.to_string(),
            },
            Err(e) => last = e.to_string(),
        }
        std::thread::sleep(std::time::Duration::from_millis(20 * (attempt + 1)));
    }
    Err(format!("credential store write failed after retries: {last}"))
}

/// Read a credential, retrying transient failures.
///
/// `Ok(None)` means genuinely absent. A single `NoEntry` is retried once
/// because it can be a transient artifact right after a concurrent write.
fn get_password(entry: &Entry) -> Result<Option<String>, String> {
    let mut last = String::from("unknown error");
    for attempt in 0..3u64 {
        match entry.get_password() {
            Ok(value) => return Ok(Some(value)),
            Err(keyring::Error::NoEntry) => {
                if attempt >= 1 {
                    return Ok(None);
                }
                last = "no matching entry".into();
            }
            Err(e) => last = e.to_string(),
        }
        std::thread::sleep(std::time::Duration::from_millis(15 * (attempt + 1)));
    }
    Err(last)
}

fn save_to(store: &Store, session: &AuthSession) -> Result<(), String> {
    if session.cookie.trim().is_empty() {
        return Err("empty session".into());
    }
    let payload = serde_json::to_string(session).map_err(|e| e.to_string())?;
    let parts = chunk_payload(&payload);
    if parts.is_empty() || parts.len() > MAX_PARTS {
        return Err("session too large to store".into());
    }

    // Write parts first, manifest last: a crash mid-write must not leave a
    // manifest pointing at parts that were never stored.
    for (index, part) in parts.iter().enumerate() {
        set_verified(&store.part(index)?, part)?;
    }

    let manifest = serde_json::to_string(&Manifest { v: 2, parts: parts.len() })
        .map_err(|e| e.to_string())?;
    set_verified(&store.manifest()?, &manifest)?;

    // Drop leftovers from a previously larger session.
    let mut index = parts.len();
    while index < MAX_PARTS {
        match store.part(index)?.delete_credential() {
            Ok(()) => index += 1,
            Err(keyring::Error::NoEntry) => break,
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

fn load_from(store: &Store) -> Result<Option<AuthSession>, String> {
    let raw = match get_password(&store.manifest()?)? {
        Some(value) => value,
        None => return Ok(None),
    };

    // Check the chunked manifest FIRST. `AuthSession` has `#[serde(default)]`
    // on every field, so a manifest (`{"v":2,"parts":N}`) would also parse as
    // an empty session and mask the real payload if we tried legacy first.
    if let Ok(manifest) = serde_json::from_str::<Manifest>(&raw) {
        if manifest.v != 2 || manifest.parts == 0 || manifest.parts > MAX_PARTS {
            return Err("unsupported stored session format".into());
        }
        let mut payload = String::new();
        for index in 0..manifest.parts {
            let part = get_password(&store.part(index)?)?.unwrap_or_default();
            payload.push_str(&part);
        }
        let session: AuthSession = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
        return Ok((!session.cookie.trim().is_empty()).then_some(session));
    }

    // Legacy single-entry payload: the manifest *is* the session JSON.
    if let Ok(session) = serde_json::from_str::<AuthSession>(&raw) {
        return Ok((!session.cookie.trim().is_empty()).then_some(session));
    }

    Err("unsupported stored session format".into())
}

/// Load from `primary`, falling back to `legacy` (the pre-rename keychain
/// service) and copying the session into `primary` so the fallback only has to
/// run once. `auth_clear` clears both, so signing out cannot be undone by it.
fn load_with_fallback(primary: &Store, legacy: &Store) -> Result<Option<AuthSession>, String> {
    if let Some(session) = load_from(primary)? {
        return Ok(Some(session));
    }
    let Some(session) = load_from(legacy)? else {
        return Ok(None);
    };
    // Best-effort: if the copy fails the legacy entry is still readable.
    if let Err(e) = save_to(primary, &session) {
        eprintln!("[cherry] could not copy the session to the new keychain entry: {e}");
    }
    Ok(Some(session))
}

pub(crate) fn save_session(session: &AuthSession) -> Result<(), String> {
    save_to(&Store::main(), session)
}

#[tauri::command]
pub fn auth_save(session: AuthSession) -> Result<(), String> {
    save_session(&session)
}

#[tauri::command]
pub fn auth_load() -> Result<Option<AuthSession>, String> {
    // The Windows Credential Manager occasionally fails a read right after a
    // write ("No matching entry found in secure storage"). Retry before
    // concluding the user is signed out — otherwise a hiccup looks like a
    // lost session and the app forgets the login on startup.
    let primary = Store::main();
    let legacy = Store::legacy();
    let mut last = String::from("unknown error");
    for attempt in 0..4u64 {
        match load_with_fallback(&primary, &legacy) {
            Ok(found) => return Ok(found),
            Err(e) => last = e,
        }
        std::thread::sleep(std::time::Duration::from_millis(40 * (attempt + 1)));
    }
    Err(last)
}

#[tauri::command]
pub fn auth_clear() -> Result<(), String> {
    Store::main().delete_all()?;
    // Drop the pre-rename entry too: otherwise the next load would migrate it
    // straight back and signing out would look like it did nothing.
    Store::legacy().delete_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Each test uses its own namespace AND holds a lock: keychain state is
    // process-global, and concurrent credential writes are what triggered the
    // transient read-back failures this suite guards against.
    static KEYCHAIN_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    const ROUNDTRIP_STORE: Store = Store { service: "cherry-selftest", user: "roundtrip" };
    const PERSIST_STORE: Store = Store { service: "cherry-selftest", user: "persist" };
    const LEGACY_STORE: Store = Store { service: "cherry-selftest-legacy", user: "session" };
    const MIGRATED_STORE: Store = Store { service: "cherry-selftest", user: "migrated" };
    /// Comfortably larger than the 1280-UTF-16-unit single-credential limit.
    const BIG_COOKIE: usize = 6000;

    fn big_session() -> AuthSession {
        // Deterministic, ASCII so byte/UTF-16 lengths match expectations.
        let cookie = "SID=".to_string() + &"abcdefghij".repeat(BIG_COOKIE / 10);
        AuthSession {
            kind: "cookie".to_string(),
            cookie,
            account_label: Some("test account".to_string()),
            saved_at: 1234567890,
        }
    }

    #[test]
    fn chunking_splits_on_utf16_limit() {
        let parts = chunk_payload(&"x".repeat(2500));
        assert_eq!(parts.len(), 3, "expected 3 parts for 2500 units");
        for part in &parts {
            assert!(
                part.encode_utf16().count() * 2 <= 2560,
                "part exceeds the Windows credential blob limit"
            );
        }
        assert_eq!(parts.concat(), "x".repeat(2500));
    }

    /// The reported bug: a real cookie header is far larger than one Windows
    /// credential can hold. This fails with
    /// "Attribute \"password\" encoded as UTF-16 is longer than platform limit"
    /// unless the payload is chunked.
    #[test]
    fn large_session_round_trips() {
        let _guard = KEYCHAIN_LOCK.lock().unwrap();
        let store = ROUNDTRIP_STORE;
        let _ = store.delete_all();
        let session = big_session();

        save_to(&store, &session).expect("save large session");
        let loaded = load_from(&store).expect("load").expect("session present");
        assert_eq!(loaded.cookie, session.cookie);
        assert_eq!(loaded.account_label.as_deref(), Some("test account"));

        // A shorter session must not leave stale trailing parts behind.
        let mut smaller = session.clone();
        smaller.cookie = "SID=short".to_string();
        save_to(&store, &smaller).expect("save smaller session");
        let reloaded = load_from(&store).expect("load").expect("session present");
        assert_eq!(reloaded.cookie, "SID=short");

        store.delete_all().expect("clear");
        assert!(load_from(&store).expect("load after clear").is_none());
    }

    /// Proves persistence is real (not the in-memory mock store) by reading
    /// the session from a **separate process**, including the chunked path.
    #[test]
    fn keychain_persists_across_processes() {
        let _guard = KEYCHAIN_LOCK.lock().unwrap();
        let store = PERSIST_STORE;

        if std::env::var("CHERRY_KEYCHAIN_CHILD").is_ok() {
            let loaded = load_from(&store)
                .expect("child load")
                .expect("child could not read the stored session — keyring is not persistent");
            assert_eq!(loaded.cookie, big_session().cookie);
            println!("CHERRY_CHILD_READ_OK");
            return;
        }

        let _ = store.delete_all();
        save_to(&store, &big_session()).expect("parent save");

        let exe = std::env::current_exe().expect("current test binary");
        let output = std::process::Command::new(exe)
            // `--exact` needs the fully-qualified path; the bare name silently
            // matches zero tests and would make this assertion vacuous.
            .args([
                "auth_store::tests::keychain_persists_across_processes",
                "--exact",
                "--nocapture",
            ])
            .env("CHERRY_KEYCHAIN_CHILD", "1")
            .output()
            .expect("spawn child test process");

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = store.delete_all();

        assert!(
            output.status.success(),
            "session did not persist across processes\n{stdout}\n{stderr}"
        );
        assert!(
            stdout.contains("CHERRY_CHILD_READ_OK"),
            "child process did not actually execute the assertion:\n{stdout}"
        );
    }

    /// The rename must not sign anyone out: a session that only exists under
    /// the old keychain service is imported, then copied to the new one so the
    /// fallback is a one-off.
    #[test]
    fn legacy_session_is_imported() {
        let _guard = KEYCHAIN_LOCK.lock().unwrap();
        let _ = LEGACY_STORE.delete_all();
        let _ = MIGRATED_STORE.delete_all();

        let session = big_session();
        save_to(&LEGACY_STORE, &session).expect("save legacy session");

        let loaded = load_with_fallback(&MIGRATED_STORE, &LEGACY_STORE)
            .expect("load")
            .expect("session was not imported from the legacy entry");
        assert_eq!(loaded.cookie, session.cookie);

        // The primary now holds it, so nothing depends on the legacy entry.
        let primary = load_from(&MIGRATED_STORE).expect("load primary").expect("copied");
        assert_eq!(primary.cookie, session.cookie);

        // With nothing stored anywhere, the fallback reports "no session".
        let _ = LEGACY_STORE.delete_all();
        let _ = MIGRATED_STORE.delete_all();
        assert!(load_with_fallback(&MIGRATED_STORE, &LEGACY_STORE).expect("load").is_none());
    }
}
