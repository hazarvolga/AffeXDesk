pub mod ai_copilot;
pub mod commands;
pub mod db;
pub mod devops;
pub mod disk_analyzer;
pub mod git_providers;
pub mod knowledge;
pub mod opener;
pub mod processes;
pub mod social_bridge;
pub mod studio;
pub mod telemetry;
pub mod uptime;
pub mod workspace;

use commands::AppState;
use db::{default_db_path, Database};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = Database::open(default_db_path()).expect("failed to initialize AffeXDesk database");

    tauri::Builder::default()
        .manage(AppState { db })
        .invoke_handler(tauri::generate_handler![
            commands::app_version,
            commands::get_system_metrics,
            commands::scan_dev_processes,
            commands::kill_dev_process,
            commands::list_workspaces,
            commands::add_workspace,
            commands::remove_workspace,
            commands::pick_workspace_dir,
            commands::scan_workspaces,
            commands::clean_project_caches,
            commands::save_project_url,
            commands::check_uptime,
            commands::open_in_file_manager,
            commands::open_in_ide,
            commands::open_url,
            commands::get_settings,
            commands::save_settings,
            commands::check_git_providers,
            commands::list_remote_repos,
            commands::clone_repo,
            commands::create_local_project,
            commands::fetch_social_snapshot,
            commands::inspect_knowledge_hub,
            commands::search_knowledge_hub,
            commands::check_ai_status,
            commands::ai_chat,
            commands::scan_creative_caches,
            commands::inspect_media_file,
            commands::pick_media_file,
            commands::scan_local_ai_models,
            commands::inspect_docker,
            commands::docker_container_action,
            commands::scan_env_hygiene,
            commands::activate_focus_mode,
            commands::check_full_disk_access,
            commands::open_full_disk_access_settings,
            commands::get_cached_disk_breakdown,
            commands::scan_disk_breakdown,
            commands::move_path_to_trash,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AffeXDesk");
}
