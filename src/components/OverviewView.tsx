import {
  Activity,
  AlertOctagon,
  Cpu,
  FolderPlus,
  Flame,
  GitBranch,
  Globe,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Share2,
  Trash2,
  Zap,
} from "lucide-react";
import type {
  DevProcessReport,
  SocialBridgeSnapshot,
  SystemMetrics,
  UptimeResult,
  WorkspaceRecord,
  WorkspaceScanReport,
} from "../lib/api";
import {
  formatBytes,
  formatMegabytes,
  formatPct,
  formatUptime,
} from "../lib/format";
import { resolveProcessOwner } from "./ProcessesView";
import { useI18n } from "../lib/i18n";

export type NavTab =
  | "overview"
  | "processes"
  | "projects"
  | "disk"
  | "clients"
  | "git"
  | "knowledge"
  | "studio"
  | "settings";
export type ProcessFilter =
  | "all"
  | "zombie"
  | "node"
  | "python"
  | "rust"
  | "docker_db"
  | "ai";
export type ProjectFilter = "all" | "dirty" | "bloated" | "live";

export interface OverviewViewProps {
  metrics: SystemMetrics | null;
  processes: DevProcessReport | null;
  workspaces: WorkspaceRecord[];
  scanReport: WorkspaceScanReport | null;
  uptimeMap: Record<string, UptimeResult>;
  socialSnapshot?: SocialBridgeSnapshot | null;
  showSocialCard?: boolean;
  loadingSocial?: boolean;
  onRefreshSocial?: () => void;
  loading: boolean;
  onRefresh: () => void;
  onAddWorkspace: () => void;
  onNavigate: (
    tab: NavTab,
    options?: { processFilter?: ProcessFilter; projectFilter?: ProjectFilter }
  ) => void;
}

function pressureLabel(
  pressure: string,
  t: (key: string) => string
): { text: string; tone: string } {
  switch (pressure) {
    case "critical":
      return { text: t("telem.critical"), tone: "danger" };
    case "warn":
      return { text: t("telem.serious"), tone: "warning" };
    default:
      return { text: t("telem.normal"), tone: "success" };
  }
}

function thermalLabel(
  state: string,
  t: (key: string) => string
): { text: string; tone: string } {
  switch (state) {
    case "critical":
      return { text: t("telem.critical"), tone: "danger" };
    case "serious":
      return { text: t("telem.serious"), tone: "warning" };
    case "fair":
      return { text: t("telem.fair"), tone: "info" };
    default:
      return { text: t("telem.nominal"), tone: "success" };
  }
}

export function OverviewView({
  metrics,
  processes,
  workspaces,
  scanReport,
  uptimeMap,
  socialSnapshot,
  showSocialCard = false,
  loadingSocial = false,
  onRefreshSocial,
  loading,
  onRefresh,
  onAddWorkspace,
  onNavigate,
}: OverviewViewProps) {
  const { t, lang } = useI18n();
  const offlineSitesCount = Object.values(uptimeMap).filter(
    (u) => u.state === "down" || u.state === "degraded"
  ).length;

  const topRamProcesses = [...(processes?.processes ?? [])]
    .sort((a, b) => b.memory_bytes - a.memory_bytes)
    .slice(0, 5);

  const topDiskProjects = [...(scanReport?.projects ?? [])]
    .filter((p) => p.reclaimable_bytes > 0)
    .sort((a, b) => b.reclaimable_bytes - a.reclaimable_bytes)
    .slice(0, 5);

  const memPressure = pressureLabel(metrics?.mem_pressure ?? "normal", t);
  const thermal = thermalLabel(metrics?.thermal_state ?? "nominal", t);

  const diskUsedBytes = metrics
    ? Math.max(0, metrics.disk_total_bytes - metrics.disk_available_bytes)
    : 0;

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1 className="view-title">{t("overview.title")}</h1>
          <p className="view-subtitle">
            {metrics
              ? `${metrics.hostname} · ${metrics.os_name} · ${metrics.cpu_brand}`
              : lang === "en"
              ? "Hardware telemetry & developer environment status"
              : "Donanım telemetrisi ve geliştirici ortamı durumu"}
          </p>
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? "spin" : ""} />
          <span>{t("telem.refresh")}</span>
        </button>
      </header>

      {/* 4 Canlı Donanım Kartı */}
      <section className="metrics-grid" aria-label="Canlı Donanım Telemetrisi">
        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <Cpu size={15} /> {t("overview.cpu_usage")}
            </span>
            <span className="badge badge--neutral">
              {metrics ? `${metrics.cpu_cores} ${t("telem.cores")}` : "—"}
            </span>
          </div>
          <div className="metric-card__value tabular">
            {metrics ? formatPct(metrics.cpu_usage_pct) : "—"}
          </div>
          <div className="progress-track">
            <div
              className="progress-fill progress-fill--cyan"
              style={{
                width: `${Math.min(100, metrics?.cpu_usage_pct ?? 0)}%`,
              }}
            />
          </div>
          <p className="metric-card__meta truncate">
            {metrics?.cpu_brand || "İşlemci okunuyor..."}
          </p>
        </article>

        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <MemoryStick size={15} /> Unified RAM
            </span>
            <span className={`badge badge--${memPressure.tone}`}>
              {memPressure.text}
            </span>
          </div>
          <div className="metric-card__value tabular">
            {metrics ? formatPct(metrics.mem_used_pct) : "—"}
          </div>
          <div className="progress-track">
            <div
              className={`progress-fill progress-fill--${
                memPressure.tone === "danger"
                  ? "danger"
                  : memPressure.tone === "warning"
                  ? "warning"
                  : "indigo"
              }`}
              style={{
                width: `${Math.min(100, metrics?.mem_used_pct ?? 0)}%`,
              }}
            />
          </div>
          <p className="metric-card__meta tabular">
            {metrics
              ? `${formatBytes(metrics.mem_used_bytes)} / ${formatBytes(
                  metrics.mem_total_bytes
                )} · Swap ${formatBytes(metrics.swap_used_bytes)}`
              : "Bellek ölçülüyor..."}
          </p>
        </article>

        <button
          type="button"
          className="metric-card metric-card--interactive"
          onClick={() => onNavigate("disk")}
          aria-label={`${t("overview.disk_usage")} — ${t("telem.detailed_analysis").replace(" →", "")}`}
        >
          <div className="metric-card__head">
            <span className="metric-card__label">
              <HardDrive size={15} /> {t("overview.disk_usage")}
            </span>
            <span className="badge badge--neutral tabular">
              {metrics
                ? `${formatBytes(metrics.disk_available_bytes)} ${t("telem.disk_free")}`
                : "—"}
            </span>
          </div>
          <div className="metric-card__value tabular">
            {metrics ? formatPct(metrics.disk_used_pct) : "—"}
          </div>
          <div className="progress-track">
            <div
              className={`progress-fill progress-fill--${
                (metrics?.disk_used_pct ?? 0) > 85 ? "danger" : "emerald"
              }`}
              style={{
                width: `${Math.min(100, metrics?.disk_used_pct ?? 0)}%`,
              }}
            />
          </div>
          <div className="metric-card__footer">
            <p className="metric-card__meta tabular">
              {metrics
                ? `${formatBytes(diskUsedBytes)} / ${formatBytes(
                    metrics.disk_total_bytes
                  )}`
                : "—"}
            </p>
            <span className="metric-card__cta">{t("telem.detailed_analysis")}</span>
          </div>
        </button>

        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <Flame size={15} /> {t("overview.thermal_gpu")}
            </span>
            <span className={`badge badge--${thermal.tone}`}>
              {thermal.text}
            </span>
          </div>
          <div className="metric-card__value tabular">
            {metrics?.temperature_c != null
              ? `${metrics.temperature_c.toFixed(0)}°C`
              : thermal.text}
          </div>
          <p className="metric-card__meta truncate">
            {metrics?.gpu_label || "GPU"}
          </p>
          <p className="metric-card__meta tabular">
            {t("telem.uptime")}: {metrics ? formatUptime(metrics.uptime_secs) : "—"}
          </p>
        </article>
      </section>

      {/* Acil Operasyon Şeridi */}
      <section className="ops-strip" aria-label="Acil Operasyon Şeridi">
        <button
          type="button"
          className={`ops-tile ${
            (processes?.zombie_count ?? 0) > 0 ? "ops-tile--danger" : ""
          }`}
          onClick={() =>
            onNavigate("processes", { processFilter: "zombie" })
          }
        >
          <div className="ops-tile__icon ops-tile__icon--danger">
            <Zap size={16} />
          </div>
          <div className="ops-tile__body">
            <span className="ops-tile__label">{t("overview.zombie_procs")}</span>
            <strong className="ops-tile__value tabular">
              {processes?.zombie_count ?? 0} {lang === "en" ? "proc" : "süreç"} ·{" "}
              {formatBytes(processes?.zombie_memory_bytes ?? 0)}
            </strong>
          </div>
        </button>

        <button
          type="button"
          className={`ops-tile ${
            (scanReport?.total_reclaimable_bytes ?? 0) > 0
              ? "ops-tile--warning"
              : ""
          }`}
          onClick={() =>
            onNavigate("projects", { projectFilter: "bloated" })
          }
        >
          <div className="ops-tile__icon ops-tile__icon--warning">
            <Trash2 size={16} />
          </div>
          <div className="ops-tile__body">
            <span className="ops-tile__label">{t("overview.reclaimable_disk")}</span>
            <strong className="ops-tile__value tabular">
              {formatBytes(scanReport?.total_reclaimable_bytes ?? 0)}
            </strong>
          </div>
        </button>

        <button
          type="button"
          className={`ops-tile ${
            (scanReport?.dirty_projects ?? 0) > 0 ? "ops-tile--info" : ""
          }`}
          onClick={() => onNavigate("projects", { projectFilter: "dirty" })}
        >
          <div className="ops-tile__icon ops-tile__icon--info">
            <GitBranch size={16} />
          </div>
          <div className="ops-tile__body">
            <span className="ops-tile__label">{t("overview.dirty_repos")}</span>
            <strong className="ops-tile__value tabular">
              {scanReport?.dirty_projects ?? 0} repo
            </strong>
          </div>
        </button>

        <button
          type="button"
          className={`ops-tile ${
            offlineSitesCount > 0 ? "ops-tile--danger" : ""
          }`}
          onClick={() => onNavigate("projects", { projectFilter: "live" })}
        >
          <div className="ops-tile__icon ops-tile__icon--emerald">
            <Globe size={16} />
          </div>
          <div className="ops-tile__body">
            <span className="ops-tile__label">{t("overview.offline_sites")}</span>
            <strong className="ops-tile__value tabular">
              {offlineSitesCount} site
            </strong>
          </div>
        </button>
      </section>

      {/* Onboarding Kartı (0 workspace varsa) */}
      {workspaces.length === 0 && (
        <section className="onboarding-card" aria-label="İlk Kurulum">
          <div className="onboarding-card__icon">
            <FolderPlus size={24} />
          </div>
          <div className="onboarding-card__content">
            <h2>İlk İş Klasörünü Bağla</h2>
            <p>
              Proje radarını, Git durumunu ve geri kazanılabilir disk
              analizini başlatmak için projelerinin bulunduğu ana klasörü seç
              (ör. <code className="mono">~/dev</code> veya{" "}
              <code className="mono">~/Projects</code>).
            </p>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={onAddWorkspace}
          >
            <FolderPlus size={16} />
            <span>+ İş Klasörünü Seç</span>
          </button>
        </section>
      )}

      {/* Canlı Sosyal Merkez MCP Köprüsü Kartı */}
      {showSocialCard && (
        <section
          className="panel social-bridge-card"
          aria-label="Sosyal Merkez MCP Köprüsü"
        >
          <div className="panel__head">
            <div className="social-bridge-card__title">
              <h2 className="panel__title">
                <Share2 size={16} className="text-cyan" /> Sosyal Merkez MCP
                Köprüsü
              </h2>
              <span
                className={`badge ${
                  socialSnapshot?.connected ? "badge--success" : "badge--warning"
                }`}
              >
                {socialSnapshot?.connected ? "Bağlı" : "Çevrimdışı"}
              </span>
              {socialSnapshot?.app_version && (
                <span className="mono muted">v{socialSnapshot.app_version}</span>
              )}
            </div>
            <div className="header-actions">
              {socialSnapshot?.endpoint && (
                <span className="mono muted truncate">
                  {socialSnapshot.endpoint}
                </span>
              )}
              {onRefreshSocial && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={onRefreshSocial}
                  disabled={loadingSocial}
                >
                  <RefreshCw
                    size={13}
                    className={loadingSocial ? "spin" : ""}
                  />
                  <span>Güncelle</span>
                </button>
              )}
            </div>
          </div>

          {socialSnapshot?.connected ? (
            <>
              <div className="social-stats-grid">
                <div className="social-stat">
                  <span className="social-stat__label">Yayınlanan</span>
                  <strong className="social-stat__value text-emerald tabular">
                    {socialSnapshot.published_count}
                  </strong>
                </div>
                <div className="social-stat">
                  <span className="social-stat__label">Planlı</span>
                  <strong className="social-stat__value text-cyan tabular">
                    {socialSnapshot.scheduled_count}
                  </strong>
                </div>
                <div className="social-stat">
                  <span className="social-stat__label">Onay Bekleyen</span>
                  <strong className="social-stat__value text-warning tabular">
                    {socialSnapshot.pending_review_count}
                  </strong>
                </div>
                <div className="social-stat">
                  <span className="social-stat__label">Hatalı</span>
                  <strong className="social-stat__value tabular">
                    {socialSnapshot.failed_count}
                  </strong>
                </div>
              </div>

              {socialSnapshot.accounts.length > 0 && (
                <div className="social-accounts-row">
                  {socialSnapshot.accounts.map((acc) => (
                    <span
                      key={acc.id}
                      className="badge badge--neutral"
                      title={`${acc.platform} · ${acc.status}`}
                    >
                      <strong>{acc.platform}</strong>
                      <span>{acc.display_name}</span>
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="empty-hint">
              {socialSnapshot?.error ||
                "Sosyal Merkez MCP sunucusuna şu an ulaşılamıyor. Ayarlardan endpoint ve token yolunu kontrol edebilirsiniz."}
            </p>
          )}
        </section>
      )}

      {/* Alt Özet: İlk 5 RAM Süreci + İlk 5 Disk Şişiren Proje */}
      <section className="split-grid">
        <div className="panel">
          <div className="panel__head">
            <h2 className="panel__title">
              <Activity size={16} /> {t("overview.top_ram_procs")}
            </h2>
            <button
              type="button"
              className="link-btn"
              onClick={() => onNavigate("processes")}
            >
              {t("overview.view_all")}
            </button>
          </div>
          {topRamProcesses.length === 0 ? (
            <p className="empty-hint">
              Aktif geliştirici süreci tespit edilmedi.
            </p>
          ) : (
            <ul className="summary-list">
              {topRamProcesses.map((proc) => {
                const owner = resolveProcessOwner(proc);
                return (
                  <li key={proc.pid} className="summary-row">
                    <div className="summary-row__main">
                      <div className="summary-row__title">
                        <span>{owner.label}</span>
                        {owner.label.toLowerCase() !==
                          proc.name.toLowerCase() && (
                          <span className="mono muted">{proc.name}</span>
                        )}
                        <span className="mono muted">PID {proc.pid}</span>
                        {proc.is_zombie_candidate && (
                          <span className="badge badge--danger">
                            <AlertOctagon size={11} /> Zombi
                          </span>
                        )}
                      </div>
                      <div className="summary-row__sub">
                        <span className="badge badge--accent">
                          {owner.kind}
                        </span>
                        <span className="badge badge--neutral">
                          {proc.category}
                        </span>
                        {proc.ports.slice(0, 3).map((port) => (
                          <span key={port} className="port-pill mono">
                            :{port}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="summary-row__metric tabular">
                      <strong>{formatMegabytes(proc.memory_bytes)}</strong>
                      <span className="muted">
                        {formatPct(proc.cpu_pct)} CPU
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="panel">
          <div className="panel__head">
            <h2 className="panel__title">
              <HardDrive size={16} /> En Çok Disk Şişiren Projeler
            </h2>
            <button
              type="button"
              className="link-btn"
              onClick={() =>
                onNavigate("projects", { projectFilter: "bloated" })
              }
            >
              Tümünü Gör →
            </button>
          </div>
          {topDiskProjects.length === 0 ? (
            <p className="empty-hint">
              {workspaces.length === 0
                ? "Disk analizi için önce bir iş klasörü ekleyin."
                : "Temizlenecek büyük cache klasörü bulunamadı."}
            </p>
          ) : (
            <ul className="summary-list">
              {topDiskProjects.map((proj) => (
                <li key={proj.path} className="summary-row">
                  <div className="summary-row__main">
                    <div className="summary-row__title">
                      <span>{proj.name}</span>
                      <span className="badge badge--neutral">
                        {proj.workspace_label}
                      </span>
                    </div>
                    <div className="summary-row__sub">
                      {proj.reclaimable_dirs.slice(0, 3).map((d) => (
                        <span key={d.path} className="mono muted">
                          {d.name} ({formatBytes(d.size_bytes)})
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="summary-row__metric tabular">
                    <strong className="text-warning">
                      {formatBytes(proj.reclaimable_bytes)}
                    </strong>
                    <span className="muted">
                      {proj.reclaimable_dirs.length} klasör
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
