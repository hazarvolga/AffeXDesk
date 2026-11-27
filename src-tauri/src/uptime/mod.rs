use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tokio::task::JoinSet;

const REQUEST_TIMEOUT_SECS: u64 = 5;
const DEGRADED_LATENCY_MS: u64 = 2_500;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UptimeResult {
    pub project_path: String,
    pub url: String,
    pub status_code: Option<u16>,
    pub latency_ms: u64,
    pub state: String,
}

/// Checks multiple project URLs in parallel with a 5-second timeout.
/// Each tuple in `targets` is `(project_path, url)`.
pub async fn check_urls(targets: Vec<(String, String)>) -> Vec<UptimeResult> {
    if targets.is_empty() {
        return Vec::new();
    }

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("AffeXDesk-Uptime/0.1")
        .build()
    {
        Ok(c) => c,
        Err(_) => {
            return targets
                .into_iter()
                .map(|(project_path, url)| UptimeResult {
                    project_path,
                    url,
                    status_code: None,
                    latency_ms: 0,
                    state: "down".to_string(),
                })
                .collect();
        }
    };

    let mut join_set = JoinSet::new();
    let total = targets.len();

    for (idx, (project_path, url)) in targets.into_iter().enumerate() {
        let client = client.clone();
        join_set.spawn(async move {
            let res = check_single_url(&client, project_path, url).await;
            (idx, res)
        });
    }

    let mut ordered: Vec<Option<UptimeResult>> = vec![None; total];
    while let Some(joined) = join_set.join_next().await {
        if let Ok((idx, res)) = joined {
            if idx < ordered.len() {
                ordered[idx] = Some(res);
            }
        }
    }

    ordered.into_iter().flatten().collect()
}

fn is_valid_http_url(url: &str) -> bool {
    let trimmed = url.trim();
    (trimmed.starts_with("https://") || trimmed.starts_with("http://"))
        && !trimmed.chars().any(|c| c.is_whitespace() || c.is_control())
}

async fn check_single_url(
    client: &reqwest::Client,
    project_path: String,
    url: String,
) -> UptimeResult {
    let trimmed = url.trim().to_string();
    if !is_valid_http_url(&trimmed) {
        return UptimeResult {
            project_path,
            url,
            status_code: None,
            latency_ms: 0,
            state: "down".to_string(),
        };
    }

    let started = Instant::now();
    match client.get(&trimmed).send().await {
        Ok(resp) => {
            let latency_ms = started.elapsed().as_millis() as u64;
            let code = resp.status().as_u16();
            let state = classify_status(code, latency_ms);
            UptimeResult {
                project_path,
                url: trimmed,
                status_code: Some(code),
                latency_ms,
                state: state.to_string(),
            }
        }
        Err(_) => {
            let latency_ms = started.elapsed().as_millis() as u64;
            UptimeResult {
                project_path,
                url: trimmed,
                status_code: None,
                latency_ms,
                state: "down".to_string(),
            }
        }
    }
}

fn classify_status(code: u16, latency_ms: u64) -> &'static str {
    match code {
        200..=399 => {
            if latency_ms >= DEGRADED_LATENCY_MS {
                "degraded"
            } else {
                "online"
            }
        }
        400..=499 => "degraded",
        _ => "down",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    async fn spawn_mock_http_server() -> String {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind local mock listener");
        let addr = listener.local_addr().expect("listener local addr");

        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    let mut buf = [0u8; 1024];
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let first_line = req.lines().next().unwrap_or("");
                    let response = if first_line.contains("GET /ok ") {
                        "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK"
                    } else if first_line.contains("GET /fail ") {
                        "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 5\r\nConnection: close\r\n\r\nERROR"
                    } else {
                        "HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nNOT FOUND"
                    };
                    let _ = stream.write_all(response.as_bytes()).await;
                    let _ = stream.shutdown().await;
                });
            }
        });

        format!("http://{}", addr)
    }

    #[tokio::test]
    async fn test_check_urls_online_down_and_invalid_scheme() {
        let base = spawn_mock_http_server().await;
        let targets = vec![
            ("/proj/ok".to_string(), format!("{base}/ok")),
            ("/proj/fail".to_string(), format!("{base}/fail")),
            ("/proj/bad".to_string(), "file:///etc/passwd".to_string()),
        ];

        let results = check_urls(targets).await;
        assert_eq!(results.len(), 3);

        assert_eq!(results[0].project_path, "/proj/ok");
        assert_eq!(results[0].status_code, Some(200));
        assert_eq!(results[0].state, "online");

        assert_eq!(results[1].project_path, "/proj/fail");
        assert_eq!(results[1].status_code, Some(500));
        assert_eq!(results[1].state, "down");

        assert_eq!(results[2].project_path, "/proj/bad");
        assert_eq!(results[2].status_code, None);
        assert_eq!(results[2].state, "down");
    }
}
