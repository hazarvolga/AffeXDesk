import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
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
  },
}));

const mockedApi = vi.mocked(api);

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it("renders sidebar, live telemetry, and switches tabs with Meta/Alt+1..4 shortcuts", async () => {
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
      screen.getByRole("heading", { name: /Ayarlar/i })
    ).toBeInTheDocument();
    expect(screen.getByText("Sosyal Merkez MCP Köprüsü")).toBeInTheDocument();
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
