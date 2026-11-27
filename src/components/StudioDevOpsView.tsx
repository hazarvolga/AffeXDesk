import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  Clapperboard,
  Code2,
  Cpu,
  Film,
  FolderOpen,
  HardDrive,
  Play,
  Radio,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Square,
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

export function StudioDevOpsView({
  onOpenFinder,
  onRefreshTelemetry,
  onNotify,
}: StudioDevOpsViewProps) {
  const [subTab, setSubTab] = useState<StudioSubTab>("media");

  // Medya & AI
  const [caches, setCaches] = useState<CreativeCacheItem[]>([]);
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

  const totalCacheBytes = caches.reduce(
    (sum, item) => sum + (item.exists ? item.size_bytes : 0),
    0
  );
  const exposedEnvCount = envItems.filter((item) => item.exposed_risk).length;

  return (
    <div className="view-stack">
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
        <div className="view-stack">
          {/* Kreatif Render Cache Kartları */}
          <section className="panel">
            <div className="panel__head">
              <h2 className="panel__title">
                <HardDrive size={16} className="text-warning" /> Kreatif Render
                &amp; Medya Önbellekleri
              </h2>
              <span className="badge badge--warning tabular">
                Toplam: {formatBytes(totalCacheBytes)}
              </span>
            </div>

            {caches.length === 0 ? (
              <p className="empty-hint">
                Kreatif uygulama cache klasörü taranıyor veya bulunamadı.
              </p>
            ) : (
              <div className="projects-grid">
                {caches.map((item) => (
                  <article key={item.id} className="project-card">
                    <div className="project-card__head">
                      <div className="project-card__title-wrap">
                        <h3 className="project-card__title">{item.app}</h3>
                        <span
                          className={`badge ${
                            item.exists ? "badge--info" : "badge--neutral"
                          }`}
                        >
                          {item.exists ? "Mevcut" : "Yok"}
                        </span>
                      </div>
                      <strong className="tabular text-warning">
                        {formatBytes(item.size_bytes)}
                      </strong>
                    </div>
                    <span className="muted">{item.label}</span>
                    <span className="mono muted truncate">{item.path}</span>
                    <div className="project-card__footer">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={!item.exists}
                        onClick={() => onOpenFinder(item.path)}
                      >
                        <FolderOpen size={13} />
                        <span>Finder&apos;da Aç</span>
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* FFprobe Medya Müfettişi */}
          <section className="panel">
            <div className="panel__head">
              <h2 className="panel__title">
                <Film size={16} className="text-cyan" /> FFprobe Medya Müfettişi
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
              <p className="empty-hint">
                Video veya ses dosyasının çözünürlük, FPS, codec, süre ve
                bitrate değerlerini FFprobe ile incelemek için bir dosya seçin.
              </p>
            ) : (
              <div className="probe-card">
                <div className="panel__head">
                  <div>
                    <strong>{probeResult.file_name}</strong>
                    <p className="mono muted truncate">{probeResult.path}</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => onOpenFinder(probeResult.path)}
                  >
                    <FolderOpen size={13} />
                    <span>Finder</span>
                  </button>
                </div>

                <div className="probe-metrics-grid">
                  <div className="social-stat">
                    <span className="social-stat__label">Çözünürlük</span>
                    <strong className="tabular">
                      {probeResult.width && probeResult.height
                        ? `${probeResult.width}×${probeResult.height}`
                        : "Ses / Bilinmiyor"}
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
                    <span className="social-stat__label">Süre</span>
                    <strong className="tabular">
                      {formatDuration(probeResult.duration_secs)}
                    </strong>
                  </div>
                  <div className="social-stat">
                    <span className="social-stat__label">Boyut &amp; Bitrate</span>
                    <strong className="tabular">
                      {formatBytes(probeResult.size_bytes)}
                      {probeResult.bitrate_kbps
                        ? ` · ${probeResult.bitrate_kbps} kbps`
                        : ""}
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
                </div>
              </div>
            )}
          </section>

          {/* Yerel AI Model Envanteri */}
          <section className="panel">
            <div className="panel__head">
              <h2 className="panel__title">
                <Sparkles size={16} className="text-emerald" /> Yerel AI Model
                Envanteri (MLX-Serve &amp; Ollama)
              </h2>
              <span className="badge badge--neutral tabular">
                {aiModels.length} model
              </span>
            </div>

            {aiModels.length === 0 ? (
              <p className="empty-hint">
                Aktif MLX-Serve veya Ollama modeli tespit edilmedi. Sunucular
                çalıştığında modeller burada listelenir.
              </p>
            ) : (
              <ul className="summary-list">
                {aiModels.map((model) => (
                  <li
                    key={`${model.provider}-${model.id}`}
                    className="summary-row"
                  >
                    <div className="summary-row__main">
                      <div className="summary-row__title">
                        <strong className="mono">{model.id}</strong>
                        <span className="badge badge--info">
                          {model.provider}
                        </span>
                        <span
                          className={`badge ${
                            model.state === "loaded" ||
                            model.state === "running"
                              ? "badge--success"
                              : "badge--neutral"
                          }`}
                        >
                          {model.state}
                        </span>
                      </div>
                    </div>
                    <div className="summary-row__metric tabular">
                      {model.bytes_resident != null && (
                        <strong className="text-cyan">
                          RAM {formatBytes(model.bytes_resident)}
                        </strong>
                      )}
                      {model.bytes_on_disk != null && (
                        <span className="muted">
                          Disk {formatBytes(model.bytes_on_disk)}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* ALT SEKME 2: DOCKER & .ENV HİJYENİ */}
      {subTab === "devops" && (
        <div className="view-stack">
          {/* Docker Konteynerleri */}
          <section className="panel">
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
              <p className="mono muted">{docker.reclaimable_summary}</p>
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
                          onClick={() => void handleDockerAction(c.id, "restart")}
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
          <section className="panel">
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
        <div className="view-stack">
          <section className="modules-grid" aria-label="Çalışma Modları">
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
            <section className="panel" aria-label="Çalışma Modu Sonucu">
              <div className="panel__head">
                <h2 className="panel__title">
                  <CheckCircle2 size={16} className="text-emerald" /> Mod Sonucu:{" "}
                  {focusResult.mode.toUpperCase()}
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
