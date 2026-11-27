import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronRight,
  Cpu,
  File,
  Flame,
  Folder,
  FolderOpen,
  HardDrive,
  Home,
  Lock,
  PieChart,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  api,
  type CategoryTotal,
  type DiskAiModel,
  type DiskBreakdownReport,
} from "../lib/api";
import { formatBytes, formatPct } from "../lib/format";
import { ConfirmDialog } from "./ConfirmDialog";
import { SmartCleanerPanel } from "./SmartCleanerPanel";

export interface DiskAnalyzerViewProps {
  onOpenFinder: (path: string) => void;
  onRefreshTelemetry: () => Promise<void>;
  onNotify: (tone: "success" | "error" | "info", text: string) => void;
}

interface CategoryStyle {
  label: string;
  color: string;
  softBg: string;
}

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  ai_models: {
    label: "AI Modelleri",
    color: "#818cf8",
    softBg: "rgba(129, 140, 248, 0.16)",
  },
  system_cache: {
    label: "Sistem Önbelleği",
    color: "#f59e0b",
    softBg: "rgba(245, 158, 11, 0.16)",
  },
  dev_cache: {
    label: "Dev Cache",
    color: "#38bdf8",
    softBg: "rgba(56, 189, 248, 0.16)",
  },
  downloads: {
    label: "İndirilenler",
    color: "#fb7185",
    softBg: "rgba(251, 113, 133, 0.16)",
  },
  media_render: {
    label: "Medya / Render",
    color: "#c084fc",
    softBg: "rgba(192, 132, 252, 0.16)",
  },
  projects: {
    label: "Projeler",
    color: "#10b981",
    softBg: "rgba(16, 185, 129, 0.16)",
  },
  other: {
    label: "Diğer",
    color: "#64748b",
    softBg: "rgba(100, 116, 139, 0.18)",
  },
};

function getCategoryStyle(category: string, fallbackLabel?: string): CategoryStyle {
  const found = CATEGORY_STYLES[category];
  if (found) return found;
  return {
    label: fallbackLabel || category || "Diğer",
    color: "#64748b",
    softBg: "rgba(100, 116, 139, 0.18)",
  };
}

interface BreadcrumbSegment {
  label: string;
  path: string;
}

function buildBreadcrumbs(rootPath: string): BreadcrumbSegment[] {
  if (!rootPath) return [];
  const normalized = rootPath.replace(/\/+$/, "") || "/";
  if (normalized === "/") {
    return [{ label: "/", path: "/" }];
  }

  const parts = normalized.split("/").filter(Boolean);
  const segments: BreadcrumbSegment[] = [];

  // macOS /Users/<name> veya Linux /home/<name> önekini "~" olarak kısalt
  if (
    parts.length >= 2 &&
    (parts[0] === "Users" || parts[0] === "home")
  ) {
    const homePath = `/${parts[0]}/${parts[1]}`;
    segments.push({ label: "~", path: homePath });
    let acc = homePath;
    for (let i = 2; i < parts.length; i += 1) {
      acc = `${acc}/${parts[i]}`;
      segments.push({ label: parts[i], path: acc });
    }
    return segments;
  }

  let acc = "";
  for (const part of parts) {
    acc = `${acc}/${part}`;
    segments.push({ label: part, path: acc });
  }
  return segments;
}

const DONUT_RADIUS = 82;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;
const DISK_CACHE_STORAGE_KEY = "affexdesk.disk_analyzer.last_state.v1";

interface CachedDiskScan {
  currentDir: string | null;
  report: DiskBreakdownReport;
  scannedAt: string;
  includeProtected?: boolean;
}

const directoryScanCache = new Map<string, CachedDiskScan>();
let lastDiskScanState: CachedDiskScan | null = null;
const inFlightScans = new Map<string, Promise<DiskBreakdownReport>>();
let cachedDiskAiModels: DiskAiModel[] | null = null;

interface DeleteTargetInfo {
  name: string;
  path: string;
  size_bytes: number;
  clean_hint?: string | null;
}

function cacheKeyForDir(dir: string | null, includeProtected = false): string {
  return `${dir ?? "__HOME__"}::${includeProtected ? "full" : "safe"}`;
}

function readPersistedDiskScan(): CachedDiskScan | null {
  if (lastDiskScanState) return lastDiskScanState;
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(DISK_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDiskScan;
    if (!parsed || !parsed.report || typeof parsed.report.root_path !== "string") {
      return null;
    }
    lastDiskScanState = parsed;
    directoryScanCache.set(
      cacheKeyForDir(parsed.currentDir, Boolean(parsed.includeProtected)),
      parsed
    );
    return parsed;
  } catch {
    return null;
  }
}

function persistDiskScan(entry: CachedDiskScan): void {
  lastDiskScanState = entry;
  directoryScanCache.set(
    cacheKeyForDir(entry.currentDir, Boolean(entry.includeProtected)),
    entry
  );
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(DISK_CACHE_STORAGE_KEY, JSON.stringify(entry));
    }
  } catch {
    // localStorage dolu veya erişilemezse yalnızca bellek önbelleğini kullan
  }
}

export function clearDiskAnalyzerCache(): void {
  lastDiskScanState = null;
  directoryScanCache.clear();
  inFlightScans.clear();
  cachedDiskAiModels = null;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(DISK_CACHE_STORAGE_KEY);
    }
  } catch {
    // yoksay
  }
}

function formatScanTime(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString("tr-TR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

export function DiskAnalyzerView({
  onOpenFinder,
  onRefreshTelemetry,
  onNotify,
}: DiskAnalyzerViewProps) {
  const initialCached = useMemo(() => readPersistedDiskScan(), []);
  const [report, setReport] = useState<DiskBreakdownReport | null>(
    () => initialCached?.report ?? null
  );
  const [currentDir, setCurrentDir] = useState<string | null>(
    () => initialCached?.currentDir ?? null
  );
  const [scannedAt, setScannedAt] = useState<string | null>(
    () => initialCached?.scannedAt ?? null
  );
  const [fullDiskMode, setFullDiskMode] = useState<boolean>(
    () => Boolean(initialCached?.includeProtected)
  );
  const [hasFullDiskAccess, setHasFullDiskAccess] = useState<boolean | null>(
    null
  );
  const [subTab, setSubTab] = useState<"map" | "cleaner">("map");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
  const [trashTarget, setTrashTarget] = useState<DeleteTargetInfo | null>(null);
  const [trashing, setTrashing] = useState(false);
  const [permDeleteTarget, setPermDeleteTarget] =
    useState<DeleteTargetInfo | null>(null);
  const [permDeleteStep, setPermDeleteStep] = useState<1 | 2>(1);
  const [permDeleting, setPermDeleting] = useState(false);
  const [aiModels, setAiModels] = useState<DiskAiModel[]>(
    () => cachedDiskAiModels ?? []
  );
  const [aiModelsLoading, setAiModelsLoading] = useState(false);
  const [aiFilter, setAiFilter] = useState<
    "all" | "unused" | "incomplete" | "active"
  >("all");

  const loadRequestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadDirectory = useCallback(
    async (
      targetDir: string | null,
      options?: { force?: boolean; includeProtected?: boolean }
    ) => {
      const useFull = options?.includeProtected ?? fullDiskMode;
      const key = cacheKeyForDir(targetDir, useFull);
      const reqId = ++loadRequestIdRef.current;

      if (!options?.force) {
        const cached = directoryScanCache.get(key);
        if (cached) {
          lastDiskScanState = cached;
          setReport(cached.report);
          setCurrentDir(cached.currentDir);
          setScannedAt(cached.scannedAt);
          setSelectedCategory(null);
          setError(null);
          setLoading(false);
          return;
        }
      }

      setLoading(true);
      setError(null);
      let pending: Promise<DiskBreakdownReport> | undefined;
      try {
        pending = !options?.force ? inFlightScans.get(key) : undefined;
        if (!pending) {
          pending = api.scanDiskBreakdown(targetDir, useFull);
          inFlightScans.set(key, pending);
        }
        const data = await pending;
        if (inFlightScans.get(key) === pending) {
          inFlightScans.delete(key);
        }
        if (!mountedRef.current || loadRequestIdRef.current !== reqId) return;
        const nowIso = new Date().toISOString();
        const entry: CachedDiskScan = {
          currentDir: targetDir,
          report: data,
          scannedAt: nowIso,
          includeProtected: useFull,
        };
        persistDiskScan(entry);
        setReport(data);
        setCurrentDir(targetDir);
        setScannedAt(nowIso);
        setSelectedCategory(null);
      } catch (err) {
        if (pending && inFlightScans.get(key) === pending) {
          inFlightScans.delete(key);
        }
        if (!mountedRef.current || loadRequestIdRef.current !== reqId) return;
        const msg = String(err);
        setError(msg);
        onNotify("error", `Disk taraması başarısız: ${msg}`);
      } finally {
        if (mountedRef.current && loadRequestIdRef.current === reqId) {
          setLoading(false);
        }
      }
    },
    [fullDiskMode, onNotify]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let fda = false;
      try {
        fda = await api.checkFullDiskAccess();
        if (!cancelled) {
          setHasFullDiskAccess(fda);
        }
      } catch {
        // yoksay
      }

      if (report) return;

      try {
        const backendCached = await api.getCachedDiskBreakdown();
        if (cancelled) return;
        if (backendCached && backendCached.report) {
          const includeProtected = Boolean(backendCached.include_protected);
          const entry: CachedDiskScan = {
            currentDir: null,
            report: backendCached.report,
            scannedAt: backendCached.scanned_at,
            includeProtected,
          };
          persistDiskScan(entry);
          setReport(entry.report);
          setCurrentDir(null);
          setScannedAt(entry.scannedAt);
          setFullDiskMode(includeProtected);
          return;
        }
      } catch {
        // Disk önbelleği okunamazsa ilk taramaya düş
      }
      if (!cancelled) {
        setFullDiskMode(fda);
        void loadDirectory(null, { includeProtected: fda });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Yalnızca ilk açılışta kayıtlı tarama yoksa otomatik bir kez tara; sonraki girişlerde disk önbelleği korunur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenFdaSettings = useCallback(async () => {
    try {
      await api.openFullDiskAccessSettings();
      onNotify(
        "info",
        "Tam Disk Erişimi penceresi açıldı. AffeXDesk'i aktif ettikten sonra 'Tam Disk Modu' ile Yeniden Tara'ya basın."
      );
    } catch (err) {
      onNotify("error", `Sistem Ayarları açılamadı: ${String(err)}`);
    }
  }, [onNotify]);

  const handleToggleFullDiskMode = useCallback(() => {
    const next = !fullDiskMode;
    setFullDiskMode(next);
    void loadDirectory(currentDir, { force: true, includeProtected: next });
  }, [fullDiskMode, currentDir, loadDirectory]);

  const loadAiModels = useCallback(async (force = false) => {
    if (!force && cachedDiskAiModels) {
      setAiModels(cachedDiskAiModels);
      return;
    }
    setAiModelsLoading(true);
    try {
      const list = await api.scanDiskAiModels();
      cachedDiskAiModels = list;
      setAiModels(list);
    } catch {
      // AI model taraması başarısız olursa ana disk analizini bozma
    } finally {
      setAiModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAiModels(false);
  }, [loadAiModels]);

  const openPermanentDelete = useCallback((target: DeleteTargetInfo) => {
    setPermDeleteTarget(target);
    setPermDeleteStep(1);
  }, []);

  const handleConfirmPermanentDelete = useCallback(async () => {
    if (!permDeleteTarget) return;
    if (permDeleteStep === 1) {
      setPermDeleteStep(2);
      return;
    }
    setPermDeleting(true);
    try {
      const freed = await api.deletePathPermanently(permDeleteTarget.path);
      onNotify(
        "success",
        `${permDeleteTarget.name} kalıcı olarak silindi (${formatBytes(
          freed || permDeleteTarget.size_bytes
        )}).`
      );
      setPermDeleteTarget(null);
      setPermDeleteStep(1);
      clearDiskAnalyzerCache();
      await Promise.all([
        loadDirectory(currentDir, { force: true }),
        loadAiModels(true),
        onRefreshTelemetry(),
      ]);
    } catch (err) {
      const raw = String(err);
      if (raw.includes("protected_path")) {
        onNotify(
          "error",
          `Korunan sistem, .git veya kullanıcı kök klasörü kalıcı silinemez: ${permDeleteTarget.name}`
        );
      } else if (raw.includes("symlink_not_allowed")) {
        onNotify(
          "error",
          `Sembolik bağlantı (symlink) güvenlik nedeniyle silinemedi: ${permDeleteTarget.name}`
        );
      } else {
        onNotify("error", `Kalıcı silme başarısız: ${raw}`);
      }
      setPermDeleteTarget(null);
      setPermDeleteStep(1);
    } finally {
      setPermDeleting(false);
    }
  }, [
    permDeleteTarget,
    permDeleteStep,
    currentDir,
    loadDirectory,
    loadAiModels,
    onRefreshTelemetry,
    onNotify,
  ]);

  const visibleAiModels = useMemo(() => {
    if (aiFilter === "all") return aiModels;
    return aiModels.filter((m) => m.status === aiFilter);
  }, [aiModels, aiFilter]);

  const totalAiModelsBytes = useMemo(
    () => aiModels.reduce((acc, m) => acc + m.size_bytes, 0),
    [aiModels]
  );

  const unusedAiModelsCount = useMemo(
    () => aiModels.filter((m) => m.status !== "active").length,
    [aiModels]
  );

  const handleConfirmTrash = useCallback(async () => {
    if (!trashTarget) return;
    setTrashing(true);
    try {
      const freed = await api.movePathToTrash(trashTarget.path);
      onNotify(
        "success",
        `${trashTarget.name} Çöp Sepetine taşındı (${formatBytes(
          freed || trashTarget.size_bytes
        )}).`
      );
      setTrashTarget(null);
      clearDiskAnalyzerCache();
      await Promise.all([
        loadDirectory(currentDir, { force: true }),
        loadAiModels(true),
        onRefreshTelemetry(),
      ]);
    } catch (err) {
      const raw = String(err);
      if (raw.includes("protected_path")) {
        onNotify(
          "error",
          `Korunan sistem veya kullanıcı kök klasörü silinemez: ${trashTarget.name}`
        );
      } else {
        onNotify("error", `Çöpe taşınamadı: ${raw}`);
      }
      setTrashTarget(null);
    } finally {
      setTrashing(false);
    }
  }, [
    trashTarget,
    currentDir,
    loadDirectory,
    loadAiModels,
    onRefreshTelemetry,
    onNotify,
  ]);

  const diskUsedPct = useMemo(() => {
    if (!report || report.disk_total_bytes <= 0) return 0;
    return (report.disk_used_bytes / report.disk_total_bytes) * 100;
  }, [report]);

  const donutSegments = useMemo(() => {
    const totals = (report?.category_totals ?? []).filter((c) => c.size_bytes > 0);
    const sumBytes = totals.reduce((acc, item) => acc + item.size_bytes, 0);
    if (sumBytes <= 0) return [];

    let offset = 0;
    return totals.map((item) => {
      const ratio = item.size_bytes / sumBytes;
      const length = Math.max(0, ratio * DONUT_CIRCUMFERENCE);
      const seg = {
        ...item,
        style: getCategoryStyle(item.category, item.label),
        dashArray: `${Math.max(0, length - 1.5)} ${
          DONUT_CIRCUMFERENCE - Math.max(0, length - 1.5)
        }`,
        dashOffset: -offset,
      };
      offset += length;
      return seg;
    });
  }, [report]);

  const activeCategoryInfo: CategoryTotal | null = useMemo(() => {
    const activeKey = hoveredCategory ?? selectedCategory;
    if (!activeKey || !report) return null;
    return (
      report.category_totals.find((c) => c.category === activeKey) ?? null
    );
  }, [hoveredCategory, selectedCategory, report]);

  const breadcrumbs = useMemo(
    () => buildBreadcrumbs(report?.root_path ?? ""),
    [report?.root_path]
  );

  const visibleEntries = useMemo(() => {
    const all = report?.entries ?? [];
    if (!selectedCategory) return all;
    return all.filter((entry) => entry.category === selectedCategory);
  }, [report, selectedCategory]);

  const formattedScanTime = useMemo(() => formatScanTime(scannedAt), [scannedAt]);

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1 className="view-title">Disk Analizi</h1>
          <p className="view-subtitle">
            {report
              ? `${report.root_path} · Taranan: ${formatBytes(
                  report.total_scanned_bytes
                )}${formattedScanTime ? ` · Son tarama: ${formattedScanTime}` : ""}`
              : "Disk doluluğunu kategorilere ayırın, klasörlerin içine girin ve güvenle Çöp Sepetine taşıyın"}
          </p>
        </div>
        {subTab === "map" && (
          <div className="header-actions">
            <button
              type="button"
              className={`btn ${fullDiskMode ? "btn--primary" : "btn--ghost"}`}
              onClick={handleToggleFullDiskMode}
              disabled={loading}
              title="Movies, Downloads, Documents, Desktop, .Trash ve /Applications dahil tüm diski tara"
            >
              {fullDiskMode ? <ShieldCheck size={14} /> : <Lock size={14} />}
              <span>
                {fullDiskMode ? "Tam Disk Modu: Açık" : "Tam Disk Modu (Tümü)"}
              </span>
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void loadDirectory(null)}
              disabled={loading || currentDir === null}
            >
              <Home size={14} />
              <span>Ev Dizini</span>
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => void loadDirectory(currentDir, { force: true })}
              disabled={loading}
            >
              <RefreshCw size={15} className={loading ? "spin" : ""} />
              <span>{loading ? "Taranıyor..." : "Yeniden Tara"}</span>
            </button>
          </div>
        )}
      </header>

      <div className="subtabs-bar" role="tablist" aria-label="Disk Analizi Sekmeleri">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "map"}
          className={`subtab-btn ${subTab === "map" ? "subtab-btn--active" : ""}`}
          onClick={() => {
            setSubTab("map");
            if (!report && !loading) {
              void loadDirectory(currentDir, { force: true });
            }
          }}
        >
          <PieChart size={14} />
          <span>Disk Haritası & Gezgin</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "cleaner"}
          className={`subtab-btn ${subTab === "cleaner" ? "subtab-btn--active" : ""}`}
          onClick={() => setSubTab("cleaner")}
        >
          <Sparkles size={14} />
          <span>Akıllı Temizleyici</span>
        </button>
      </div>

      {subTab === "cleaner" ? (
        <SmartCleanerPanel
          onOpenFinder={onOpenFinder}
          onRefreshTelemetry={onRefreshTelemetry}
          onNotify={onNotify}
          onCleaned={() => {
            clearDiskAnalyzerCache();
            setReport(null);
          }}
        />
      ) : (
        <>
          {hasFullDiskAccess === false && (
        <div className="fda-banner" role="note">
          <div className="fda-banner__text">
            <Lock size={15} className="text-warning" />
            <span>
              <strong>Tam Disk Erişimi kapalı:</strong>{" "}
              <code>Movies</code>, <code>Downloads</code>, <code>Documents</code>,{" "}
              <code>Desktop</code> ve <code>/Applications</code> dahil tüm diski{" "}
              <strong>izin penceresi çıkmadan</strong> görmek için macOS Sistem
              Ayarları'ndan AffeXDesk'e bir kez izin verin.
            </span>
          </div>
          <button
            type="button"
            className="btn btn--sm btn--secondary"
            onClick={() => void handleOpenFdaSettings()}
          >
            Tam Disk Erişimi Ayarını Aç
          </button>
        </div>
      )}

      {/* 1. Üst Özet Kartları */}
      <section className="disk-summary-grid" aria-label="Disk Özeti">
        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <HardDrive size={15} /> Toplam Kapasite
            </span>
            <span className="badge badge--neutral">Ana Disk</span>
          </div>
          <div className="metric-card__value tabular">
            {report ? formatBytes(report.disk_total_bytes) : "—"}
          </div>
          <p className="metric-card__meta">
            Taranan klasör toplamı:{" "}
            <strong className="tabular">
              {report ? formatBytes(report.total_scanned_bytes) : "—"}
            </strong>
          </p>
        </article>

        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <PieChart size={15} /> Kullanılan Alan
            </span>
            <span
              className={`badge ${
                diskUsedPct > 85
                  ? "badge--danger"
                  : diskUsedPct > 70
                  ? "badge--warning"
                  : "badge--info"
              } tabular`}
            >
              {report ? formatPct(diskUsedPct) : "—"}
            </span>
          </div>
          <div className="metric-card__value tabular">
            {report ? formatBytes(report.disk_used_bytes) : "—"}
          </div>
          <div className="progress-track">
            <div
              className={`progress-fill progress-fill--${
                diskUsedPct > 85
                  ? "danger"
                  : diskUsedPct > 70
                  ? "warning"
                  : "cyan"
              }`}
              style={{ width: `${Math.min(100, diskUsedPct)}%` }}
            />
          </div>
        </article>

        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <ShieldCheck size={15} /> Boş Alan
            </span>
            <span
              className={`badge ${
                diskUsedPct > 85 ? "badge--warning" : "badge--success"
              }`}
            >
              {diskUsedPct > 85 ? "Daralıyor" : "Rahat"}
            </span>
          </div>
          <div className="metric-card__value tabular text-emerald">
            {report ? formatBytes(report.disk_available_bytes) : "—"}
          </div>
          <p className="metric-card__meta">
            Tüm silme işlemleri geri alınabilir Çöp Sepetine taşınır.
          </p>
        </article>
      </section>

      {error && !report && (
        <section className="empty-panel">
          <p className="empty-hint">Disk analizi yüklenemedi: {error}</p>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => void loadDirectory(currentDir)}
          >
            Tekrar Dene
          </button>
        </section>
      )}

      {/* 2. SVG Donut Grafik + Kategori Çubukları */}
      <section className="panel" aria-label="Kategori Dağılımı">
        <div className="panel__head">
          <h2 className="panel__title">
            <PieChart size={16} className="text-cyan" /> Kategori Dağılımı
          </h2>
          {selectedCategory && (
            <button
              type="button"
              className="link-btn"
              onClick={() => setSelectedCategory(null)}
            >
              Filtreyi Temizle
            </button>
          )}
        </div>

        <div className="disk-chart-layout">
          <div className="disk-donut-wrap">
            <svg
              className="disk-donut"
              viewBox="0 0 220 220"
              role="img"
              aria-label="Disk kategori dağılımı donut grafiği"
            >
              <circle
                cx="110"
                cy="110"
                r={DONUT_RADIUS}
                fill="none"
                stroke="rgba(148, 163, 184, 0.12)"
                strokeWidth="24"
              />
              {donutSegments.map((seg) => {
                const isDimmed =
                  (hoveredCategory && hoveredCategory !== seg.category) ||
                  (selectedCategory && selectedCategory !== seg.category);
                return (
                  <circle
                    key={seg.category}
                    cx="110"
                    cy="110"
                    r={DONUT_RADIUS}
                    fill="none"
                    stroke={seg.style.color}
                    strokeWidth={
                      hoveredCategory === seg.category ||
                      selectedCategory === seg.category
                        ? 28
                        : 24
                    }
                    strokeDasharray={seg.dashArray}
                    strokeDashoffset={seg.dashOffset}
                    transform="rotate(-90 110 110)"
                    opacity={isDimmed ? 0.32 : 1}
                    className="disk-donut__segment"
                    onMouseEnter={() => setHoveredCategory(seg.category)}
                    onMouseLeave={() => setHoveredCategory(null)}
                    onClick={() =>
                      setSelectedCategory((prev) =>
                        prev === seg.category ? null : seg.category
                      )
                    }
                  >
                    <title>
                      {seg.style.label}: {formatBytes(seg.size_bytes)} (
                      {formatPct(seg.pct)})
                    </title>
                  </circle>
                );
              })}
            </svg>
            <div className="disk-donut__center">
              <span className="disk-donut__center-label truncate">
                {activeCategoryInfo
                  ? getCategoryStyle(
                      activeCategoryInfo.category,
                      activeCategoryInfo.label
                    ).label
                  : "Taranan Toplam"}
              </span>
              <strong className="disk-donut__center-value tabular">
                {activeCategoryInfo
                  ? formatBytes(activeCategoryInfo.size_bytes)
                  : report
                  ? formatBytes(report.total_scanned_bytes)
                  : "—"}
              </strong>
              {activeCategoryInfo && (
                <span className="disk-donut__center-pct tabular">
                  {formatPct(activeCategoryInfo.pct)}
                </span>
              )}
            </div>
          </div>

          <div className="disk-legend-list">
            {(report?.category_totals ?? []).length === 0 ? (
              <p className="empty-hint">
                {loading
                  ? "Kategoriler hesaplanıyor..."
                  : "Bu klasörde kategori verisi bulunamadı."}
              </p>
            ) : (
              (report?.category_totals ?? []).map((cat) => {
                const style = getCategoryStyle(cat.category, cat.label);
                const isActive = selectedCategory === cat.category;
                return (
                  <button
                    key={cat.category}
                    type="button"
                    className={`disk-legend-item ${
                      isActive ? "disk-legend-item--active" : ""
                    }`}
                    onMouseEnter={() => setHoveredCategory(cat.category)}
                    onMouseLeave={() => setHoveredCategory(null)}
                    onClick={() =>
                      setSelectedCategory((prev) =>
                        prev === cat.category ? null : cat.category
                      )
                    }
                  >
                    <div className="disk-legend-item__top">
                      <span className="disk-legend-item__name">
                        <span
                          className="disk-cat-dot"
                          style={{ background: style.color }}
                        />
                        {style.label}
                      </span>
                      <span className="disk-legend-item__nums tabular">
                        <strong>{formatBytes(cat.size_bytes)}</strong>
                        <span className="muted">{formatPct(cat.pct)}</span>
                      </span>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${Math.min(100, Math.max(2, cat.pct))}%`,
                          background: style.color,
                        }}
                      />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </section>

      {/* 3. En Büyük Alan Tüketicileri (Quick Wins) */}
      {report && report.quick_wins.length > 0 && (
        <section
          className="panel"
          aria-label="En Büyük Alan Tüketicileri"
        >
          <div className="panel__head">
            <div>
              <h2 className="panel__title">
                <Sparkles size={16} className="text-warning" /> En Büyük Alan
                Tüketicileri (Hızlı Kazançlar)
              </h2>
              <p className="view-subtitle">
                Diskte en çok yer kaplayan bilinen klasörler — içine girip
                inceleyin veya güvenle Çöp Sepetine taşıyın.
              </p>
            </div>
            <span className="badge badge--warning tabular">
              {report.quick_wins.length} nokta
            </span>
          </div>

          <div className="disk-quickwins-grid">
            {report.quick_wins.map((item) => {
              const catStyle = getCategoryStyle(item.category);
              return (
                <article key={item.path} className="disk-quickwin-card">
                  <div className="disk-quickwin-card__head">
                    <span
                      className="disk-cat-badge"
                      style={{
                        background: catStyle.softBg,
                        color: catStyle.color,
                      }}
                    >
                      <span
                        className="disk-cat-dot"
                        style={{ background: catStyle.color }}
                      />
                      {catStyle.label}
                    </span>
                    {item.safe_to_clean && (
                      <span className="badge badge--success">Güvenli</span>
                    )}
                  </div>

                  <div className="disk-quickwin-card__body">
                    <div className="disk-quickwin-card__title-row">
                      <strong className="truncate" title={item.name}>
                        {item.name}
                      </strong>
                      <span className="disk-quickwin-card__size tabular">
                        {formatBytes(item.size_bytes)}
                      </span>
                    </div>
                    <span className="mono muted truncate" title={item.path}>
                      {item.path}
                    </span>
                    {item.clean_hint && (
                      <p className="disk-quickwin-card__hint">
                        {item.clean_hint}
                      </p>
                    )}
                  </div>

                  <div className="disk-quickwin-card__actions">
                    {item.is_dir && (
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => void loadDirectory(item.path)}
                        disabled={loading}
                      >
                        <FolderOpen size={13} />
                        <span>İçine Gir</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => onOpenFinder(item.path)}
                    >
                      <span>Finder&apos;da Aç</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger-soft btn--sm"
                      onClick={() => setTrashTarget(item)}
                      disabled={trashing || permDeleting}
                    >
                      <Trash2 size={13} />
                      <span>Çöpe Taşı</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => openPermanentDelete(item)}
                      disabled={trashing || permDeleting}
                      title="Çöp Sepetine taşımadan doğrudan kalıcı sil (2 aşamalı onay)"
                    >
                      <Flame size={13} />
                      <span>Kalıcı Sil</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* 3.5 Yerel AI Modelleri (Aktif & Kullanılmayan) */}
      {(aiModels.length > 0 || aiModelsLoading) && (
        <section
          className="panel"
          aria-label="Yerel AI Modelleri"
        >
          <div className="panel__head">
            <div>
              <h2 className="panel__title">
                <Cpu size={16} className="text-indigo" /> Yerel AI Modelleri
                (HuggingFace / MLX-Serve / LM Studio)
              </h2>
              <p className="view-subtitle">
                Aktif sunucudaki modeller işaretlenir; kullanılmayan veya yarım
                kalmış modelleri tek tek Çöpe Taşıyabilir veya 2 aşamalı onayla
                Kalıcı Silebilirsiniz.
              </p>
            </div>
            <div className="header-actions">
              <span className="badge badge--info tabular">
                {aiModels.length} model · {formatBytes(totalAiModelsBytes)}
              </span>
              {unusedAiModelsCount > 0 && (
                <span className="badge badge--warning tabular">
                  {unusedAiModelsCount} kullanılmıyor / yarım
                </span>
              )}
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => void loadAiModels(true)}
                disabled={aiModelsLoading}
              >
                <RefreshCw
                  size={12}
                  className={aiModelsLoading ? "spin" : ""}
                />
                <span>Yenile</span>
              </button>
            </div>
          </div>

          <div className="ai-filter-row" role="group" aria-label="AI Model Filtresi">
            {(
              [
                ["all", `Tümü (${aiModels.length})`],
                [
                  "unused",
                  `Kullanılmayanlar (${
                    aiModels.filter((m) => m.status === "unused").length
                  })`,
                ],
                [
                  "incomplete",
                  `Yarım Kalıntılar (${
                    aiModels.filter((m) => m.status === "incomplete").length
                  })`,
                ],
                [
                  "active",
                  `Aktif (${
                    aiModels.filter((m) => m.status === "active").length
                  })`,
                ],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`subtab-btn ${
                  aiFilter === key ? "subtab-btn--active" : ""
                }`}
                onClick={() => setAiFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {visibleAiModels.length === 0 ? (
            <div className="empty-inline">
              {aiModelsLoading
                ? "Yerel AI modelleri taranıyor..."
                : "Bu filtrede model bulunamadı."}
            </div>
          ) : (
            <div className="cleaner-list">
              {visibleAiModels.map((model) => {
                const badgeClass =
                  model.status === "active"
                    ? "badge--success"
                    : model.status === "incomplete"
                    ? "badge--neutral"
                    : "badge--warning";
                const deleteInfo: DeleteTargetInfo = {
                  name: model.id,
                  path: model.path,
                  size_bytes: model.size_bytes,
                  clean_hint:
                    model.status === "active"
                      ? "DİKKAT: Bu model şu an yerel AI sunucusunda aktif görünüyor."
                      : `${model.provider} · ${model.status_label}`,
                };
                return (
                  <div key={model.path} className="ai-model-row">
                    <div className="ai-model-row__info">
                      <div className="cleaner-row__title-row">
                        <strong className="cleaner-row__title truncate">
                          {model.id}
                        </strong>
                        <span className="badge badge--neutral">
                          {model.provider}
                        </span>
                        <span className={`badge ${badgeClass}`}>
                          {model.status_label}
                        </span>
                      </div>
                      <span
                        className="mono muted truncate"
                        title={model.path}
                        style={{ fontSize: 11 }}
                      >
                        {model.path}
                      </span>
                    </div>
                    <div className="ai-model-row__actions">
                      <strong className="cleaner-row__size tabular">
                        {formatBytes(model.size_bytes)}
                      </strong>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => onOpenFinder(model.path)}
                        title="Finder'da Aç"
                      >
                        <FolderOpen size={13} />
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger-soft btn--sm"
                        onClick={() => setTrashTarget(deleteInfo)}
                        disabled={trashing || permDeleting}
                      >
                        <Trash2 size={13} />
                        <span>Çöpe Taşı</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        onClick={() => openPermanentDelete(deleteInfo)}
                        disabled={trashing || permDeleting}
                      >
                        <Flame size={13} />
                        <span>Kalıcı Sil</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* 4. Etkileşimli Klasör Gezgini (Drill-Down Explorer) */}
      <section className="panel" aria-label="Etkileşimli Klasör Gezgini">
        <div className="disk-explorer-head">
          <div className="disk-breadcrumbs" role="navigation" aria-label="Klasör Yolu">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() =>
                report?.parent_path && void loadDirectory(report.parent_path)
              }
              disabled={loading || !report?.parent_path}
            >
              <ArrowUp size={13} />
              <span>Üst Klasör</span>
            </button>

            <div className="disk-breadcrumb-trail">
              {breadcrumbs.map((seg, idx) => {
                const isLast = idx === breadcrumbs.length - 1;
                return (
                  <span key={seg.path} className="disk-breadcrumb-item">
                    {idx > 0 && (
                      <ChevronRight
                        size={13}
                        className="muted"
                        aria-hidden="true"
                      />
                    )}
                    <button
                      type="button"
                      className={`disk-breadcrumb-btn mono ${
                        isLast ? "disk-breadcrumb-btn--current" : ""
                      }`}
                      disabled={loading || isLast}
                      onClick={() => void loadDirectory(seg.path)}
                    >
                      {seg.label}
                    </button>
                  </span>
                );
              })}
            </div>
          </div>

          <span className="badge badge--neutral tabular">
            {visibleEntries.length} öğe
          </span>
        </div>

        {loading && !report ? (
          <p className="empty-hint">Klasör boyutları hesaplanıyor...</p>
        ) : visibleEntries.length === 0 ? (
          <p className="empty-hint">
            {selectedCategory
              ? "Seçili kategoride bu klasör altında öğe bulunamadı."
              : "Bu klasörde görüntülenecek alt öğe bulunamadı."}
          </p>
        ) : (
          <ul className="disk-entries-list">
            {visibleEntries.map((entry) => {
              const catStyle = getCategoryStyle(entry.category);
              const barPct = Math.min(100, Math.max(1.5, entry.pct_of_parent));
              return (
                <li key={entry.path} className="disk-entry-row">
                  <div className="disk-entry-row__left">
                    {entry.is_dir ? (
                      <button
                        type="button"
                        className="disk-entry-name-btn"
                        onClick={() => void loadDirectory(entry.path)}
                        disabled={loading}
                        title={`İçine gir: ${entry.path}`}
                      >
                        <Folder
                          size={16}
                          style={{ color: catStyle.color, flexShrink: 0 }}
                        />
                        <span className="truncate">{entry.name}</span>
                        <ChevronRight
                          size={14}
                          className="disk-entry-chevron"
                        />
                      </button>
                    ) : (
                      <div className="disk-entry-name-static" title={entry.path}>
                        <File
                          size={15}
                          className="muted"
                          style={{ flexShrink: 0 }}
                        />
                        <span className="truncate">{entry.name}</span>
                      </div>
                    )}

                    <div className="disk-entry-row__meta">
                      <span
                        className="disk-cat-badge"
                        style={{
                          background: catStyle.softBg,
                          color: catStyle.color,
                        }}
                      >
                        {catStyle.label}
                      </span>
                      {entry.clean_hint && (
                        <span className="muted truncate" title={entry.clean_hint}>
                          {entry.clean_hint}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="disk-entry-row__bar-col">
                    <div className="disk-entry-bar-track">
                      <div
                        className="disk-entry-bar-fill"
                        style={{
                          width: `${barPct}%`,
                          background: catStyle.color,
                        }}
                      />
                    </div>
                    <div className="disk-entry-size tabular">
                      <strong>{formatBytes(entry.size_bytes)}</strong>
                      <span className="muted">
                        {formatPct(entry.pct_of_parent)}
                      </span>
                    </div>
                  </div>

                  <div className="disk-entry-row__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => onOpenFinder(entry.path)}
                      aria-label={`Finder'da Aç: ${entry.name}`}
                    >
                      Finder&apos;da Aç
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger-soft btn--sm"
                      onClick={() => setTrashTarget(entry)}
                      disabled={trashing || permDeleting}
                      aria-label={`Çöpe Taşı: ${entry.name}`}
                    >
                      <Trash2 size={13} />
                      <span>Çöpe Taşı</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => openPermanentDelete(entry)}
                      disabled={trashing || permDeleting}
                      aria-label={`Kalıcı Sil: ${entry.name}`}
                    >
                      <Flame size={13} />
                      <span>Kalıcı Sil</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(trashTarget)}
        title="Çöp Sepetine Taşı"
        description={
          trashTarget
            ? `"${trashTarget.name}" öğesi geri alınabilir şekilde Çöp Sepetine taşınacak. Devam etmek istiyor musunuz?`
            : ""
        }
        details={
          trashTarget
            ? [
                trashTarget.path,
                `Boyut: ${formatBytes(trashTarget.size_bytes)}`,
                ...(trashTarget.clean_hint ? [trashTarget.clean_hint] : []),
              ]
            : undefined
        }
        confirmLabel="Çöpe Taşı"
        cancelLabel="Vazgeç"
        tone="danger"
        busy={trashing}
        onConfirm={() => void handleConfirmTrash()}
        onCancel={() => setTrashTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(permDeleteTarget)}
        title={
          permDeleteStep === 1
            ? "Kalıcı Olarak Sil (Adım 1/2)"
            : "Emin misiniz? Geri Alınamaz! (Adım 2/2)"
        }
        description={
          permDeleteTarget
            ? permDeleteStep === 1
              ? `"${permDeleteTarget.name}" öğesi Çöp Sepetine taşınmadan DOĞRUDAN silinmek üzere seçildi. İkinci onay adımına geçmek istiyor musunuz?`
              : `SON ONAY: "${permDeleteTarget.name}" (${formatBytes(
                  permDeleteTarget.size_bytes
                )}) diskten kalıcı olarak yok edilecek ve geri getirilemeyecek. Gerçekten emin misiniz?`
            : ""
        }
        details={
          permDeleteTarget
            ? [
                permDeleteTarget.path,
                `Boyut: ${formatBytes(permDeleteTarget.size_bytes)}`,
                ...(permDeleteTarget.clean_hint
                  ? [permDeleteTarget.clean_hint]
                  : []),
              ]
            : undefined
        }
        confirmLabel={
          permDeleteStep === 1
            ? "Devam Et (1/2)"
            : "Evet, Kalıcı Olarak Sil"
        }
        cancelLabel="Vazgeç"
        tone="danger"
        busy={permDeleting}
        onConfirm={() => void handleConfirmPermanentDelete()}
        onCancel={() => {
          if (!permDeleting) {
            setPermDeleteTarget(null);
            setPermDeleteStep(1);
          }
        }}
      />
        </>
      )}
    </div>
  );
}
