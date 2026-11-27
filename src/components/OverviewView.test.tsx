import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OverviewView } from "./OverviewView";
import type {
  DevProcessReport,
  SystemMetrics,
  WorkspaceScanReport,
} from "../lib/api";

const sampleMetrics: SystemMetrics = {
  cpu_usage_pct: 42.3,
  cpu_cores: 16,
  cpu_brand: "Apple M5 Max",
  mem_total_bytes: 48 * 1024 ** 3,
  mem_used_bytes: 38 * 1024 ** 3,
  mem_used_pct: 79.2,
  mem_pressure: "warn",
  swap_total_bytes: 8 * 1024 ** 3,
  swap_used_bytes: 1024 ** 3,
  disk_total_bytes: 2000 * 1024 ** 3,
  disk_available_bytes: 600 * 1024 ** 3,
  disk_used_pct: 70.0,
  temperature_c: 64,
  thermal_state: "fair",
  gpu_label: "40-Core GPU",
  os_name: "macOS",
  hostname: "studio-mbp",
  uptime_secs: 183600,
  collected_at: "2026-11-27T10:00:00Z",
};

const sampleProcesses: DevProcessReport = {
  processes: [
    {
      pid: 9001,
      name: "next-server",
      category: "node",
      memory_bytes: 1200 * 1024 ** 2,
      cpu_pct: 6.1,
      ports: [3000],
      cwd: "/work/app",
      cmd_preview: "node next start",
      runtime_secs: 5000,
      is_zombie_candidate: true,
    },
  ],
  total_dev_memory_bytes: 1200 * 1024 ** 2,
  zombie_count: 1,
  zombie_memory_bytes: 1200 * 1024 ** 2,
  listening_ports_count: 1,
};

const sampleScan: WorkspaceScanReport = {
  projects: [
    {
      name: "alpha-web",
      path: "/work/alpha-web",
      workspace_label: "work",
      stack: ["React", "Vite"],
      git_branch: "main",
      git_dirty_count: 3,
      git_last_commit: "feat: dashboard",
      progress_done: 4,
      progress_total: 5,
      progress_pct: 80,
      live_url: "https://alpha.example.com",
      reclaimable_bytes: 2 * 1024 ** 3,
      reclaimable_dirs: [
        {
          name: "node_modules",
          path: "/work/alpha-web/node_modules",
          size_bytes: 2 * 1024 ** 3,
        },
      ],
      last_modified_days_ago: 1,
    },
  ],
  total_projects: 1,
  dirty_projects: 1,
  total_reclaimable_bytes: 2 * 1024 ** 3,
};

describe("OverviewView", () => {
  it("renders onboarding card when workspaces list is empty and triggers add workspace", () => {
    const onAddWorkspace = vi.fn();
    render(
      <OverviewView
        metrics={sampleMetrics}
        processes={sampleProcesses}
        workspaces={[]}
        scanReport={null}
        uptimeMap={{}}
        loading={false}
        onRefresh={vi.fn()}
        onAddWorkspace={onAddWorkspace}
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByText("İlk İş Klasörünü Bağla")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /\+ İş Klasörünü Seç/i })
    );
    expect(onAddWorkspace).toHaveBeenCalledTimes(1);
  });

  it("renders 4 hardware cards and navigates via Urgent Ops Strip", () => {
    const onNavigate = vi.fn();
    render(
      <OverviewView
        metrics={sampleMetrics}
        processes={sampleProcesses}
        workspaces={[
          {
            id: 1,
            path: "/work",
            label: "work",
            created_at: "2026-11-27T09:00:00Z",
          },
        ]}
        scanReport={sampleScan}
        uptimeMap={{
          "/work/alpha-web": {
            project_path: "/work/alpha-web",
            url: "https://alpha.example.com",
            status_code: 503,
            latency_ms: 410,
            state: "down",
          },
        }}
        loading={false}
        onRefresh={vi.fn()}
        onAddWorkspace={vi.fn()}
        onNavigate={onNavigate}
      />
    );

    expect(screen.queryByText("İlk İş Klasörünü Bağla")).not.toBeInTheDocument();
    expect(screen.getByText("42.3%")).toBeInTheDocument();
    expect(screen.getByText("79.2%")).toBeInTheDocument();
    expect(screen.getByText("Yüksek")).toBeInTheDocument();
    expect(screen.getByText("64°C")).toBeInTheDocument();
    expect(screen.getByText("next-server")).toBeInTheDocument();
    expect(screen.getByText("alpha-web")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Zombi Dev Süreçleri/i }));
    expect(onNavigate).toHaveBeenCalledWith("processes", {
      processFilter: "zombie",
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Geri Kazanılabilir Disk/i })
    );
    expect(onNavigate).toHaveBeenCalledWith("projects", {
      projectFilter: "bloated",
    });

    fireEvent.click(screen.getByRole("button", { name: /Kirli Git Repoları/i }));
    expect(onNavigate).toHaveBeenCalledWith("projects", {
      projectFilter: "dirty",
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Çevrimdışı Canlı Siteler/i })
    );
    expect(onNavigate).toHaveBeenCalledWith("projects", {
      projectFilter: "live",
    });
  });
});
