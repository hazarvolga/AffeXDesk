use std::collections::HashMap;
use std::path::Path;
use tauri::State;

use crate::ai_copilot;
use crate::cleaner;
use crate::clients;
use crate::db::{self, Database};
use crate::devops;
use crate::disk_analyzer;
use crate::git_providers;
use crate::knowledge;
use crate::opener;
use crate::processes;
use crate::social_bridge;
use crate::studio;
use crate::telemetry;
use crate::uptime;
use crate::workspace;

pub type WorkspaceRecord = db::Workspace;

pub struct AppState {
    pub db: Database,
}

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub async fn get_system_metrics() -> Result<telemetry::SystemMetrics, String> {
    tokio::task::spawn_blocking(telemetry::collect_system_metrics)
        .await
        .map_err(|err| format!("telemetry task failed: {err}"))
}

#[tauri::command]
pub async fn scan_dev_processes() -> Result<processes::DevProcessReport, String> {
    tokio::task::spawn_blocking(processes::scan_dev_processes)
        .await
        .map_err(|err| format!("process scan task failed: {err}"))
}

#[tauri::command]
pub fn kill_dev_process(pid: u32, force: Option<bool>) -> Result<(), String> {
    processes::kill_dev_process(pid, force.unwrap_or(false))
}

#[tauri::command]
pub fn list_workspaces(state: State<'_, AppState>) -> Result<Vec<WorkspaceRecord>, String> {
    state
        .db
        .list_workspaces()
        .map_err(|err| format!("failed to list workspaces: {err}"))
}

#[tauri::command]
pub fn add_workspace(
    path: String,
    label: Option<String>,
    state: State<'_, AppState>,
) -> Result<WorkspaceRecord, String> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("workspace path cannot be empty".to_string());
    }

    let resolved_label = label
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            Path::new(trimmed_path)
                .file_name()
                .and_then(|n| n.to_str())
                .filter(|s| !s.is_empty())
                .unwrap_or(trimmed_path)
                .to_string()
        });

    state
        .db
        .add_workspace(trimmed_path, &resolved_label)
        .map_err(|err| format!("failed to add workspace: {err}"))
}

#[tauri::command]
pub fn remove_workspace(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    state
        .db
        .remove_workspace(id)
        .map(|_| ())
        .map_err(|err| format!("failed to remove workspace: {err}"))
}

#[tauri::command]
pub async fn pick_workspace_dir() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(opener::pick_directory)
        .await
        .map_err(|err| format!("folder picker task failed: {err}"))?
}

#[tauri::command]
pub async fn scan_workspaces(
    state: State<'_, AppState>,
) -> Result<workspace::WorkspaceScanReport, String> {
    let roots: Vec<(String, String)> = state
        .db
        .list_workspaces()
        .map_err(|err| format!("failed to load workspaces: {err}"))?
        .into_iter()
        .map(|ws| (ws.path, ws.label))
        .collect();

    let custom_urls: HashMap<String, String> = state
        .db
        .list_project_urls()
        .map_err(|err| format!("failed to load project urls: {err}"))?
        .into_iter()
        .map(|rec| (rec.project_path, rec.url))
        .collect();

    tokio::task::spawn_blocking(move || workspace::scan_workspaces(&roots, &custom_urls))
        .await
        .map_err(|err| format!("workspace scan task failed: {err}"))
}

#[tauri::command]
pub async fn clean_project_caches(paths: Vec<String>) -> Result<workspace::CleanResult, String> {
    tokio::task::spawn_blocking(move || {
        let result = workspace::clean_reclaimable_paths(&paths)?;
        disk_analyzer::invalidate_all_disk_caches();
        cleaner::invalidate_cleaner_cache();
        Ok(result)
    })
    .await
    .map_err(|err| format!("cache cleanup task failed: {err}"))?
}

#[tauri::command]
pub fn save_project_url(
    project_path: String,
    url: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let trimmed_path = project_path.trim();
    if trimmed_path.is_empty() {
        return Err("project_path cannot be empty".to_string());
    }

    let trimmed_url = url.trim();
    if trimmed_url.is_empty() {
        state
            .db
            .delete_project_url(trimmed_path)
            .map(|_| ())
            .map_err(|err| format!("failed to delete project url: {err}"))
    } else {
        state
            .db
            .set_project_url(trimmed_path, trimmed_url)
            .map(|_| ())
            .map_err(|err| format!("failed to save project url: {err}"))
    }
}

#[tauri::command]
pub async fn check_uptime(
    targets: Vec<(String, String)>,
) -> Result<Vec<uptime::UptimeResult>, String> {
    Ok(uptime::check_urls(targets).await)
}

#[tauri::command]
pub fn open_in_file_manager(path: String) -> Result<(), String> {
    opener::open_in_file_manager(&path)
}

#[tauri::command]
pub fn open_in_ide(
    path: String,
    ide: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let explicit = ide
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let resolved_ide = match explicit {
        Some(v) => Some(v),
        None => state
            .db
            .get_setting("preferred_ide")
            .map_err(|err| format!("failed to read preferred_ide setting: {err}"))?
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
    };

    opener::open_in_ide(&path, resolved_ide.as_deref())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    opener::open_url(&url)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    let pairs = state
        .db
        .list_settings()
        .map_err(|err| format!("failed to list settings: {err}"))?;
    Ok(pairs.into_iter().collect())
}

#[tauri::command]
pub fn save_settings(
    settings: HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    for (key, value) in settings {
        let trimmed_key = key.trim();
        if trimmed_key.is_empty() {
            continue;
        }
        state
            .db
            .set_setting(trimmed_key, &value)
            .map_err(|err| format!("failed to save setting '{trimmed_key}': {err}"))?;
    }
    Ok(())
}

fn load_settings_map(state: &State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    let pairs = state
        .db
        .list_settings()
        .map_err(|err| format!("failed to load settings: {err}"))?;
    Ok(pairs.into_iter().collect())
}

#[tauri::command]
pub async fn check_git_providers(
    state: State<'_, AppState>,
) -> Result<git_providers::GitProviderStatus, String> {
    let settings = load_settings_map(&state)?;
    tokio::task::spawn_blocking(move || git_providers::check_git_providers(&settings))
        .await
        .map_err(|err| format!("git provider check task failed: {err}"))
}

#[tauri::command]
pub async fn list_remote_repos(
    provider: String,
    state: State<'_, AppState>,
) -> Result<Vec<git_providers::RemoteRepo>, String> {
    let settings = load_settings_map(&state)?;
    git_providers::list_remote_repos(&provider, &settings).await
}

#[tauri::command]
pub async fn clone_repo(
    clone_url: String,
    target_workspace_dir: String,
    folder_name: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        git_providers::clone_repo(&clone_url, &target_workspace_dir, folder_name.as_deref())
    })
    .await
    .map_err(|err| format!("clone repo task failed: {err}"))?
}

#[tauri::command]
pub async fn create_local_project(
    workspace_dir: String,
    name: String,
    template: String,
    create_github_remote: bool,
    private: bool,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        git_providers::create_local_project(
            &workspace_dir,
            &name,
            &template,
            create_github_remote,
            private,
        )
    })
    .await
    .map_err(|err| format!("create local project task failed: {err}"))?
}

#[tauri::command]
pub async fn fetch_social_snapshot(
    state: State<'_, AppState>,
) -> Result<social_bridge::SocialBridgeSnapshot, String> {
    let settings = load_settings_map(&state)?;
    Ok(social_bridge::fetch_social_snapshot(&settings).await)
}

#[tauri::command]
pub async fn inspect_knowledge_hub(
    state: State<'_, AppState>,
) -> Result<knowledge::KnowledgeOverview, String> {
    let scrapling_dir = state
        .db
        .get_setting("scrapling_dir")
        .map_err(|err| format!("failed to read scrapling_dir setting: {err}"))?;

    tokio::task::spawn_blocking(move || knowledge::inspect_knowledge_hub(scrapling_dir.as_deref()))
        .await
        .map_err(|err| format!("knowledge hub inspect task failed: {err}"))
}

#[tauri::command]
pub async fn search_knowledge_hub(
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<knowledge::KnowledgeSearchHit>, String> {
    let scrapling_dir = state
        .db
        .get_setting("scrapling_dir")
        .map_err(|err| format!("failed to read scrapling_dir setting: {err}"))?
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Bilgi bankası dizini (scrapling_dir) yapılandırılmadı.".to_string())?;

    let effective_limit = limit.unwrap_or(20);
    tokio::task::spawn_blocking(move || {
        knowledge::search_knowledge_hub(&scrapling_dir, &query, effective_limit)
    })
    .await
    .map_err(|err| format!("knowledge hub search task failed: {err}"))?
}

#[tauri::command]
pub async fn check_ai_status(
    state: State<'_, AppState>,
) -> Result<ai_copilot::AiStatus, String> {
    let settings = load_settings_map(&state)?;
    Ok(ai_copilot::check_ai_status(&settings).await)
}

#[tauri::command]
pub async fn ai_chat(
    messages: Vec<ai_copilot::CopilotMessage>,
    state: State<'_, AppState>,
) -> Result<ai_copilot::CopilotReply, String> {
    let settings = load_settings_map(&state)?;
    let workspace_count = state
        .db
        .list_workspaces()
        .map(|ws| ws.len())
        .unwrap_or(0);

    let live_summary = tokio::task::spawn_blocking(move || {
        let metrics = telemetry::collect_system_metrics();
        let proc_report = processes::scan_dev_processes();
        let mem_used_gb = metrics.mem_used_bytes as f64 / 1_073_741_824.0;
        let mem_total_gb = metrics.mem_total_bytes as f64 / 1_073_741_824.0;
        let disk_avail_gb = metrics.disk_available_bytes as f64 / 1_073_741_824.0;

        format!(
            "CPU: {:.1}% | RAM: {:.1}/{:.1} GB ({:.0}%, {}) | Disk Boş: {:.1} GB ({:.0}% dolu) | Geliştirici Süreci: {} (Zombi adayı: {}, Dinlenen port: {}) | Kayıtlı Çalışma Alanı: {}",
            metrics.cpu_usage_pct,
            mem_used_gb,
            mem_total_gb,
            metrics.mem_used_pct,
            metrics.mem_pressure,
            disk_avail_gb,
            metrics.disk_used_pct,
            proc_report.processes.len(),
            proc_report.zombie_count,
            proc_report.listening_ports_count,
            workspace_count,
        )
    })
    .await
    .map_err(|err| format!("live summary task failed: {err}"))?;

    Ok(ai_copilot::ai_chat(&messages, &live_summary, &settings).await)
}

#[tauri::command]
pub async fn scan_creative_caches() -> Result<Vec<studio::CreativeCacheItem>, String> {
    tokio::task::spawn_blocking(studio::scan_creative_caches)
        .await
        .map_err(|err| format!("creative cache scan task failed: {err}"))
}

#[tauri::command]
pub async fn inspect_media_file(path: String) -> Result<studio::MediaProbeResult, String> {
    tokio::task::spawn_blocking(move || studio::inspect_media_file(&path))
        .await
        .map_err(|err| format!("media probe task failed: {err}"))?
}

#[tauri::command]
pub async fn pick_media_file() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(studio::pick_media_file)
        .await
        .map_err(|err| format!("media picker task failed: {err}"))?
}

#[tauri::command]
pub async fn scan_local_ai_models(
    state: State<'_, AppState>,
) -> Result<Vec<studio::LocalAiModel>, String> {
    let settings = load_settings_map(&state)?;
    Ok(studio::scan_local_ai_models(&settings).await)
}

#[tauri::command]
pub async fn inspect_docker() -> Result<devops::DockerOverview, String> {
    tokio::task::spawn_blocking(devops::inspect_docker)
        .await
        .map_err(|err| format!("docker inspect task failed: {err}"))
}

#[tauri::command]
pub async fn docker_container_action(id: String, action: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || devops::docker_container_action(&id, &action))
        .await
        .map_err(|err| format!("docker action task failed: {err}"))?
}

#[tauri::command]
pub async fn scan_env_hygiene(
    state: State<'_, AppState>,
) -> Result<Vec<devops::EnvHygieneItem>, String> {
    let roots: Vec<(String, String)> = state
        .db
        .list_workspaces()
        .map_err(|err| format!("failed to load workspaces for env hygiene: {err}"))?
        .into_iter()
        .map(|ws| (ws.path, ws.label))
        .collect();

    tokio::task::spawn_blocking(move || {
        let scan = workspace::scan_workspaces(&roots, &HashMap::new());
        let projects: Vec<(String, String)> = scan
            .projects
            .into_iter()
            .map(|p| (p.name, p.path))
            .collect();
        devops::scan_env_hygiene(&projects)
    })
    .await
    .map_err(|err| format!("env hygiene scan task failed: {err}"))
}

#[tauri::command]
pub async fn activate_focus_mode(mode: String) -> Result<devops::FocusModeResult, String> {
    tokio::task::spawn_blocking(move || devops::activate_focus_mode(&mode))
        .await
        .map_err(|err| format!("focus mode task failed: {err}"))?
}

#[tauri::command]
pub async fn check_full_disk_access() -> Result<bool, String> {
    tokio::task::spawn_blocking(disk_analyzer::check_full_disk_access)
        .await
        .map_err(|err| format!("full disk access check failed: {err}"))
}

#[tauri::command]
pub async fn open_full_disk_access_settings() -> Result<(), String> {
    tokio::task::spawn_blocking(disk_analyzer::open_full_disk_access_settings)
        .await
        .map_err(|err| format!("open full disk access settings failed: {err}"))?
}

#[tauri::command]
pub async fn get_cached_disk_breakdown() -> Result<Option<disk_analyzer::CachedDiskBreakdown>, String>
{
    tokio::task::spawn_blocking(disk_analyzer::get_cached_disk_breakdown)
        .await
        .map_err(|err| format!("cached disk breakdown task failed: {err}"))
}

#[tauri::command]
pub async fn scan_disk_breakdown(
    target_dir: Option<String>,
    include_protected: Option<bool>,
) -> Result<disk_analyzer::DiskBreakdownReport, String> {
    let full = include_protected.unwrap_or(false);
    tokio::task::spawn_blocking(move || {
        disk_analyzer::scan_disk_breakdown(target_dir.as_deref(), full)
    })
    .await
    .map_err(|err| format!("disk breakdown scan task failed: {err}"))?
}

#[tauri::command]
pub async fn move_path_to_trash(path: String) -> Result<u64, String> {
    tokio::task::spawn_blocking(move || disk_analyzer::move_path_to_trash(&path))
        .await
        .map_err(|err| format!("move to trash task failed: {err}"))?
}

#[tauri::command]
pub async fn delete_path_permanently(path: String) -> Result<u64, String> {
    tokio::task::spawn_blocking(move || disk_analyzer::delete_path_permanently(&path))
        .await
        .map_err(|err| format!("permanent delete task failed: {err}"))?
}

#[tauri::command]
pub async fn scan_disk_ai_models(
    state: State<'_, AppState>,
) -> Result<Vec<disk_analyzer::DiskAiModel>, String> {
    let settings = load_settings_map(&state)?;
    let live_models = studio::scan_local_ai_models(&settings).await;
    let active_ids: Vec<String> = live_models.into_iter().map(|m| m.id).collect();
    tokio::task::spawn_blocking(move || disk_analyzer::scan_disk_ai_models(&active_ids))
        .await
        .map_err(|err| format!("scan disk ai models task failed: {err}"))
}

#[tauri::command]
pub async fn get_cached_cleaner_scan() -> Result<Option<cleaner::CleanerScanReport>, String> {
    tokio::task::spawn_blocking(cleaner::get_cached_cleaner_scan)
        .await
        .map_err(|err| format!("cached cleaner scan failed: {err}"))
}

#[tauri::command]
pub async fn scan_system_cleaner() -> Result<cleaner::CleanerScanReport, String> {
    tokio::task::spawn_blocking(cleaner::scan_system_cleaner)
        .await
        .map_err(|err| format!("system cleaner scan failed: {err}"))?
}

#[tauri::command]
pub async fn run_system_cleaner(item_ids: Vec<String>) -> Result<cleaner::CleanerRunReport, String> {
    tokio::task::spawn_blocking(move || cleaner::run_system_cleaner(&item_ids))
        .await
        .map_err(|err| format!("system cleaner run failed: {err}"))?
}

#[tauri::command]
pub async fn restart_docker_desktop() -> Result<(), String> {
    tokio::task::spawn_blocking(cleaner::restart_docker_desktop)
        .await
        .map_err(|err| format!("restart docker desktop failed: {err}"))?
}

#[tauri::command]
pub fn list_clients(state: State<'_, AppState>) -> Result<Vec<db::ClientRecord>, String> {
    state
        .db
        .list_clients()
        .map_err(|err| format!("failed to list clients: {err}"))
}

const VALID_REMOTE_TOOLS: [&str; 6] = ["rustdesk", "hoptodesk", "anydesk", "vnc", "rdp", "ssh"];
const VALID_PROJECT_STATUSES: [&str; 5] = ["lead", "active", "waiting", "review", "done"];
const VALID_PROJECT_PRIORITIES: [&str; 4] = ["low", "normal", "high", "urgent"];

#[tauri::command]
pub fn save_client(
    state: State<'_, AppState>,
    input: db::ClientInput,
) -> Result<db::ClientRecord, String> {
    if input.name.trim().is_empty() {
        return Err("Müşteri / firma adı boş olamaz.".to_string());
    }
    let normalized_tool = input.remote_tool.trim().to_ascii_lowercase();
    if !VALID_REMOTE_TOOLS.contains(&normalized_tool.as_str()) {
        return Err(format!(
            "Desteklenmeyen uzak bağlantı aracı: '{}'. Geçerli değerler: rustdesk, hoptodesk, anydesk, vnc, rdp, ssh.",
            input.remote_tool.trim()
        ));
    }
    state
        .db
        .save_client(&input)
        .map_err(|err| format!("failed to save client: {err}"))
}

#[tauri::command]
pub fn delete_client(state: State<'_, AppState>, id: i64) -> Result<bool, String> {
    state
        .db
        .delete_client(id)
        .map_err(|err| format!("failed to delete client: {err}"))
}

#[tauri::command]
pub async fn connect_remote_client(
    state: State<'_, AppState>,
    id: i64,
) -> Result<String, String> {
    let client = state
        .db
        .get_client(id)
        .map_err(|err| format!("failed to load client: {err}"))?
        .ok_or_else(|| "Müşteri bulunamadı.".to_string())?;

    let uri = clients::build_remote_uri(&client.remote_tool, &client.remote_id)?;
    let uri_clone = uri.clone();
    tokio::task::spawn_blocking(move || clients::launch_remote_uri(&uri_clone))
        .await
        .map_err(|err| format!("remote launch task failed: {err}"))??;

    let _ = state.db.touch_client_connected(id);
    Ok(uri)
}

#[tauri::command]
pub fn list_client_projects(
    state: State<'_, AppState>,
) -> Result<Vec<db::ClientProjectRecord>, String> {
    state
        .db
        .list_client_projects()
        .map_err(|err| format!("failed to list client projects: {err}"))
}

#[tauri::command]
pub fn save_client_project(
    state: State<'_, AppState>,
    input: db::ClientProjectInput,
) -> Result<db::ClientProjectRecord, String> {
    if input.title.trim().is_empty() {
        return Err("Proje adı boş olamaz.".to_string());
    }
    let normalized_status = input.status.trim().to_ascii_lowercase();
    if !VALID_PROJECT_STATUSES.contains(&normalized_status.as_str()) {
        return Err(format!(
            "Geçersiz proje durumu: '{}'. Geçerli değerler: lead, active, waiting, review, done.",
            input.status.trim()
        ));
    }
    let normalized_priority = input.priority.trim().to_ascii_lowercase();
    if !VALID_PROJECT_PRIORITIES.contains(&normalized_priority.as_str()) {
        return Err(format!(
            "Geçersiz öncelik seviyesi: '{}'. Geçerli değerler: low, normal, high, urgent.",
            input.priority.trim()
        ));
    }
    let trimmed_local_path = input.local_path.trim();
    if !trimmed_local_path.is_empty() {
        let existing_projects = state
            .db
            .list_client_projects()
            .map_err(|err| format!("failed to check local_path conflict: {err}"))?;
        if let Some(conflict) = existing_projects
            .into_iter()
            .find(|p| p.local_path.trim() == trimmed_local_path && Some(p.id) != input.id)
        {
            return Err(format!(
                "Bu yerel klasör ('{trimmed_local_path}') zaten '{}' projesine bağlı. Aynı klasör birden fazla projeye atanamaz.",
                conflict.title
            ));
        }
    }
    state
        .db
        .save_client_project(&input)
        .map_err(|err| format!("failed to save client project: {err}"))
}

#[tauri::command]
pub fn delete_client_project(state: State<'_, AppState>, id: i64) -> Result<bool, String> {
    state
        .db
        .delete_client_project(id)
        .map_err(|err| format!("failed to delete client project: {err}"))
}
