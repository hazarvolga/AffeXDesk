use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::Path;
use std::process::Command;

use crate::processes;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub ports: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerOverview {
    pub available: bool,
    pub containers: Vec<DockerContainer>,
    pub reclaimable_summary: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvHygieneItem {
    pub project_name: String,
    pub project_path: String,
    pub has_env: bool,
    pub gitignored: bool,
    pub exposed_risk: bool,
    pub key_count: usize,
    pub key_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusModeResult {
    pub mode: String,
    pub summary: String,
    pub freed_memory_bytes: u64,
    pub killed_pids: Vec<u32>,
    pub notes: Vec<String>,
}

pub fn parse_docker_ps_json_lines(stdout: &str) -> Vec<DockerContainer> {
    let mut containers = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
            let id = val
                .get("ID")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            if id.is_empty() {
                continue;
            }
            let name = val
                .get("Names")
                .and_then(Value::as_str)
                .unwrap_or(&id)
                .trim()
                .to_string();
            let image = val
                .get("Image")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            let status = val
                .get("Status")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            let state = val
                .get("State")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            let ports = val
                .get("Ports")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();

            containers.push(DockerContainer {
                id,
                name,
                image,
                status,
                state,
                ports,
            });
        }
    }
    containers
}

pub fn inspect_docker() -> DockerOverview {
    let ps_output = match Command::new("docker")
        .args(["ps", "-a", "--format", "{{json .}}"])
        .output()
    {
        Ok(out) => out,
        Err(err) => {
            return DockerOverview {
                available: false,
                containers: Vec::new(),
                reclaimable_summary: String::new(),
                error: Some(format!("Docker CLI bulunamadı veya çalıştırılamadı: {err}")),
            };
        }
    };

    if !ps_output.status.success() {
        let stderr = String::from_utf8_lossy(&ps_output.stderr).trim().to_string();
        return DockerOverview {
            available: false,
            containers: Vec::new(),
            reclaimable_summary: String::new(),
            error: Some(if stderr.is_empty() {
                "Docker daemon çalışmıyor.".to_string()
            } else {
                stderr
            }),
        };
    }

    let stdout = String::from_utf8_lossy(&ps_output.stdout);
    let containers = parse_docker_ps_json_lines(&stdout);

    let reclaimable_summary = match Command::new("docker")
        .args(["system", "df", "--format", "{{.Type}}: {{.Reclaimable}}"])
        .output()
    {
        Ok(df_out) if df_out.status.success() => String::from_utf8_lossy(&df_out.stdout)
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join(" · "),
        _ => String::new(),
    };

    DockerOverview {
        available: true,
        containers,
        reclaimable_summary,
        error: None,
    }
}

fn validate_container_id(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    if trimmed.is_empty() || trimmed.len() > 128 || trimmed.starts_with('-') {
        return Err("Geçersiz Docker konteyner kimliği.".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
    {
        return Err("Docker konteyner kimliği güvenli olmayan karakter içeriyor.".to_string());
    }
    Ok(trimmed.to_string())
}

pub fn docker_container_action(id: &str, action: &str) -> Result<String, String> {
    let safe_id = validate_container_id(id)?;
    let normalized_action = action.trim().to_ascii_lowercase();
    if !matches!(normalized_action.as_str(), "start" | "stop" | "restart") {
        return Err(format!(
            "Desteklenmeyen Docker eylemi: '{action}'. Geçerli eylemler: start, stop, restart"
        ));
    }

    let output = Command::new("docker")
        .args([normalized_action.as_str(), safe_id.as_str()])
        .output()
        .map_err(|err| format!("Docker komutu çalıştırılamadı: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("docker {normalized_action} başarısız: {}", stderr.trim()));
    }

    Ok(format!("Konteyner {safe_id}: {normalized_action} tamamlandı."))
}

pub fn docker_prune_unused() -> Result<String, String> {
    let output = Command::new("docker")
        .args(["system", "prune", "-f"])
        .output()
        .map_err(|err| format!("Docker prune çalıştırılamadı: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("docker system prune başarısız: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(if stdout.is_empty() {
        "Kullanılmayan Docker kaynakları temizlendi.".to_string()
    } else {
        stdout
    })
}

/// Extracts ONLY environment variable key names from a `.env` file.
/// Secret values are NEVER stored, logged, or returned.
fn extract_env_key_names(content: &str) -> Vec<String> {
    let mut keys = Vec::new();
    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let without_export = line.strip_prefix("export ").map(str::trim).unwrap_or(line);
        if let Some((key_part, _value_ignored)) = without_export.split_once('=') {
            let key = key_part.trim();
            if !key.is_empty()
                && key
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-')
            {
                if !keys.iter().any(|k| k == key) {
                    keys.push(key.to_string());
                }
            }
        }
    }
    keys
}

fn is_env_gitignored(project_dir: &Path) -> bool {
    let gitignore_path = project_dir.join(".gitignore");
    let content = match fs::read_to_string(&gitignore_path) {
        Ok(c) => c,
        Err(_) => return false,
    };

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('!') {
            continue;
        }
        let cleaned = line.trim_start_matches('/').trim_end_matches('/');
        if matches!(
            cleaned,
            ".env" | ".env*" | ".env.*" | "*.env" | ".env.local" | "**/.env"
        ) {
            return true;
        }
    }
    false
}

pub fn scan_env_hygiene(projects: &[(String, String)]) -> Vec<EnvHygieneItem> {
    let mut items = Vec::new();

    for (project_name, project_path) in projects {
        let dir = Path::new(project_path);
        if !dir.is_dir() {
            continue;
        }

        let env_file = dir.join(".env");
        let has_env = env_file.is_file();
        let key_names = if has_env {
            fs::read_to_string(&env_file)
                .map(|c| extract_env_key_names(&c))
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        let gitignored = is_env_gitignored(dir);
        let exposed_risk = has_env && !gitignored;
        let key_count = key_names.len();

        items.push(EnvHygieneItem {
            project_name: project_name.clone(),
            project_path: project_path.clone(),
            has_env,
            gitignored,
            exposed_risk,
            key_count,
            key_names,
        });
    }

    items.sort_by(|a, b| {
        b.exposed_risk
            .cmp(&a.exposed_risk)
            .then_with(|| b.has_env.cmp(&a.has_env))
            .then_with(|| a.project_name.to_lowercase().cmp(&b.project_name.to_lowercase()))
    });

    items
}

pub fn activate_focus_mode(mode: &str) -> Result<FocusModeResult, String> {
    let normalized = mode.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "render" => {
            let report = processes::scan_dev_processes();
            let mut freed_memory_bytes: u64 = 0;
            let mut killed_pids: Vec<u32> = Vec::new();
            let mut notes: Vec<String> = Vec::new();

            for proc_item in report.processes {
                if proc_item.is_zombie_candidate && proc_item.category == "node" {
                    match processes::kill_dev_process(proc_item.pid, false) {
                        Ok(()) => {
                            freed_memory_bytes =
                                freed_memory_bytes.saturating_add(proc_item.memory_bytes);
                            killed_pids.push(proc_item.pid);
                        }
                        Err(err) => {
                            notes.push(format!("PID {} kapatılamadı: {err}", proc_item.pid));
                        }
                    }
                }
            }

            let freed_mb = freed_memory_bytes as f64 / 1_048_576.0;
            let summary = if killed_pids.is_empty() {
                "Render modu hazır: Kapatılacak zombi Node.js süreci bulunmadı.".to_string()
            } else {
                format!(
                    "Render modu etkin: {} zombi Node.js süreci kapatıldı, yaklaşık {:.1} MB RAM kazanıldı.",
                    killed_pids.len(),
                    freed_mb
                )
            };
            notes.push("Video/3B render öncesinde gereksiz arka plan dev sunucuları kontrol edildi.".to_string());

            Ok(FocusModeResult {
                mode: "render".to_string(),
                summary,
                freed_memory_bytes,
                killed_pids,
                notes,
            })
        }
        "webdev" => {
            let report = processes::scan_dev_processes();
            let notes = vec![
                format!("Aktif geliştirici süreci: {}", report.processes.len()),
                format!("Dinlenen yerel port sayısı: {}", report.listening_ports_count),
                format!("Zombi adayı süreç: {}", report.zombie_count),
            ];
            Ok(FocusModeResult {
                mode: "webdev".to_string(),
                summary: "Web Geliştirme modu hazır: Yerel dev sunucuları ve portlar doğrulandı.".to_string(),
                freed_memory_bytes: 0,
                killed_pids: Vec::new(),
                notes,
            })
        }
        "publish" => {
            let report = processes::scan_dev_processes();
            let notes = vec![
                "Yayın öncesi kontrol: Git değişiklikleri, .env hijyeni ve Sosyal Merkez MCP bağlantısını gözden geçirin.".to_string(),
                format!("Arka planda çalışan geliştirici süreci: {}", report.processes.len()),
            ];
            Ok(FocusModeResult {
                mode: "publish".to_string(),
                summary: "Yayın modu etkin: Yayın ve dağıtım kontrol listesi hazır.".to_string(),
                freed_memory_bytes: 0,
                killed_pids: Vec::new(),
                notes,
            })
        }
        other => Err(format!(
            "Bilinmeyen çalışma modu: '{other}'. Geçerli modlar: render, webdev, publish"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_project(suffix: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "affexdesk_devops_test_{}_{}_{}",
            std::process::id(),
            suffix,
            nanos
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn parse_docker_ps_json_lines_parses_containers() {
        let sample = "{\"ID\":\"abc123\",\"Names\":\"postgres-dev\",\"Image\":\"postgres:16\",\"Status\":\"Up 2 hours\",\"State\":\"running\",\"Ports\":\"5432/tcp\"}\n";
        let containers = parse_docker_ps_json_lines(sample);
        assert_eq!(containers.len(), 1);
        assert_eq!(containers[0].id, "abc123");
        assert_eq!(containers[0].name, "postgres-dev");
        assert_eq!(containers[0].state, "running");
    }

    #[test]
    fn docker_container_action_rejects_invalid_inputs() {
        assert!(docker_container_action("-evil", "start").is_err());
        assert!(docker_container_action("abc123", "rm").is_err());
        assert!(docker_container_action("abc;rm -rf /", "stop").is_err());
    }

    #[test]
    fn scan_env_hygiene_never_leaks_secret_values_and_checks_gitignore() {
        let exposed_dir = make_temp_project("exposed");
        fs::write(
            exposed_dir.join(".env"),
            "# Comment\nAPI_KEY=super_secret_value_123\nexport DB_URL=postgres://secret\n",
        )
        .unwrap();

        let safe_dir = make_temp_project("safe");
        fs::write(safe_dir.join(".env"), "TOKEN=another_secret\n").unwrap();
        fs::write(safe_dir.join(".gitignore"), "node_modules/\n.env\n").unwrap();

        let items = scan_env_hygiene(&[
            ("exposed-app".to_string(), exposed_dir.to_string_lossy().to_string()),
            ("safe-app".to_string(), safe_dir.to_string_lossy().to_string()),
        ]);

        assert_eq!(items.len(), 2);
        let exposed = items.iter().find(|i| i.project_name == "exposed-app").unwrap();
        assert!(exposed.has_env);
        assert!(!exposed.gitignored);
        assert!(exposed.exposed_risk);
        assert_eq!(exposed.key_count, 2);
        assert_eq!(exposed.key_names, vec!["API_KEY", "DB_URL"]);
        assert!(!exposed
            .key_names
            .iter()
            .any(|k| k.contains("super_secret")));

        let safe = items.iter().find(|i| i.project_name == "safe-app").unwrap();
        assert!(safe.has_env);
        assert!(safe.gitignored);
        assert!(!safe.exposed_risk);
        assert_eq!(safe.key_names, vec!["TOKEN"]);

        let _ = fs::remove_dir_all(&exposed_dir);
        let _ = fs::remove_dir_all(&safe_dir);
    }

    #[test]
    fn activate_focus_mode_handles_valid_and_invalid_modes() {
        assert!(activate_focus_mode("invalid-mode").is_err());

        let webdev = activate_focus_mode("webdev").unwrap();
        assert_eq!(webdev.mode, "webdev");
        assert!(!webdev.summary.is_empty());

        let publish = activate_focus_mode("publish").unwrap();
        assert_eq!(publish.mode, "publish");
        assert!(!publish.summary.is_empty());
    }
}
