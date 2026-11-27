import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Cpu,
  FolderGit2,
  LayoutDashboard,
  Settings,
  ShieldAlert,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  api,
  type DevProcessReport,
  type SystemMetrics,
  type UptimeResult,
  type WorkspaceRecord,
  type WorkspaceScanReport,
} from "./lib/api";
import { formatBytes } from "./lib/format";
import {
  OverviewView,
  type NavTab,
  type ProcessFilter,
  type ProjectFilter,
} from "./components/OverviewView";
import { ProcessesView } from "./components/ProcessesView";
import { ProjectsView } from "./components/ProjectsView";
import { SettingsView } from "./components/SettingsView";

interface ToastMessage {
  id: number;
  tone: "success" | "error" | "info";
  text: string;
}

const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  shortcut: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "overview", label: "Genel Bakış", shortcut: "1", icon: LayoutDashboard },
  { id: "processes", label: "Süreçler", shortcut: "2", icon: Cpu },
  { id: "projects", label: "Projeler", shortcut: "3", icon: FolderGit2 },
  { id: "settings", label: "Ayarlar", shortcut: "4", icon: Settings },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>("overview");
  const [processFilter, setProcessFilter] = useState<ProcessFilter>("all");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");

  const [version, setVersion] = useState<string>("0.1.0");
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [processes, setProcesses] = useState<DevProcessReport | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [scanReport, setScanReport] = useState<WorkspaceScanReport | null>(null);
  const [uptimeMap, setUptimeMap] = useState<Record<string, UptimeResult>>({});
  const [settings, setSettings] = useState<Record<string, string>>({
    default_ide: "code",
    refresh_interval_secs: "5",
  });

  const [loadingTelemetry, setLoadingTelemetry] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [checkingUptime, setCheckingUptime] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastCounter = useRef(0);

  const showToast = useCallback(
    (tone: ToastMessage["tone"], text: string) => {
      toastCounter.current += 1;
      setToast({ id: toastCounter.current, tone, text });
    },
    []
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const refreshTelemetry = useCallback(async () => {
    setLoadingTelemetry(true);
    try {
      const [metricsRes, procRes] = await Promise.allSettled([
        api.getSystemMetrics(),
        api.scanDevProcesses(),
      ]);
      if (metricsRes.status === "fulfilled") setMetrics(metricsRes.value);
      if (procRes.status === "fulfilled") setProcesses(procRes.value);
    } finally {
      setLoadingTelemetry(false);
    }
  }, []);

  const refreshWorkspacesAndProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const [wsRes, scanRes] = await Promise.allSettled([
        api.listWorkspaces(),
        api.scanWorkspaces(),
      ]);
      if (wsRes.status === "fulfilled") setWorkspaces(wsRes.value);
      if (scanRes.status === "fulfilled") setScanReport(scanRes.value);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  // İlk yükleme
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const [verRes, setRes] = await Promise.allSettled([
        api.appVersion(),
        api.getSettings(),
      ]);
      if (cancelled) return;
      if (verRes.status === "fulfilled") setVersion(verRes.value);
      if (setRes.status === "fulfilled") {
        setSettings((prev) => ({ ...prev, ...setRes.value }));
      }
      await Promise.all([refreshTelemetry(), refreshWorkspacesAndProjects()]);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [refreshTelemetry, refreshWorkspacesAndProjects]);

  // Canlı telemetri döngüsü
  useEffect(() => {
    const secs = Math.max(
      3,
      Number.parseInt(settings.refresh_interval_secs || "5", 10) || 5
    );
    const id = window.setInterval(() => {
      void refreshTelemetry();
    }, secs * 1000);
    return () => window.clearInterval(id);
  }, [settings.refresh_interval_secs, refreshTelemetry]);

  // Meta/Alt + 1..4 klavye kısayolları
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.altKey) || event.ctrlKey || event.shiftKey) {
        return;
      }
      const map: Record<string, NavTab> = {
        "1": "overview",
        "2": "processes",
        "3": "projects",
        "4": "settings",
      };
      const target = map[event.key];
      if (target) {
        event.preventDefault();
        setActiveTab(target);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleNavigate = useCallback(
    (
      tab: NavTab,
      options?: { processFilter?: ProcessFilter; projectFilter?: ProjectFilter }
    ) => {
      if (options?.processFilter) setProcessFilter(options.processFilter);
      if (options?.projectFilter) setProjectFilter(options.projectFilter);
      setActiveTab(tab);
    },
    []
  );

  const handleAddWorkspace = useCallback(async () => {
    try {
      const picked = await api.pickWorkspaceDir();
      if (!picked) return;
      const added = await api.addWorkspace({ path: picked });
      showToast("success", `İş klasörü eklendi: ${added.label}`);
      await refreshWorkspacesAndProjects();
    } catch (err) {
      showToast("error", `İş klasörü eklenemedi: ${String(err)}`);
    }
  }, [refreshWorkspacesAndProjects, showToast]);

  const handleRemoveWorkspace = useCallback(
    async (id: number) => {
      try {
        await api.removeWorkspace({ id });
        showToast("info", "İş klasörü kaldırıldı.");
        await refreshWorkspacesAndProjects();
      } catch (err) {
        showToast("error", `Klasör kaldırılamadı: ${String(err)}`);
      }
    },
    [refreshWorkspacesAndProjects, showToast]
  );

  const handleKillProcess = useCallback(
    async (pid: number, force: boolean) => {
      try {
        await api.killDevProcess({ pid, force });
        showToast(
          "success",
          `PID ${pid} ${force ? "zorla sonlandırıldı" : "kapatıldı"}.`
        );
        await refreshTelemetry();
      } catch (err) {
        showToast("error", `Süreç kapatılamadı (PID ${pid}): ${String(err)}`);
      }
    },
    [refreshTelemetry, showToast]
  );

  const handleCleanCaches = useCallback(
    async (paths: string[], projectName: string) => {
      try {
        const res = await api.cleanProjectCaches({ paths });
        if (res.errors.length > 0) {
          showToast(
            "error",
            `${projectName}: ${formatBytes(res.freed_bytes)} temizlendi, ${
              res.errors.length
            } hata oluştu.`
          );
        } else {
          showToast(
            "success",
            `${projectName}: ${res.cleaned_count} klasör silindi, ${formatBytes(
              res.freed_bytes
            )} geri kazanıldı.`
          );
        }
        await refreshWorkspacesAndProjects();
      } catch (err) {
        showToast("error", `Temizlik başarısız: ${String(err)}`);
      }
    },
    [refreshWorkspacesAndProjects, showToast]
  );

  const handleSaveProjectUrl = useCallback(
    async (projectPath: string, url: string) => {
      try {
        await api.saveProjectUrl({ projectPath, url });
        showToast("success", "Canlı URL kaydedildi.");
        await refreshWorkspacesAndProjects();
      } catch (err) {
        showToast("error", `URL kaydedilemedi: ${String(err)}`);
      }
    },
    [refreshWorkspacesAndProjects, showToast]
  );

  const handleCheckAllUptime = useCallback(async () => {
    const targets: Array<[string, string]> = (scanReport?.projects ?? [])
      .filter((p): p is typeof p & { live_url: string } => Boolean(p.live_url))
      .map((p) => [p.path, p.live_url]);

    if (targets.length === 0) {
      showToast("info", "Kontrol edilecek canlı URL bulunamadı.");
      return;
    }

    setCheckingUptime(true);
    try {
      const results = await api.checkUptime({ targets });
      const nextMap: Record<string, UptimeResult> = {};
      for (const item of results) {
        nextMap[item.project_path] = item;
      }
      setUptimeMap((prev) => ({ ...prev, ...nextMap }));
      const downCount = results.filter((r) => r.state !== "online").length;
      showToast(
        downCount > 0 ? "error" : "success",
        `${results.length} site kontrol edildi (${downCount} sorunlu).`
      );
    } catch (err) {
      showToast("error", `Uptime kontrolü başarısız: ${String(err)}`);
    } finally {
      setCheckingUptime(false);
    }
  }, [scanReport, showToast]);

  const handleSaveSettings = useCallback(
    async (next: Record<string, string>) => {
      try {
        await api.saveSettings({ settings: next });
        setSettings(next);
        showToast("success", "Ayarlar kaydedildi.");
      } catch (err) {
        showToast("error", `Ayarlar kaydedilemedi: ${String(err)}`);
      }
    },
    [showToast]
  );

  const handleOpenFinder = useCallback(
    async (path: string) => {
      try {
        await api.openInFileManager({ path });
      } catch (err) {
        showToast("error", `Dosya yöneticisi açılamadı: ${String(err)}`);
      }
    },
    [showToast]
  );

  const handleOpenIde = useCallback(
    async (path: string) => {
      try {
        await api.openInIde({ path, ide: settings.default_ide || "code" });
      } catch (err) {
        showToast("error", `IDE açılamadı: ${String(err)}`);
      }
    },
    [settings.default_ide, showToast]
  );

  const handleOpenUrl = useCallback(
    async (url: string) => {
      try {
        await api.openUrl({ url });
      } catch (err) {
        showToast("error", `URL açılamadı: ${String(err)}`);
      }
    },
    [showToast]
  );

  const processBadge =
    processes && processes.zombie_count > 0
      ? { count: processes.zombie_count, tone: "danger" as const }
      : processes && processes.processes.length > 0
      ? { count: processes.processes.length, tone: "neutral" as const }
      : null;

  const projectBadge =
    scanReport && scanReport.total_projects > 0
      ? { count: scanReport.total_projects, tone: "neutral" as const }
      : null;

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Ana Gezinme">
        <div className="brand">
          <div className="brand__mark">
            <TerminalSquare size={18} />
          </div>
          <div className="brand__text">
            <strong>AffeXDesk</strong>
            <span className="mono muted">v{version}</span>
          </div>
        </div>

        <nav className="nav-list">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            const badge =
              item.id === "processes"
                ? processBadge
                : item.id === "projects"
                ? projectBadge
                : null;

            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${active ? "nav-item--active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => setActiveTab(item.id)}
              >
                <Icon size={16} aria-hidden="true" />
                <span className="nav-item__label">{item.label}</span>
                {badge && (
                  <span className={`nav-badge nav-badge--${badge.tone} tabular`}>
                    {badge.count}
                  </span>
                )}
                <kbd className="nav-kbd">⌘{item.shortcut}</kbd>
              </button>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          <div className="status-dot-row">
            <span className="status-dot status-dot--live" />
            <span className="truncate">
              {metrics?.hostname || "Mission Control"}
            </span>
          </div>
          <span className="muted mono truncate">
            {metrics?.os_name || "Yerel Telemetri"}
          </span>
        </div>
      </aside>

      <main className="main-content">
        {toast && (
          <div
            role="status"
            className={`toast toast--${toast.tone}`}
            data-testid="app-toast"
          >
            {toast.tone === "error" ? (
              <ShieldAlert size={16} />
            ) : (
              <CheckCircle2 size={16} />
            )}
            <span>{toast.text}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Bildirimi kapat"
              onClick={() => setToast(null)}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {activeTab === "overview" && (
          <OverviewView
            metrics={metrics}
            processes={processes}
            workspaces={workspaces}
            scanReport={scanReport}
            uptimeMap={uptimeMap}
            loading={loadingTelemetry || loadingProjects}
            onRefresh={() => {
              void refreshTelemetry();
              void refreshWorkspacesAndProjects();
            }}
            onAddWorkspace={() => void handleAddWorkspace()}
            onNavigate={handleNavigate}
          />
        )}

        {activeTab === "processes" && (
          <ProcessesView
            report={processes}
            loading={loadingTelemetry}
            filter={processFilter}
            onFilterChange={setProcessFilter}
            onRefresh={() => void refreshTelemetry()}
            onKillProcess={handleKillProcess}
          />
        )}

        {activeTab === "projects" && (
          <ProjectsView
            scanReport={scanReport}
            uptimeMap={uptimeMap}
            loading={loadingProjects}
            checkingUptime={checkingUptime}
            filter={projectFilter}
            onFilterChange={setProjectFilter}
            onAddWorkspace={() => void handleAddWorkspace()}
            onRescan={() => void refreshWorkspacesAndProjects()}
            onCheckAllUptime={() => void handleCheckAllUptime()}
            onCleanCaches={handleCleanCaches}
            onSaveProjectUrl={handleSaveProjectUrl}
            onOpenFinder={(p) => void handleOpenFinder(p)}
            onOpenIde={(p) => void handleOpenIde(p)}
            onOpenUrl={(u) => void handleOpenUrl(u)}
          />
        )}

        {activeTab === "settings" && (
          <SettingsView
            workspaces={workspaces}
            settings={settings}
            onAddWorkspace={() => void handleAddWorkspace()}
            onRemoveWorkspace={handleRemoveWorkspace}
            onSaveSettings={handleSaveSettings}
          />
        )}
      </main>
    </div>
  );
}
