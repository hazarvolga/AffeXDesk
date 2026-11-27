import { useMemo, useState } from "react";
import {
  AlertOctagon,
  FolderOpen,
  RefreshCw,
  Search,
  Skull,
  Square,
} from "lucide-react";
import type { DevProcess, DevProcessReport } from "../lib/api";
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
}: ProcessesViewProps) {
  const [search, setSearch] = useState("");
  const [busyPid, setBusyPid] = useState<number | null>(null);
  const [forceTarget, setForceTarget] = useState<DevProcess | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (report?.processes ?? []).filter((proc) => {
      if (!matchesCategory(proc, filter)) return false;
      if (!q) return true;
      return (
        proc.name.toLowerCase().includes(q) ||
        String(proc.pid).includes(q) ||
        proc.category.toLowerCase().includes(q) ||
        (proc.cwd ?? "").toLowerCase().includes(q) ||
        proc.cmd_preview.toLowerCase().includes(q) ||
        proc.ports.some((p) => String(p).includes(q))
      );
    });
  }, [report, filter, search]);

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

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1 className="view-title">Geliştirici Süreçleri &amp; Portlar</h1>
          <p className="view-subtitle tabular">
            Toplam {report?.processes.length ?? 0} süreç ·{" "}
            {formatBytes(report?.total_dev_memory_bytes ?? 0)} RAM ·{" "}
            {report?.listening_ports_count ?? 0} dinlenen port ·{" "}
            {report?.zombie_count ?? 0} zombi adayı
          </p>
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
      </header>

      <div className="toolbar">
        <div className="filter-pills" role="tablist" aria-label="Süreç Filtreleri">
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
            placeholder="Süreç, PID, port veya klasör ara..."
            aria-label="Süreç ara"
          />
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-panel">
          <p>Bu filtreye uyan geliştirici süreci bulunamadı.</p>
        </div>
      ) : (
        <div className="process-list">
          {filtered.map((proc) => {
            const isBusy = busyPid === proc.pid;
            return (
              <article
                key={proc.pid}
                className={`process-row ${
                  proc.is_zombie_candidate ? "process-row--zombie" : ""
                }`}
              >
                <div className="process-row__info">
                  <div className="process-row__head">
                    <strong className="process-row__name">{proc.name}</strong>
                    <span className="mono muted">PID {proc.pid}</span>
                    <span className="badge badge--neutral">
                      {proc.category}
                    </span>
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
                  forceTarget.memory_bytes
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
    </div>
  );
}
