import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  Database,
  FileSearch,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import {
  api,
  type KnowledgeOverview,
  type KnowledgeSearchHit,
} from "../lib/api";
import { formatBytes } from "../lib/format";

export interface KnowledgeViewProps {
  settings: Record<string, string>;
  onSaveSettings: (next: Record<string, string>) => Promise<void>;
  onOpenFinder: (path: string) => void;
  onNotify: (tone: "success" | "error" | "info", text: string) => void;
}

export function KnowledgeView({
  settings,
  onSaveSettings,
  onOpenFinder,
  onNotify,
}: KnowledgeViewProps) {
  const [overview, setOverview] = useState<KnowledgeOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<KnowledgeSearchHit[] | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.inspectKnowledgeHub();
      setOverview(data);
    } catch (err) {
      onNotify("error", `Bilgi bankası okunamadı: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, settings.scrapling_dir]);

  async function handlePickKnowledgeDir() {
    try {
      const picked = await api.pickWorkspaceDir();
      if (!picked) return;
      await onSaveSettings({
        ...settings,
        scrapling_dir: picked,
      });
    } catch (err) {
      onNotify("error", `Bilgi bankası klasörü seçilemedi: ${String(err)}`);
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setHits(null);
      return;
    }
    setSearching(true);
    try {
      const results = await api.searchKnowledgeHub(trimmed, 20);
      setHits(results);
    } catch (err) {
      onNotify("error", `Arama başarısız: ${String(err)}`);
    } finally {
      setSearching(false);
    }
  }

  function handleClearSearch() {
    setQuery("");
    setHits(null);
  }

  const configured = Boolean(overview?.configured && overview.root_dir);

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1 className="view-title">Bilgi Bankası</h1>
          <p className="view-subtitle">
            Scrapling veri setlerini inceleyin ve yerel bilgi bankasında anlık
            arama yapın
          </p>
        </div>
        <div className="header-actions">
          {configured && overview?.root_dir && (
            <>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => onOpenFinder(overview.root_dir!)}
              >
                <FolderOpen size={15} />
                <span>Finder&apos;da Aç</span>
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => void handlePickKnowledgeDir()}
              >
                <FolderPlus size={15} />
                <span>Klasörü Değiştir</span>
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => void loadOverview()}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? "spin" : ""} />
            <span>Yenile</span>
          </button>
        </div>
      </header>

      {!configured ? (
        <section className="onboarding-card" aria-label="Bilgi Bankası Kurulumu">
          <div className="onboarding-card__icon">
            <BookOpen size={24} />
          </div>
          <div className="onboarding-card__content">
            <h2>Scrapling Bilgi Bankasını Bağla</h2>
            <p>
              Yerel veri seti kartlarını görmek ve hızlı tam metin araması
              yapmak için Scrapling kök veya <code className="mono">exports</code>{" "}
              klasörünü seçin.
            </p>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void handlePickKnowledgeDir()}
          >
            <FolderPlus size={16} />
            <span>+ Bilgi Bankası Klasörünü Seç</span>
          </button>
        </section>
      ) : (
        <>
          {/* Durum ve Arama Barı */}
          <section className="panel">
            <div className="panel__head">
              <div className="knowledge-meta">
                <span className="mono muted truncate">
                  {overview?.root_dir}
                </span>
                <span className="badge badge--info tabular">
                  <Database size={11} /> {overview?.dataset_count ?? 0} veri seti
                </span>
                <span
                  className={`badge ${
                    overview?.index_exists ? "badge--success" : "badge--warning"
                  }`}
                >
                  {overview?.index_exists ? "INDEX.md hazır" : "INDEX.md yok"}
                </span>
                <span
                  className={`badge ${
                    overview?.search_script_exists
                      ? "badge--success"
                      : "badge--neutral"
                  }`}
                >
                  {overview?.search_script_exists
                    ? "search_hub.py aktif"
                    : "Yerel tarama modu"}
                </span>
              </div>
            </div>

            <form className="knowledge-search-form" onSubmit={handleSearch}>
              <label className="search-box search-box--grow">
                <Search size={15} />
                <input
                  type="search"
                  placeholder="Bilgi bankasında ara (ör. IFC, Allplan, BIM, prompt...)"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Aramayı temizle"
                    onClick={handleClearSearch}
                  >
                    <X size={13} />
                  </button>
                )}
              </label>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={searching || !query.trim()}
              >
                <FileSearch size={15} />
                <span>{searching ? "Aranıyor..." : "Ara"}</span>
              </button>
            </form>
          </section>

          {/* Arama Sonuçları */}
          {hits !== null && (
            <section className="panel" aria-label="Arama Sonuçları">
              <div className="panel__head">
                <h2 className="panel__title">
                  <FileSearch size={16} /> Arama Sonuçları ({hits.length})
                </h2>
                <button
                  type="button"
                  className="link-btn"
                  onClick={handleClearSearch}
                >
                  Sonuçları Kapat
                </button>
              </div>
              {hits.length === 0 ? (
                <p className="empty-hint">
                  &ldquo;{query}&rdquo; için eşleşen kayıt bulunamadı.
                </p>
              ) : (
                <ul className="summary-list">
                  {hits.map((hit, idx) => (
                    <li
                      key={`${hit.source}-${hit.title}-${idx}`}
                      className="summary-row"
                    >
                      <div className="summary-row__main">
                        <div className="summary-row__title">
                          <strong>{hit.title}</strong>
                          <span className="badge badge--accent">
                            {hit.source}
                          </span>
                        </div>
                        <p className="knowledge-snippet">{hit.snippet}</p>
                        {hit.path && (
                          <span className="mono muted truncate">
                            {hit.path}
                          </span>
                        )}
                      </div>
                      {hit.path && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => onOpenFinder(hit.path!)}
                        >
                          <FolderOpen size={13} />
                          <span>Finder&apos;da Aç</span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Veri Seti Kartları */}
          <section className="projects-grid" aria-label="Veri Setleri">
            {(overview?.datasets ?? []).length === 0 ? (
              <div className="empty-panel">
                <p>
                  Bu klasörde henüz veri seti kartı tespit edilmedi. Klasör
                  yolunun <code className="mono">exports</code> veya{" "}
                  <code className="mono">_index/datasets</code> içerdiğinden
                  emin olun.
                </p>
              </div>
            ) : (
              overview?.datasets.map((ds) => (
                <article key={ds.id} className="project-card">
                  <div className="project-card__head">
                    <div className="project-card__title-wrap">
                      <h3 className="project-card__title">{ds.title}</h3>
                    </div>
                    <span className="badge badge--neutral tabular">
                      {formatBytes(ds.size_bytes)}
                    </span>
                  </div>

                  <span className="mono muted truncate">{ds.id}</span>
                  <p className="repo-desc">
                    {ds.summary || "Özet açıklaması bulunmuyor."}
                  </p>

                  <div className="project-card__footer">
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() => onOpenFinder(ds.path)}
                    >
                      <FolderOpen size={13} />
                      <span>Finder&apos;da Aç</span>
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
