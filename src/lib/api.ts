import { invoke } from "@tauri-apps/api/core";

export type MemoryPressure = "normal" | "warn" | "critical";
export type ThermalState = "nominal" | "fair" | "serious" | "critical";
export type ProcessCategory =
  | "node"
  | "python"
  | "rust"
  | "docker"
  | "db"
  | "ai"
  | "other";
export type UptimeState = "online" | "degraded" | "down";

export interface SystemMetrics {
  cpu_usage_pct: number;
  cpu_cores: number;
  cpu_brand: string;
  mem_total_bytes: number;
  mem_used_bytes: number;
  mem_used_pct: number;
  mem_pressure: MemoryPressure | string;
  swap_total_bytes: number;
  swap_used_bytes: number;
  disk_total_bytes: number;
  disk_available_bytes: number;
  disk_used_pct: number;
  temperature_c: number | null;
  thermal_state: ThermalState | string;
  gpu_label: string;
  os_name: string;
  hostname: string;
  uptime_secs: number;
  collected_at: string;
}

export interface DevProcess {
  pid: number;
  name: string;
  category: ProcessCategory | string;
  memory_bytes: number;
  cpu_pct: number;
  ports: number[];
  cwd: string | null;
  cmd_preview: string;
  runtime_secs: number;
  is_zombie_candidate: boolean;
}

export interface DevProcessReport {
  processes: DevProcess[];
  total_dev_memory_bytes: number;
  zombie_count: number;
  zombie_memory_bytes: number;
  listening_ports_count: number;
}

export interface WorkspaceRecord {
  id: number;
  path: string;
  label: string;
  created_at: string;
}

export interface ReclaimableDir {
  name: string;
  path: string;
  size_bytes: number;
}

export interface ProjectInfo {
  name: string;
  path: string;
  workspace_label: string;
  stack: string[];
  git_branch: string | null;
  git_dirty_count: number;
  git_last_commit: string | null;
  progress_done: number;
  progress_total: number;
  progress_pct: number | null;
  live_url: string | null;
  reclaimable_bytes: number;
  reclaimable_dirs: ReclaimableDir[];
  last_modified_days_ago: number;
}

export interface WorkspaceScanReport {
  projects: ProjectInfo[];
  total_projects: number;
  dirty_projects: number;
  total_reclaimable_bytes: number;
}

export interface CleanResult {
  cleaned_count: number;
  freed_bytes: number;
  errors: string[];
}

export interface UptimeResult {
  project_path: string;
  url: string;
  status_code: number | null;
  latency_ms: number;
  state: UptimeState | string;
}

export const api = {
  appVersion(): Promise<string> {
    return invoke<string>("app_version");
  },

  getSystemMetrics(): Promise<SystemMetrics> {
    return invoke<SystemMetrics>("get_system_metrics");
  },

  scanDevProcesses(): Promise<DevProcessReport> {
    return invoke<DevProcessReport>("scan_dev_processes");
  },

  killDevProcess(params: { pid: number; force?: boolean }): Promise<void> {
    return invoke<void>("kill_dev_process", {
      pid: params.pid,
      force: params.force ?? false,
    });
  },

  listWorkspaces(): Promise<WorkspaceRecord[]> {
    return invoke<WorkspaceRecord[]>("list_workspaces");
  },

  addWorkspace(params: {
    path: string;
    label?: string | null;
  }): Promise<WorkspaceRecord> {
    return invoke<WorkspaceRecord>("add_workspace", {
      path: params.path,
      label: params.label ?? null,
    });
  },

  removeWorkspace(params: { id: number }): Promise<void> {
    return invoke<void>("remove_workspace", { id: params.id });
  },

  pickWorkspaceDir(): Promise<string | null> {
    return invoke<string | null>("pick_workspace_dir");
  },

  scanWorkspaces(): Promise<WorkspaceScanReport> {
    return invoke<WorkspaceScanReport>("scan_workspaces");
  },

  cleanProjectCaches(params: { paths: string[] }): Promise<CleanResult> {
    return invoke<CleanResult>("clean_project_caches", {
      paths: params.paths,
    });
  },

  saveProjectUrl(params: {
    projectPath: string;
    url: string;
  }): Promise<void> {
    return invoke<void>("save_project_url", {
      projectPath: params.projectPath,
      url: params.url,
    });
  },

  checkUptime(params: {
    targets: Array<[string, string]>;
  }): Promise<UptimeResult[]> {
    return invoke<UptimeResult[]>("check_uptime", {
      targets: params.targets,
    });
  },

  openInFileManager(params: { path: string }): Promise<void> {
    return invoke<void>("open_in_file_manager", { path: params.path });
  },

  openInIde(params: { path: string; ide?: string | null }): Promise<void> {
    return invoke<void>("open_in_ide", {
      path: params.path,
      ide: params.ide ?? null,
    });
  },

  openUrl(params: { url: string }): Promise<void> {
    return invoke<void>("open_url", { url: params.url });
  },

  getSettings(): Promise<Record<string, string>> {
    return invoke<Record<string, string>>("get_settings");
  },

  saveSettings(params: { settings: Record<string, string> }): Promise<void> {
    return invoke<void>("save_settings", { settings: params.settings });
  },
};
