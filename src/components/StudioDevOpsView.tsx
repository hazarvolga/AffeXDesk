import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  AudioLines,
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Code2,
  Cpu,
  Film,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  Play,
  Radio,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Square,
  Volume2,
  Zap,
} from "lucide-react";
import {
  api,
  type CreativeCacheItem,
  type DockerOverview,
  type EnvHygieneItem,
  type FocusModeResult,
  type LocalAiModel,
  type MediaProbeResult,
} from "../lib/api";
import { formatBytes, formatUptime } from "../lib/format";

export interface StudioDevOpsViewProps {
  onOpenFinder: (path: string) => void;
  onRefreshTelemetry: () => Promise<void>;
  onNotify: (tone: "success" | "error" | "info", text: string) => void;
}

type StudioSubTab = "media" | "devops" | "focus";
type ModelCategory = "image" | "audio" | "llm";

interface ModelVisualMeta {
  category: ModelCategory;
  label: string;
  accentColor: string;
  iconBg: string;
  iconBorder: string;
  badgeStyle: {
    background: string;
    borderColor: string;
    color: string;
  };
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}:${String(remMins).padStart(2, "0")}:${String(secs).padStart(
      2,
      "0"
    )}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function classifyAiModel(id: string): ModelVisualMeta {
  const lower = id.toLowerCase();
  if (
    /(flux|image|sdxl|\bsd\b|sd-|stable-diffusion|imagen|dall)/i.test(lower)
  ) {
    return {
      category: "image",
      label: "Görsel Üretim",
      accentColor: "#a78bfa",
      iconBg: "rgba(129, 140, 248, 0.14)",
      iconBorder: "rgba(129, 140, 248, 0.3)",
      badgeStyle: {
        background: "rgba(129, 140, 248, 0.14)",
        borderColor: "rgba(129, 140, 248, 0.3)",
        color: "#c4b5fd",
      },
    };
  }
  if (/(audio|music|ace-step|kokoro|tts|whisper|voice|speech)/i.test(lower)) {
    return {
      category: "audio",
      label: "Ses & Müzik",
      accentColor: "#f59e0b",
      iconBg: "rgba(245, 158, 11, 0.14)",
      iconBorder: "rgba(245, 158, 11, 0.3)",
      badgeStyle: {
        background: "rgba(245, 158, 11, 0.14)",
        borderColor: "rgba(245, 158, 11, 0.3)",
        color: "#fcd34d",
      },
    };
  }
  return {
    category: "llm",
    label: "LLM / Kod",
    accentColor: "#38bdf8",
    iconBg: "rgba(56, 189, 248, 0.14)",
    iconBorder: "rgba(56, 189, 248, 0.3)",
    badgeStyle: {
      background: "rgba(56, 189, 248, 0.14)",
      borderColor: "rgba(56, 189, 248, 0.28)",
      color: "#7dd3fc",
    },
  };
}

function parseModelIdentity(
  id: string,
  provider: string
): { name: string; vendor: string } {
  const slashIdx = id.indexOf("/");
  if (slashIdx > 0 && slashIdx < id.length - 1) {
    return {
      vendor: id.slice(0, slashIdx),
      name: id.slice(slashIdx + 1),
    };
  }
  return { name: id, vendor: provider };
}

function isModelLoaded(state: string): boolean {
  const s = state.toLowerCase();
  return s === "loaded" || s === "running" || s === "active";
}

function ModelCategoryIcon({ category }: { category: ModelCategory }) {
  if (category === "image") return <ImageIcon size={16} />;
  if (category === "audio") return <AudioLines size={16} />;
  return <Cpu size={16} />;
}

export function StudioDevOpsView({
  onOpenFinder,
  onRefreshTelemetry,
  onNotify,
}: StudioDevOpsViewProps) {
  const [subTab, setSubTab] = useState<StudioSubTab>("media");

  // Medya & AI
  const [caches, setCaches] = useState<CreativeCacheItem[]>([]);
  const [showEmptyCaches, setShowEmptyCaches] = useState(false);
  const [aiModels, setAiModels] = useState<LocalAiModel[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<MediaProbeResult | null>(null);

  // Docker & .env
  const [docker, setDocker] = useState<DockerOverview | null>(null);
  const [envItems, setEnvItems] = useState<EnvHygieneItem[]>([]);
  const [loadingDevops, setLoadingDevops] = useState(false);
  const [busyContainerId, setBusyContainerId] = useState<string | null>(null);

  // Focus Presets
  const [activatingMode, setActivatingMode] = useState<string | null>(null);
  const [focusResult, setFocusResult] = useState<FocusModeResult | null>(null);

  const loadMediaAndAi = useCallback(async () => {
    setLoadingMedia(true);
    try {
      const [cacheRes, modelRes] = await Promise.allSettled([
        api.scanCreativeCaches(),
        api.scanLocalAiModels(),
      ]);
      if (cacheRes.status === "fulfilled") setCaches(cacheRes.value);
      if (modelRes.status === "fulfilled") setAiModels(modelRes.value);
    } finally {
      setLoadingMedia(false);
    }
  }, []);

  const loadDevops = useCallback(async () => {
    setLoadingDevops(true);
    try {
      const [dockerRes, envRes] = await Promise.allSettled([
        api.inspectDocker(),
        api.scanEnvHygiene(),
      ]);
      if (dockerRes.status === "fulfilled") setDocker(dockerRes.value);
      if (envRes.status === "fulfilled") setEnvItems(envRes.value);
    } finally {
      setLoadingDevops(false);
    }
  }, []);

  useEffect(() => {
    void loadMediaAndAi();
    void loadDevops();
  }, [loadMediaAndAi, loadDevops]);

  async function handlePickAndProbeMedia() {
    setProbing(true);
    try {
      const picked = await api.pickMediaFile();
      if (!picked) return;
      const result = await api.inspectMediaFile(picked);
      setProbeResult(result);
      onNotify("success", `Medya analiz edildi: ${result.file_name}`);
    } catch (err) {
      onNotify("error", `FFprobe analizi başarısız: ${String(err)}`);
    } finally {
      setProbing(false);
    }
  }

  async function handleDockerAction(
    id: string,
    action: "start" | "stop" | "restart"
  ) {
    setBusyContainerId(id);
    try {
      await api.dockerContainerAction(id, action);
      onNotify("success", `Konteyner işlemi tamamlandı (${action}).`);
      await loadDevops();
    } catch (err) {
      onNotify("error", `Docker komutu başarısız: ${String(err)}`);
    } finally {
      setBusyContainerId(null);
    }
  }

  async function handleActivateFocus(mode: "render" | "webdev" | "publish") {
    setActivatingMode(mode);
    try {
      const result = await api.activateFocusMode(mode);
      setFocusResult(result);
      onNotify("success", result.summary);
      if (mode === "render" && result.killed_pids.length > 0) {
        await onRefreshTelemetry();
      }
    } catch (err) {
      onNotify("error", `Çalışma modu başlatılamadı: ${String(err)}`);
    } finally {
      setActivatingMode(null);
    }
  }

  // KPI & özet hesaplamaları
  const activeCaches = caches
    .filter((item) => item.exists && item.size_bytes > 0)
    .sort((a, b) => b.size_bytes - a.size_bytes);
  const emptyCaches = caches.filter(
    (item) => !item.exists || item.size_bytes <= 0
  );
  const totalCacheBytes = activeCaches.reduce(
    (sum, item) => sum + item.size_bytes,
    0
  );

  const loadedModelsCount = aiModels.filter((m) =>
    isModelLoaded(m.state)
  ).length;
  const totalModelDiskBytes = aiModels.reduce(
    (sum, m) => sum + (m.bytes_on_disk && m.bytes_on_disk > 0 ? m.bytes_on_disk : 0),
    0
  );

  const totalContainers = docker?.containers.length ?? 0;
  const runningContainers =
    docker?.containers.filter((c) => c.state.toLowerCase() === "running")
      .length ?? 0;

  const exposedEnvCount = envItems.filter((item) => item.exposed_risk).length;

  return (
    <div className="view-stack" style={{ width: "100%" }}>
      <header className="view-header">
        <div>
          <h1 className="view-title">Stüdyo &amp; DevOps</h1>
          <p className="view-subtitle">
            Kreatif medya önbellekleri, FFprobe müfettişi, yerel AI modelleri,
            Docker, .env hijyeni ve çalışma modları
          </p>
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => {
            void loadMediaAndAi();
            void loadDevops();
          }}
          disabled={loadingMedia || loadingDevops}
        >
          <RefreshCw
            size={15}
            className={loadingMedia || loadingDevops ? "spin" : ""}
          />
          <span>Yenile</span>
        </button>
      </header>

      {/* 1. Üstte 4'lü Operatör KPI Şeridi */}
      <section
        className="metrics-grid"
        aria-label="Stüdyo ve DevOps Operatör Özeti"
      >
        {/* KPI 1: Kreatif & Model Cache */}
        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <HardDrive size={14} className="text-warning" />
              Kreatif &amp; Model Cache
            </span>
            <span className="badge badge--warning tabular">
              {activeCaches.length} aktif
            </span>
          </div>
          <div className="metric-card__value tabular">
            {formatBytes(totalCacheBytes)}
          </div>
          <p className="metric-card__meta">
            {emptyCaches.length > 0
              ? `${emptyCaches.length} boş önbellek gizlendi`
              : `${caches.length} önbellek tarandı`}
          </p>
        </article>

        {/* KPI 2: Yerel AI Modelleri */}
        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <Sparkles size={14} className="text-cyan" />
              Yerel AI Modelleri
            </span>
            <span
              className={`badge tabular ${
                loadedModelsCount > 0 ? "badge--success" : "badge--neutral"
              }`}
            >
              {loadedModelsCount} yüklü
            </span>
          </div>
          <div className="metric-card__value tabular">
            {aiModels.length}{" "}
            <span
              style={{
                fontSize: "14px",
                fontWeight: 500,
                color: "var(--text-secondary)",
              }}
            >
              model
            </span>
          </div>
          <p className="metric-card__meta">
            {totalModelDiskBytes > 0
              ? `Diskte ${formatBytes(totalModelDiskBytes)}`
              : "MLX-Serve & Ollama envanteri"}
          </p>
        </article>

        {/* KPI 3: Docker Konteynerleri */}
        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <Box size={14} className="text-indigo" />
              Docker Konteynerleri
            </span>
            <span
              className={`badge ${
                docker?.available ? "badge--success" : "badge--warning"
              }`}
            >
              {docker?.available ? "Aktif" : "Çevrimdışı"}
            </span>
          </div>
          <div className="metric-card__value tabular">
            {runningContainers}
            <span
              style={{
                fontSize: "16px",
                fontWeight: 500,
                color: "var(--text-muted)",
              }}
            >
              {" "}
              / {totalContainers}
            </span>
          </div>
          <p className="metric-card__meta">
            {docker?.available
              ? runningContainers > 0
                ? `${runningContainers} konteyner çalışıyor`
                : "Çalışan konteyner yok"
              : "Docker daemon erişilemiyor"}
          </p>
        </article>

        {/* KPI 4: .env Güvenlik */}
        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <ShieldCheck size={14} className="text-emerald" />
              .env Güvenlik
            </span>
            <span
              className={`badge ${
                exposedEnvCount > 0 ? "badge--danger" : "badge--success"
              }`}
            >
              {exposedEnvCount > 0 ? `${exposedEnvCount} Risk` : "Temiz"}
            </span>
          </div>
          <div
            className={`metric-card__value tabular ${
              exposedEnvCount > 0 ? "" : "text-emerald"
            }`}
            style={
              exposedEnvCount > 0 ? { color: "var(--accent-danger)" } : undefined
            }
          >
            {exposedEnvCount === 0 ? "Temiz" : `${exposedEnvCount} Riskli`}
          </div>
          <p className="metric-card__meta">
            {envItems.length > 0
              ? `${envItems.length} proje denetlendi`
              : "Taranan proje yok"}
          </p>
        </article>
      </section>

      {/* 3 Alt Sekme */}
      <div className="toolbar">
        <div
          className="filter-pills"
          role="tablist"
          aria-label="Stüdyo ve DevOps Alt Sekmeleri"
        >
          <button
            type="button"
            role="tab"
            aria-selected={subTab === "media"}
            className={`pill ${subTab === "media" ? "pill--active" : ""}`}
            onClick={() => setSubTab("media")}
          >
            Medya &amp; AI Modelleri
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === "devops"}
            className={`pill ${subTab === "devops" ? "pill--active" : ""}`}
            onClick={() => setSubTab("devops")}
          >
            Docker &amp; .env Hijyeni
            {exposedEnvCount > 0 ? ` (${exposedEnvCount} risk)` : ""}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === "focus"}
            className={`pill ${subTab === "focus" ? "pill--active" : ""}`}
            onClick={() => setSubTab("focus")}
          >
            Çalışma Modları
          </button>
        </div>
      </div>

      {/* ALT SEKME 1: MEDYA & AI MODELLERİ */}
      {subTab === "media" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "18px",
            width: "100%",
          }}
        >
          {/* 2. 2 Sütunlu Bento Düzeni */}
          <div className="split-grid" style={{ width: "100%" }}>
            {/* Sol Panel: Aktif Medya & Model Önbellekleri */}
            <section className="panel" style={{ minWidth: 0 }}>
              <div className="panel__head">
                <h2 className="panel__title">
                  <HardDrive size={16} className="text-warning" /> Aktif Medya
                  &amp; Model Önbellekleri
                </h2>
                <span className="badge badge--warning tabular">
                  {formatBytes(totalCacheBytes)}
                </span>
              </div>

              {loadingMedia && caches.length === 0 ? (
                <p className="empty-hint">
                  Kreatif uygulama ve model önbellekleri taranıyor...
                </p>
              ) : activeCaches.length === 0 ? (
                <div
                  style={{
                    padding: "20px 16px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px dashed var(--border-strong)",
                    background: "rgba(255, 255, 255, 0.015)",
                    textAlign: "center",
                    color: "var(--text-secondary)",
                    fontSize: "13px",
                  }}
                >
                  Dolu kreatif veya model önbelleği tespit edilmedi.
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  {activeCaches.map((item) => {
                    const sharePct =
                      totalCacheBytes > 0
                        ? Math.max(
                            2,
                            Math.round((item.size_bytes / totalCacheBytes) * 100)
                          )
                        : 100;
                    return (
                      <article
                        key={item.id}
                        style={{
                          padding: "14px 16px",
                          borderRadius: "var(--radius-sm)",
                          background: "var(--bg-surface-elevated)",
                          border: "1px solid var(--border-subtle)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            gap: "12px",
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                flexWrap: "wrap",
                              }}
                            >
                              <strong style={{ fontSize: "14px" }}>
                                {item.app}
                              </strong>
                              <span className="badge badge--info tabular">
                                %{sharePct}
                              </span>
                            </div>
                            <span
                              className="muted"
                              style={{ fontSize: "12px", display: "block", marginTop: "2px" }}
                            >
                              {item.label}
                            </span>
                          </div>
                          <strong
                            className="tabular text-warning"
                            style={{ fontSize: "18px", flexShrink: 0 }}
                          >
                            {formatBytes(item.size_bytes)}
                          </strong>
                        </div>

                        <div className="progress-track">
                          <div
                            className="progress-fill progress-fill--warning"
                            style={{ width: `${sharePct}%` }}
                          />
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "10px",
                          }}
                        >
                          <span
                            className="mono muted truncate"
                            style={{ minWidth: 0, flex: 1 }}
                            title={item.path}
                          >
                            {item.path}
                          </span>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            style={{ flexShrink: 0 }}
                            onClick={() => onOpenFinder(item.path)}
                          >
                            <FolderOpen size={13} />
                            <span>Finder&apos;da Aç</span>
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              {/* Boş / Kurulu Olmayan Önbellekler — Daraltılabilir Tek Satır Çubuk */}
              {emptyCaches.length > 0 && (
                <div
                  style={{
                    marginTop: "auto",
                    borderTop: "1px solid var(--border-subtle)",
                    paddingTop: "10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setShowEmptyCaches((prev) => !prev)}
                    aria-expanded={showEmptyCaches}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                      width: "100%",
                      padding: "7px 10px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-subtle)",
                      background: "rgba(255, 255, 255, 0.02)",
                      color: "var(--text-secondary)",
                      fontSize: "12px",
                    }}
                  >
                    <span>
                      {emptyCaches.length} boş/kurulu olmayan önbellek gizlendi
                    </span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        color: "var(--accent-cyan)",
                        fontWeight: 500,
                      }}
                    >
                      {showEmptyCaches ? "Gizle" : "Göster"}
                      {showEmptyCaches ? (
                        <ChevronUp size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </span>
                  </button>

                  {showEmptyCaches && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                      }}
                    >
                      {emptyCaches.map((item) => (
                        <div
                          key={item.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "10px",
                            padding: "7px 10px",
                            borderRadius: "var(--radius-sm)",
                            background: "rgba(255, 255, 255, 0.015)",
                            border: "1px solid var(--border-subtle)",
                            fontSize: "12px",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              minWidth: 0,
                            }}
                          >
                            <span style={{ fontWeight: 500 }}>{item.app}</span>
                            <span className="muted truncate">{item.label}</span>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              flexShrink: 0,
                            }}
                          >
                            <span className="badge badge--neutral">
                              {item.exists ? "0 B" : "Yok"}
                            </span>
                            {item.exists && (
                              <button
                                type="button"
                                className="icon-btn"
                                title="Finder'da Aç"
                                onClick={() => onOpenFinder(item.path)}
                              >
                                <FolderOpen size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Sağ Panel: FFprobe Medya Müfettişi */}
            <section className="panel" style={{ minWidth: 0 }}>
              <div className="panel__head">
                <h2 className="panel__title">
                  <Film size={16} className="text-cyan" /> FFprobe Medya
                  Müfettişi
                </h2>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => void handlePickAndProbeMedia()}
                  disabled={probing}
                >
                  <Clapperboard size={14} />
                  <span>
                    {probing ? "Analiz Ediliyor..." : "Medya Dosyası Seç"}
                  </span>
                </button>
              </div>

              {!probeResult ? (
                <div
                  style={{
                    flex: 1,
                    minHeight: "196px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "12px",
                    padding: "24px 20px",
                    borderRadius: "var(--radius-md)",
                    border: "1px dashed rgba(56, 189, 248, 0.3)",
                    background:
                      "radial-gradient(circle at 50% 0%, rgba(56, 189, 248, 0.08), transparent 68%)",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "12px",
                      display: "grid",
                      placeItems: "center",
                      background: "rgba(56, 189, 248, 0.14)",
                      border: "1px solid rgba(56, 189, 248, 0.28)",
                      color: "var(--accent-cyan)",
                    }}
                  >
                    <Clapperboard size={20} />
                  </div>
                  <div style={{ maxWidth: "360px" }}>
                    <strong style={{ display: "block", fontSize: "14px" }}>
                      Yayın &amp; Render Kalite Denetimi
                    </strong>
                    <p
                      className="muted"
                      style={{ margin: "4px 0 0", fontSize: "12.5px" }}
                    >
                      Video veya ses dosyası seçerek çözünürlük, FPS, codec,
                      süre, bitrate ve YouTube{" "}
                      <span className="mono">-14 LUFS</span> uyumluluğunu
                      anında doğrulayın.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => void handlePickAndProbeMedia()}
                    disabled={probing}
                  >
                    <Film size={13} />
                    <span>
                      {probing ? "Analiz Ediliyor..." : "Dosya Seç ve İncele"}
                    </span>
                  </button>
                </div>
              ) : (
                <div className="probe-card" style={{ flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: "10px",
                      padding: "10px 12px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--bg-surface-elevated)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          flexWrap: "wrap",
                        }}
                      >
                        <strong className="truncate">
                          {probeResult.file_name}
                        </strong>
                        {/* -14 LUFS Uyumluluk Rozeti */}
                        {probeResult.lufs != null ? (
                          <span
                            className={`badge tabular ${
                              probeResult.youtube_lufs_ok === true
                                ? "badge--success"
                                : probeResult.youtube_lufs_ok === false
                                ? "badge--warning"
                                : "badge--info"
                            }`}
                          >
                            <Volume2 size={11} />
                            {probeResult.lufs.toFixed(1)} LUFS ·{" "}
                            {probeResult.youtube_lufs_ok === true
                              ? "-14 LUFS Uyumlu"
                              : probeResult.youtube_lufs_ok === false
                              ? "-14 LUFS Sapması"
                              : "Ölçüldü"}
                          </span>
                        ) : (
                          <span className="badge badge--neutral">
                            <Volume2 size={11} />
                            -14 LUFS: Ölçülmedi
                          </span>
                        )}
                      </div>
                      <p
                        className="mono muted truncate"
                        style={{ margin: "3px 0 0" }}
                        title={probeResult.path}
                      >
                        {probeResult.path}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      style={{ flexShrink: 0 }}
                      onClick={() => onOpenFinder(probeResult.path)}
                    >
                      <FolderOpen size={13} />
                      <span>Finder</span>
                    </button>
                  </div>

                  {/* 6'lı Teknik Metrik Izgarası */}
                  <div className="probe-metrics-grid">
                    <div className="social-stat">
                      <span className="social-stat__label">Çözünürlük</span>
                      <strong className="tabular">
                        {probeResult.width && probeResult.height
                          ? `${probeResult.width}×${probeResult.height}`
                          : "Ses / Yok"}
                      </strong>
                    </div>
                    <div className="social-stat">
                      <span className="social-stat__label">FPS</span>
                      <strong className="tabular">
                        {probeResult.fps != null
                          ? `${probeResult.fps.toFixed(2)} fps`
                          : "—"}
                      </strong>
                    </div>
                    <div className="social-stat">
                      <span className="social-stat__label">Video Codec</span>
                      <strong className="mono">
                        {probeResult.video_codec || "—"}
                      </strong>
                    </div>
                    <div className="social-stat">
                      <span className="social-stat__label">Ses Codec</span>
                      <strong className="mono">
                        {probeResult.audio_codec || "—"}
                      </strong>
                    </div>
                    <div className="social-stat">
                      <span className="social-stat__label">Süre</span>
                      <strong className="tabular">
                        {formatDuration(probeResult.duration_secs)}
                      </strong>
                    </div>
                    <div className="social-stat">
                      <span className="social-stat__label">Bitrate</span>
                      <strong className="tabular">
                        {probeResult.bitrate_kbps
                          ? `${probeResult.bitrate_kbps} kbps`
                          : formatBytes(probeResult.size_bytes)}
                      </strong>
                      {probeResult.bitrate_kbps != null && (
                        <span
                          className="muted tabular"
                          style={{ fontSize: "11px" }}
                        >
                          {formatBytes(probeResult.size_bytes)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* 3. Yerel AI Model Envanteri -> 3 Sütunlu Görsel Model Kart Izgarası */}
          <section className="panel" style={{ width: "100%" }}>
            <div className="panel__head">
              <h2 className="panel__title">
                <Sparkles size={16} className="text-emerald" /> Yerel AI Model
                Envanteri (MLX-Serve &amp; Ollama)
              </h2>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  flexWrap: "wrap",
                }}
              >
                {loadedModelsCount > 0 && (
                  <span className="badge badge--success tabular">
                    {loadedModelsCount} bellekte
                  </span>
                )}
                <span className="badge badge--neutral tabular">
                  {aiModels.length} model
                </span>
              </div>
            </div>

            {aiModels.length === 0 ? (
              <p className="empty-hint">
                Aktif MLX-Serve veya Ollama modeli tespit edilmedi. Sunucular
                çalıştığında modeller burada listelenir.
              </p>
            ) : (
              <div className="modules-grid" style={{ gap: "14px" }}>
                {aiModels.map((model) => {
                  const visual = classifyAiModel(model.id);
                  const identity = parseModelIdentity(model.id, model.provider);
                  const loaded = isModelLoaded(model.state);
                  const hasDisk =
                    model.bytes_on_disk != null && model.bytes_on_disk > 0;
                  const hasRam =
                    model.bytes_resident != null && model.bytes_resident > 0;

                  return (
                    <article
                      key={`${model.provider}-${model.id}`}
                      className="module-card"
                      style={{
                        background: "var(--bg-surface-elevated)",
                        borderColor: loaded
                          ? "rgba(16, 185, 129, 0.32)"
                          : "var(--border-subtle)",
                        padding: "14px 16px",
                        gap: "12px",
                        justifyContent: "space-between",
                        minWidth: 0,
                      }}
                    >
                      {/* Üst Satır: Kategori İkonu + Kategori Rozeti + Bellek Durumu */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "8px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            minWidth: 0,
                          }}
                        >
                          <span
                            style={{
                              width: "30px",
                              height: "30px",
                              borderRadius: "8px",
                              display: "grid",
                              placeItems: "center",
                              flexShrink: 0,
                              background: visual.iconBg,
                              border: `1px solid ${visual.iconBorder}`,
                              color: visual.accentColor,
                            }}
                          >
                            <ModelCategoryIcon category={visual.category} />
                          </span>
                          <span
                            className="badge"
                            style={visual.badgeStyle}
                          >
                            {visual.label}
                          </span>
                        </div>

                        <span
                          className={`badge ${
                            loaded ? "badge--success" : "badge--neutral"
                          }`}
                        >
                          {loaded && (
                            <span
                              style={{
                                width: "6px",
                                height: "6px",
                                borderRadius: "999px",
                                background: "var(--accent-emerald)",
                                display: "inline-block",
                              }}
                            />
                          )}
                          {model.state}
                        </span>
                      </div>

                      {/* Orta Blok: Temiz Model Adı + Üretici Alt Metni */}
                      <div style={{ minWidth: 0 }}>
                        <h3
                          className="truncate"
                          style={{
                            margin: 0,
                            fontSize: "14px",
                            fontWeight: 650,
                            color: "var(--text-primary)",
                          }}
                          title={model.id}
                        >
                          {identity.name}
                        </h3>
                        <p
                          className="mono muted truncate"
                          style={{ margin: "3px 0 0", fontSize: "11.5px" }}
                          title={identity.vendor}
                        >
                          {identity.vendor}
                        </p>
                      </div>

                      {/* Alt Satır: Sağlayıcı Rozeti + Disk / RAM Boyutu */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "8px",
                          paddingTop: "8px",
                          borderTop: "1px solid var(--border-subtle)",
                          flexWrap: "wrap",
                        }}
                      >
                        <span className="badge badge--info">
                          {model.provider}
                        </span>
                        <div
                          className="tabular"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            fontSize: "12px",
                          }}
                        >
                          {hasRam && (
                            <strong className="text-cyan">
                              RAM {formatBytes(model.bytes_resident!)}
                            </strong>
                          )}
                          {hasDisk ? (
                            <span className="muted">
                              {formatBytes(model.bytes_on_disk!)}
                            </span>
                          ) : (
                            !hasRam && (
                              <span
                                className="muted"
                                style={{ fontSize: "11px" }}
                              >
                                Hazır
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ALT SEKME 2: DOCKER & .ENV HİJYENİ */}
      {subTab === "devops" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "18px",
            width: "100%",
          }}
        >
          {/* Docker Konteynerleri */}
          <section className="panel" style={{ width: "100%" }}>
            <div className="panel__head">
              <h2 className="panel__title">
                <Box size={16} className="text-cyan" /> Docker Konteynerleri
              </h2>
              <span
                className={`badge ${
                  docker?.available ? "badge--success" : "badge--warning"
                }`}
              >
                {docker?.available ? "Docker Aktif" : "Docker Çevrimdışı"}
              </span>
            </div>

            {docker?.reclaimable_summary && (
              <p className="mono muted" style={{ margin: 0 }}>
                {docker.reclaimable_summary}
              </p>
            )}

            {!docker?.available ? (
              <p className="empty-hint">
                {docker?.error ||
                  "Docker daemon çalışmıyor veya CLI bulunamadı."}
              </p>
            ) : docker.containers.length === 0 ? (
              <p className="empty-hint">Kayıtlı Docker konteyneri bulunamadı.</p>
            ) : (
              <ul className="summary-list">
                {docker.containers.map((c) => {
                  const running = c.state.toLowerCase() === "running";
                  const busy = busyContainerId === c.id;
                  return (
                    <li key={c.id} className="summary-row">
                      <div className="summary-row__main">
                        <div className="summary-row__title">
                          <strong>{c.name}</strong>
                          <span
                            className={`badge ${
                              running ? "badge--success" : "badge--neutral"
                            }`}
                          >
                            {c.state}
                          </span>
                          <span className="mono muted">{c.image}</span>
                        </div>
                        <div className="summary-row__sub">
                          <span className="muted">{c.status}</span>
                          {c.ports && (
                            <span className="port-pill mono">{c.ports}</span>
                          )}
                        </div>
                      </div>
                      <div className="process-row__actions">
                        {!running ? (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            disabled={busy}
                            onClick={() => void handleDockerAction(c.id, "start")}
                          >
                            <Play size={12} />
                            <span>Başlat</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--danger-soft btn--sm"
                            disabled={busy}
                            onClick={() => void handleDockerAction(c.id, "stop")}
                          >
                            <Square size={12} />
                            <span>Durdur</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={busy}
                          onClick={() =>
                            void handleDockerAction(c.id, "restart")
                          }
                        >
                          <RotateCw size={12} />
                          <span>Yeniden Başlat</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* .env Güvenlik Hijyeni */}
          <section className="panel" style={{ width: "100%" }}>
            <div className="panel__head">
              <h2 className="panel__title">
                <ShieldCheck size={16} className="text-emerald" /> .env Güvenlik
                Hijyen Denetimi
              </h2>
              <span
                className={`badge ${
                  exposedEnvCount > 0 ? "badge--danger" : "badge--success"
                }`}
              >
                {exposedEnvCount > 0
                  ? `${exposedEnvCount} Riskli Proje`
                  : "Tüm Projeler Güvenli"}
              </span>
            </div>

            {envItems.length === 0 ? (
              <p className="empty-hint">
                Taranacak proje bulunamadı. Önce en az bir iş klasörü ekleyin.
              </p>
            ) : (
              <ul className="summary-list">
                {envItems.map((item) => (
                  <li
                    key={item.project_path}
                    className={`summary-row ${
                      item.exposed_risk ? "env-row--risk" : ""
                    }`}
                  >
                    <div className="summary-row__main">
                      <div className="summary-row__title">
                        <strong>{item.project_name}</strong>
                        <span
                          className={`badge ${
                            item.has_env ? "badge--info" : "badge--neutral"
                          }`}
                        >
                          {item.has_env
                            ? `.env (${item.key_count} anahtar)`
                            : ".env yok"}
                        </span>
                        {item.has_env && (
                          <span
                            className={`badge ${
                              item.gitignored
                                ? "badge--success"
                                : "badge--warning"
                            }`}
                          >
                            {item.gitignored
                              ? ".gitignore korumalı"
                              : ".gitignore eksik"}
                          </span>
                        )}
                        {item.exposed_risk && (
                          <span className="badge badge--danger">
                            <AlertTriangle size={11} /> Riskli
                          </span>
                        )}
                      </div>

                      {item.key_names.length > 0 && (
                        <div className="tag-row">
                          {item.key_names.slice(0, 8).map((k) => (
                            <span key={k} className="tech-tag mono">
                              {k}
                            </span>
                          ))}
                          {item.key_names.length > 8 && (
                            <span className="mono muted">
                              +{item.key_names.length - 8} anahtar
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => onOpenFinder(item.project_path)}
                    >
                      <FolderOpen size={13} />
                      <span>Klasör</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* ALT SEKME 3: ÇALIŞMA MODLARI (FOCUS PRESETS) */}
      {subTab === "focus" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "18px",
            width: "100%",
          }}
        >
          <section
            className="modules-grid"
            aria-label="Çalışma Modları"
            style={{ width: "100%" }}
          >
            <article className="module-card focus-card">
              <div className="module-card__head">
                <Clapperboard size={20} className="text-warning" />
                <span className="badge badge--warning">RAM Kurtarma</span>
              </div>
              <h3>Render / Video Modu</h3>
              <p>
                Arka planda unutulmuş zombi Node.js geliştirici süreçlerini
                güvenli şekilde kapatır ve video/3B render için bellek açar.
              </p>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={activatingMode !== null}
                onClick={() => void handleActivateFocus("render")}
              >
                <Zap size={14} />
                <span>
                  {activatingMode === "render"
                    ? "Uygulanıyor..."
                    : "Render Modunu Başlat"}
                </span>
              </button>
            </article>

            <article className="module-card focus-card">
              <div className="module-card__head">
                <Code2 size={20} className="text-cyan" />
                <span className="badge badge--info">Geliştirme</span>
              </div>
              <h3>WebDev Modu</h3>
              <p>
                Aktif geliştirme ortamı, dinlenen portlar ve çalışma alanı
                sağlık durumunu kontrol ederek hızlı özet hazırlar.
              </p>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={activatingMode !== null}
                onClick={() => void handleActivateFocus("webdev")}
              >
                <Cpu size={14} />
                <span>
                  {activatingMode === "webdev"
                    ? "Kontrol Ediliyor..."
                    : "WebDev Modunu Başlat"}
                </span>
              </button>
            </article>

            <article className="module-card focus-card">
              <div className="module-card__head">
                <Radio size={20} className="text-emerald" />
                <span className="badge badge--success">Yayın</span>
              </div>
              <h3>Yayın Modu</h3>
              <p>
                İçerik ve sürüm çıkışı öncesi operasyonel hazırlık kontrolünü
                çalıştırır ve kritik notları listeler.
              </p>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={activatingMode !== null}
                onClick={() => void handleActivateFocus("publish")}
              >
                <CheckCircle2 size={14} />
                <span>
                  {activatingMode === "publish"
                    ? "Hazırlanıyor..."
                    : "Yayın Modunu Başlat"}
                </span>
              </button>
            </article>
          </section>

          {focusResult && (
            <section
              className="panel"
              aria-label="Çalışma Modu Sonucu"
              style={{ width: "100%" }}
            >
              <div className="panel__head">
                <h2 className="panel__title">
                  <CheckCircle2 size={16} className="text-emerald" /> Mod
                  Sonucu: {focusResult.mode.toUpperCase()}
                </h2>
                {focusResult.freed_memory_bytes > 0 && (
                  <span className="badge badge--success tabular">
                    +{formatBytes(focusResult.freed_memory_bytes)} RAM açıldı
                  </span>
                )}
              </div>
              <p className="repo-desc">{focusResult.summary}</p>

              {focusResult.killed_pids.length > 0 && (
                <div className="tag-row">
                  <span className="muted">Kapatılan PID&apos;ler:</span>
                  {focusResult.killed_pids.map((pid) => (
                    <span key={pid} className="port-pill mono">
                      PID {pid}
                    </span>
                  ))}
                </div>
              )}

              {focusResult.notes.length > 0 && (
                <ul className="focus-notes">
                  {focusResult.notes.map((note, idx) => (
                    <li key={idx}>{note}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// Keep unused import check clean if formatUptime is referenced later
export { formatUptime };
