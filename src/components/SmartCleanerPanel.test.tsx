import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSmartCleanerUiCache,
  SmartCleanerPanel,
} from "./SmartCleanerPanel";
import { api, type CleanerScanReport } from "../lib/api";

vi.mock("../lib/api", () => ({
  api: {
    getCachedCleanerScan: vi.fn(),
    scanSystemCleaner: vi.fn(),
    runSystemCleaner: vi.fn(),
    restartDockerDesktop: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

const SAMPLE_SCAN: CleanerScanReport = {
  scanned_at: "2026-11-27T15:00:00Z",
  total_reclaimable_bytes: 400 * 1024 ** 3,
  safe_reclaimable_bytes: 200 * 1024 ** 3,
  review_reclaimable_bytes: 200 * 1024 ** 3,
  docker_available: true,
  items: [
    {
      id: "docker_build_cache",
      title: "Docker Build Cache",
      subtitle: "100 derleme katmanı",
      category: "docker",
      risk: "safe",
      size_bytes: 200 * 1024 ** 3,
      default_selected: true,
      path_hint: "docker builder prune -a -f",
      note: "Tamamen güvenli",
    },
    {
      id: "docker_stopped_containers",
      title: "Durmuş Docker Konteynerleri",
      subtitle: "10 durmuş konteyner",
      category: "docker",
      risk: "review",
      size_bytes: 5 * 1024 ** 2,
      default_selected: false,
      path_hint: "docker container prune -f",
      note: null,
    },
    {
      id: "docker_unused_volumes",
      title: "Kullanılmayan Docker Volume'leri",
      subtitle: "20 volume",
      category: "docker",
      risk: "review",
      size_bytes: 200 * 1024 ** 3,
      default_selected: false,
      path_hint: "docker volume prune -f",
      note: null,
    },
  ],
};

describe("SmartCleanerPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSmartCleanerUiCache();
    mockedApi.getCachedCleanerScan.mockResolvedValue(SAMPLE_SCAN);
    mockedApi.scanSystemCleaner.mockResolvedValue(SAMPLE_SCAN);
  });

  it("enforces mutual exclusion between stopped Docker containers and Docker volumes", async () => {
    const onNotify = vi.fn();
    render(
      <SmartCleanerPanel
        onOpenFinder={vi.fn()}
        onRefreshTelemetry={vi.fn().mockResolvedValue(undefined)}
        onNotify={onNotify}
      />
    );

    const containersBtn = await screen.findByRole("button", {
      name: /Durmuş Docker Konteynerleri/i,
    });
    const volumesBtn = screen.getByRole("button", {
      name: /Kullanılmayan Docker Volume'leri/i,
    });

    fireEvent.click(containersBtn);
    expect(containersBtn).toHaveAttribute("aria-pressed", "true");
    expect(volumesBtn).toHaveAttribute("aria-pressed", "false");

    // Selecting volumes must automatically uncheck stopped containers and notify user
    fireEvent.click(volumesBtn);
    expect(volumesBtn).toHaveAttribute("aria-pressed", "true");
    expect(containersBtn).toHaveAttribute("aria-pressed", "false");
    expect(onNotify).toHaveBeenCalledWith(
      "info",
      expect.stringMatching(/aynı anda seçilemez/i)
    );
  });

  it("runs selected safe clean items through ConfirmDialog and triggers onCleaned", async () => {
    const onCleaned = vi.fn();
    const onNotify = vi.fn();
    mockedApi.runSystemCleaner.mockResolvedValue({
      total_freed_bytes: 200 * 1024 ** 3,
      succeeded: 1,
      failed: 0,
      needs_docker_restart: true,
      results: [
        {
          id: "docker_build_cache",
          title: "Docker Build Cache",
          ok: true,
          freed_bytes: 200 * 1024 ** 3,
          message: "Temizlendi",
        },
      ],
    });

    render(
      <SmartCleanerPanel
        onOpenFinder={vi.fn()}
        onRefreshTelemetry={vi.fn().mockResolvedValue(undefined)}
        onNotify={onNotify}
        onCleaned={onCleaned}
      />
    );

    const cleanBtn = await screen.findByRole("button", {
      name: /Seçilenleri Temizle/i,
    });
    fireEvent.click(cleanBtn);

    const confirmBtn = await screen.findByRole("button", {
      name: /^Temizle \(/i,
    });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockedApi.runSystemCleaner).toHaveBeenCalledWith([
        "docker_build_cache",
      ]);
      expect(onCleaned).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByRole("button", {
        name: /Docker Desktop'ı Yeniden Başlat/i,
      })
    ).toBeInTheDocument();
  });
});
