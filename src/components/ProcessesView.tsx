import { useMemo, useState } from "react";
import {
  AlertOctagon,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Layers,
  List,
  RefreshCw,
  Search,
  Skull,
  Square,
} from "lucide-react";
import { api, type DevProcess, type DevProcessReport } from "../lib/api";
import { formatBytes, formatMegabytes, formatPct } from "../lib/format";
import { ConfirmDialog } from "./ConfirmDialog";
import type { ProcessFilter } from "./OverviewView";

export interface ProcessesViewProps {
  report: DevProcessReport | null;
  loading: boolean;
  filter: ProcessFilter;
  onFilterChange: (filter: ProcessFilter) => void;
  onRefresh: () => void;
  onKillProcess: (pid: number, force: boolean) => Promise<void>;
  onNotify?: (tone: "success" | "error" | "info", text: string) => void;
}

interface ProcessOwner {
  key: string;
  label: string;
  kind: "Proje" | "Uygulama" | "Süreç";
  openablePath: string | null;
}

interface ProcessGroup {
  owner: ProcessOwner;
  processes: DevProcess[];
  totalMemoryBytes: number;
  totalCpuPct: number;
  ports: number[];
  categories: string[];
  hasZombie: boolean;
}

const FILTER_OPTIONS: Array<{ id: ProcessFilter; label: string }> = [
  { id: "all", label: "Tümü" },
  { id: "zombie", label: "Zombi Adayları" },
  { id: "node", label: "Node/JS" },
  { id: "python", label: "Python" },
  { id: "rust", label: "Rust" },
  { id: "docker_db", label: "Docker/DB" },
  { id: "ai", label: "AI" },
];

const GENERIC_SUBDIRS = new Set([
  "studio",
  "app",
  "apps",
  "web",
  "server",
  "backend",
  "frontend",
  "client",
  "api",
  "src",
  "packages",
]);

export function resolveProcessOwner(proc: DevProcess): ProcessOwner {
  const nameLower = proc.name.toLowerCase();
  const cmd = proc.cmd_preview || "";
  const cwd = proc.cwd || "";

  if (
    nameLower.includes("docker") ||
    cwd.includes("com.docker.docker") ||
    cmd.includes("Docker.app")
  ) {
    return {
      key: "app:docker-desktop",
      label: "Docker Desktop",
      kind: "Uygulama",
      openablePath: null,
    };
  }

  const appMatch = cmd.match(/\/Applications\/([^/]+)\.app/);
  if (appMatch && appMatch[1]) {
    const appName = appMatch[1];
    return {
      key: `app:${appName.toLowerCase()}`,
      label: appName,
      kind: "Uygulama",
      openablePath: null,
    };
  }

  if (
    cwd &&
    cwd !== "/" &&
    !cwd.includes("/Library/Containers/") &&
    !cwd.includes("/Library/Application Support/")
  ) {
    const parts = cwd.split(/[\\/]+/).filter(Boolean);
    // Ignore bare home directory like /Users/<name>
    const isHomeRoot =
      parts.length <= 2 && (parts[0] === "Users" || parts[0] === "home");
    if (!isHomeRoot && parts.length > 0) {
      const last = parts[parts.length - 1];
      const prev = parts.length >= 2 ? parts[parts.length - 2] : null;
      const label =
        prev && GENERIC_SUBDIRS.has(last.toLowerCase())
          ? `${prev} / ${last}`
          : last;
      return {
        key: `project:${cwd}`,
        label,
        kind: "Proje",
        openablePath: cwd,
      };
    }
  }

  return {
    key: `proc:${proc.name.toLowerCase()}`,
    label: proc.name,
    kind: "Süreç",
    openablePath: cwd && cwd !== "/" ? cwd : null,
  };
}

function matchesCategory(proc: DevProcess, filter: ProcessFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "zombie":
      return proc.is_zombie_candidate;
    case "docker_db":
      return proc.category === "docker" || proc.category === "db";
    default:
      return proc.category === filter;
  }
}

export function ProcessesView({
  report,
  loading,
  filter,
  onFilterChange,
  onRefresh,
  onKillProcess,
  onNotify,
}: ProcessesViewProps) {
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grouped" | "flat">("grouped");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );
  const [busyPid, setBusyPid] = useState<number | null>(null);
  const [busyGroupKey, setBusyGroupKey] = useState<string | null>(null);
  const [forceTarget, setForceTarget] = useState<DevProcess | null>(null);
  const [groupKillTarget, setGroupKillTarget] = useState<ProcessGroup | null>(
    null,
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (report?.processes ?? []).filter((proc) => {
      if (!matchesCategory(proc, filter)) return false;
      if (!q) return true;
      const owner = resolveProcessOwner(proc);
      return (
        owner.label.toLowerCase().includes(q) ||
        proc.name.toLowerCase().includes(q) ||
        String(proc.pid).includes(q) ||
        proc.category.toLowerCase().includes(q) ||
        (proc.cwd ?? "").toLowerCase().includes(q) ||
        proc.cmd_preview.toLowerCase().includes(q) ||
        proc.ports.some((p) => String(p).includes(q))
      );
    });
  }, [report, filter, search]);

  const groups = useMemo<ProcessGroup[]>(() => {
    const map = new Map<string, ProcessGroup>();
    for (const proc of filtered) {
      const owner = resolveProcessOwner(proc);
      const existing = map.get(owner.key);
      if (existing) {
        existing.processes.push(proc);
        existing.totalMemoryBytes += proc.memory_bytes;
        existing.totalCpuPct += proc.cpu_pct;
        existing.hasZombie = existing.hasZombie || proc.is_zombie_candidate;
        for (const p of proc.ports) {
          if (!existing.ports.includes(p)) existing.ports.push(p);
        }
        if (!existing.categories.includes(proc.category)) {
          existing.categories.push(proc.category);
        }
      } else {
        map.set(owner.key, {
          owner,
          processes: [proc],
          totalMemoryBytes: proc.memory_bytes,
          totalCpuPct: proc.cpu_pct,
          ports: [...proc.ports],
          categories: [proc.category],
          hasZombie: proc.is_zombie_candidate,
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => b.totalMemoryBytes - a.totalMemoryBytes,
    );
  }, [filtered]);

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleGracefulKill(proc: DevProcess) {
    setBusyPid(proc.pid);
    try {
      await onKillProcess(proc.pid, false);
    } finally {
      setBusyPid(null);
    }
  }

  async function handleConfirmForceKill() {
    if (!forceTarget) return;
    const pid = forceTarget.pid;
    setBusyPid(pid);
    try {
      await onKillProcess(pid, true);
      setForceTarget(null);
    } finally {
      setBusyPid(null);
    }
  }

  async function handleConfirmGroupKill() {
    if (!groupKillTarget) return;
    setBusyGroupKey(groupKillTarget.owner.key);
    try {
      for (const proc of groupKillTarget.processes) {
        await onKillProcess(proc.pid, false);
      }
      setGroupKillTarget(null);
    } finally {
      setBusyGroupKey(null);
    }
  }

  function renderProcessRow(proc: DevProcess, showOwnerBadge: boolean) {
    const isBusy = busyPid === proc.pid;
    const owner = showOwnerBadge ? resolveProcessOwner(proc) : null;
    return (
      <article
        key={proc.pid}
        className={`process-row ${
          proc.is_zombie_candidate ? "process-row--zombie" : ""
        }`}
      >
        <div className="process-row__info">
          <div className="process-row__head">
            {owner && (
              <strong className="process-row__name">{owner.label}</strong>
            )}
            <span className={owner ? "mono muted" : "process-row__name"}>
              {proc.name}
            </span>
            <span className="mono muted">PID {proc.pid}</span>
            <span className="badge badge--neutral">{proc.category}</span>
            {proc.is_zombie_candidate && (
              <span className="badge badge--danger">
                <AlertOctagon size={11} /> Zombi Adayı
              </span>
            )}
            {proc.ports.map((port) => (
              <span key={port} className="port-pill mono">
                :{port}
              </span>
            ))}
          </div>
          <div className="process-row__meta">
            {proc.cwd && (
              <span className="cwd-label mono truncate" title={proc.cwd}>
                <FolderOpen size={12} /> {proc.cwd}
              </span>
            )}
            {proc.cmd_preview && (
              <span
                className="cmd-preview mono truncate"
                title={proc.cmd_preview}
              >
                {proc.cmd_preview}
              </span>
            )}
          </div>
        </div>

        <div className="process-row__stats tabular">
          <div>
            <span className="stat-label">RAM</span>
            <strong>{formatMegabytes(proc.memory_bytes)}</strong>
          </div>
          <div>
            <span className="stat-label">CPU</span>
            <strong>{formatPct(proc.cpu_pct)}</strong>
          </div>
        </div>

        <div className="process-row__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={isBusy}
            onClick={() => handleGracefulKill(proc)}
            title="SIGTERM ile nazikçe kapat"
          >
            <Square size={13} />
            <span>Kapat</span>
          </button>
          <button
            type="button"
            className="btn btn--danger-soft btn--sm"
            disabled={isBusy}
            onClick={() => setForceTarget(proc)}
            title="SIGKILL ile zorla sonlandır"
          >
            <Skull size={13} />
            <span>Zorla Kapat</span>
          </button>
        </div>
      </article>
    );
  }

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1 className="view-title">Geliştirici Süreçleri &amp; Portlar</h1>
          <p className="view-subtitle tabular">
            {groups.length} uygulama/proje · {report?.processes.length ?? 0}{" "}
            süreç · {formatBytes(report?.total_dev_memory_bytes ?? 0)} RAM ·{" "}
            {report?.listening_ports_count ?? 0} dinlenen port ·{" "}
            {report?.zombie_count ?? 0} zombi adayı
          </p>
        </div>
        <div className="header-actions-inline">
          <div className="view-toggle" role="group" aria-label="Görünüm modu">
            <button
              type="button"
              className={`pill ${viewMode === "grouped" ? "pill--active" : ""}`}
              onClick={() => setViewMode("grouped")}
            >
              <Layers size={13} /> Uygulamaya Göre
            </button>
            <button
              type="button"
              className={`pill ${viewMode === "flat" ? "pill--active" : ""}`}
              onClick={() => setViewMode("flat")}
            >
              <List size={13} /> Tekil PID
            </button>
          </div>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? "spin" : ""} />
            <span>Yenile</span>
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div
          className="filter-pills"
          role="tablist"
          aria-label="Süreç Filtreleri"
        >
          {FILTER_OPTIONS.map((opt) => (
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
            placeholder="Proje, uygulama, PID, port ara..."
            aria-label="Süreç ara"
          />
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-panel">
          <p>Bu filtreye uyan geliştirici süreci bulunamadı.</p>
        </div>
      ) : viewMode === "flat" ? (
        <div className="process-list">
          {filtered.map((proc) => renderProcessRow(proc, true))}
        </div>
      ) : (
        <div className="process-group-list">
          {groups.map((group) => {
            const isExpanded = Boolean(expandedGroups[group.owner.key]);
            const isBusyGroup = busyGroupKey === group.owner.key;
            const firstCmd = group.processes[0]?.cmd_preview ?? "";
            return (
              <section
                key={group.owner.key}
                className={`process-group-card ${
                  group.hasZombie ? "process-group-card--zombie" : ""
                }`}
              >
                <div className="process-group-card__head">
                  <button
                    type="button"
                    className="process-group-toggle"
                    onClick={() => toggleGroup(group.owner.key)}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                    <div className="process-group-title-wrap">
                      <div className="process-row__head">
                        <strong className="process-group-name">
                          {group.owner.label}
                        </strong>
                        <span className="badge badge--accent">
                          {group.owner.kind}
                        </span>
                        <span className="badge badge--neutral tabular">
                          {group.processes.length} süreç
                        </span>
                        {group.hasZombie && (
                          <span className="badge badge--danger">
                            <AlertOctagon size={11} /> Zombi Adayı
                          </span>
                        )}
                        {group.ports.map((port) => (
                          <span key={port} className="port-pill mono">
                            :{port}
                          </span>
                        ))}
                      </div>
                      <span className="cmd-preview mono truncate">
                        {group.owner.openablePath ?? firstCmd}
                      </span>
                    </div>
                  </button>

                  <div className="process-row__stats tabular">
                    <div>
                      <span className="stat-label">TOPLAM RAM</span>
                      <strong>{formatMegabytes(group.totalMemoryBytes)}</strong>
                    </div>
                    <div>
                      <span className="stat-label">CPU</span>
                      <strong>{formatPct(group.totalCpuPct)}</strong>
                    </div>
                  </div>

                  <div className="process-row__actions">
                    {group.owner.openablePath && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          const targetPath = group.owner.openablePath;
                          if (!targetPath) return;
                          void (async () => {
                            try {
                              await api.openInFileManager({ path: targetPath });
                            } catch (err) {
                              onNotify?.(
                                "error",
                                `Dosya yöneticisi açılamadı: ${String(err)}`,
                              );
                            }
                          })();
                        }}
                        title="Proje klasörünü Finder'da aç"
                      >
                        <FolderOpen size={13} />
                        <span>Klasör</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn--danger-soft btn--sm"
                      disabled={isBusyGroup}
                      onClick={() => setGroupKillTarget(group)}
                    >
                      <Square size={13} />
                      <span>
                        {group.processes.length > 1 ? "Tümünü Kapat" : "Kapat"}
                      </span>
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="process-group-children">
                    {group.processes.map((proc) =>
                      renderProcessRow(proc, false),
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={forceTarget !== null}
        title="Süreci Zorla Kapat (SIGKILL)"
        description={
          forceTarget
            ? `"${forceTarget.name}" (PID ${forceTarget.pid}) süreci kaydedilmemiş verileri beklemeden anında sonlandırılacak.`
            : ""
        }
        details={
          forceTarget
            ? [
                `PID: ${forceTarget.pid} · RAM: ${formatMegabytes(
                  forceTarget.memory_bytes,
                )}`,
                ...(forceTarget.cwd ? [`Klasör: ${forceTarget.cwd}`] : []),
              ]
            : undefined
        }
        confirmLabel="Zorla Kapat"
        cancelLabel="Vazgeç"
        tone="danger"
        busy={forceTarget !== null && busyPid === forceTarget.pid}
        onConfirm={handleConfirmForceKill}
        onCancel={() => setForceTarget(null)}
      />

      <ConfirmDialog
        open={groupKillTarget !== null}
        title={
          groupKillTarget
            ? `"${groupKillTarget.owner.label}" Süreçlerini Kapat`
            : "Süreçleri Kapat"
        }
        description={
          groupKillTarget
            ? `${groupKillTarget.processes.length} süreç (toplam ${formatMegabytes(
                groupKillTarget.totalMemoryBytes,
              )} RAM) SIGTERM ile kapatılacak.`
            : ""
        }
        details={
          groupKillTarget
            ? groupKillTarget.processes
                .slice(0, 5)
                .map(
                  (p) =>
                    `PID ${p.pid} · ${p.name} (${formatMegabytes(
                      p.memory_bytes,
                    )})`,
                )
            : undefined
        }
        confirmLabel="Kapat"
        cancelLabel="Vazgeç"
        tone="danger"
        busy={
          groupKillTarget !== null &&
          busyGroupKey === groupKillTarget.owner.key
        }
        onConfirm={handleConfirmGroupKill}
        onCancel={() => setGroupKillTarget(null)}
      />
    </div>
  );
}
