import { useMemo, useState } from "react";
import {
  Check,
  Code2,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Globe,
  Monitor,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type {
  ClientProjectRecord,
  ClientRecord,
  ProjectInfo,
  UptimeResult,
  WorkspaceScanReport,
} from "../lib/api";
import { formatBytes } from "../lib/format";
import { ConfirmDialog } from "./ConfirmDialog";
import type { ProjectFilter } from "./OverviewView";

export interface ProjectsViewProps {
  scanReport: WorkspaceScanReport | null;
  uptimeMap: Record<string, UptimeResult>;
  loading: boolean;
  checkingUptime: boolean;
  filter: ProjectFilter;
  clients?: ClientRecord[];
  clientProjects?: ClientProjectRecord[];
  onAssignClient?: (project: ProjectInfo, clientId: number | null) => Promise<void>;
  onConnectRemote?: (client: ClientRecord) => void;
  onFilterChange: (filter: ProjectFilter) => void;
  onAddWorkspace: () => void;
  onRescan: () => void;
  onCheckAllUptime: () => void;
  onCleanCaches: (paths: string[], projectName: string) => Promise<void>;
  onSaveProjectUrl: (projectPath: string, url: string) => Promise<void>;
  onOpenFinder: (path: string) => void;
  onOpenIde: (path: string) => void;
  onOpenUrl: (url: string) => void;
}

const PROJECT_FILTERS: Array<{ id: ProjectFilter; label: string }> = [
  { id: "all", label: "Tümü" },
  { id: "dirty", label: "Kirli Git" },
  { id: "bloated", label: "Şişkin Disk" },
  { id: "live", label: "Canlı URL" },
];

export function ProjectsView({
  scanReport,
  uptimeMap,
  loading,
  checkingUptime,
  filter,
  clients = [],
  clientProjects = [],
  onAssignClient,
  onConnectRemote,
  onFilterChange,
  onAddWorkspace,
  onRescan,
  onCheckAllUptime,
  onCleanCaches,
  onSaveProjectUrl,
  onOpenFinder,
  onOpenIde,
  onOpenUrl,
}: ProjectsViewProps) {
  const [search, setSearch] = useState("");
  const [cleanTarget, setCleanTarget] = useState<ProjectInfo | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [editingUrlPath, setEditingUrlPath] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (scanReport?.projects ?? []).filter((proj) => {
      if (filter === "dirty" && proj.git_dirty_count === 0) return false;
      if (filter === "bloated" && proj.reclaimable_bytes === 0) return false;
      if (filter === "live" && !proj.live_url) return false;
      if (!q) return true;
      return (
        proj.name.toLowerCase().includes(q) ||
        proj.workspace_label.toLowerCase().includes(q) ||
        proj.path.toLowerCase().includes(q) ||
        proj.stack.some((s) => s.toLowerCase().includes(q)) ||
        (proj.git_branch ?? "").toLowerCase().includes(q)
      );
    });
  }, [scanReport, filter, search]);

  async function handleConfirmClean() {
    if (!cleanTarget) return;
    setCleaning(true);
    try {
      const paths = cleanTarget.reclaimable_dirs.map((d) => d.path);
      await onCleanCaches(paths, cleanTarget.name);
      setCleanTarget(null);
    } finally {
      setCleaning(false);
    }
  }

  function startEditUrl(proj: ProjectInfo) {
    setEditingUrlPath(proj.path);
    setUrlDraft(proj.live_url ?? "");
  }

  async function handleSaveUrl(projectPath: string) {
    setSavingUrl(true);
    try {
      await onSaveProjectUrl(projectPath, urlDraft.trim());
      setEditingUrlPath(null);
    } finally {
      setSavingUrl(false);
    }
  }

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1 className="view-title">Proje Radarı</h1>
          <p className="view-subtitle tabular">
            {scanReport?.total_projects ?? 0} proje ·{" "}
            {scanReport?.dirty_projects ?? 0} kirli Git ·{" "}
            {formatBytes(scanReport?.total_reclaimable_bytes ?? 0)} geri
            kazanılabilir
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onCheckAllUptime}
            disabled={checkingUptime}
          >
            <Globe size={15} className={checkingUptime ? "spin" : ""} />
            <span>Canlı URL&apos;leri Kontrol Et</span>
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onRescan}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? "spin" : ""} />
            <span>Yenile</span>
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={onAddWorkspace}
          >
            <FolderPlus size={15} />
            <span>+ İş Klasörü Ekle</span>
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="filter-pills" role="tablist" aria-label="Proje Filtreleri">
          {PROJECT_FILTERS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={filter === opt.id}
              className={`pill ${filter === opt.id ? "pill--active" : ""}`}
              onClick={() => onFilterChange(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <label className="search-box">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Proje, teknoloji veya Git dalı ara..."
            aria-label="Proje ara"
          />
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-panel">
          <p>Gösterilecek proje bulunamadı.</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={onAddWorkspace}
          >
            <FolderPlus size={15} />
            <span>+ İş Klasörü Ekle</span>
          </button>
        </div>
      ) : (
        <div className="projects-grid">
          {filtered.map((proj) => {
            const uptime = uptimeMap[proj.path];
            const isEditing = editingUrlPath === proj.path;

            return (
              <article key={proj.path} className="project-card">
                <div className="project-card__head">
                  <div className="project-card__title-wrap">
                    <h2 className="project-card__title">{proj.name}</h2>
                    <span className="badge badge--neutral">
                      {proj.workspace_label}
                    </span>
                  </div>
                  {proj.git_branch && (
                    <div className="git-pill">
                      <GitBranch size={12} />
                      <span className="mono">{proj.git_branch}</span>
                      {proj.git_dirty_count > 0 && (
                        <span className="badge badge--warning tabular">
                          {proj.git_dirty_count} kirli
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {proj.stack.length > 0 && (
                  <div className="tag-row">
                    {proj.stack.map((tech) => (
                      <span key={tech} className="tech-tag">
                        {tech}
                      </span>
                    ))}
                  </div>
                )}

                {proj.progress_pct !== null && proj.progress_total > 0 && (
                  <div className="project-progress">
                    <div className="project-progress__head tabular">
                      <span>HANDOFF / PRD İlerleme</span>
                      <span>
                        {proj.progress_done}/{proj.progress_total} (
                        {proj.progress_pct}%)
                      </span>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill progress-fill--cyan"
                        style={{ width: `${proj.progress_pct}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Canlı URL + Uptime */}
                <div className="project-url-row">
                  {isEditing ? (
                    <div className="url-editor">
                      <input
                        type="url"
                        value={urlDraft}
                        onChange={(e) => setUrlDraft(e.target.value)}
                        placeholder="https://ornek.com"
                        aria-label={`${proj.name} canlı URL`}
                      />
                      <button
                        type="button"
                        className="icon-btn icon-btn--success"
                        aria-label="URL kaydet"
                        disabled={savingUrl}
                        onClick={() => handleSaveUrl(proj.path)}
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="İptal"
                        onClick={() => setEditingUrlPath(null)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="url-status">
                        <Globe size={13} className="muted" />
                        {proj.live_url ? (
                          <span className="mono truncate" title={proj.live_url}>
                            {proj.live_url.replace(/^https?:\/\//, "")}
                          </span>
                        ) : (
                          <span className="muted">Canlı URL tanımlı değil</span>
                        )}
                        {uptime && (
                          <span
                            className={`badge tabular badge--${
                              uptime.state === "online"
                                ? "success"
                                : uptime.state === "degraded"
                                ? "warning"
                                : "danger"
                            }`}
                          >
                            {uptime.status_code ?? "ERR"} · {uptime.latency_ms}ms
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`${proj.name} URL düzenle`}
                        onClick={() => startEditUrl(proj)}
                      >
                        <Pencil size={13} />
                      </button>
                    </>
                  )}
                </div>

                {/* Geri kazanılabilir cache listesi */}
                {proj.reclaimable_dirs.length > 0 && (
                  <div className="cache-box">
                    <div className="cache-list">
                      {proj.reclaimable_dirs.map((dir) => (
                        <span key={dir.path} className="cache-chip mono tabular">
                          {dir.name} · {formatBytes(dir.size_bytes)}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="btn btn--warning-soft btn--sm"
                      onClick={() => setCleanTarget(proj)}
                    >
                      <Trash2 size={13} />
                      <span>Temizle ({formatBytes(proj.reclaimable_bytes)})</span>
                    </button>
                  </div>
                )}

                {/* Müşteri Atama & Uzak Bağlantı (İki Yönlü Senkronizasyon) */}
                {onAssignClient && clients.length > 0 && (() => {
                  const linkedProj = clientProjects.find(
                    (cp) => cp.local_path && cp.local_path === proj.path
                  );
                  const linkedClient = linkedProj
                    ? clients.find((c) => c.id === linkedProj.client_id) ?? null
                    : null;
                  return (
                    <div className="project-client-row">
                      <span className="project-client-row__label">
                        <Users size={12} className="text-cyan" />
                        <span>Müşteri</span>
                      </span>
                      <select
                        className="inline-select"
                        value={linkedClient ? String(linkedClient.id) : ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          void onAssignClient(
                            proj,
                            val ? Number(val) : null
                          );
                        }}
                        aria-label={`${proj.name} müşteri ata`}
                      >
                        <option value="">Müşterisiz</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {linkedClient &&
                        linkedClient.remote_id.trim() &&
                        onConnectRemote && (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => onConnectRemote(linkedClient)}
                            title={`${linkedClient.name} uzak bağlantısı`}
                          >
                            <Monitor size={12} />
                            <span>Bağlan</span>
                          </button>
                        )}
                    </div>
                  );
                })()}

                {/* Hızlı Aksiyonlar */}
                <div className="project-card__footer">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => onOpenFinder(proj.path)}
                  >
                    <FolderOpen size={13} />
                    <span>Finder</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => onOpenIde(proj.path)}
                  >
                    <Code2 size={13} />
                    <span>IDE</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={!proj.live_url}
                    onClick={() => proj.live_url && onOpenUrl(proj.live_url)}
                  >
                    <ExternalLink size={13} />
                    <span>Site</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={cleanTarget !== null}
        title="Proje Önbelleklerini Temizle"
        description={
          cleanTarget
            ? `"${cleanTarget.name}" projesindeki yalnızca güvenli (allowlist) önbellek klasörleri silinecek ve ${formatBytes(
                cleanTarget.reclaimable_bytes
              )} disk alanı geri kazanılacak.`
            : ""
        }
        details={cleanTarget?.reclaimable_dirs.map(
          (d) => `${d.name} (${formatBytes(d.size_bytes)}) — ${d.path}`
        )}
        confirmLabel={
          cleanTarget
            ? `Temizle (${formatBytes(cleanTarget.reclaimable_bytes)})`
            : "Temizle"
        }
        cancelLabel="Vazgeç"
        tone="warning"
        busy={cleaning}
        onConfirm={handleConfirmClean}
        onCancel={() => setCleanTarget(null)}
      />
    </div>
  );
}
