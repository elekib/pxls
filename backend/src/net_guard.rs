//! SSRF guard for fetching images from URLs that arrive in webhook payloads.
//!
//! Only http/https is allowed. Every address the host resolves to must be public
//! unless `PXLS_ALLOW_PRIVATE_URLS=true`. Redirects are followed manually so each
//! hop is checked, and the connection is pinned to the address that was checked
//! (no DNS rebinding between check and connect).

use reqwest::{redirect::Policy, Url};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;

pub const ALLOW_PRIVATE_ENV: &str = "PXLS_ALLOW_PRIVATE_URLS";
pub const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_REDIRECTS: usize = 3;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

pub fn allow_private_from_env() -> bool {
    matches!(
        std::env::var(ALLOW_PRIVATE_ENV)
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes"
    )
}

fn blocked_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local() // includes cloud metadata 169.254.169.254
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        || o[0] == 0
        || (o[0] == 100 && (o[1] & 0xc0) == 64) // 100.64.0.0/10 carrier-grade NAT
        || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0.0/24
        || o[0] >= 240 // reserved
}

/// True for loopback, private, link-local, multicast and other non-public addresses.
pub fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => blocked_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return blocked_v4(mapped);
            }
            let first = v6.segments()[0];
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (first & 0xfe00) == 0xfc00 // unique local fc00::/7
                || (first & 0xffc0) == 0xfe80 // link-local fe80::/10
        }
    }
}

/// Parse and sanity-check a URL: http/https only, a host, no embedded credentials.
pub fn validate_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "Invalid URL".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Only http and https URLs are allowed".to_string());
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err("URL has no host".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URLs with embedded credentials are not allowed".to_string());
    }
    Ok(url)
}

/// Check where the URL points. Returns the (host, address) to pin the connection to,
/// or `None` for an IP-literal host that needs no pinning.
async fn resolve_checked(
    url: &Url,
    allow_private: bool,
) -> Result<Option<(String, SocketAddr)>, String> {
    let host = url.host_str().ok_or("URL has no host")?;
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    let port = url.port_or_known_default().ok_or("URL has no port")?;

    if let Ok(ip) = bare.parse::<IpAddr>() {
        if !allow_private && is_blocked_ip(ip) {
            return Err("Address is not allowed (private or reserved range)".to_string());
        }
        return Ok(None);
    }

    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((bare, port))
        .await
        .map_err(|_| "Could not resolve host".to_string())?
        .collect();
    let first = *addrs.first().ok_or("Could not resolve host")?;
    if !allow_private && addrs.iter().any(|a| is_blocked_ip(a.ip())) {
        return Err("Host resolves to a private or reserved address".to_string());
    }
    Ok(Some((bare.to_string(), first)))
}

/// Download an image body from `url` with the SSRF checks applied.
pub async fn fetch_image_bytes(url: &str, allow_private: bool) -> Result<Vec<u8>, String> {
    let mut current = validate_url(url)?;
    for _ in 0..=MAX_REDIRECTS {
        let pin = resolve_checked(&current, allow_private).await?;

        let mut builder = reqwest::Client::builder()
            .redirect(Policy::none())
            .timeout(REQUEST_TIMEOUT)
            .user_agent("pxls");
        if let Some((host, addr)) = pin {
            builder = builder.resolve(&host, addr);
        }
        let client = builder
            .build()
            .map_err(|e| format!("HTTP client error: {}", e))?;

        let mut resp = client
            .get(current.clone())
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e.without_url()))?;

        if resp.status().is_redirection() {
            let location = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("Redirect without Location header")?
                .to_string();
            let next = current
                .join(&location)
                .map_err(|_| "Invalid redirect target".to_string())?;
            current = validate_url(next.as_str())?;
            continue;
        }
        if !resp.status().is_success() {
            return Err(format!("Server returned {}", resp.status()));
        }
        if resp
            .content_length()
            .is_some_and(|len| len > MAX_IMAGE_BYTES as u64)
        {
            return Err("Image is too large".to_string());
        }

        let mut data: Vec<u8> = Vec::new();
        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| format!("Read failed: {}", e.without_url()))?
        {
            if data.len() + chunk.len() > MAX_IMAGE_BYTES {
                return Err("Image is too large".to_string());
            }
            data.extend_from_slice(&chunk);
        }
        return Ok(data);
    }
    Err("Too many redirects".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn blocks_non_public_addresses() {
        for s in [
            "127.0.0.1",
            "127.1.2.3",
            "10.0.0.1",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",
            "0.0.0.0",
            "255.255.255.255",
            "224.0.0.1",
            "100.64.0.1",
            "100.127.255.255",
            "192.0.0.1",
            "240.0.0.1",
            "0.1.2.3",
            "::1",
            "::",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "ff02::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "::ffff:169.254.169.254",
        ] {
            assert!(is_blocked_ip(ip(s)), "{} should be blocked", s);
        }
    }

    #[test]
    fn allows_public_addresses() {
        for s in [
            "8.8.8.8",
            "1.1.1.1",
            "93.184.216.34",
            "172.32.0.1",
            "100.128.0.1",
            "2606:4700:4700::1111",
            "::ffff:8.8.8.8",
        ] {
            assert!(!is_blocked_ip(ip(s)), "{} should be allowed", s);
        }
    }

    #[test]
    fn url_validation() {
        assert!(validate_url("https://image.tmdb.org/t/p/w300/x.jpg").is_ok());
        assert!(validate_url("http://example.com:8080/a.png").is_ok());
        for bad in [
            "file:///etc/passwd",
            "ftp://example.com/a.png",
            "gopher://x",
            "data:text/plain,hi",
            "javascript:alert(1)",
            "http://",
            "not a url",
            "",
            "http://user:pass@example.com/",
            "http://user@example.com/",
        ] {
            assert!(validate_url(bad).is_err(), "should reject {:?}", bad);
        }
    }

    #[tokio::test]
    async fn rejects_private_targets_by_default() {
        for u in [
            "http://127.0.0.1/a.png",
            "http://localhost/a.png",
            "http://[::1]/a.png",
            "http://169.254.169.254/latest/meta-data/",
            "http://192.168.1.10:8096/Items/1/Images/Primary",
            "http://0.0.0.0:3400/api/config",
            "http://2130706433/", // decimal form of 127.0.0.1
            "http://0x7f.0.0.1/", // hex form
        ] {
            let err = fetch_image_bytes(u, false).await.unwrap_err();
            assert!(!err.is_empty(), "{} should fail", u);
            assert!(
                err.contains("not allowed") || err.contains("private") || err.contains("resolve"),
                "{} failed for the wrong reason: {}",
                u,
                err
            );
        }
    }

    #[tokio::test]
    async fn non_http_schemes_are_rejected_before_any_request() {
        assert!(fetch_image_bytes("file:///etc/passwd", true).await.is_err());
    }

    #[tokio::test]
    async fn private_targets_pass_the_guard_when_allowed() {
        // Nothing listens on this port, so the request fails, but not at the guard.
        let err = fetch_image_bytes("http://127.0.0.1:9/a.png", true)
            .await
            .unwrap_err();
        assert!(
            !err.contains("not allowed"),
            "guard should be bypassed: {}",
            err
        );
    }
}
