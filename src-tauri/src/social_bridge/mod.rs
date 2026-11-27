use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

const DEFAULT_SOCIAL_MCP_URL: &str = "http://127.0.0.1:49157/mcp";
const REQUEST_TIMEOUT_SECS: u64 = 3;
const USER_AGENT: &str = "AffeXDesk";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SocialAccountSummary {
    pub id: i64,
    pub platform: String,
    pub display_name: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SocialBridgeSnapshot {
    pub connected: bool,
    pub endpoint: String,
    pub app_version: Option<String>,
    pub accounts: Vec<SocialAccountSummary>,
    pub scheduled_count: usize,
    pub pending_review_count: usize,
    pub failed_count: usize,
    pub published_count: usize,
    pub error: Option<String>,
}

impl SocialBridgeSnapshot {
    fn disconnected(endpoint: String, error: String) -> Self {
        Self {
            connected: false,
            endpoint,
            app_version: None,
            accounts: Vec::new(),
            scheduled_count: 0,
            pending_review_count: 0,
            failed_count: 0,
            published_count: 0,
            error: Some(error),
        }
    }
}

fn resolve_endpoint(settings: &HashMap<String, String>) -> String {
    settings
        .get("social_mcp_url")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_SOCIAL_MCP_URL)
        .to_string()
}

fn resolve_token_path(settings: &HashMap<String, String>) -> Option<PathBuf> {
    if let Some(custom) = settings
        .get("social_mcp_token_path")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        return Some(PathBuf::from(custom));
    }

    dirs::home_dir().map(|home| home.join(".config").join("sosyal-merkez").join("mcp.token"))
}

fn read_mcp_token(settings: &HashMap<String, String>) -> Result<String, String> {
    let path = resolve_token_path(settings)
        .ok_or_else(|| "Could not determine home directory for Sosyal Merkez MCP token".to_string())?;

    let raw = fs::read_to_string(&path).map_err(|e| {
        format!(
            "Sosyal Merkez MCP token file could not be read ({}): {e}",
            path.display()
        )
    })?;

    let token = raw.trim().to_string();
    if token.is_empty() {
        return Err(format!(
            "Sosyal Merkez MCP token file is empty ({})",
            path.display()
        ));
    }

    Ok(token)
}

/// Parses a JSON-RPC 2.0 `tools/call` response from Sosyal Merkez MCP.
/// Supports standard MCP `result.content[0].text` (JSON-encoded string) as well
/// as direct structured JSON in `result`.
pub fn parse_mcp_tool_response(response: &Value) -> Result<Value, String> {
    if let Some(err) = response.get("error") {
        let message = err
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown JSON-RPC error");
        let code = err.get("code").and_then(Value::as_i64);
        return match code {
            Some(c) => Err(format!("MCP error ({c}): {message}")),
            None => Err(format!("MCP error: {message}")),
        };
    }

    let result = response
        .get("result")
        .ok_or_else(|| "MCP response missing 'result' field".to_string())?;

    let is_error = result
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    if let Some(content) = result.get("content").and_then(Value::as_array) {
        let text = content
            .iter()
            .find_map(|item| item.get("text").and_then(Value::as_str))
            .ok_or_else(|| "MCP tool result missing text content".to_string())?;

        if is_error {
            return Err(format!("MCP tool error: {text}"));
        }

        return serde_json::from_str::<Value>(text)
            .map_err(|e| format!("Failed to parse MCP tool payload JSON: {e}"));
    }

    if is_error {
        return Err("MCP tool returned isError=true".to_string());
    }

    Ok(result.clone())
}

fn parse_accounts(value: &Value) -> Vec<SocialAccountSummary> {
    let Some(items) = value.as_array() else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| {
            let id = item.get("id").and_then(Value::as_i64)?;
            let platform = item
                .get("platform")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            let display_name = item
                .get("display_name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let status = item
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();

            Some(SocialAccountSummary {
                id,
                platform,
                display_name,
                status,
            })
        })
        .collect()
}

#[derive(Debug, Default, PartialEq, Eq)]
struct PostStatusCounts {
    scheduled: usize,
    pending_review: usize,
    failed: usize,
    published: usize,
}

fn count_post_statuses(value: &Value) -> PostStatusCounts {
    let mut counts = PostStatusCounts::default();
    let Some(items) = value.as_array() else {
        return counts;
    };

    for item in items {
        let status = item
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match status {
            "scheduled" => counts.scheduled += 1,
            "pending_review" => counts.pending_review += 1,
            "failed" => counts.failed += 1,
            "published" => counts.published += 1,
            _ => {}
        }
    }

    counts
}

async fn call_mcp_tool(
    client: &reqwest::Client,
    endpoint: &str,
    token: &str,
    request_id: u64,
    tool_name: &str,
) -> Result<Value, String> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": {}
        }
    });

    let resp = client
        .post(endpoint)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Sosyal Merkez MCP at {endpoint}: {e}"))?;

    let status = resp.status();
    if status.as_u16() == 401 {
        return Err("Unauthorized: Sosyal Merkez MCP rejected the bearer token".to_string());
    }
    if !status.is_success() {
        return Err(format!(
            "Sosyal Merkez MCP returned HTTP {}",
            status.as_u16()
        ));
    }

    let raw: Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid JSON response from Sosyal Merkez MCP: {e}"))?;

    parse_mcp_tool_response(&raw)
}

pub async fn fetch_social_snapshot(settings: &HashMap<String, String>) -> SocialBridgeSnapshot {
    let endpoint = resolve_endpoint(settings);

    if !(endpoint.starts_with("http://") || endpoint.starts_with("https://"))
        || endpoint.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return SocialBridgeSnapshot::disconnected(
            endpoint,
            "Invalid social_mcp_url: must start with http:// or https://".to_string(),
        );
    }

    let token = match read_mcp_token(settings) {
        Ok(t) => t,
        Err(err) => return SocialBridgeSnapshot::disconnected(endpoint, err),
    };

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent(USER_AGENT)
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return SocialBridgeSnapshot::disconnected(
                endpoint,
                format!("Failed to initialize HTTP client: {e}"),
            );
        }
    };

    let status_payload = match call_mcp_tool(&client, &endpoint, &token, 1, "get_status").await {
        Ok(val) => val,
        Err(err) => return SocialBridgeSnapshot::disconnected(endpoint, err),
    };

    let app_version = status_payload
        .get("app_version")
        .and_then(Value::as_str)
        .map(str::to_string);

    let mut partial_errors: Vec<String> = Vec::new();

    let accounts = match call_mcp_tool(&client, &endpoint, &token, 2, "list_accounts").await {
        Ok(val) => parse_accounts(&val),
        Err(err) => {
            partial_errors.push(format!("list_accounts: {err}"));
            Vec::new()
        }
    };

    let counts = match call_mcp_tool(&client, &endpoint, &token, 3, "list_posts").await {
        Ok(val) => count_post_statuses(&val),
        Err(err) => {
            partial_errors.push(format!("list_posts: {err}"));
            PostStatusCounts::default()
        }
    };

    let error = if partial_errors.is_empty() {
        None
    } else {
        Some(partial_errors.join("; "))
    };

    SocialBridgeSnapshot {
        connected: true,
        endpoint,
        app_version,
        accounts,
        scheduled_count: counts.scheduled,
        pending_review_count: counts.pending_review,
        failed_count: counts.failed,
        published_count: counts.published,
        error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn write_temp_token(label: &str, token: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "affexdesk_social_bridge_{label}_{}_{}.token",
            std::process::id(),
            nanos
        ));
        fs::write(&path, token).expect("write temp token");
        path
    }

    #[tokio::test]
    async fn test_offline_endpoint_returns_clean_disconnected_snapshot() {
        // Bind then drop to obtain an unused local port.
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind ephemeral port");
        let port = listener.local_addr().expect("local addr").port();
        drop(listener);

        let token_path = write_temp_token("offline", "test-secret-token");
        let endpoint = format!("http://127.0.0.1:{port}/mcp");

        let mut settings = HashMap::new();
        settings.insert("social_mcp_url".to_string(), endpoint.clone());
        settings.insert(
            "social_mcp_token_path".to_string(),
            token_path.to_string_lossy().to_string(),
        );

        let snapshot = fetch_social_snapshot(&settings).await;
        assert!(!snapshot.connected);
        assert_eq!(snapshot.endpoint, endpoint);
        assert!(snapshot.error.is_some());
        assert!(snapshot.accounts.is_empty());
        assert_eq!(snapshot.scheduled_count, 0);

        let _ = fs::remove_file(&token_path);
    }

    #[tokio::test]
    async fn test_missing_token_file_returns_clean_disconnected_snapshot() {
        let mut settings = HashMap::new();
        settings.insert(
            "social_mcp_token_path".to_string(),
            "/nonexistent/affexdesk-test-mcp.token".to_string(),
        );

        let snapshot = fetch_social_snapshot(&settings).await;
        assert!(!snapshot.connected);
        assert_eq!(snapshot.endpoint, DEFAULT_SOCIAL_MCP_URL);
        assert!(snapshot.error.is_some());
    }

    #[test]
    fn test_parse_mcp_jsonrpc_responses() {
        let status_rpc = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "content": [{
                    "type": "text",
                    "text": "{\"app_version\":\"0.4.2\",\"queue_depth\":3}"
                }],
                "isError": false
            }
        });
        let status_val = parse_mcp_tool_response(&status_rpc).expect("parse status");
        assert_eq!(status_val["app_version"], "0.4.2");

        let accounts_rpc = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "result": {
                "content": [{
                    "type": "text",
                    "text": "[{\"id\":1,\"platform\":\"youtube\",\"display_name\":\"Ledger Files\",\"status\":\"connected\"}]"
                }],
                "isError": false
            }
        });
        let accounts_val = parse_mcp_tool_response(&accounts_rpc).expect("parse accounts");
        let accounts = parse_accounts(&accounts_val);
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].platform, "youtube");
        assert_eq!(accounts[0].display_name, "Ledger Files");

        let posts_rpc = json!({
            "jsonrpc": "2.0",
            "id": 3,
            "result": {
                "content": [{
                    "type": "text",
                    "text": "[{\"status\":\"scheduled\"},{\"status\":\"scheduled\"},{\"status\":\"pending_review\"},{\"status\":\"failed\"},{\"status\":\"published\"}]"
                }],
                "isError": false
            }
        });
        let posts_val = parse_mcp_tool_response(&posts_rpc).expect("parse posts");
        let counts = count_post_statuses(&posts_val);
        assert_eq!(counts.scheduled, 2);
        assert_eq!(counts.pending_review, 1);
        assert_eq!(counts.failed, 1);
        assert_eq!(counts.published, 1);

        let err_rpc = json!({
            "jsonrpc": "2.0",
            "id": 4,
            "error": { "code": -32601, "message": "method_not_found" }
        });
        assert!(parse_mcp_tool_response(&err_rpc).is_err());

        let tool_err_rpc = json!({
            "jsonrpc": "2.0",
            "id": 5,
            "result": {
                "content": [{ "type": "text", "text": "unknown_tool" }],
                "isError": true
            }
        });
        assert!(parse_mcp_tool_response(&tool_err_rpc).is_err());
    }

    #[tokio::test]
    async fn test_fetch_social_snapshot_against_mock_mcp_server() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock server");
        let addr = listener.local_addr().expect("mock addr");

        tokio::spawn(async move {
            for _ in 0..3 {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let payload = if req.contains("\"get_status\"") {
                        json!({
                            "jsonrpc": "2.0",
                            "id": 1,
                            "result": {
                                "content": [{
                                    "type": "text",
                                    "text": "{\"app_version\":\"1.2.3\"}"
                                }],
                                "isError": false
                            }
                        })
                    } else if req.contains("\"list_accounts\"") {
                        json!({
                            "jsonrpc": "2.0",
                            "id": 2,
                            "result": {
                                "content": [{
                                    "type": "text",
                                    "text": "[{\"id\":7,\"platform\":\"x\",\"display_name\":\"@affex\",\"status\":\"active\"}]"
                                }],
                                "isError": false
                            }
                        })
                    } else {
                        json!({
                            "jsonrpc": "2.0",
                            "id": 3,
                            "result": {
                                "content": [{
                                    "type": "text",
                                    "text": "[{\"status\":\"scheduled\"},{\"status\":\"published\"},{\"status\":\"failed\"}]"
                                }],
                                "isError": false
                            }
                        })
                    };
                    let body = payload.to_string();
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                    let _ = stream.shutdown().await;
                });
            }
        });

        let token_path = write_temp_token("mock", "valid-token-123");
        let endpoint = format!("http://{addr}/mcp");
        let mut settings = HashMap::new();
        settings.insert("social_mcp_url".to_string(), endpoint.clone());
        settings.insert(
            "social_mcp_token_path".to_string(),
            token_path.to_string_lossy().to_string(),
        );

        let snapshot = fetch_social_snapshot(&settings).await;
        assert!(snapshot.connected);
        assert_eq!(snapshot.endpoint, endpoint);
        assert_eq!(snapshot.app_version.as_deref(), Some("1.2.3"));
        assert_eq!(snapshot.accounts.len(), 1);
        assert_eq!(snapshot.accounts[0].id, 7);
        assert_eq!(snapshot.scheduled_count, 1);
        assert_eq!(snapshot.pending_review_count, 0);
        assert_eq!(snapshot.failed_count, 1);
        assert_eq!(snapshot.published_count, 1);
        assert_eq!(snapshot.error, None);

        let _ = fs::remove_file(&token_path);
    }
}
