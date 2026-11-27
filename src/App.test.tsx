import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { clearDiskAnalyzerCache } from "./components/DiskAnalyzerView";
import { api } from "./lib/api";

vi.mock("./lib/api", () => ({
  api: {
    appVersion: vi.fn(),
    getSystemMetrics: vi.fn(),
    scanDevProcesses: vi.fn(),
    killDevProcess: vi.fn(),
    listWorkspaces: vi.fn(),
    addWorkspace: vi.fn(),
    removeWorkspace: vi.fn(),
    pickWorkspaceDir: vi.fn(),
    scanWorkspaces: vi.fn(),
    cleanProjectCaches: vi.fn(),
    saveProjectUrl: vi.fn(),
    checkUptime: vi.fn(),
    openInFileManager: vi.fn(),
    openInIde: vi.fn(),
    openUrl: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    checkGitProviders: vi.fn(),
    listRemoteRepos: vi.fn(),
    cloneRepo: vi.fn(),
    createLocalProject: vi.fn(),
    fetchSocialSnapshot: vi.fn(),
    inspectKnowledgeHub: vi.fn(),
    searchKnowledgeHub: vi.fn(),
    checkAiStatus: vi.fn(),
    aiChat: vi.fn(),
    scanCreativeCaches: vi.fn(),
    inspectMediaFile: vi.fn(),
    pickMediaFile: vi.fn(),
    scanLocalAiModels: vi.fn(),
    inspectDocker: vi.fn(),
    dockerContainerAction: vi.fn(),
    scanEnvHygiene: vi.fn(),
    activateFocusMode: vi.fn(),
    checkFullDiskAccess: vi.fn(),
    openFullDiskAccessSettings: vi.fn(),
    getCachedDiskBreakdown: vi.fn(),
    scanDiskBreakdown: vi.fn(),
    movePathToTrash: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDiskAnalyzerCache();
    mockedApi.appVersion.mockResolvedValue("0.1.0");
    mockedApi.getSettings.mockResolvedValue({
      default_ide: "cursor",
      refresh_interval_secs: "10",
    });
    mockedApi.getSystemMetrics.mockResolvedValue({
      cpu_usage_pct: 24.5,
      cpu_cores: 12,
      cpu_brand: "Apple M4 Pro",
      mem_total_bytes: 48 * 1024 ** 3,
      mem_used_bytes: 18 * 1024 ** 3,
      mem_used_pct: 37.5,
      mem_pressure: "normal",
      swap_total_bytes: 4 * 1024 ** 3,
      swap_used_bytes: 0,
      disk_total_bytes: 1000 * 1024 ** 3,
      disk_available_bytes: 420 * 1024 ** 3,
      disk_used_pct: 58.0,
      temperature_c: 46,
      thermal_state: "nominal",
      gpu_label: "Apple GPU (20-core)",
      os_name: "macOS 15.4",
      hostname: "dev-station",
      uptime_secs: 93600,
      collected_at: "2026-11-27T10:00:00Z",
    });
    mockedApi.scanDevProcesses.mockResolvedValue({
      processes: [
        {
          pid: 4242,
          name: "vite",
          category: "node",
          memory_bytes: 512 * 1024 ** 2,
          cpu_pct: 4.2,
          ports: [5173],
          cwd: "/workspace/demo-web",
          cmd_preview: "node ./node_modules/.bin/vite",
          runtime_secs: 7200,
          is_zombie_candidate: true,
        },
      ],
      total_dev_memory_bytes: 512 * 1024 ** 2,
      zombie_count: 1,
      zombie_memory_bytes: 512 * 1024 ** 2,
      listening_ports_count: 1,
    });
    mockedApi.listWorkspaces.mockResolvedValue([
      {
        id: 1,
        path: "/workspace",
        label: "workspace",
        created_at: "2026-11-27T09:00:00Z",
      },
    ]);
    mockedApi.scanWorkspaces.mockResolvedValue({
      projects: [],
      total_projects: 0,
      dirty_projects: 0,
      total_reclaimable_bytes: 0,
    });
    mockedApi.killDevProcess.mockResolvedValue();
    mockedApi.checkGitProviders.mockResolvedValue({
      gh_cli_available: true,
      gh_authenticated: true,
      gh_user: "dev-user",
      github_token_configured: false,
      gitlab_url: "https://gitlab.com",
      gitlab_token_configured: false,
    });
    mockedApi.listRemoteRepos.mockResolvedValue([]);
    mockedApi.fetchSocialSnapshot.mockResolvedValue({
      connected: false,
      endpoint: "http://127.0.0.1:49157/mcp",
      app_version: null,
      accounts: [],
      scheduled_count: 0,
      pending_review_count: 0,
      failed_count: 0,
      published_count: 0,
      error: "offline",
    });
    mockedApi.inspectKnowledgeHub.mockResolvedValue({
      configured: false,
      root_dir: null,
      index_exists: false,
      search_script_exists: false,
      dataset_count: 0,
      datasets: [],
    });
    mockedApi.checkAiStatus.mockResolvedValue({
      online: true,
      provider: "mlx-serve",
      base_url: "http://127.0.0.1:11234/v1",
      model: "qwen3-coder",
      available_models: ["qwen3-coder"],
    });
    mockedApi.aiChat.mockResolvedValue({
      message: "Sistem sağlıklı görünüyor.",
      model: "qwen3-coder",
      fallback: false,
      actions: [],
    });
    mockedApi.checkFullDiskAccess.mockResolvedValue(true);
    mockedApi.openFullDiskAccessSettings.mockResolvedValue();
    mockedApi.getCachedDiskBreakdown.mockResolvedValue(null);
    mockedApi.scanCreativeCaches.mockResolvedValue([]);
    mockedApi.scanLocalAiModels.mockResolvedValue([]);
    mockedApi.inspectDocker.mockResolvedValue({
      available: false,
      containers: [],
      reclaimable_summary: "",
      error: "Docker çalışmıyor",
    });
    mockedApi.scanEnvHygiene.mockResolvedValue([]);
    mockedApi.scanDiskBreakdown.mockResolvedValue({
      root_path: "/Users/hazar",
      parent_path: "/Users",
      total_scanned_bytes: 900 * 1024 ** 3,
      disk_total_bytes: 2000 * 1024 ** 3,
      disk_used_bytes: 1400 * 1024 ** 3,
      disk_available_bytes: 600 * 1024 ** 3,
      entries: [
        {
          name: "Library",
          path: "/Users/hazar/Library",
          size_bytes: 420 * 1024 ** 3,
          pct_of_parent: 46.7,
          is_dir: true,
          category: "system_cache",
          safe_to_clean: false,
          clean_hint: "Önbellek ve uygulama verileri",
        },
        {
          name: "huggingface",
          path: "/Users/hazar/.cache/huggingface",
          size_bytes: 280 * 1024 ** 3,
          pct_of_parent: 31.1,
          is_dir: true,
          category: "ai_models",
          safe_to_clean: true,
          clean_hint: "İndirilmiş yerel LLM ağırlıkları",
        },
      ],
      category_totals: [
        {
          category: "system_cache",
          label: "Sistem Önbelleği",
          size_bytes: 420 * 1024 ** 3,
          pct: 46.7,
        },
        {
          category: "ai_models",
          label: "AI Modelleri",
          size_bytes: 280 * 1024 ** 3,
          pct: 31.1,
        },
      ],
      quick_wins: [
        {
          name: "HuggingFace Cache",
          path: "/Users/hazar/.cache/huggingface",
          size_bytes: 280 * 1024 ** 3,
          pct_of_parent: 31.1,
          is_dir: true,
          category: "ai_models",
          safe_to_clean: true,
          clean_hint: "Kullanılmayan AI modellerini temizleyebilirsiniz",
        },
      ],
    });
    mockedApi.movePathToTrash.mockResolvedValue(280 * 1024 ** 3);
  });

  it("renders sidebar, live telemetry, and switches tabs with Meta/Alt+1..8 and Meta/Ctrl+K shortcuts", async () => {
    render(<App />);

    expect(screen.getByText("AffeXDesk")).toBeInTheDocument();
    expect(await screen.findByText("24.5%")).toBeInTheDocument();
    expect(screen.getByText("Komuta Merkezi")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "2", metaKey: true });
    expect(
      screen.getByRole("heading", { name: /Geliştirici Süreçleri/i })
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "3", altKey: true });
    expect(
      screen.getByRole("heading", { name: /Proje Radarı/i })
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "4", metaKey: true });
    expect(
      await screen.findByRole("heading", { level: 1, name: /Disk Analizi/i })
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "5", metaKey: true });
    expect(
      await screen.findByRole("heading", { name: /Git & Uzak Repolar/i })
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "6", altKey: true });
    expect(
      await screen.findByRole("heading", { level: 1, name: /Bilgi Bankası/i })
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "7", metaKey: true });
    expect(
      await screen.findByRole("heading", { level: 1, name: /Stüdyo & DevOps/i })
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "8", metaKey: true });
    expect(
      screen.getByRole("heading", { name: /Ayarlar/i })
    ).toBeInTheDocument();
    expect(screen.getByText("Sosyal Merkez MCP Köprüsü")).toBeInTheDocument();

    // Cmd/Ctrl+K opens AI Drawer and Escape closes it
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(
      await screen.findByRole("dialog", { name: /Yerel AI Asistan/i })
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: /Yerel AI Asistan/i })
    ).not.toBeInTheDocument();
  });

  it("navigates to Disk Analyzer from Overview Disk card, drills down, and moves item to trash via ConfirmDialog", async () => {
    render(<App />);
    await screen.findByText("24.5%");

    // Click Disk Doluluk card on Overview
    fireEvent.click(
      screen.getByRole("button", { name: /Disk Doluluk — Detaylı Analiz/i })
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: /Disk Analizi/i })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("img", { name: /donut grafiği/i })
    ).toBeInTheDocument();
    expect(screen.getByText("HuggingFace Cache")).toBeInTheDocument();

    // Drill down into Library folder
    fireEvent.click(screen.getByRole("button", { name: /^Library$/i }));
    await waitFor(() => {
      expect(mockedApi.scanDiskBreakdown).toHaveBeenCalledWith(
        "/Users/hazar/Library",
        true
      );
    });

    // Click Çöpe Taşı on an entry and confirm in ConfirmDialog
    fireEvent.click(
      screen.getByRole("button", { name: /Çöpe Taşı: huggingface/i })
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent("/Users/hazar/.cache/huggingface");

    const confirmButtons = screen.getAllByRole("button", {
      name: /^Çöpe Taşı$/i,
    });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(mockedApi.movePathToTrash).toHaveBeenCalledWith(
        "/Users/hazar/.cache/huggingface"
      );
    });
  });

  it("opens ConfirmDialog before force-killing a process and invokes killDevProcess", async () => {
    render(<App />);
    await screen.findByText("24.5%");

    fireEvent.keyDown(window, { key: "2", metaKey: true });
    // Grouped by project/app by default; switch to Tekil PID to test per-PID SIGKILL dialog
    fireEvent.click(await screen.findByRole("button", { name: /Tekil PID/i }));
    expect(await screen.findByText("vite")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Zorla Kapat/i }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent("PID 4242");

    // Escape cancels without killing
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mockedApi.killDevProcess).not.toHaveBeenCalled();

    // Confirming invokes killDevProcess({ pid: 4242, force: true })
    fireEvent.click(screen.getByRole("button", { name: /Zorla Kapat/i }));
    const confirmButtons = screen.getAllByRole("button", {
      name: /Zorla Kapat/i,
    });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(mockedApi.killDevProcess).toHaveBeenCalledWith({
        pid: 4242,
        force: true,
      });
    });
  });
});
