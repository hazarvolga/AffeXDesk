use std::collections::HashMap;
use std::path::Path;
use tauri::State;

use crate::db::{self, Database};
use crate::opener;
use crate::processes;
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
    tokio::task::spawn_blocking(move || workspace::clean_reclaimable_paths(&paths))
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
