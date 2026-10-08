//! CORS-free HTTP relay for the YouTube Music API.
//!
//! Why this exists: the frontend runs in a WebView2 webview, where `fetch`
//! to googleapis.com / youtube.com is blocked by CORS. youtubei.js accepts
//! an injected `fetch` implementation, so all of its traffic (session,
//! player JS, Innertube API, OAuth) flows through this command, which uses
//! reqwest — no origin checks server-side.
//!
//! Only http(s) to Google / YouTube hosts is allowed (`allowed_host`): the
//! relay ignores CORS by design, so without a host allowlist any script that
//! ran in the webview could use it to reach `localhost` or the LAN. No cookie
//! jar: auth travels in explicit headers, so there is nothing to leak between
//! requests.

use std::collections::HashMap;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        // Redirects are re-checked against the allowlist, otherwise an allowed
        // URL could bounce the request to a refused host.
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let allowed = attempt.url().host_str().is_some_and(allowed_host);
            if !allowed {
                attempt.error("redirect to a refused host")
            } else if attempt.previous().len() >= 10 {
                attempt.error("too many redirects")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .expect("reqwest client")
}

/// Hosts that need a browser-style `Origin` header.
///
/// youtubei.js only sets `Origin` on its "server" shim; the browser shim (used
/// inside the webview) omits it. Verified live: without `Origin`,
/// `accounts_list` returns a 1.8 KB context-only body with **no** account
/// entries (0 channels), while with it the same request returns 15 KB and all
/// channels. Adding a User-Agent alone does not help.
fn needs_origin(host: &str) -> bool {
    const SUFFIXES: [&str; 6] = [
        "youtube.com",
        "google.com",
        "googlevideo.com",
        "ytimg.com",
        "ggpht.com",
        "googleapis.com",
    ];
    SUFFIXES.iter().any(|s| host == *s || host.ends_with(&format!(".{s}")))
}

/// Hosts the relay will talk to: everything youtubei.js and the artwork
/// fetcher need (YouTube, Google auth/APIs, the video and image CDNs) and
/// nothing else.
fn allowed_host(host: &str) -> bool {
    const SUFFIXES: [&str; 9] = [
        "youtube.com",
        "youtu.be",
        "google.com",
        "googleapis.com",
        "googlevideo.com",
        "googleusercontent.com",
        "gstatic.com",
        "ytimg.com",
        "ggpht.com",
    ];
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    SUFFIXES.iter().any(|s| host == *s || host.ends_with(&format!(".{s}")))
}

/// Parse and vet a URL for the relay: http(s) only, allowlisted hosts only.
fn checked_url(raw: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(raw).map_err(|e| e.to_string())?;
    match url.scheme() {
        "http" | "https" => {}
        other => return Err(format!("refused scheme: {other}")),
    }
    let host = url.host_str().unwrap_or_default();
    if !allowed_host(host) {
        return Err(format!("refused host: {host}"));
    }
    Ok(url)
}

pub async fn proxy_fetch(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<ProxyResponse, String> {
    let url = checked_url(&url)?;
    let mut req = client().request(
        reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?,
        url.clone(),
    );
    let mut has_origin = false;
    for (name, value) in &headers {
        // Managed by reqwest itself; forwarding them breaks routing/framing.
        match name.to_lowercase().as_str() {
            "host" | "content-length" | "connection" | "transfer-encoding" | "upgrade" => continue,
            "origin" => has_origin = true,
            _ => {}
        }
        req = req.header(name, value);
    }
    let host = url.host_str().unwrap_or_default();
    if !has_origin && needs_origin(host) {
        let origin = format!("{}://{}", url.scheme(), host);
        req = req.header("Origin", origin);
    }
    if let Some(body) = body {
        req = req.body(body);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let mut out_headers = HashMap::new();
    for (name, value) in resp.headers() {
        if let Ok(value) = value.to_str() {
            out_headers.insert(name.to_string(), value.to_string());
        }
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(ProxyResponse { status, headers: out_headers, body })
}

#[tauri::command]
pub async fn http_proxy_fetch(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<ProxyResponse, String> {
    proxy_fetch(url, method, headers, body).await
}

/// Fetch a binary resource (album artwork) and return it base64-encoded.
///
/// Used to derive the app's accent colour from the current album art. The
/// bytes are fetched here rather than in the webview so the image can be drawn
/// to a canvas without tainting it (a cross-origin image would make
/// `getImageData` throw).
#[tauri::command]
pub async fn http_proxy_fetch_base64(url: String) -> Result<String, String> {
    use base64::Engine as _;
    let parsed = checked_url(&url)?;
    let resp = client().get(parsed).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("status {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_accepts_google_hosts_only() {
        for ok in [
            "music.youtube.com",
            "youtube.com",
            "rr3---sn-abc.googlevideo.com",
            "lh3.googleusercontent.com",
            "i.ytimg.com",
            "yt3.ggpht.com",
            "accounts.google.com",
            "jnn-pa.googleapis.com",
            "WWW.YOUTUBE.COM",
            "www.youtube.com.",
        ] {
            assert!(allowed_host(ok), "{ok} should be allowed");
        }
        for bad in [
            "localhost",
            "127.0.0.1",
            "192.168.1.1",
            "evil.com",
            "youtube.com.evil.com",
            "notyoutube.com",
            "google.com-attacker.net",
            "",
        ] {
            assert!(!allowed_host(bad), "{bad} should be refused");
        }
    }

    #[test]
    fn checked_url_refuses_bad_scheme_and_host() {
        assert!(checked_url("https://music.youtube.com/youtubei/v1/browse").is_ok());
        assert!(checked_url("file:///etc/passwd").unwrap_err().contains("refused scheme"));
        assert!(checked_url("http://127.0.0.1:8080/").unwrap_err().contains("refused host"));
        assert!(checked_url("http://[::1]/").unwrap_err().contains("refused host"));
        assert!(checked_url("https://youtube.com@evil.com/").unwrap_err().contains("refused host"));
    }

    #[tokio::test]
    async fn refuses_loopback_without_connecting() {
        let err = proxy_fetch("http://127.0.0.1:1/".into(), "GET".into(), HashMap::new(), None)
            .await
            .expect_err("loopback must be refused");
        assert!(err.contains("refused host"));
    }

    /// Needs network access to music.youtube.com.
    #[tokio::test]
    #[ignore = "network"]
    async fn proxies_https_get() {
        let res = proxy_fetch(
            "https://music.youtube.com/".to_string(),
            "GET".to_string(),
            HashMap::new(),
            None,
        )
        .await
        .expect("proxy GET");
        assert_eq!(res.status, 200);
        assert!(res.body.len() > 10_000, "unexpectedly small body");
    }

    #[tokio::test]
    async fn refuses_non_http_scheme() {
        let err = proxy_fetch(
            "file:///etc/passwd".to_string(),
            "GET".to_string(),
            HashMap::new(),
            None,
        )
        .await
        .expect_err("file scheme must be refused");
        assert!(err.contains("refused scheme"));
    }

    /// The album-art theming path depends on this: real image bytes, base64
    /// encoded, with the JPEG magic number intact. Needs network access.
    #[tokio::test]
    #[ignore = "network"]
    async fn fetches_image_bytes_as_base64() {
        use base64::Engine as _;
        let encoded = http_proxy_fetch_base64("https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg".into())
            .await
            .expect("fetch artwork");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("valid base64");
        assert!(bytes.len() > 500, "suspiciously small image: {} bytes", bytes.len());
        assert_eq!(&bytes[0..2], &[0xFF, 0xD8], "expected a JPEG");
        assert!(http_proxy_fetch_base64("file:///etc/passwd".into()).await.is_err());
    }
}
