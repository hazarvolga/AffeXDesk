import { useEffect, useState, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Cpu,
  Flame,
  GripVertical,
  HardDrive,
  Maximize2,
  MemoryStick,
  TerminalSquare,
  X,
} from "lucide-react";
import { api, type SystemMetrics } from "../lib/api";
import { formatBytes, formatPct } from "../lib/format";
import { useI18n } from "../lib/i18n";

export function FloatingHudBar() {
  const { t } = useI18n();
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const data = await api.getSystemMetrics();
        if (active) setMetrics(data);
      } catch {
        // yoksay
      }
    };
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const handleFocusMain = () => {
    void api.focusMainWindow();
  };

  const handleClose = () => {
    void api.setFloatingHud(false);
  };

  const handleDragMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button")) return;
    e.preventDefault();
    void getCurrentWindow().startDragging();
  };

  const cpuPct = metrics?.cpu_usage_pct ?? 0;
  const memPct = metrics?.mem_used_pct ?? 0;
  const diskPct = metrics?.disk_used_pct ?? 0;

  return (
    <div
      className="floating-hud"
      data-tauri-drag-region
      onMouseDown={handleDragMouseDown}
      title="Sürükleyerek ekranın istediğiniz yerine taşıyabilirsiniz"
    >
      <div className="floating-hud__brand" data-tauri-drag-region>
        <GripVertical size={12} className="muted" />
        <TerminalSquare size={13} className="text-cyan" />
      </div>

      <div className="floating-hud__item" data-tauri-drag-region>
        <Cpu size={13} className="text-cyan" />
        <span className="telemetry-ribbon__label">CPU</span>
        <strong className="telemetry-ribbon__value tabular">
          {metrics ? formatPct(cpuPct) : "—"}
        </strong>
        <span className="telemetry-ribbon__bar">
          <span
            className={`telemetry-ribbon__fill ${
              cpuPct > 85
                ? "progress-fill--danger"
                : cpuPct > 65
                ? "progress-fill--warning"
                : "progress-fill--cyan"
            }`}
            style={{ width: `${Math.min(100, cpuPct)}%` }}
          />
        </span>
        <span className="telemetry-ribbon__meta tabular">
          {metrics ? `${metrics.cpu_cores}c` : ""}
        </span>
      </div>

      <span className="telemetry-ribbon__sep" aria-hidden="true" />

      <div className="floating-hud__item" data-tauri-drag-region>
        <MemoryStick size={13} className="text-indigo" />
        <span className="telemetry-ribbon__label">RAM</span>
        <strong className="telemetry-ribbon__value tabular">
          {metrics ? formatPct(memPct) : "—"}
        </strong>
        <span className="telemetry-ribbon__bar">
          <span
            className={`telemetry-ribbon__fill ${
              metrics?.mem_pressure === "critical"
                ? "progress-fill--danger"
                : metrics?.mem_pressure === "warn"
                ? "progress-fill--warning"
                : "progress-fill--indigo"
            }`}
            style={{ width: `${Math.min(100, memPct)}%` }}
          />
        </span>
        <span className="telemetry-ribbon__meta tabular">
          {metrics
            ? `${formatBytes(metrics.mem_used_bytes)} / ${formatBytes(
                metrics.mem_total_bytes
              )}`
            : ""}
        </span>
      </div>

      <span className="telemetry-ribbon__sep" aria-hidden="true" />

      <div className="floating-hud__item" data-tauri-drag-region>
        <HardDrive size={13} className="text-emerald" />
        <span className="telemetry-ribbon__label">{t("telem.disk")}</span>
        <strong className="telemetry-ribbon__value tabular">
          {metrics ? formatPct(diskPct) : "—"}
        </strong>
        <span className="telemetry-ribbon__bar">
          <span
            className={`telemetry-ribbon__fill ${
              diskPct > 90
                ? "progress-fill--danger"
                : diskPct > 78
                ? "progress-fill--warning"
                : "progress-fill--emerald"
            }`}
            style={{ width: `${Math.min(100, diskPct)}%` }}
          />
        </span>
        <span className="telemetry-ribbon__meta tabular">
          {metrics
            ? `${formatBytes(metrics.disk_available_bytes)} ${t("telem.disk_free")}`
            : ""}
        </span>
      </div>

      <span className="telemetry-ribbon__sep" aria-hidden="true" />

      <div className="floating-hud__item" data-tauri-drag-region>
        <Flame
          size={13}
          className={
            metrics?.thermal_state === "critical"
              ? "text-danger"
              : metrics?.thermal_state === "serious"
              ? "text-warning"
              : metrics?.thermal_state === "fair"
              ? "text-cyan"
              : "muted"
          }
        />
        <span className="telemetry-ribbon__label">{t("telem.thermal")}</span>
        <strong className="telemetry-ribbon__value tabular">
          {metrics && metrics.temperature_c !== null
            ? `${Math.round(metrics.temperature_c)}°C`
            : "—"}
        </strong>
        <span
          className={`badge ${
            metrics?.thermal_state === "critical"
              ? "badge--danger"
              : metrics?.thermal_state === "serious"
              ? "badge--warning"
              : metrics?.thermal_state === "fair"
              ? "badge--info"
              : "badge--success"
          }`}
        >
          {metrics?.thermal_state === "critical"
            ? t("telem.critical")
            : metrics?.thermal_state === "serious"
            ? t("telem.serious")
            : metrics?.thermal_state === "fair"
            ? t("telem.fair")
            : t("telem.nominal")}
        </span>
      </div>

      <div className="floating-hud__actions">
        <button
          type="button"
          className="floating-hud__btn"
          onClick={handleFocusMain}
          title="AffeXDesk ana penceresini öne getir"
          aria-label="AffeXDesk ana penceresini öne getir"
        >
          <Maximize2 size={12} />
        </button>
        <button
          type="button"
          className="floating-hud__btn floating-hud__btn--close"
          onClick={handleClose}
          title="Üst telemetri bandını kapat"
          aria-label="Üst telemetri bandını kapat"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
