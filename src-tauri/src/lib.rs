pub mod commands;
pub mod db;
pub mod opener;
pub mod processes;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running AffeXDesk");
}
