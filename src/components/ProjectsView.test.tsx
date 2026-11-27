import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectsView } from "./ProjectsView";
import type { WorkspaceScanReport } from "../lib/api";

const report: WorkspaceScanReport = {
  projects: [
    {
      name: "mission-ui",
      path: "/dev/mission-ui",
      workspace_label: "dev",
      stack: ["TypeScript", "Tauri"],
      git_branch: "feat/v1",
      git_dirty_count: 4,
      git_last_commit: "wip",
      progress_done: 7,
      progress_total: 10,
      progress_pct: 70,
      live_url: "https://mission.example.com",
      reclaimable_bytes: 1.5 * 1024 ** 3,
      reclaimable_dirs: [
        {
          name: "node_modules",
          path: "/dev/mission-ui/node_modules",
          size_bytes: 1.0 * 1024 ** 3,
        },
        {
          name: "target",
          path: "/dev/mission-ui/src-tauri/target",
          size_bytes: 0.5 * 1024 ** 3,
        },
      ],
      last_modified_days_ago: 0,
    },
    {
      name: "clean-lib",
      path: "/dev/clean-lib",
      workspace_label: "dev",
      stack: ["Rust"],
      git_branch: "main",
      git_dirty_count: 0,
      git_last_commit: "release",
      progress_done: 0,
      progress_total: 0,
      progress_pct: null,
      live_url: null,
      reclaimable_bytes: 0,
      reclaimable_dirs: [],
      last_modified_days_ago: 5,
    },
  ],
  total_projects: 2,
  dirty_projects: 1,
  total_reclaimable_bytes: 1.5 * 1024 ** 3,
};

describe("ProjectsView", () => {
  it("renders project cards, uptime badge, and confirms cache cleanup via ConfirmDialog", async () => {
    const onCleanCaches = vi.fn().mockResolvedValue(undefined);
    const onOpenFinder = vi.fn();
    const onOpenIde = vi.fn();
    const onOpenUrl = vi.fn();

    render(
      <ProjectsView
        scanReport={report}
        uptimeMap={{
          "/dev/mission-ui": {
            project_path: "/dev/mission-ui",
            url: "https://mission.example.com",
            status_code: 200,
            latency_ms: 42,
            state: "online",
          },
        }}
        loading={false}
        checkingUptime={false}
        filter="all"
        onFilterChange={vi.fn()}
        onAddWorkspace={vi.fn()}
        onRescan={vi.fn()}
        onCheckAllUptime={vi.fn()}
        onCleanCaches={onCleanCaches}
        onSaveProjectUrl={vi.fn().mockResolvedValue(undefined)}
        onOpenFinder={onOpenFinder}
        onOpenIde={onOpenIde}
        onOpenUrl={onOpenUrl}
      />
    );

    expect(screen.getByText("mission-ui")).toBeInTheDocument();
    expect(screen.getByText("200 · 42ms")).toBeInTheDocument();
    expect(screen.getByText("7/10 (70%)")).toBeInTheDocument();

    // Open cache cleanup confirm dialog
    fireEvent.click(screen.getByRole("button", { name: /Temizle \(1\.5 GB\)/i }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent("/dev/mission-ui/node_modules");

    const confirmBtns = screen.getAllByRole("button", {
      name: /Temizle \(1\.5 GB\)/i,
    });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => {
      expect(onCleanCaches).toHaveBeenCalledWith(
        ["/dev/mission-ui/node_modules", "/dev/mission-ui/src-tauri/target"],
        "mission-ui"
      );
    });

    // Quick action buttons
    fireEvent.click(screen.getAllByRole("button", { name: /Finder/i })[0]);
    expect(onOpenFinder).toHaveBeenCalledWith("/dev/mission-ui");

    fireEvent.click(screen.getAllByRole("button", { name: /IDE/i })[0]);
    expect(onOpenIde).toHaveBeenCalledWith("/dev/mission-ui");

    fireEvent.click(screen.getAllByRole("button", { name: /Site/i })[0]);
    expect(onOpenUrl).toHaveBeenCalledWith("https://mission.example.com");
  });

  it("supports inline URL editing and saving", async () => {
    const onSaveProjectUrl = vi.fn().mockResolvedValue(undefined);

    render(
      <ProjectsView
        scanReport={report}
        uptimeMap={{}}
        loading={false}
        checkingUptime={false}
        filter="all"
        onFilterChange={vi.fn()}
        onAddWorkspace={vi.fn()}
        onRescan={vi.fn()}
        onCheckAllUptime={vi.fn()}
        onCleanCaches={vi.fn().mockResolvedValue(undefined)}
        onSaveProjectUrl={onSaveProjectUrl}
        onOpenFinder={vi.fn()}
        onOpenIde={vi.fn()}
        onOpenUrl={vi.fn()}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /clean-lib URL düzenle/i })
    );
    const input = screen.getByLabelText("clean-lib canlı URL");
    fireEvent.change(input, { target: { value: "https://clean-lib.dev" } });
    fireEvent.click(screen.getByRole("button", { name: /URL kaydet/i }));

    await waitFor(() => {
      expect(onSaveProjectUrl).toHaveBeenCalledWith(
        "/dev/clean-lib",
        "https://clean-lib.dev"
      );
    });
  });
});
