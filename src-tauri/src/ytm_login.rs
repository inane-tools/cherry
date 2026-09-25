//! In-app "log in with YouTube Music" window.
//!
//! Opens music.youtube.com in a real webview and watches the **native cookie
//! store** (including HttpOnly cookies, which page JavaScript can never read).
//! Once session cookies appear we persist the full `Cookie` header through
//! `auth_store` and close the window.
//!
//! ## Critical Windows detail
//!
//! `WebviewWindowBuilder::build()` **deadlocks when called from a synchronous
//! command** (see tauri#13963, tauri#3597 and the `WebviewWindowBuilder::new`
//! docs). The visible symptom is a blank white, frozen, unclosable window.
//! Every command here that builds or closes a window is therefore `async` and
//! calls `build()` directly (the builder already posts to the event loop).
//!
//! Also: a WebView2 `additionalBrowserArgs` override **breaks this window**.
//! Setting `--enable-features=OverlayScrollbar` (for nicer scrollbars) creates
//! the login window with `visible=false` / `url=""`, and every webview call
//! then fails with "failed to receive message from webview". Keep
//! `additionalBrowserArgs` unset unless you verify login still works.
//!
//! Deliberately uses the *default* user agent and a native frame: forcing a
//! Chrome UA made Google render a blank page, and a normal browser window is
//! the least surprising thing for a login flow.
//!
//! Threading: on Windows `cookies_for_url` also deadlocks if called on the
//! WebView2 thread, so cookie reads hop to a blocking worker.

use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Manager, WebviewUrl};

use crate::auth_store::{save_session, AuthSession};

const LABEL: &str = "cherry-login";
const YTM_URL: &str = "https://music.youtube.com/";

/// Presence of any of these marks a signed-in Google session. Anonymous
/// visitors only carry VISITOR_INFO1_LIVE / YSC / PREF / SOCS style cookies.
const SESSION_MARKERS: &[&str] = &[
    "SID",
    "SSID",
    "HSID",
    "APISID",
    "SAPISID",
    "LOGIN_INFO",
    "__Secure-1PSID",
    "__Secure-3PSID",
];

// Only YouTube-scoped cookies are collected.
//
// Google sets `SID`/`SAPISID`/`HSID`/... on **both** `.google.com` and
// `.youtube.com` with *different values*, and YouTube's Innertube rejects a
// session built from the `.google.com` set. Collecting the accounts.google.com
// jar and merging by cookie name let Google's value overwrite YouTube's, so
// the captured "session" authenticated as nobody. Google's jar is omitted.
const COOKIE_URLS: &[&str] = &["https://music.youtube.com/", "https://www.youtube.com/"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtmLoginStatus {
    pub open: bool,
    pub url: String,
    pub logged_in: bool,
}

/// Open (or focus) the sign-in window. MUST be async — see module docs.
#[tauri::command]
pub async fn open_ytm_login(app: AppHandle) -> Result<(), String> {
    // Reuse an existing window instead of closing and immediately rebuilding
    // the same label, which is racy on Windows.
    if let Some(existing) = app.get_webview_window(LABEL) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    let url: url::Url = YTM_URL.parse().map_err(|e: url::ParseError| e.to_string())?;
    // Called directly (not from `spawn_blocking`): the builder already posts to
    // the event loop, and wrapping it in a blocking task created the window on
    // a short-lived worker where it never became visible (and was torn down).
    let window = tauri::WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(url))
        .title("Sign in — YouTube Music")
        .inner_size(1120.0, 800.0)
        .min_inner_size(900.0, 620.0)
        .center()
        .resizable(true)
        .decorations(true)
        .visible(true)
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;

    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

/// Close the sign-in window. Async for the same reason as `open_ytm_login`.
#[tauri::command]
pub async fn close_ytm_login(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.close();
    }
    Ok(())
}

/// Run `f` against the login window, turning a wry panic into a plain error.
///
/// `tauri-runtime-wry` `unwrap()`s the event-loop channel in every window
/// getter (e.g. `lib.rs:1796` for `cookies_for_url`). If the webview is being
/// torn down the message is dropped and that `unwrap()` panics on the calling
/// worker — which previously aborted cookie reads and broke login. Catching it
/// keeps the app (and the login flow) alive.
fn with_login_window<T>(
    app: &AppHandle,
    f: impl FnOnce(&tauri::WebviewWindow) -> Result<T, String>,
) -> Result<T, String> {
    let window = app
        .get_webview_window(LABEL)
        .ok_or_else(|| "login window is not open".to_string())?;
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(&window)))
        .map_err(|_| "login window is closing".to_string())?
}

fn read_cookies_blocking(app: &AppHandle) -> Result<HashMap<String, String>, String> {
    with_login_window(app, |window| {
        let mut merged = HashMap::new();
        for raw in COOKIE_URLS {
            let url: url::Url = raw.parse().map_err(|e: url::ParseError| e.to_string())?;
            for cookie in window.cookies_for_url(url).map_err(|e| e.to_string())? {
                let value = cookie.value().to_string();
                if !value.is_empty() {
                    merged.insert(cookie.name().to_string(), value);
                }
            }
        }
        Ok(merged)
    })
}

async fn read_cookies(app: AppHandle) -> Result<HashMap<String, String>, String> {
    // Cookie reads race with window teardown (and can hit a transient wry
    // panic), so retry a couple of times instead of failing the whole login.
    tokio::task::spawn_blocking(move || {
        let mut last = String::from("unknown error");
        for attempt in 0..3u64 {
            match read_cookies_blocking(&app) {
                Ok(cookies) => return Ok(cookies),
                Err(e) => last = e,
            }
            std::thread::sleep(std::time::Duration::from_millis(120 * (attempt + 1)));
        }
        Err(last)
    })
    .await
    .map_err(|e| format!("cookie read failed: {e}"))?
}

fn has_session(cookies: &HashMap<String, String>) -> bool {
    SESSION_MARKERS.iter().any(|marker| cookies.contains_key(*marker))
}

/// Serialize cookies into a `Cookie` request header value.
fn build_cookie_header(cookies: &HashMap<String, String>) -> String {
    let mut names: Vec<&String> = cookies.keys().collect();
    names.sort();
    names
        .iter()
        .map(|name| format!("{name}={}", cookies[*name]))
        .collect::<Vec<_>>()
        .join("; ")
}

#[tauri::command]
pub async fn ytm_login_status(app: AppHandle) -> Result<YtmLoginStatus, String> {
    let Ok(url) = with_login_window(&app, |window| {
        window.url().map(|u| u.to_string()).map_err(|e| e.to_string())
    }) else {
        return Ok(YtmLoginStatus { open: false, url: String::new(), logged_in: false });
    };
    let logged_in = read_cookies(app).await.map(|c| has_session(&c)).unwrap_or(false);
    Ok(YtmLoginStatus { open: true, url, logged_in })
}

/// Capture the session cookie, persist it, and close the login window.
#[tauri::command]
pub async fn ytm_login_finish(app: AppHandle) -> Result<AuthSession, String> {
    let cookies = read_cookies(app.clone()).await?;
    if !has_session(&cookies) {
        return Err("no YouTube session found — finish signing in first".into());
    }
    let header = build_cookie_header(&cookies);
    let session = AuthSession {
        kind: "cookie".to_string(),
        cookie: header,
        account_label: None,
        saved_at: unix_now(),
    };
    save_session(&session)?;
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.close();
    }
    Ok(session)
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
