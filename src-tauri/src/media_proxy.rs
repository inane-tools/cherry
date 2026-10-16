//! Binary, range-aware relay for DASH media. Googlevideo streams can play in a
//! <video> while refusing JavaScript's CORS requests. Keep the bytes native;
//! never send media through the text API relay or base64 IPC.
use std::sync::OnceLock;
use tauri::http::{Request, Response};

const MAX_BYTES: usize = 32 * 1024 * 1024;

fn media_host(host: &str) -> bool {
    host == "googlevideo.com" || host.ends_with(".googlevideo.com")
}

fn source_url(request: &Request<Vec<u8>>) -> Result<url::Url, String> {
    if request.method() != "GET" {
        return Err("Only GET media requests are supported".into());
    }
    let raw = url::form_urlencoded::parse(request.uri().query().unwrap_or_default().as_bytes())
        .find(|(key, _)| key == "url")
        .map(|(_, value)| value.into_owned())
        .ok_or("Missing media URL")?;
    let url = url::Url::parse(&raw).map_err(|_| "Invalid media URL")?;
    if url.scheme() != "https" || !url.host_str().is_some_and(media_host)
        || !url.username().is_empty() || url.password().is_some() || url.port_or_known_default() != Some(443)
    {
        return Err("Refused media URL".into());
    }
    Ok(url)
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.url().scheme() != "https" || !attempt.url().host_str().is_some_and(media_host) {
                attempt.error("Refused media redirect")
            } else if attempt.previous().len() >= 5 {
                attempt.error("Too many media redirects")
            } else { attempt.follow() }
        }))
        .build().expect("media HTTP client"))
}

async fn fetch(request: Request<Vec<u8>>) -> Result<Response<Vec<u8>>, String> {
    let url = source_url(&request)?;
    let mut outgoing = client().get(url);
    if let Some(range) = request.headers().get("range") {
        outgoing = outgoing.header("range", range);
    }
    let mut response = outgoing.send().await.map_err(|e| e.to_string())?;
    let mut result = Response::builder().status(response.status().as_u16())
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
        .header("Cache-Control", "no-store");
    for name in ["content-type", "content-range", "accept-ranges"] {
        if let Some(value) = response.headers().get(name) { result = result.header(name, value); }
    }
    if response.content_length().is_some_and(|length| length > MAX_BYTES as u64) {
        return Err("Media request exceeded the byte limit".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > MAX_BYTES { return Err("Media request exceeded the byte limit".into()); }
        bytes.extend_from_slice(&chunk);
    }
    result.header("Content-Length", bytes.len()).body(bytes).map_err(|e| e.to_string())
}

pub async fn respond(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    // Chromium may preflight range requests on the custom HTTP scheme.
    if request.method() == "OPTIONS" {
        return Response::builder().status(204)
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Methods", "GET, OPTIONS")
            .header("Access-Control-Allow-Headers", "Range")
            .body(Vec::new()).unwrap();
    }
    fetch(request).await.unwrap_or_else(|error| Response::builder().status(502)
        .header("Access-Control-Allow-Origin", "*")
        .body(error.into_bytes()).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(source: &str) -> Request<Vec<u8>> {
        let mut url = url::Url::parse("http://cherry-media.localhost/stream").unwrap();
        url.query_pairs_mut().append_pair("url", source);
        Request::builder().uri(url.as_str()).body(Vec::new()).unwrap()
    }
    #[test]
    fn accepts_only_https_media_cdn_urls() {
        assert!(source_url(&request("https://rr1---sn-test.googlevideo.com/videoplayback?sig=a%2Bb&n=c")).is_ok());
        for url in ["http://rr1.googlevideo.com/video", "https://googlevideo.com.evil.test/video",
            "https://localhost/video", "file:///etc/passwd", "https://user:secret@rr1.googlevideo.com/video",
            "https://rr1.googlevideo.com:8080/video"] {
            assert!(source_url(&request(url)).is_err(), "{url}");
        }
    }
    #[test]
    fn preserves_signed_url_queries_exactly() {
        let source = "https://rr1.googlevideo.com/video?sig=a%2Bb&n=x+y&range=0-1023";
        assert_eq!(source_url(&request(source)).unwrap().as_str(), source);
    }
    #[tokio::test]
    async fn handles_range_preflight_without_fetching() {
        let response = respond(Request::builder().method("OPTIONS").body(Vec::new()).unwrap()).await;
        assert_eq!(response.status(), 204);
        assert_eq!(response.headers()["access-control-allow-headers"], "Range");
    }
    #[tokio::test]
    #[ignore = "requires a current public media URL in CHERRY_TEST_MEDIA_URL"]
    async fn relays_live_binary_range() {
        let source = std::env::var("CHERRY_TEST_MEDIA_URL").expect("current public media URL");
        let mut request = request(&source);
        request.headers_mut().insert("range", "bytes=0-1023".parse().unwrap());
        let response = respond(request).await;
        assert_eq!(response.status(), 206);
        assert_eq!(response.body().len(), 1024);
        assert!(response.headers().contains_key("content-range"));
        assert_eq!(response.headers()["access-control-allow-origin"], "*");
    }
}
