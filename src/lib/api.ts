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

export interface GitProviderStatus {
  gh_cli_available: boolean;
  gh_authenticated: boolean;
  gh_user: string | null;
  github_token_configured: boolean;
  gitlab_url: string;
  gitlab_token_configured: boolean;
}

export interface RemoteRepo {
  provider: "github" | "gitlab" | string;
  id: string;
  name: string;
  full_name: string;
  description: string | null;
  clone_url: string;
  html_url: string;
  private: boolean;
  default_branch: string;
  language: string | null;
  updated_at: string;
  stargazers_count: number;
}

export interface SocialAccountSummary {
  id: number;
  platform: string;
  display_name: string;
  status: string;
}

export interface SocialBridgeSnapshot {
  connected: boolean;
  endpoint: string;
  app_version: string | null;
  accounts: SocialAccountSummary[];
  scheduled_count: number;
  pending_review_count: number;
  failed_count: number;
  published_count: number;
  error: string | null;
}

export interface DatasetCard {
  id: string;
  title: string;
  path: string;
  summary: string;
  size_bytes: number;
}

export interface KnowledgeOverview {
  configured: boolean;
  root_dir: string | null;
  index_exists: boolean;
  search_script_exists: boolean;
  dataset_count: number;
  datasets: DatasetCard[];
}

export interface KnowledgeSearchHit {
  source: string;
  title: string;
  snippet: string;
  path: string | null;
}

export interface AiStatus {
  online: boolean;
  provider: string;
  base_url: string;
  model: string;
  available_models: string[];
}

export interface CopilotMessage {
  role: "user" | "assistant" | "system" | string;
  content: string;
}

export interface CopilotAction {
  id: string;
  kind: string;
  label: string;
  description: string;
  requires_confirmation: boolean;
  payload: Record<string, unknown>;
}

export interface CopilotReply {
  message: string;
  model: string;
  fallback: boolean;
  actions: CopilotAction[];
}

export interface CreativeCacheItem {
  id: string;
  app: string;
  label: string;
  path: string;
  size_bytes: number;
  exists: boolean;
}

export interface MediaProbeResult {
  path: string;
  file_name: string;
  size_bytes: number;
  duration_secs: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  bitrate_kbps: number | null;
  lufs: number | null;
  youtube_lufs_ok: boolean | null;
}

export interface LocalAiModel {
  id: string;
  provider: string;
  state: string;
  bytes_on_disk: number | null;
  bytes_resident: number | null;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
}

export interface DockerOverview {
  available: boolean;
  containers: DockerContainer[];
  reclaimable_summary: string;
  error: string | null;
}

export interface EnvHygieneItem {
  project_name: string;
  project_path: string;
  has_env: boolean;
  gitignored: boolean;
  exposed_risk: boolean;
  key_count: number;
  key_names: string[];
}

export interface FocusModeResult {
  mode: string;
  summary: string;
  freed_memory_bytes: number;
  killed_pids: number[];
  notes: string[];
}

export type DiskCategory =
  | "ai_models"
  | "dev_cache"
  | "media_render"
  | "system_cache"
  | "downloads"
  | "projects"
  | "other";

export interface DiskEntry {
  name: string;
  path: string;
  size_bytes: number;
  pct_of_parent: number;
  is_dir: boolean;
  category: DiskCategory | string;
  safe_to_clean: boolean;
  clean_hint: string | null;
}

export interface CategoryTotal {
  category: DiskCategory | string;
  label: string;
  size_bytes: number;
  pct: number;
}

export interface DiskBreakdownReport {
  root_path: string;
  parent_path: string | null;
  total_scanned_bytes: number;
  disk_total_bytes: number;
  disk_used_bytes: number;
  disk_available_bytes: number;
  entries: DiskEntry[];
  category_totals: CategoryTotal[];
  quick_wins: DiskEntry[];
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

  checkGitProviders(): Promise<GitProviderStatus> {
    return invoke<GitProviderStatus>("check_git_providers");
  },

  listRemoteRepos(provider: "github" | "gitlab"): Promise<RemoteRepo[]> {
    return invoke<RemoteRepo[]>("list_remote_repos", { provider });
  },

  cloneRepo(args: {
    cloneUrl: string;
    targetWorkspaceDir: string;
    folderName?: string | null;
  }): Promise<string> {
    return invoke<string>("clone_repo", args);
  },

  createLocalProject(args: {
    workspaceDir: string;
    name: string;
    template: "empty" | "react-vite" | "rust" | "python";
    createGithubRemote: boolean;
    private: boolean;
  }): Promise<string> {
    return invoke<string>("create_local_project", args);
  },

  fetchSocialSnapshot(): Promise<SocialBridgeSnapshot> {
    return invoke<SocialBridgeSnapshot>("fetch_social_snapshot");
  },

  inspectKnowledgeHub(): Promise<KnowledgeOverview> {
    return invoke<KnowledgeOverview>("inspect_knowledge_hub");
  },

  searchKnowledgeHub(
    query: string,
    limit?: number
  ): Promise<KnowledgeSearchHit[]> {
    return invoke<KnowledgeSearchHit[]>("search_knowledge_hub", {
      query,
      limit: limit ?? 20,
    });
  },

  checkAiStatus(): Promise<AiStatus> {
    return invoke<AiStatus>("check_ai_status");
  },

  aiChat(messages: CopilotMessage[]): Promise<CopilotReply> {
    return invoke<CopilotReply>("ai_chat", { messages });
  },

  scanCreativeCaches(): Promise<CreativeCacheItem[]> {
    return invoke<CreativeCacheItem[]>("scan_creative_caches");
  },

  inspectMediaFile(path: string): Promise<MediaProbeResult> {
    return invoke<MediaProbeResult>("inspect_media_file", { path });
  },

  pickMediaFile(): Promise<string | null> {
    return invoke<string | null>("pick_media_file");
  },

  scanLocalAiModels(): Promise<LocalAiModel[]> {
    return invoke<LocalAiModel[]>("scan_local_ai_models");
  },

  inspectDocker(): Promise<DockerOverview> {
    return invoke<DockerOverview>("inspect_docker");
  },

  dockerContainerAction(
    id: string,
    action: "start" | "stop" | "restart"
  ): Promise<void> {
    return invoke<void>("docker_container_action", { id, action });
  },

  scanEnvHygiene(): Promise<EnvHygieneItem[]> {
    return invoke<EnvHygieneItem[]>("scan_env_hygiene");
  },

  activateFocusMode(
    mode: "render" | "webdev" | "publish"
  ): Promise<FocusModeResult> {
    return invoke<FocusModeResult>("activate_focus_mode", { mode });
  },

  checkFullDiskAccess(): Promise<boolean> {
    return invoke<boolean>("check_full_disk_access");
  },

  openFullDiskAccessSettings(): Promise<void> {
    return invoke<void>("open_full_disk_access_settings");
  },

  getCachedDiskBreakdown(): Promise<{
    report: DiskBreakdownReport;
    scanned_at: string;
    include_protected?: boolean;
  } | null> {
    return invoke<{
      report: DiskBreakdownReport;
      scanned_at: string;
      include_protected?: boolean;
    } | null>("get_cached_disk_breakdown");
  },

  scanDiskBreakdown(
    targetDir?: string | null,
    includeProtected = false
  ): Promise<DiskBreakdownReport> {
    return invoke<DiskBreakdownReport>("scan_disk_breakdown", {
      targetDir: targetDir ?? null,
      includeProtected,
    });
  },

  movePathToTrash(path: string): Promise<number> {
    return invoke<number>("move_path_to_trash", { path });
  },
};
