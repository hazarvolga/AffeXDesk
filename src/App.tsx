import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import {
  BookOpen,
  CheckCircle2,
  Clapperboard,
  Cpu,
  Flame,
  FolderGit2,
  GitBranch,
  HardDrive,
  LayoutDashboard,
  MemoryStick,
  Music,
  Pin,
  PinOff,
  Settings,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  Users,
  X,
} from "lucide-react";
import {
  api,
  type ClientProjectRecord,
  type ClientRecord,
  type DevProcessReport,
  type ProjectInfo,
  type SocialBridgeSnapshot,
  type SystemMetrics,
  type UptimeResult,
  type WorkspaceRecord,
  type WorkspaceScanReport,
} from "./lib/api";
import { formatBytes, formatPct, formatUptime } from "./lib/format";
import {
  OverviewView,
  type NavTab,
  type ProcessFilter,
  type ProjectFilter,
} from "./components/OverviewView";
import { ProcessesView } from "./components/ProcessesView";
import { ProjectsView } from "./components/ProjectsView";
import {
  clearDiskAnalyzerCache,
  DiskAnalyzerView,
} from "./components/DiskAnalyzerView";
import { clearSmartCleanerUiCache } from "./components/SmartCleanerPanel";
import { ClientsView } from "./components/ClientsView";
import { GitView } from "./components/GitView";
import { KnowledgeView } from "./components/KnowledgeView";
import { StudioDevOpsView } from "./components/StudioDevOpsView";
import { SettingsView } from "./components/SettingsView";
import { AiDrawer } from "./components/AiDrawer";
import { BootSplash } from "./components/BootSplash";
import { EdgeEqualizer } from "./components/EdgeEqualizer";
import { ArcadeOverlay } from "./components/ArcadeOverlay";
import { useI18n } from "./lib/i18n";

interface ToastMessage {
  id: number;
  tone: "success" | "error" | "info";
  text: string;
}

const NAV_ITEMS: Array<{
  id: NavTab;
  labelKey: string;
  shortcut: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "overview", labelKey: "nav.overview", shortcut: "1", icon: LayoutDashboard },
  { id: "processes", labelKey: "nav.processes", shortcut: "2", icon: Cpu },
  { id: "projects", labelKey: "nav.projects", shortcut: "3", icon: FolderGit2 },
  { id: "disk", labelKey: "nav.disk", shortcut: "4", icon: HardDrive },
  { id: "clients", labelKey: "nav.clients", shortcut: "5", icon: Users },
  { id: "git", labelKey: "nav.git", shortcut: "6", icon: GitBranch },
  { id: "knowledge", labelKey: "nav.knowledge", shortcut: "7", icon: BookOpen },
  {
    id: "studio",
    labelKey: "nav.studio",
    shortcut: "8",
    icon: Clapperboard,
  },
  { id: "settings", labelKey: "nav.settings", shortcut: "9", icon: Settings },
];

export default function App() {
  const { lang, setLang, t } = useI18n();
  const [bootStage, setBootStage] = useState<"splash" | "entering" | "ready">(
    () => {
      const mode = (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE;
      if (mode === "test") return "ready";
      if (
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ) {
        return "ready";
      }
      return "splash";
    }
  );
  const [activeTab, setActiveTab] = useState<NavTab>("overview");
  const [processFilter, setProcessFilter] = useState<ProcessFilter>("all");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [floatingHudOpen, setFloatingHudOpen] = useState(false);
  const [eqMode, setEqMode] = useState<"auto" | "live" | "off">("auto");
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioTrack, setAudioTrack] = useState<string | null>(null);
  const [arcadeOpen, setArcadeOpen] = useState(false);

  const [version, setVersion] = useState<string>("0.1.0");
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [processes, setProcesses] = useState<DevProcessReport | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [scanReport, setScanReport] = useState<WorkspaceScanReport | null>(null);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [clientProjects, setClientProjects] = useState<ClientProjectRecord[]>([]);
  const [uptimeMap, setUptimeMap] = useState<Record<string, UptimeResult>>({});
  const [socialSnapshot, setSocialSnapshot] =
    useState<SocialBridgeSnapshot | null>(null);
  const [loadingSocial, setLoadingSocial] = useState(false);
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

  const refreshClientsAndProjects = useCallback(async () => {
    try {
      const [cRes, pRes] = await Promise.allSettled([
        api.listClients(),
        api.listClientProjects(),
      ]);
      if (cRes.status === "fulfilled") setClients(cRes.value);
      if (pRes.status === "fulfilled") setClientProjects(pRes.value);
    } catch {
      // yoksay
    }
  }, []);

  const handleAssignProjectToClient = useCallback(
    async (
      project: ProjectInfo,
      clientId: number | null,
      clientNameHint?: string
    ) => {
      try {
        const existing = clientProjects.find(
          (cp) => cp.local_path && cp.local_path === project.path
        );
        if (clientId === null) {
          if (existing) {
            await api.deleteClientProject(existing.id);
            showToast(
              "info",
              `${project.name} müşteri bağlantısından çıkarıldı.`
            );
          }
        } else {
          await api.saveClientProject({
            id: existing?.id ?? null,
            client_id: clientId,
            title: existing?.title || project.name,
            status: existing?.status || "active",
            priority: existing?.priority || "normal",
            progress_pct:
              existing !== undefined
                ? existing.progress_pct
                : project.progress_pct ?? 20,
            due_date: existing?.due_date || "",
            local_path: project.path,
            live_url: existing?.live_url || project.live_url || "",
            notes: existing?.notes || "",
          });
          const clientName =
            clientNameHint ||
            clients.find((c) => c.id === clientId)?.name ||
            "Müşteri";
          showToast(
            "success",
            `${project.name} → ${clientName} müşterisine bağlandı.`
          );
        }
        await refreshClientsAndProjects();
      } catch (err) {
        showToast("error", `Müşteri atanamadı: ${String(err)}`);
      }
    },
    [clientProjects, clients, refreshClientsAndProjects, showToast]
  );

  const handleConnectRemoteClient = useCallback(
    async (client: ClientRecord) => {
      if (!client.remote_id.trim()) {
        showToast(
          "info",
          `${client.name} için henüz Uzak Bağlantı ID tanımlanmamış.`
        );
        return;
      }
      try {
        const uri = await api.connectRemoteClient(client.id);
        showToast("success", `${client.name} bağlantısı başlatıldı (${uri}).`);
        void refreshClientsAndProjects();
      } catch (err) {
        showToast("error", String(err));
      }
    },
    [refreshClientsAndProjects, showToast]
  );

  const refreshSocialSnapshot = useCallback(async () => {
    setLoadingSocial(true);
    try {
      const snap = await api.fetchSocialSnapshot();
      setSocialSnapshot(snap);
    } catch {
      // MCP sunucusu kapalıysa sessiz kal
    } finally {
      setLoadingSocial(false);
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
      await Promise.all([
        refreshTelemetry(),
        refreshWorkspacesAndProjects(),
        refreshClientsAndProjects(),
        refreshSocialSnapshot(),
      ]);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [
    refreshTelemetry,
    refreshWorkspacesAndProjects,
    refreshClientsAndProjects,
    refreshSocialSnapshot,
  ]);

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

  // Meta/Alt + 1..8 ve Meta/Ctrl + K klavye kısayolları
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        return;
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setAiDrawerOpen((prev) => !prev);
        return;
      }

      if (!(event.metaKey || event.altKey) || event.ctrlKey || event.shiftKey) {
        return;
      }
      const map: Record<string, NavTab> = {
        "1": "overview",
        "2": "processes",
        "3": "projects",
        "4": "disk",
        "5": "clients",
        "6": "git",
        "7": "knowledge",
        "8": "studio",
        "9": "settings",
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
        clearDiskAnalyzerCache();
        clearSmartCleanerUiCache();
        await Promise.all([
          refreshWorkspacesAndProjects(),
          refreshTelemetry(),
        ]);
      } catch (err) {
        showToast("error", `Temizlik başarısız: ${String(err)}`);
      }
    },
    [refreshWorkspacesAndProjects, refreshTelemetry, showToast]
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
        if (next.module_social_bridge === "true") {
          void refreshSocialSnapshot();
        }
      } catch (err) {
        showToast("error", `Ayarlar kaydedilemedi: ${String(err)}`);
      }
    },
    [refreshSocialSnapshot, showToast]
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

  const showSocialCard =
    settings.module_social_bridge === "true" ||
    Boolean(socialSnapshot?.connected);

  const handleToggleFloatingHud = useCallback(async () => {
    try {
      const next = !floatingHudOpen;
      const active = await api.setFloatingHud(next);
      setFloatingHudOpen(active);
      showToast(
        "info",
        active
          ? "Üst telemetri bandı masaüstüne sabitlendi (sürükleyerek taşıyabilirsiniz)."
          : "Üst telemetri bandı kapatıldı."
      );
    } catch (err) {
      showToast("error", `Üst bant değiştirilemedi: ${String(err)}`);
    }
  }, [floatingHudOpen, showToast]);

  useEffect(() => {
    const mode = (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE;
    if (mode === "test") return;
    void api
      .getFloatingHudStatus()
      .then((active) => setFloatingHudOpen(Boolean(active)))
      .catch(() => {});
  }, []);

  // Poll macOS/Linux system audio playback (zero microphone permission) for Edge Equalizer
  useEffect(() => {
    const mode = (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE;
    if (mode === "test" || eqMode === "off") {
      setAudioPlaying(false);
      return;
    }
    let alive = true;
    const check = async () => {
      try {
        const st = await api.getAudioPlaybackStatus();
        if (!alive) return;
        setAudioPlaying(Boolean(st?.playing));
        setAudioTrack(st?.track ?? null);
      } catch {
        // yoksay
      }
    };
    void check();
    const timer = window.setInterval(() => {
      void check();
    }, 2500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [eqMode]);

  const shellRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const handleBootComplete = useCallback(() => {
    setBootStage("entering");
    window.setTimeout(() => {
      setBootStage("ready");
    }, 950);
  }, []);

  // GSAP orchestrated shell entrance right after WebGL warp-dive completes
  useLayoutEffect(() => {
    const mode = (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE;
    if (mode === "test" || bootStage !== "entering" || !shellRef.current) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".sidebar",
        { x: -24, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.52, ease: "power3.out", clearProps: "transform,opacity" }
      );
      gsap.fromTo(
        ".sidebar .nav-item",
        { x: -14, opacity: 0 },
        {
          x: 0,
          opacity: 1,
          duration: 0.42,
          stagger: 0.032,
          delay: 0.08,
          ease: "power3.out",
          clearProps: "transform,opacity",
        }
      );
      gsap.fromTo(
        ".telemetry-ribbon",
        { y: -14, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.44, delay: 0.1, ease: "power3.out", clearProps: "transform,opacity" }
      );
    }, shellRef);

    return () => ctx.revert();
  }, [bootStage]);

  // GSAP 3D-perspective staggered card choreography on boot reveal & every tab switch
  useLayoutEffect(() => {
    const mode = (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE;
    if (mode === "test" || bootStage === "splash" || !stageRef.current) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      const targets = stageRef.current?.querySelectorAll(
        ".metric-card, .panel, .project-card, .client-card, .quick-win-card, .cleaner-row"
      );
      if (!targets || targets.length === 0) return;
      const isBoot = bootStage === "entering";
      gsap.fromTo(
        targets,
        {
          y: isBoot ? 28 : 16,
          rotateX: isBoot ? 7 : 3,
          scale: isBoot ? 0.955 : 0.98,
          opacity: 0,
          transformPerspective: 900,
          transformOrigin: "50% 0%",
        },
        {
          y: 0,
          rotateX: 0,
          scale: 1,
          opacity: 1,
          duration: isBoot ? 0.56 : 0.34,
          stagger: { amount: isBoot ? 0.3 : 0.16, from: "start" },
          delay: isBoot ? 0.08 : 0,
          ease: "power3.out",
          clearProps: "transform,opacity",
        }
      );
    }, stageRef);

    return () => ctx.revert();
  }, [activeTab, bootStage]);

  return (
    <div
      ref={shellRef}
      className={`app-shell${
        bootStage === "splash" ? " app-shell--booting" : ""
      }`}
    >
      {bootStage === "splash" && (
        <BootSplash
          version={version}
          metrics={metrics}
          processes={processes}
          projects={scanReport?.projects ?? []}
          clients={clients}
          clientProjectsCount={clientProjects.length}
          onComplete={handleBootComplete}
        />
      )}
      <EdgeEqualizer
        playing={audioPlaying}
        enabled={eqMode !== "off"}
        liveMicReactive={eqMode === "live"}
      />
      {arcadeOpen && <ArcadeOverlay onClose={() => setArcadeOpen(false)} />}
      <aside className="sidebar" aria-label="Ana Gezinme">
        <div className="brand">
          <button
            type="button"
            className="brand__mark brand__mark--interactive"
            onClick={() => setBootStage("splash")}
            title="Açılış animasyonunu tekrar oynat"
            aria-label="AffeXDesk açılış animasyonunu oynat"
          >
            <TerminalSquare size={18} />
          </button>
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
                <span className="nav-item__label">{t(item.labelKey)}</span>
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

        <button
          type="button"
          className={`hud-pin-btn ${floatingHudOpen ? "hud-pin-btn--active" : ""}`}
          onClick={() => void handleToggleFloatingHud()}
          title="Masaüstünde her zaman en üstte görünen telemetri bandını aç/kapat"
        >
          {floatingHudOpen ? (
            <PinOff size={14} className="text-emerald" />
          ) : (
            <Pin size={14} className="text-cyan" />
          )}
          <span className="nav-item__label">
            {floatingHudOpen ? t("nav.hud_on") : t("nav.hud_pin")}
          </span>
        </button>

        <div className="sidebar-bottom-row">
          <button
            type="button"
            className={`ai-trigger-btn ${aiDrawerOpen ? "ai-trigger-btn--active" : ""}`}
            style={{ flex: 1, marginBottom: 0 }}
            onClick={() => setAiDrawerOpen(true)}
          >
            <Sparkles size={15} className="text-cyan" />
            <span className="nav-item__label">{t("nav.ai_assistant")}</span>
            <kbd className="nav-kbd">⌘K</kbd>
          </button>

          <button
            type="button"
            className="lang-switch-btn mono"
            onClick={() => setLang(lang === "tr" ? "en" : "tr")}
            title={lang === "tr" ? "Switch UI to English" : "Arayüzü Türkçeye çevir"}
            aria-label="Dil Değiştir / Switch Language"
          >
            {lang === "tr" ? "EN" : "TR"}
          </button>
        </div>

        <div
          className="sidebar__footer sidebar__footer--arcade"
          onClick={() => setArcadeOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setArcadeOpen(true);
            }
          }}
          title="Gizli Arcade Modu: Card Invaders'ı başlatmak için tıklayın"
        >
          <div className="status-dot-row">
            <span className="status-dot status-dot--live" />
            <span className="truncate">
              {metrics?.hostname || "Mission Control"}
            </span>
            <button
              type="button"
              className={`eq-toggle-btn${
                eqMode === "live"
                  ? " eq-toggle-btn--fft"
                  : eqMode === "auto" && audioPlaying
                  ? " eq-toggle-btn--live"
                  : ""
              }`}
              onClick={(e) => {
                e.stopPropagation();
                setEqMode((prev) =>
                  prev === "auto" ? "live" : prev === "live" ? "off" : "auto"
                );
              }}
              title={
                eqMode === "auto"
                  ? "Equalizer: Otomatik (Canlı Ritim FFT modu için tıklayın)"
                  : eqMode === "live"
                  ? "Equalizer: Canlı Ritim FFT (Mikrofon/Hoparlör ritmine tepki verir — kapatmak için tıklayın)"
                  : "Equalizer: Kapalı (Açmak için tıklayın)"
              }
              aria-label="Müzik Equalizer Modu"
            >
              <Music size={12} />
            </button>
          </div>
          {eqMode !== "off" && audioPlaying && audioTrack ? (
            <span className="text-cyan mono truncate" style={{ fontSize: 10.5 }} title={audioTrack}>
              ♪ {audioTrack}
            </span>
          ) : (
            <span className="muted mono truncate">
              {metrics?.os_name || t("nav.local_telemetry")}
            </span>
          )}
        </div>
      </aside>

      <main className="main-content">
        {activeTab !== "overview" && metrics && (
          <div
            className="telemetry-ribbon"
            role="region"
            aria-label="Canlı Sistem Telemetrisi"
          >
            <button
              type="button"
              className="telemetry-ribbon__item"
              onClick={() => setActiveTab("overview")}
              title="Genel Bakış ekranına git"
            >
              <Cpu size={13} className="text-cyan" />
              <span className="telemetry-ribbon__label">CPU</span>
              <strong className="telemetry-ribbon__value tabular">
                {formatPct(metrics.cpu_usage_pct)}
              </strong>
              <span className="telemetry-ribbon__bar">
                <span
                  className={`telemetry-ribbon__fill ${
                    metrics.cpu_usage_pct > 85
                      ? "progress-fill--danger"
                      : metrics.cpu_usage_pct > 65
                      ? "progress-fill--warning"
                      : "progress-fill--cyan"
                  }`}
                  style={{ width: `${Math.min(100, metrics.cpu_usage_pct)}%` }}
                />
              </span>
              <span className="telemetry-ribbon__meta tabular">
                {metrics.cpu_cores}c
              </span>
            </button>

            <span className="telemetry-ribbon__sep" aria-hidden="true" />

            <button
              type="button"
              className="telemetry-ribbon__item"
              onClick={() => setActiveTab("processes")}
              title="Süreçler ve RAM dağılımını aç"
            >
              <MemoryStick size={13} className="text-indigo" />
              <span className="telemetry-ribbon__label">RAM</span>
              <strong className="telemetry-ribbon__value tabular">
                {formatPct(metrics.mem_used_pct)}
              </strong>
              <span className="telemetry-ribbon__bar">
                <span
                  className={`telemetry-ribbon__fill ${
                    metrics.mem_pressure === "critical"
                      ? "progress-fill--danger"
                      : metrics.mem_pressure === "warn"
                      ? "progress-fill--warning"
                      : "progress-fill--indigo"
                  }`}
                  style={{ width: `${Math.min(100, metrics.mem_used_pct)}%` }}
                />
              </span>
              <span className="telemetry-ribbon__meta tabular">
                {formatBytes(metrics.mem_used_bytes)} /{" "}
                {formatBytes(metrics.mem_total_bytes)}
              </span>
            </button>

            <span className="telemetry-ribbon__sep" aria-hidden="true" />

            <button
              type="button"
              className="telemetry-ribbon__item"
              onClick={() => setActiveTab("disk")}
              title="Disk Analizi ekranına git"
            >
              <HardDrive size={13} className="text-emerald" />
              <span className="telemetry-ribbon__label">{t("telem.disk")}</span>
              <strong className="telemetry-ribbon__value tabular">
                {formatPct(metrics.disk_used_pct)}
              </strong>
              <span className="telemetry-ribbon__bar">
                <span
                  className={`telemetry-ribbon__fill ${
                    metrics.disk_used_pct > 85
                      ? "progress-fill--danger"
                      : metrics.disk_used_pct > 75
                      ? "progress-fill--warning"
                      : "progress-fill--emerald"
                  }`}
                  style={{ width: `${Math.min(100, metrics.disk_used_pct)}%` }}
                />
              </span>
              <span className="telemetry-ribbon__meta tabular">
                {formatBytes(metrics.disk_available_bytes)} {t("telem.disk_free")}
              </span>
            </button>

            <span className="telemetry-ribbon__sep" aria-hidden="true" />

            <div className="telemetry-ribbon__item telemetry-ribbon__item--static">
              <Flame
                size={13}
                className={
                  metrics.thermal_state === "critical"
                    ? "text-danger"
                    : metrics.thermal_state === "serious"
                    ? "text-warning"
                    : metrics.thermal_state === "fair"
                    ? "text-cyan"
                    : "muted"
                }
              />
              <span className="telemetry-ribbon__label">{t("telem.thermal")}</span>
              <strong className="telemetry-ribbon__value tabular">
                {metrics.temperature_c !== null
                  ? `${Math.round(metrics.temperature_c)}°C`
                  : "—"}
              </strong>
              <span
                className={`badge ${
                  metrics.thermal_state === "critical"
                    ? "badge--danger"
                    : metrics.thermal_state === "serious"
                    ? "badge--warning"
                    : metrics.thermal_state === "fair"
                    ? "badge--info"
                    : "badge--success"
                }`}
              >
                {metrics.thermal_state === "critical"
                  ? t("telem.critical")
                  : metrics.thermal_state === "serious"
                  ? t("telem.serious")
                  : metrics.thermal_state === "fair"
                  ? t("telem.fair")
                  : t("telem.nominal")}
              </span>
            </div>

            <div className="telemetry-ribbon__right mono tabular">
              {formatUptime(metrics.uptime_secs)}
            </div>
          </div>
        )}

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

        <div key={activeTab} ref={stageRef} className="tab-stage">
          {activeTab === "overview" && (
            <OverviewView
              metrics={metrics}
              processes={processes}
              workspaces={workspaces}
              scanReport={scanReport}
              uptimeMap={uptimeMap}
              socialSnapshot={socialSnapshot}
              showSocialCard={showSocialCard}
              loadingSocial={loadingSocial}
              onRefreshSocial={() => void refreshSocialSnapshot()}
              loading={loadingTelemetry || loadingProjects}
              onRefresh={() => {
                void refreshTelemetry();
                void refreshWorkspacesAndProjects();
                if (showSocialCard) void refreshSocialSnapshot();
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
              onNotify={showToast}
            />
          )}

          {activeTab === "projects" && (
            <ProjectsView
              scanReport={scanReport}
              uptimeMap={uptimeMap}
              loading={loadingProjects}
              checkingUptime={checkingUptime}
              filter={projectFilter}
              clients={clients}
              clientProjects={clientProjects}
              onAssignClient={handleAssignProjectToClient}
              onConnectRemote={(client) => void handleConnectRemoteClient(client)}
              onFilterChange={setProjectFilter}
              onAddWorkspace={() => void handleAddWorkspace()}
              onRescan={() => void refreshWorkspacesAndProjects()}
              onCheckAllUptime={() => void handleCheckAllUptime()}
              onCleanCaches={handleCleanCaches}
              onSaveProjectUrl={handleSaveProjectUrl}
              onOpenFinder={(p) => void handleOpenFinder(p)}
              onOpenIde={(p) => void handleOpenIde(p)}
              onOpenUrl={(u) => void handleOpenUrl(u)}
              onNotify={showToast}
            />
          )}

          {activeTab === "disk" && (
            <DiskAnalyzerView
              onOpenFinder={(p) => void handleOpenFinder(p)}
              onRefreshTelemetry={refreshTelemetry}
              onNotify={showToast}
            />
          )}

          {activeTab === "clients" && (
            <ClientsView
              clients={clients}
              projects={clientProjects}
              workspaces={workspaces}
              workspaceProjects={scanReport?.projects ?? []}
              onReloadClients={refreshClientsAndProjects}
              onRescanWorkspaces={refreshWorkspacesAndProjects}
              onAddWorkspace={() => void handleAddWorkspace()}
              onAssignProject={handleAssignProjectToClient}
              onConnectRemote={handleConnectRemoteClient}
              onOpenFinder={(p) => void handleOpenFinder(p)}
              onOpenIde={(p) => void handleOpenIde(p)}
              onOpenUrl={(u) => void handleOpenUrl(u)}
              onNotify={showToast}
            />
          )}

          {activeTab === "git" && (
            <GitView
              workspaces={workspaces}
              onOpenIde={(p) => void handleOpenIde(p)}
              onOpenUrl={(u) => void handleOpenUrl(u)}
              onOpenFinder={(p) => void handleOpenFinder(p)}
              onNavigateSettings={() => setActiveTab("settings")}
              onProjectsChanged={refreshWorkspacesAndProjects}
              onNotify={showToast}
            />
          )}

          {activeTab === "knowledge" && (
            <KnowledgeView
              settings={settings}
              onSaveSettings={handleSaveSettings}
              onOpenFinder={(p) => void handleOpenFinder(p)}
              onNotify={showToast}
            />
          )}

          {activeTab === "studio" && (
            <StudioDevOpsView
              onOpenFinder={(p) => void handleOpenFinder(p)}
              onRefreshTelemetry={refreshTelemetry}
              onNotify={showToast}
            />
          )}

          {activeTab === "settings" && (
            <SettingsView
              workspaces={workspaces}
              settings={settings}
              onAddWorkspace={() => void handleAddWorkspace()}
              onRemoveWorkspace={handleRemoveWorkspace}
              onSaveSettings={handleSaveSettings}
              onNotify={showToast}
            />
          )}
        </div>
      </main>

      <AiDrawer
        open={aiDrawerOpen}
        onClose={() => setAiDrawerOpen(false)}
        onNavigate={(tab) => setActiveTab(tab)}
        onRefreshTelemetry={refreshTelemetry}
        onRefreshWorkspaces={refreshWorkspacesAndProjects}
        onNotify={showToast}
      />
    </div>
  );
}
