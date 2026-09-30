//! Last.fm scrobbling.
//!
//! Last.fm's write API is *signed*: every request carries `api_sig`, the MD5 of
//! the alphabetically-sorted parameters concatenated with the application's
//! shared secret. The frontend owns the user's API key / secret and the
//! resulting session key (all entered in Settings) and passes them to these
//! commands, which do the signing and the HTTP call through reqwest — so the
//! webview never has to reach a cross-origin endpoint or compute MD5.
//!
//! Desktop auth flow:
//!   1. `auth.getToken`                      -> token
//!   2. user approves at last.fm/api/auth    -> (browser)
//!   3. `auth.getSession` (token)            -> session key + username
//! `lastfm_get_token` also returns the approval URL for step 2.

use std::collections::BTreeMap;

use serde::Serialize;

const API_ROOT: &str = "https://ws.audioscrobbler.com/2.0/";

/// `api_sig` = md5(sorted `keyvalue` pairs + secret), excluding `format` and
/// `callback`. `BTreeMap` keeps the keys in the ASCII order Last.fm requires.
fn sign(params: &BTreeMap<String, String>, secret: &str) -> String {
    let mut concat = String::new();
    for (key, value) in params {
        if key == "format" || key == "callback" {
            continue;
        }
        concat.push_str(key);
        concat.push_str(value);
    }
    concat.push_str(secret);
    format!("{:x}", md5::compute(concat.as_bytes()))
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("Cherry/1.0 (https://inane.tools)")
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .expect("reqwest client")
}

fn enc(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

/// POST a signed method. Errors are returned as `message (code N)` so the UI
/// can tell "invalid session key" (9) from "invalid api key" (10) and a bad
/// signature (13).
async fn call(
    api_key: &str,
    secret: &str,
    method: &str,
    extra: BTreeMap<String, String>,
) -> Result<serde_json::Value, String> {
    let mut params = extra;
    params.insert("method".to_string(), method.to_string());
    params.insert("api_key".to_string(), api_key.to_string());
    params.insert("api_sig".to_string(), sign(&params, secret));
    params.insert("format".to_string(), "json".to_string());

    let response = client()
        .post(API_ROOT)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Could not reach Last.fm: {e}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|_| format!("Last.fm returned an unexpected response ({status})."))?;
    if let Some(code) = json.get("error").and_then(|e| e.as_i64()) {
        let message = json
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Last.fm rejected the request");
        return Err(format!("{message} (code {code})"));
    }
    Ok(json)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastfmToken {
    pub token: String,
    pub auth_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastfmSession {
    pub session_key: String,
    pub username: String,
}

#[tauri::command]
pub async fn lastfm_get_token(api_key: String, api_secret: String) -> Result<LastfmToken, String> {
    let json = call(&api_key, &api_secret, "auth.getToken", BTreeMap::new()).await?;
    let token = json
        .get("token")
        .and_then(|t| t.as_str())
        .unwrap_or_default()
        .to_string();
    if token.is_empty() {
        return Err("Last.fm did not return an auth token.".into());
    }
    let auth_url = format!(
        "https://www.last.fm/api/auth/?api_key={}&token={}",
        enc(&api_key),
        enc(&token)
    );
    Ok(LastfmToken { token, auth_url })
}

#[tauri::command]
pub async fn lastfm_get_session(
    api_key: String,
    api_secret: String,
    token: String,
) -> Result<LastfmSession, String> {
    let mut extra = BTreeMap::new();
    extra.insert("token".to_string(), token);
    let json = call(&api_key, &api_secret, "auth.getSession", extra).await?;
    let session = json
        .get("session")
        .ok_or_else(|| "Last.fm did not return a session — has the token been authorized?".to_string())?;
    let session_key = session
        .get("key")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let username = session
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if session_key.is_empty() {
        return Err("Last.fm did not return a session key (authorize the token first).".into());
    }
    Ok(LastfmSession { session_key, username })
}

fn track_params(
    session_key: String,
    artist: String,
    track: String,
    album: Option<String>,
    duration: Option<i64>,
) -> BTreeMap<String, String> {
    let mut extra = BTreeMap::new();
    extra.insert("sk".to_string(), session_key);
    extra.insert("artist".to_string(), artist);
    extra.insert("track".to_string(), track);
    if let Some(album) = album.filter(|a| !a.is_empty()) {
        extra.insert("album".to_string(), album);
    }
    if let Some(duration) = duration.filter(|d| *d > 0) {
        extra.insert("duration".to_string(), duration.to_string());
    }
    extra
}

#[tauri::command]
pub async fn lastfm_now_playing(
    api_key: String,
    api_secret: String,
    session_key: String,
    artist: String,
    track: String,
    album: Option<String>,
    duration: Option<i64>,
) -> Result<(), String> {
    let extra = track_params(session_key, artist, track, album, duration);
    call(&api_key, &api_secret, "track.updateNowPlaying", extra)
        .await
        .map(|_| ())
}

#[tauri::command]
pub async fn lastfm_scrobble(
    api_key: String,
    api_secret: String,
    session_key: String,
    artist: String,
    track: String,
    album: Option<String>,
    duration: Option<i64>,
    timestamp: i64,
) -> Result<(), String> {
    let mut extra = track_params(session_key, artist, track, album, duration);
    extra.insert("timestamp".to_string(), timestamp.to_string());
    call(&api_key, &api_secret, "track.scrobble", extra)
        .await
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The documented example: secret `mysecret`, `auth.getSession` params.
    #[test]
    fn signature_matches_lastfm_spec() {
        let mut params = BTreeMap::new();
        params.insert("api_key".to_string(), "xxxxxxxx".to_string());
        params.insert("method".to_string(), "auth.getSession".to_string());
        params.insert("token".to_string(), "xxxxxxx".to_string());
        assert_eq!(
            sign(&params, "mysecret"),
            format!("{:x}", md5::compute("api_keyxxxxxxxxmethodauth.getSessiontokenxxxxxxxmysecret"))
        );
    }

    #[test]
    fn format_is_excluded_from_signature() {
        let base: BTreeMap<String, String> =
            [("method".to_string(), "track.scrobble".to_string())].into_iter().collect();
        let mut with_format = base.clone();
        with_format.insert("format".to_string(), "json".to_string());
        assert_eq!(sign(&base, "s"), sign(&with_format, "s"));
    }
}
