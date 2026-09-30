//! Custom playlist thumbnails.
//!
//! YouTube Music added user-uploaded playlist images in late 2024. The flow is a
//! two-step resumable upload to a dedicated endpoint, which returns an
//! **encrypted blob id**; that id is then attached to the playlist through
//! `browse/edit_playlist` with an `ACTION_SET_CUSTOM_THUMBNAIL` action (the
//! frontend does that part through the normal Innertube client).
//!
//! The upload endpoints are *not* Innertube API calls, so youtubei.js does not
//! sign them — this module does, with the browser `SAPISIDHASH` scheme:
//! `SHA1("<unix> <SAPISID> https://music.youtube.com")`, sent as
//! `Authorization: SAPISIDHASH <unix>_<hash>`. This mirrors ytmusicapi's
//! `_resumable_upload`.
//!
//! Note: YT Music may require the account to have a verified phone number before
//! it accepts an image; that failure comes back as the endpoint's own error.

use base64::Engine as _;
use serde_json::Value;
use sha1::{Digest, Sha1};

const UPLOAD_URL: &str =
    "https://music.youtube.com/playlist_image_upload/playlist_custom_thumbnail";
const ORIGIN: &str = "https://music.youtube.com";

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .expect("reqwest client")
}

/// `SAPISID` from the raw `Cookie` header (`__Secure-3PAPISID` preferred).
fn sapisid_from_cookie(cookie: &str) -> Option<String> {
    for name in ["__Secure-3PAPISID", "SAPISID"] {
        let prefix = format!("{name}=");
        for part in cookie.split(';') {
            let part = part.trim();
            if let Some(value) = part.strip_prefix(&prefix) {
                let value = value.trim_matches('"');
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

fn authorization(sapisid: &str, unix: u64) -> String {
    let mut hasher = Sha1::new();
    hasher.update(format!("{unix} {sapisid} {ORIGIN}").as_bytes());
    let hash: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    format!("SAPISIDHASH {unix}_{hash}")
}

/// Upload `data_base64` (a JPEG/PNG) and return the encrypted blob id.
#[tauri::command]
pub async fn upload_playlist_thumbnail(
    cookie: String,
    data_base64: String,
    mime: String,
) -> Result<String, String> {
    let sapisid = sapisid_from_cookie(&cookie)
        .ok_or_else(|| "The session has no SAPISID cookie to sign the upload with.".to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("Invalid image data: {e}"))?;
    if bytes.is_empty() {
        return Err("The image is empty.".into());
    }
    let unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let auth = authorization(&sapisid, unix);

    // Step 1: start a resumable upload; the session URL comes back in a header.
    //
    // The start request MUST carry a body (ytmusicapi sends `filename=…`): an
    // empty POST is answered with **411 Length Required**.
    let ext = if mime.contains("png") { "png" } else { "jpg" };
    let start_body = format!("filename=cherry-playlist.{ext}");
    let start = client()
        .post(UPLOAD_URL)
        .header("Authorization", &auth)
        .header("Cookie", &cookie)
        .header("Origin", ORIGIN)
        .header("X-Origin", ORIGIN)
        .header("X-Goog-AuthUser", "0")
        .header("X-Goog-Upload-Protocol", "resumable")
        .header("X-Goog-Upload-Command", "start")
        .header("X-Goog-Upload-Header-Content-Length", bytes.len().to_string())
        .header("X-Goog-Upload-Header-Content-Type", &mime)
        .header(
            "Content-Type",
            "application/x-www-form-urlencoded;charset=utf-8",
        )
        .body(start_body)
        .send()
        .await
        .map_err(|e| format!("Could not start the upload: {e}"))?;
    let start_status = start.status();
    let session_url = start
        .headers()
        .get("x-goog-upload-url")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_string());
    let start_body = start.text().await.unwrap_or_default();
    let session_url = session_url.ok_or_else(|| {
        format!(
            "Upload was not accepted ({start_status}). {}",
            start_body.chars().take(200).collect::<String>()
        )
    })?;

    // Step 2: send the bytes and finalize; the response carries the blob id.
    let finish = client()
        .post(session_url)
        .header("Authorization", &auth)
        .header("Cookie", &cookie)
        .header("Origin", ORIGIN)
        .header("X-Origin", ORIGIN)
        .header("X-Goog-AuthUser", "0")
        .header("X-Goog-Upload-Command", "upload, finalize")
        .header("X-Goog-Upload-Offset", "0")
        .header("Content-Type", "application/octet-stream")
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("Could not upload the image: {e}"))?;
    let finish_status = finish.status();
    let body = finish.text().await.map_err(|e| e.to_string())?;
    let json: Value = serde_json::from_str(&body).map_err(|_| {
        format!(
            "Unexpected upload response ({finish_status}): {}",
            body.chars().take(200).collect::<String>()
        )
    })?;
    json.get("encryptedBlobId")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string())
        .ok_or_else(|| format!("The upload did not return an image id ({finish_status})."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_sapisid_from_cookie() {
        let cookie = "SID=abc; SAPISID=xyz; __Secure-3PAPISID=sec";
        assert_eq!(sapisid_from_cookie(cookie).as_deref(), Some("sec"));
        assert_eq!(sapisid_from_cookie("SID=a; SAPISID=xyz").as_deref(), Some("xyz"));
        assert_eq!(sapisid_from_cookie("SID=a"), None);
    }

    #[test]
    fn authorization_matches_spec_shape() {
        let auth = authorization("abc", 1700000000);
        assert!(auth.starts_with("SAPISIDHASH 1700000000_"));
        assert_eq!(auth.len(), "SAPISIDHASH 1700000000_".len() + 40);
    }
}
