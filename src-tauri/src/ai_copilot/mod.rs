use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const DEFAULT_MLX_BASE_URL: &str = "http://127.0.0.1:11234/v1";
const DEFAULT_OLLAMA_BASE_URL: &str = "http://127.0.0.1:11434/v1";
const PROBE_TIMEOUT_SECS: u64 = 2;
const CHAT_TIMEOUT_SECS: u64 = 45;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiStatus {
    pub online: bool,
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub available_models: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopilotMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopilotAction {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub description: String,
    pub requires_confirmation: bool,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopilotReply {
    pub message: String,
    pub model: String,
    pub fallback: bool,
    pub actions: Vec<CopilotAction>,
}

fn normalize_base_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.ends_with("/v1") || trimmed.ends_with("/api/v1") {
        trimmed.to_string()
    } else {
        format!("{}/v1", trimmed)
    }
}

fn infer_provider_name(base_url: &str) -> String {
    let lower = base_url.to_lowercase();
    if lower.contains(":11234") || lower.contains("mlx") {
        "mlx-serve".to_string()
    } else if lower.contains(":11434") || lower.contains("ollama") {
        "ollama".to_string()
    } else {
        "custom".to_string()
    }
}

async fn probe_models(client: &Client, base_url: &str) -> Option<Vec<String>> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let response = client.get(&url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }

    let body: Value = response.json().await.ok()?;
    let mut models = Vec::new();

    if let Some(arr) = body.get("data").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                if !id.trim().is_empty() {
                    models.push(id.trim().to_string());
                }
            }
        }
    } else if let Some(arr) = body.get("models").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(name) = item
                .get("name")
                .or_else(|| item.get("model"))
                .and_then(|v| v.as_str())
            {
                if !name.trim().is_empty() {
                    models.push(name.trim().to_string());
                }
            }
        }
    }

    Some(models)
}

fn pick_model(preferred: Option<&str>, available: &[String]) -> String {
    if let Some(pref) = preferred.map(str::trim).filter(|s| !s.is_empty()) {
        return pref.to_string();
    }
    available.first().cloned().unwrap_or_default()
}

pub async fn check_ai_status(settings: &HashMap<String, String>) -> AiStatus {
    let preferred_model = settings.get("ai_model").map(String::as_str);
    let custom_base = settings
        .get("ai_base_url")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    let client = match Client::builder()
        .timeout(Duration::from_secs(PROBE_TIMEOUT_SECS))
        .build()
    {
        Ok(c) => c,
        Err(_) => {
            return AiStatus {
                online: false,
                provider: "offline".to_string(),
                base_url: custom_base
                    .map(normalize_base_url)
                    .unwrap_or_else(|| DEFAULT_MLX_BASE_URL.to_string()),
                model: preferred_model.unwrap_or_default().trim().to_string(),
                available_models: Vec::new(),
            };
        }
    };

    if let Some(raw_url) = custom_base {
        let base_url = normalize_base_url(raw_url);
        let provider = infer_provider_name(&base_url);
        if let Some(models) = probe_models(&client, &base_url).await {
            let model = pick_model(preferred_model, &models);
            return AiStatus {
                online: true,
                provider,
                base_url,
                model,
                available_models: models,
            };
        }
        return AiStatus {
            online: false,
            provider,
            base_url,
            model: preferred_model.unwrap_or_default().trim().to_string(),
            available_models: Vec::new(),
        };
    }

    if let Some(models) = probe_models(&client, DEFAULT_MLX_BASE_URL).await {
        let model = pick_model(preferred_model, &models);
        return AiStatus {
            online: true,
            provider: "mlx-serve".to_string(),
            base_url: DEFAULT_MLX_BASE_URL.to_string(),
            model,
            available_models: models,
        };
    }

    if let Some(models) = probe_models(&client, DEFAULT_OLLAMA_BASE_URL).await {
        let model = pick_model(preferred_model, &models);
        return AiStatus {
            online: true,
            provider: "ollama".to_string(),
            base_url: DEFAULT_OLLAMA_BASE_URL.to_string(),
            model,
            available_models: models,
        };
    }

    AiStatus {
        online: false,
        provider: "offline".to_string(),
        base_url: DEFAULT_MLX_BASE_URL.to_string(),
        model: preferred_model.unwrap_or_default().trim().to_string(),
        available_models: Vec::new(),
    }
}

pub fn strip_think_tags(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut remaining = input;

    while let Some(start_idx) = find_ascii_case_insensitive(remaining, "<think>") {
        result.push_str(&remaining[..start_idx]);
        let after_open = &remaining[start_idx + "<think>".len()..];
        if let Some(end_idx) = find_ascii_case_insensitive(after_open, "</think>") {
            remaining = &after_open[end_idx + "</think>".len()..];
        } else {
            remaining = "";
            break;
        }
    }

    result.push_str(remaining);
    result.trim().to_string()
}

fn find_ascii_case_insensitive(haystack: &str, needle: &str) -> Option<usize> {
    let h_bytes = haystack.as_bytes();
    let n_bytes = needle.as_bytes();
    if n_bytes.is_empty() || n_bytes.len() > h_bytes.len() {
        return None;
    }
    h_bytes
        .windows(n_bytes.len())
        .position(|w| w.eq_ignore_ascii_case(n_bytes))
}

fn normalize_tr(text: &str) -> String {
    text.replace('İ', "i")
        .replace('I', "ı")
        .to_lowercase()
}

fn contains_any(text: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|kw| text.contains(kw))
}

fn make_navigate_action(id: &str, tab: &str, label: &str, description: &str) -> CopilotAction {
    CopilotAction {
        id: id.to_string(),
        kind: "navigate".to_string(),
        label: label.to_string(),
        description: description.to_string(),
        requires_confirmation: false,
        payload: json!({ "tab": tab }),
    }
}

fn make_scan_processes_action() -> CopilotAction {
    CopilotAction {
        id: "action-scan-processes".to_string(),
        kind: "scan_processes".to_string(),
        label: "Geliştirme Süreçlerini Tara".to_string(),
        description: "Aktif ve zombi geliştirici süreçlerini (Node, Python, Rust, Docker vb.) yeniden tarar.".to_string(),
        requires_confirmation: false,
        payload: json!({}),
    }
}

fn make_scan_workspaces_action() -> CopilotAction {
    CopilotAction {
        id: "action-scan-workspaces".to_string(),
        kind: "scan_workspaces".to_string(),
        label: "Çalışma Alanlarını Tara".to_string(),
        description: "Kayıtlı çalışma alanlarındaki Git durumunu ve önbellek boyutlarını günceller.".to_string(),
        requires_confirmation: false,
        payload: json!({}),
    }
}

fn infer_actions_for_query(query: &str) -> Vec<CopilotAction> {
    let q = normalize_tr(query);
    let mut actions = Vec::new();

    if contains_any(&q, &["zombi", "zombie", "süreç", "surec", "process", "port"]) {
        actions.push(make_scan_processes_action());
        actions.push(make_navigate_action(
            "nav-processes",
            "processes",
            "Süreç Monitörünü Aç",
            "Çalışan geliştirici süreçlerini ve port kullanımını inceleyin.",
        ));
    }

    if contains_any(&q, &["ram", "bellek", "memory", "cpu", "performans"]) {
        if !actions.iter().any(|a| a.kind == "scan_processes") {
            actions.push(make_scan_processes_action());
        }
        if !actions.iter().any(|a| a.id == "nav-processes") {
            actions.push(make_navigate_action(
                "nav-processes",
                "processes",
                "Bellek Tüketen Süreçleri Gör",
                "Yüksek RAM/CPU kullanan süreçleri listeleyin.",
            ));
        }
    }

    if contains_any(
        &q,
        &[
            "disk",
            "cache",
            "önbellek",
            "onbellek",
            "temizle",
            "node_modules",
            "target",
            "proje",
            "workspace",
            "git",
            "branch",
            "commit",
        ],
    ) {
        actions.push(make_scan_workspaces_action());
        actions.push(make_navigate_action(
            "nav-workspaces",
            "workspaces",
            "Projeler ve Disk Görünümünü Aç",
            "Proje Git durumlarını ve temizlenebilir önbellekleri inceleyin.",
        ));
    }

    if contains_any(&q, &["sosyal", "social", "medya", "içerik", "icerik", "takvim"]) {
        actions.push(make_navigate_action(
            "nav-social",
            "social",
            "Sosyal Medya Paneline Git",
            "Sosyal medya içerik ve yayın akışını açın.",
        ));
    }

    if contains_any(&q, &["bilgi", "knowledge", "scrapling", "dataset", "veri", "doküman", "dokuman"]) {
        actions.push(make_navigate_action(
            "nav-knowledge",
            "knowledge",
            "Bilgi Bankasını Aç",
            "Yerel veri setlerini inceleyin ve arama yapın.",
        ));
    }

    actions
}

pub fn build_offline_fallback_reply(query: &str, live_summary: &str) -> CopilotReply {
    let q = normalize_tr(query);
    let mut actions = infer_actions_for_query(query);

    let message = if contains_any(&q, &["zombi", "zombie", "süreç", "surec", "process", "port"]) {
        "Yerel AI sunucusu şu an çevrimdışı; yerel komut çözücü devrede. Zombi veya açık kalmış geliştirici süreçlerini tespit etmek için süreç taramasını çalıştırabilir ve Süreç Monitörü sekmesine geçebilirsiniz.".to_string()
    } else if contains_any(&q, &["ram", "bellek", "memory", "cpu"]) {
        "Yerel AI sunucusu çevrimdışı; yerel komut çözücü devrede. RAM ve CPU tüketimini düşürmek için geliştirici süreçlerini tarayıp yüksek kaynak kullanan işlemleri gözden geçirebilirsiniz.".to_string()
    } else if contains_any(&q, &["disk", "cache", "önbellek", "onbellek", "temizle", "node_modules", "target"]) {
        "Yerel AI sunucusu çevrimdışı; yerel komut çözücü devrede. Disk alanı açmak için çalışma alanlarını yeniden tarayıp `node_modules`, `target` veya `.next` önbelleklerini Projeler sekmesinden güvenli biçimde temizleyebilirsiniz.".to_string()
    } else if contains_any(&q, &["git", "branch", "commit", "değişiklik", "degisiklik"]) {
        "Yerel AI sunucusu çevrimdışı; yerel komut çözücü devrede. Tüm projelerdeki Git dallarını ve commit edilmemiş değişiklikleri güncellemek için çalışma alanlarını tarayabilirsiniz.".to_string()
    } else if contains_any(&q, &["proje", "workspace", "klasör", "klasor"]) {
        "Yerel AI sunucusu çevrimdışı; yerel komut çözücü devrede. Kayıtlı çalışma alanlarındaki projeleri ve sağlık durumlarını görmek için Projeler sekmesini açabilir veya tarama başlatabilirsiniz.".to_string()
    } else if contains_any(&q, &["sosyal", "social", "medya", "içerik", "icerik"]) {
        "Yerel AI sunucusu çevrimdışı; yerel komut çözücü devrede. Sosyal medya içerik planı ve yönetim ekranına doğrudan geçebilirsiniz.".to_string()
    } else if contains_any(&q, &["bilgi", "knowledge", "scrapling", "dataset", "veri"]) {
        "Yerel AI sunucusu çevrimdışı; yerel komut çözücü devrede. Bilgi Bankası sekmesinden yapılandırılmış veri setlerini salt-okunur olarak inceleyip arama yapabilirsiniz.".to_string()
    } else {
        if actions.is_empty() {
            actions.push(make_scan_workspaces_action());
            actions.push(make_scan_processes_action());
            actions.push(make_navigate_action(
                "nav-knowledge",
                "knowledge",
                "Bilgi Bankasını Aç",
                "Yerel bilgi bankasında arama yapın.",
            ));
        }
        let summary_note = if live_summary.trim().is_empty() {
            String::new()
        } else {
            format!("\n\nAnlık özet:\n{}", live_summary.trim())
        };
        format!(
            "Yerel AI sunucusu (MLX-Serve / Ollama) çevrimdışı olduğu için yerel komut çözücü yanıt veriyor. 'ram', 'zombi', 'disk', 'proje', 'git', 'sosyal' veya 'bilgi' komutlarıyla hızlı aksiyon alabilirsiniz.{}",
            summary_note
        )
    };

    CopilotReply {
        message,
        model: "local-fallback".to_string(),
        fallback: true,
        actions,
    }
}

pub async fn ai_chat(
    messages: &[CopilotMessage],
    live_summary: &str,
    settings: &HashMap<String, String>,
) -> CopilotReply {
    let last_user_query = messages
        .iter()
        .rev()
        .find(|m| m.role.eq_ignore_ascii_case("user"))
        .map(|m| m.content.as_str())
        .unwrap_or("");

    let status = check_ai_status(settings).await;
    if !status.online || status.model.is_empty() {
        return build_offline_fallback_reply(last_user_query, live_summary);
    }

    let client = match Client::builder()
        .timeout(Duration::from_secs(CHAT_TIMEOUT_SECS))
        .build()
    {
        Ok(c) => c,
        Err(_) => return build_offline_fallback_reply(last_user_query, live_summary),
    };

    let system_prompt = format!(
        "Sen AffeXDesk yerel masaüstü çalışma alanı asistanısın. Kısa, net ve eyleme dönük Türkçe yanıtlar ver. Kullanıcının canlı sistem özeti aşağıdadır:\n{}",
        if live_summary.trim().is_empty() {
            "(Canlı özet sağlanmadı)"
        } else {
            live_summary.trim()
        }
    );

    let mut payload_messages = Vec::with_capacity(messages.len() + 1);
    payload_messages.push(json!({
        "role": "system",
        "content": system_prompt,
    }));
    for msg in messages {
        payload_messages.push(json!({
            "role": msg.role,
            "content": msg.content,
        }));
    }

    let url = format!("{}/chat/completions", status.base_url.trim_end_matches('/'));
    let request_body = json!({
        "model": status.model,
        "messages": payload_messages,
        "temperature": 0.3,
        "stream": false,
    });

    let response = match client.post(&url).json(&request_body).send().await {
        Ok(resp) if resp.status().is_success() => resp,
        _ => return build_offline_fallback_reply(last_user_query, live_summary),
    };

    let body: Value = match response.json().await {
        Ok(v) => v,
        Err(_) => return build_offline_fallback_reply(last_user_query, live_summary),
    };

    let raw_content = body
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|first| first.get("message"))
        .and_then(|msg| msg.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("");

    let cleaned = strip_think_tags(raw_content);
    if cleaned.is_empty() {
        return build_offline_fallback_reply(last_user_query, live_summary);
    }

    let actions = infer_actions_for_query(last_user_query);

    CopilotReply {
        message: cleaned,
        model: status.model,
        fallback: false,
        actions,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_think_tags_removes_single_multiline_and_unclosed_blocks() {
        let single = "<think>gizli akıl yürütme</think>\nMerhaba dünya!";
        assert_eq!(strip_think_tags(single), "Merhaba dünya!");

        let multiline = "Ön metin <THINK>\nSatır 1\nSatır 2\n</THINK> Son metin";
        assert_eq!(strip_think_tags(multiline), "Ön metin  Son metin");

        let unclosed = "Başlangıç<think>kesilen düşünce";
        assert_eq!(strip_think_tags(unclosed), "Başlangıç");

        let plain = "Normal yanıt metni";
        assert_eq!(strip_think_tags(plain), "Normal yanıt metni");
    }

    #[test]
    fn offline_fallback_generates_expected_actions_for_zombi_disk_and_git() {
        let zombi = build_offline_fallback_reply("Zombi süreçleri bul ve göster", "");
        assert!(zombi.fallback);
        assert_eq!(zombi.model, "local-fallback");
        assert!(zombi.actions.iter().any(|a| a.kind == "scan_processes"));
        assert!(zombi
            .actions
            .iter()
            .any(|a| a.kind == "navigate" && a.payload["tab"] == "processes"));

        let disk = build_offline_fallback_reply("Disk dolu, önbellek temizle", "");
        assert!(disk.fallback);
        assert!(disk.actions.iter().any(|a| a.kind == "scan_workspaces"));
        assert!(disk
            .actions
            .iter()
            .any(|a| a.kind == "navigate" && a.payload["tab"] == "workspaces"));

        let git = build_offline_fallback_reply("Git durumunu kontrol et", "");
        assert!(git.fallback);
        assert!(git.actions.iter().any(|a| a.kind == "scan_workspaces"));
        assert!(git
            .actions
            .iter()
            .any(|a| a.kind == "navigate" && a.payload["tab"] == "workspaces"));
    }
}
