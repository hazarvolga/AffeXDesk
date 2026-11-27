import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  Container,
  FolderOpen,
  Package,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  type CleanerItem,
  type CleanerRunReport,
  type CleanerScanReport,
} from "../lib/api";
import { formatBytes } from "../lib/format";
import { ConfirmDialog } from "./ConfirmDialog";

export interface SmartCleanerPanelProps {
  onOpenFinder: (path: string) => void;
  onRefreshTelemetry: () => Promise<void>;
  onNotify: (tone: "success" | "error" | "info", text: string) => void;
  onCleaned?: () => void;
}

let cachedCleanerReport: CleanerScanReport | null = null;
let inFlightCleanerScan: Promise<CleanerScanReport> | null = null;
let cachedLastCleanerRun: CleanerRunReport | null = null;

export function clearSmartCleanerUiCache(): void {
  cachedCleanerReport = null;
  inFlightCleanerScan = null;
  cachedLastCleanerRun = null;
}

function formatScanClock(iso: string | null | undefined): string | null {
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

export function SmartCleanerPanel({
  onOpenFinder,
  onRefreshTelemetry,
  onNotify,
  onCleaned,
}: SmartCleanerPanelProps) {
  const [report, setReport] = useState<CleanerScanReport | null>(
    () => cachedCleanerReport
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    cachedCleanerReport
      ? cachedCleanerReport.items
          .filter((i) => i.default_selected)
          .map((i) => i.id)
      : []
  );
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [restartingDocker, setRestartingDocker] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastRun, setLastRun] = useState<CleanerRunReport | null>(
    () => cachedLastCleanerRun
  );

  const scanRequestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const updateLastRun = useCallback((next: CleanerRunReport | null) => {
    cachedLastCleanerRun = next;
    setLastRun(next);
  }, []);

  const applyReport = useCallback((next: CleanerScanReport) => {
    cachedCleanerReport = next;
    setReport(next);
    setSelectedIds(
      next.items.filter((i) => i.default_selected).map((i) => i.id)
    );
  }, []);

  const runScan = useCallback(
    async (force = false) => {
      if (!force && cachedCleanerReport) {
        applyReport(cachedCleanerReport);
        return;
      }
      const reqId = ++scanRequestIdRef.current;
      setScanning(true);
      let pending: Promise<CleanerScanReport> | null = null;
      try {
        pending = !force ? inFlightCleanerScan : null;
        if (!pending) {
          pending = api.scanSystemCleaner();
          inFlightCleanerScan = pending;
        }
        const data = await pending;
        if (inFlightCleanerScan === pending) {
          inFlightCleanerScan = null;
        }
        if (!mountedRef.current || scanRequestIdRef.current !== reqId) return;
        applyReport(data);
      } catch (err) {
        if (pending && inFlightCleanerScan === pending) {
          inFlightCleanerScan = null;
        }
        if (!mountedRef.current || scanRequestIdRef.current !== reqId) return;
        onNotify("error", `Temizleyici taraması başarısız: ${String(err)}`);
      } finally {
        if (mountedRef.current && scanRequestIdRef.current === reqId) {
          setScanning(false);
        }
      }
    },
    [applyReport, onNotify]
  );

  useEffect(() => {
    if (report) return;
    let cancelled = false;
    void (async () => {
      try {
        const cached = await api.getCachedCleanerScan();
        if (cancelled) return;
        if (cached) {
          applyReport(cached);
          return;
        }
      } catch {
        // yoksay
      }
      if (!cancelled) {
        void runScan(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Yalnızca ilk açılışta kayıtlı tarama yoksa bir kez tara
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleItem = useCallback(
    (id: string) => {
      const conflictId =
        id === "docker_stopped_containers"
          ? "docker_unused_volumes"
          : id === "docker_unused_volumes"
          ? "docker_stopped_containers"
          : null;
      if (
        !selectedIds.includes(id) &&
        conflictId &&
        selectedIds.includes(conflictId)
      ) {
        setSelectedIds((prev) => [
          ...prev.filter((x) => x !== conflictId && x !== id),
          id,
        ]);
        onNotify(
          "info",
          "Güvenlik nedeniyle Durmuş Docker Konteynerleri ve Kullanılmayan Docker Volume'leri aynı anda seçilemez; diğer seçim kaldırıldı."
        );
        return;
      }
      setSelectedIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    },
    [selectedIds, onNotify]
  );

  const selectAllSafe = useCallback(() => {
    if (!report) return;
    setSelectedIds(
      report.items.filter((i) => i.risk === "safe").map((i) => i.id)
    );
  }, [report]);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const safeItems = useMemo(
    () => (report?.items ?? []).filter((i) => i.risk === "safe"),
    [report]
  );

  const reviewItems = useMemo(
    () => (report?.items ?? []).filter((i) => i.risk !== "safe"),
    [report]
  );

  const selectedBytes = useMemo(() => {
    if (!report) return 0;
    const set = new Set(selectedIds);
    return report.items
      .filter((i) => set.has(i.id))
      .reduce((acc, item) => acc + item.size_bytes, 0);
  }, [report, selectedIds]);

  const hasReviewSelected = useMemo(() => {
    if (!report) return false;
    const set = new Set(selectedIds);
    return report.items.some((i) => set.has(i.id) && i.risk !== "safe");
  }, [report, selectedIds]);

  const handleConfirmClean = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setCleaning(true);
    try {
      const result = await api.runSystemCleaner(selectedIds);
      updateLastRun(result);
      setConfirmOpen(false);
      if (result.succeeded > 0 && result.failed > 0) {
        onNotify(
          "info",
          `Temizlik kısmen tamamlandı: ${formatBytes(result.total_freed_bytes)} geri kazanıldı (${result.succeeded} başarılı, ${result.failed} başarısız).`
        );
      } else if (result.succeeded > 0) {
        onNotify(
          "success",
          `Temizlik tamamlandı: ${formatBytes(result.total_freed_bytes)} geri kazanıldı (${result.succeeded} kalem).`
        );
      } else {
        onNotify("error", "Seçilen kalemler temizlenemedi.");
      }
      cachedCleanerReport = null;
      onCleaned?.();
      await Promise.all([runScan(true), onRefreshTelemetry()]);
    } catch (err) {
      onNotify("error", `Temizlik başarısız: ${String(err)}`);
      setConfirmOpen(false);
    } finally {
      setCleaning(false);
    }
  }, [selectedIds, updateLastRun, onNotify, onCleaned, runScan, onRefreshTelemetry]);

  const handleRestartDocker = useCallback(async () => {
    setRestartingDocker(true);
    try {
      await api.restartDockerDesktop();
      onNotify(
        "success",
        "Docker Desktop yeniden başlatıldı. Docker.raw sanal diski birkaç saniye içinde küçülecektir."
      );
      setTimeout(() => {
        void onRefreshTelemetry();
      }, 3000);
    } catch (err) {
      onNotify("error", `Docker yeniden başlatılamadı: ${String(err)}`);
    } finally {
      setRestartingDocker(false);
    }
  }, [onNotify, onRefreshTelemetry]);

  const renderItemRow = (item: CleanerItem) => {
    const checked = selectedIds.includes(item.id);
    const isSafe = item.risk === "safe";
    const isDocker = item.category === "docker";

    return (
      <div
        key={item.id}
        className={`cleaner-row ${checked ? "cleaner-row--selected" : ""}`}
      >
        <button
          type="button"
          className="cleaner-row__check"
          onClick={() => toggleItem(item.id)}
          aria-pressed={checked}
        >
          {checked ? (
            <CheckSquare size={17} className="text-cyan" />
          ) : (
            <Square size={17} className="muted" />
          )}
          <div className="cleaner-row__body">
            <div className="cleaner-row__title-row">
              {isDocker ? (
                <Container size={14} className="text-cyan" />
              ) : (
                <Package size={14} className="muted" />
              )}
              <strong className="cleaner-row__title">{item.title}</strong>
              <span
                className={`badge ${
                  isSafe ? "badge--success" : "badge--warning"
                }`}
              >
                {isSafe ? "Tam Güvenli" : "Kontrol Et"}
              </span>
            </div>
            <p className="cleaner-row__sub">{item.subtitle}</p>
            {item.note && <p className="cleaner-row__note">{item.note}</p>}
          </div>
        </button>

        <div className="cleaner-row__right">
          <strong className="cleaner-row__size tabular">
            {formatBytes(item.size_bytes)}
          </strong>
          {item.path_hint && item.path_hint.startsWith("/") && (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => onOpenFinder(item.path_hint!)}
              title="Finder'da aç"
            >
              <FolderOpen size={13} />
            </button>
          )}
        </div>
      </div>
    );
  };

  const scanClock = formatScanClock(report?.scanned_at);

  return (
    <div className="cleaner-stack">
      {/* Üst KPI Şeridi */}
      <section className="disk-summary-grid" aria-label="Temizleyici Özeti">
        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <Sparkles size={15} className="text-cyan" /> Toplam Geri Kazanılabilir
            </span>
            <span className="badge badge--info">
              {report ? `${report.items.length} kalem` : "—"}
            </span>
          </div>
          <div className="metric-card__value tabular">
            {report ? formatBytes(report.total_reclaimable_bytes) : "—"}
          </div>
          <p className="metric-card__meta">
            {scanClock ? `Son tarama: ${scanClock}` : "Docker, paket yöneticileri ve önbellekler"}
          </p>
        </article>

        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <ShieldCheck size={15} className="text-emerald" /> Tam Güvenli Alan
            </span>
            <span className="badge badge--success">Veri Kaybı Sıfır</span>
          </div>
          <div className="metric-card__value tabular text-emerald">
            {report ? formatBytes(report.safe_reclaimable_bytes) : "—"}
          </div>
          <p className="metric-card__meta">
            Build cache ve paket depoları
          </p>
        </article>

        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <Trash2 size={15} className="text-warning" /> Seçili Temizlik
            </span>
            <span className="badge badge--neutral tabular">
              {selectedIds.length} seçili
            </span>
          </div>
          <div className="metric-card__value tabular">
            {formatBytes(selectedBytes)}
          </div>
          <div className="cleaner-action-bar">
            <button
              type="button"
              className="btn btn--sm btn--primary"
              disabled={cleaning || scanning || selectedIds.length === 0}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 size={13} />
              <span>
                {cleaning
                  ? "Temizleniyor..."
                  : `Seçilenleri Temizle (${formatBytes(selectedBytes)})`}
              </span>
            </button>
          </div>
        </article>
      </section>

      {/* Son Temizlik Raporu & Docker.raw Küçültme Aksiyonu */}
      {lastRun && (() => {
        const isAllFailed = lastRun.succeeded === 0 && lastRun.failed > 0;
        const okResults = lastRun.results.filter((r) => r.ok);
        const failedResults = lastRun.results.filter((r) => !r.ok);
        return (
          <div
            className={`cleaner-result-banner${
              isAllFailed ? " cleaner-result-banner--error" : ""
            }`}
            role={isAllFailed ? "alert" : "status"}
          >
            <div className="cleaner-result-banner__left">
              {isAllFailed ? (
                <AlertTriangle size={16} className="text-danger" />
              ) : (
                <CheckCircle2 size={16} className="text-emerald" />
              )}
              <div>
                {isAllFailed ? (
                  <>
                    <strong>Temizlik başarısız oldu</strong>{" "}
                    <span className="muted">
                      ({lastRun.failed} kalem temizlenemedi)
                    </span>
                  </>
                ) : (
                  <>
                    <strong>
                      {formatBytes(lastRun.total_freed_bytes)} geri kazanıldı
                    </strong>{" "}
                    <span className="muted">
                      ({lastRun.succeeded} başarılı
                      {lastRun.failed > 0 ? `, ${lastRun.failed} başarısız` : ""})
                    </span>
                  </>
                )}
                {okResults.length > 0 && (
                  <ul className="cleaner-result-banner__items">
                    {okResults.map((item) => (
                      <li key={item.id}>
                        <strong>{item.title}:</strong>{" "}
                        <span className="tabular text-emerald">
                          {formatBytes(item.freed_bytes)}
                        </span>{" "}
                        <span className="muted">— {item.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {failedResults.length > 0 && (
                  <ul className="cleaner-result-banner__errors">
                    {failedResults.map((item) => (
                      <li key={item.id}>
                        <strong>{item.title}:</strong> {item.message}
                      </li>
                    ))}
                  </ul>
                )}
                {lastRun.needs_docker_restart && (
                  <p className="muted" style={{ margin: "3px 0 0", fontSize: 12 }}>
                    macOS'ta <code>Docker.raw</code> sanal diskinin fiziksel olarak
                    küçülmesi için Docker Desktop'ı yeniden başlatın.
                  </p>
                )}
              </div>
            </div>
            <div className="cleaner-result-banner__actions">
              {lastRun.needs_docker_restart && (
                <button
                  type="button"
                  className="btn btn--sm btn--secondary"
                  disabled={restartingDocker}
                  onClick={() => void handleRestartDocker()}
                >
                  <RotateCw size={13} className={restartingDocker ? "spin" : ""} />
                  <span>
                    {restartingDocker
                      ? "Yeniden Başlatılıyor..."
                      : "Docker Desktop'ı Yeniden Başlat"}
                  </span>
                </button>
              )}
              <button
                type="button"
                className="icon-btn"
                aria-label="Sonucu kapat"
                onClick={() => updateLastRun(null)}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })()}

      {/* Kontrol Çubuğu */}
      <div className="cleaner-toolbar">
        <div className="cleaner-toolbar__left">
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={selectAllSafe}
            disabled={!report || scanning}
          >
            Tüm Güvenlileri Seç
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={clearSelection}
            disabled={selectedIds.length === 0}
          >
            Seçimi Temizle
          </button>
        </div>
        <button
          type="button"
          className="btn btn--sm btn--secondary"
          onClick={() => void runScan(true)}
          disabled={scanning || cleaning}
        >
          <RefreshCw size={13} className={scanning ? "spin" : ""} />
          <span>{scanning ? "Taranıyor..." : "Temizleyiciyi Yeniden Tara"}</span>
        </button>
      </div>

      {/* 1. Tam Güvenli Kalemler */}
      <section className="panel">
        <div className="panel__head">
          <div className="panel__title-group">
            <ShieldCheck size={16} className="text-emerald" />
            <h2 className="panel__title">Tam Güvenli Temizlik (Veri Kaybı Sıfır)</h2>
          </div>
          <span className="badge badge--success tabular">
            {report ? formatBytes(report.safe_reclaimable_bytes) : "—"}
          </span>
        </div>

        {scanning && !report ? (
          <div className="empty-inline">
            Docker, paket yöneticileri ve sistem önbellekleri taranıyor...
          </div>
        ) : safeItems.length === 0 ? (
          <div className="empty-inline">
            Harika! Temizlenecek kayda değer güvenli önbellek bulunmadı.
          </div>
        ) : (
          <div className="cleaner-list">{safeItems.map(renderItemRow)}</div>
        )}
      </section>

      {/* 2. Kontrol Ederek Seçilecek Kalemler */}
      {reviewItems.length > 0 && (
        <section className="panel">
          <div className="panel__head">
            <div className="panel__title-group">
              <AlertTriangle size={16} className="text-warning" />
              <h2 className="panel__title">
                Kontrol Ederek Seç (İsteğe Bağlı Ek Kazanç)
              </h2>
            </div>
            <span className="badge badge--warning tabular">
              {report ? formatBytes(report.review_reclaimable_bytes) : "—"}
            </span>
          </div>
          <div className="cleaner-list">{reviewItems.map(renderItemRow)}</div>
        </section>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Seçilen Önbellekler Temizlensin mi?"
        description={
          hasReviewSelected
            ? `Seçili ${selectedIds.length} kalem (${formatBytes(
                selectedBytes
              )}) temizlenecek. Dikkat: 'Kontrol Et' grubundan seçtiğiniz Docker Volume veya önbellekler geri alınamaz.`
            : `Seçili ${selectedIds.length} güvenli kalem (${formatBytes(
                selectedBytes
              )}) temizlenecek. Projelerinizdeki kaynak kodlara ve veritabanlarına dokunulmaz.`
        }
        confirmLabel={
          cleaning ? "Temizleniyor..." : `Temizle (${formatBytes(selectedBytes)})`
        }
        tone={hasReviewSelected ? "danger" : "warning"}
        busy={cleaning}
        onConfirm={() => void handleConfirmClean()}
        onCancel={() => {
          if (!cleaning) setConfirmOpen(false);
        }}
      />
    </div>
  );
}
