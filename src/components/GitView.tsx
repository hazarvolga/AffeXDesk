import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Code2,
  Download,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Globe,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  X,
  XCircle,
} from "lucide-react";
import {
  api,
  type GitProviderStatus,
  type RemoteRepo,
  type WorkspaceRecord,
} from "../lib/api";

export interface GitViewProps {
  workspaces: WorkspaceRecord[];
  onOpenIde: (path: string) => void;
  onOpenUrl: (url: string) => void;
  onOpenFinder: (path: string) => void;
  onNavigateSettings: () => void;
  onProjectsChanged: () => Promise<void>;
  onNotify: (tone: "success" | "error" | "info", text: string) => void;
}

type ProviderKey = "github" | "gitlab";
type ProjectTemplate = "empty" | "react-vite" | "rust" | "python";

const TEMPLATE_OPTIONS: Array<{ value: ProjectTemplate; label: string }> = [
  { value: "empty", label: "Boş Proje (README + .gitignore)" },
  { value: "react-vite", label: "React + Vite (TypeScript)" },
  { value: "rust", label: "Rust (Cargo)" },
  { value: "python", label: "Python (pyproject + src)" },
];

export function GitView({
  workspaces,
  onOpenIde,
  onOpenUrl,
  onOpenFinder,
  onNavigateSettings,
  onProjectsChanged,
  onNotify,
}: GitViewProps) {
  const [provider, setProvider] = useState<ProviderKey>("github");
  const [status, setStatus] = useState<GitProviderStatus | null>(null);
  const [repos, setRepos] = useState<RemoteRepo[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Yeni Proje & Repo paneli
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [newName, setNewName] = useState("");
  const [newWorkspaceDir, setNewWorkspaceDir] = useState(
    workspaces[0]?.path ?? ""
  );
  const [newTemplate, setNewTemplate] = useState<ProjectTemplate>("react-vite");
  const [createGithubRemote, setCreateGithubRemote] = useState(false);
  const [isPrivateRepo, setIsPrivateRepo] = useState(true);
  const [creating, setCreating] = useState(false);

  // Klonlama dialogu
  const [cloneTarget, setCloneTarget] = useState<RemoteRepo | null>(null);
  const [cloneWorkspaceDir, setCloneWorkspaceDir] = useState(
    workspaces[0]?.path ?? ""
  );
  const [cloneFolderName, setCloneFolderName] = useState("");
  const [openAfterClone, setOpenAfterClone] = useState(true);
  const [cloning, setCloning] = useState(false);

  const repoRequestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!cloneTarget) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !cloning) {
        event.preventDefault();
        event.stopPropagation();
        setCloneTarget(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cloneTarget, cloning]);

  useEffect(() => {
    if (!newWorkspaceDir && workspaces.length > 0) {
      setNewWorkspaceDir(workspaces[0].path);
    }
    if (!cloneWorkspaceDir && workspaces.length > 0) {
      setCloneWorkspaceDir(workspaces[0].path);
    }
  }, [workspaces, newWorkspaceDir, cloneWorkspaceDir]);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await api.checkGitProviders();
      setStatus(res);
    } catch (err) {
      onNotify("error", `Git sağlayıcı durumu okunamadı: ${String(err)}`);
    } finally {
      setLoadingStatus(false);
    }
  }, [onNotify]);

  const loadRepos = useCallback(async (targetProvider: ProviderKey) => {
    const reqId = ++repoRequestIdRef.current;
    setLoadingRepos(true);
    setRepoError(null);
    try {
      const list = await api.listRemoteRepos(targetProvider);
      if (!mountedRef.current || repoRequestIdRef.current !== reqId) return;
      setRepos(list);
    } catch (err) {
      if (!mountedRef.current || repoRequestIdRef.current !== reqId) return;
      setRepos([]);
      setRepoError(String(err));
    } finally {
      if (mountedRef.current && repoRequestIdRef.current === reqId) {
        setLoadingRepos(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    void loadRepos(provider);
  }, [provider, loadRepos]);

  const filteredRepos = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.full_name.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) ||
        (r.language ?? "").toLowerCase().includes(q)
    );
  }, [repos, search]);

  async function handlePickDir(setter: (dir: string) => void) {
    try {
      const picked = await api.pickWorkspaceDir();
      if (picked) setter(picked);
    } catch (err) {
      onNotify("error", `Klasör seçilemedi: ${String(err)}`);
    }
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = newName.trim();
    if (!trimmedName) {
      onNotify("error", "Lütfen geçerli bir proje adı girin.");
      return;
    }
    if (!newWorkspaceDir.trim()) {
      onNotify("error", "Lütfen hedef iş klasörü seçin.");
      return;
    }

    setCreating(true);
    try {
      const createdPath = await api.createLocalProject({
        workspaceDir: newWorkspaceDir.trim(),
        name: trimmedName,
        template: newTemplate,
        createGithubRemote,
        private: isPrivateRepo,
      });
      onNotify("success", `Proje oluşturuldu: ${createdPath}`);
      setNewName("");
      setShowCreatePanel(false);
      await onProjectsChanged();
      if (createGithubRemote && provider === "github") {
        void loadRepos("github");
      }
      onOpenIde(createdPath);
    } catch (err) {
      onNotify("error", `Proje oluşturulamadı: ${String(err)}`);
    } finally {
      setCreating(false);
    }
  }

  function openCloneModal(repo: RemoteRepo) {
    setCloneTarget(repo);
    setCloneFolderName(repo.name);
    if (!cloneWorkspaceDir && workspaces.length > 0) {
      setCloneWorkspaceDir(workspaces[0].path);
    }
  }

  async function handleConfirmClone(e: React.FormEvent) {
    e.preventDefault();
    if (!cloneTarget) return;
    if (!cloneWorkspaceDir.trim()) {
      onNotify("error", "Lütfen klonlanacak hedef klasörü seçin.");
      return;
    }

    setCloning(true);
    try {
      const clonedPath = await api.cloneRepo({
        cloneUrl: cloneTarget.clone_url,
        targetWorkspaceDir: cloneWorkspaceDir.trim(),
        folderName: cloneFolderName.trim() || null,
      });
      onNotify("success", `Repo klonlandı: ${clonedPath}`);
      setCloneTarget(null);
      await onProjectsChanged();
      if (openAfterClone) {
        onOpenIde(clonedPath);
      }
    } catch (err) {
      onNotify("error", `Klonlama başarısız: ${String(err)}`);
    } finally {
      setCloning(false);
    }
  }

  const githubReady = Boolean(
    status?.gh_authenticated || status?.github_token_configured
  );
  const gitlabReady = Boolean(status?.gitlab_token_configured);

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1 className="view-title">Git &amp; Uzak Repolar</h1>
          <p className="view-subtitle">
            GitHub ve GitLab repolarını tarayın, tek tıkla klonlayın veya yeni
            proje başlatın
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setShowCreatePanel((v) => !v)}
          >
            <Plus size={15} />
            <span>+ Yeni Proje &amp; Repo</span>
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              void loadStatus();
              void loadRepos(provider);
            }}
            disabled={loadingStatus || loadingRepos}
          >
            <RefreshCw
              size={15}
              className={loadingStatus || loadingRepos ? "spin" : ""}
            />
            <span>Yenile</span>
          </button>
        </div>
      </header>

      {/* Bağlantı Durum Çubuğu */}
      <section className="status-strip" aria-label="Git Sağlayıcı Durumu">
        <div className="status-chip">
          {githubReady ? (
            <CheckCircle2 size={15} className="text-emerald" />
          ) : (
            <XCircle size={15} className="text-warning" />
          )}
          <div className="status-chip__body">
            <strong>GitHub</strong>
            <span className="muted">
              {status?.gh_authenticated
                ? `gh CLI bağlı${status.gh_user ? ` (@${status.gh_user})` : ""}`
                : status?.github_token_configured
                ? "Kişisel Token yapılandırıldı"
                : status?.gh_cli_available
                ? "gh CLI kurulu ama oturum kapalı"
                : "Token veya gh CLI bağlı değil"}
            </span>
          </div>
        </div>

        <div className="status-chip">
          {gitlabReady ? (
            <CheckCircle2 size={15} className="text-emerald" />
          ) : (
            <XCircle size={15} className="muted" />
          )}
          <div className="status-chip__body">
            <strong>GitLab</strong>
            <span className="muted">
              {gitlabReady
                ? `${status?.gitlab_url || "https://gitlab.com"} · Token aktif`
                : "Token yapılandırılmadı"}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onNavigateSettings}
        >
          <Settings size={14} />
          <span>Token &amp; URL Ayarları</span>
        </button>
      </section>

      {/* + Yeni Proje & Repo Paneli */}
      {showCreatePanel && (
        <form
          className="panel create-project-panel"
          onSubmit={handleCreateProject}
        >
          <div className="panel__head">
            <h2 className="panel__title">
              <FolderPlus size={16} /> Yeni Yerel Proje &amp; Repo Oluştur
            </h2>
            <button
              type="button"
              className="icon-btn"
              aria-label="Paneli kapat"
              onClick={() => setShowCreatePanel(false)}
            >
              <X size={15} />
            </button>
          </div>

          <div className="form-grid">
            <label className="form-field">
              <span>Proje Adı</span>
              <input
                type="text"
                className="text-input"
                placeholder="ornek-uygulama"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
            </label>

            <label className="form-field">
              <span>Şablon</span>
              <select
                value={newTemplate}
                onChange={(e) =>
                  setNewTemplate(e.target.value as ProjectTemplate)
                }
              >
                {TEMPLATE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field form-field--full">
              <span>Hedef İş Klasörü</span>
              <div className="input-with-btn">
                {workspaces.length > 0 ? (
                  <select
                    value={newWorkspaceDir}
                    onChange={(e) => setNewWorkspaceDir(e.target.value)}
                  >
                    {workspaces.map((ws) => (
                      <option key={ws.id} value={ws.path}>
                        {ws.label} ({ws.path})
                      </option>
                    ))}
                    {newWorkspaceDir &&
                      !workspaces.some((w) => w.path === newWorkspaceDir) && (
                        <option value={newWorkspaceDir}>
                          {newWorkspaceDir}
                        </option>
                      )}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="text-input"
                    placeholder="/Users/.../dev"
                    value={newWorkspaceDir}
                    onChange={(e) => setNewWorkspaceDir(e.target.value)}
                  />
                )}
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => void handlePickDir(setNewWorkspaceDir)}
                >
                  <FolderOpen size={14} />
                  <span>Gözat</span>
                </button>
              </div>
            </label>
          </div>

          <div className="checkbox-row">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={createGithubRemote}
                onChange={(e) => setCreateGithubRemote(e.target.checked)}
              />
              <span>GitHub&apos;da uzak repo oluştur (`gh repo create`)</span>
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={isPrivateRepo}
                disabled={!createGithubRemote}
                onChange={(e) => setIsPrivateRepo(e.target.checked)}
              />
              <span>Private repo</span>
            </label>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setShowCreatePanel(false)}
            >
              Vazgeç
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={creating}
            >
              <Plus size={15} />
              <span>{creating ? "Oluşturuluyor..." : "Oluştur ve IDE'de Aç"}</span>
            </button>
          </div>
        </form>
      )}

      {/* Sağlayıcı Seçici & Arama */}
      <div className="toolbar">
        <div className="filter-pills" role="tablist" aria-label="Git Sağlayıcı">
          <button
            type="button"
            role="tab"
            aria-selected={provider === "github"}
            className={`pill ${provider === "github" ? "pill--active" : ""}`}
            onClick={() => setProvider("github")}
          >
            GitHub
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={provider === "gitlab"}
            className={`pill ${provider === "gitlab" ? "pill--active" : ""}`}
            onClick={() => setProvider("gitlab")}
          >
            GitLab
          </button>
        </div>

        <label className="search-box">
          <Search size={14} />
          <input
            type="search"
            placeholder="Repo adı, açıklama veya dil ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      {/* Repo Listesi */}
      {loadingRepos ? (
        <div className="empty-panel">
          <RefreshCw size={20} className="spin" />
          <p>Uzak repolar yükleniyor...</p>
        </div>
      ) : repoError ? (
        <div className="empty-panel">
          <p>{repoError}</p>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={onNavigateSettings}
          >
            <Settings size={14} />
            <span>Ayarlardan Bağlantıyı Yapılandır</span>
          </button>
        </div>
      ) : filteredRepos.length === 0 ? (
        <div className="empty-panel">
          <p>
            {repos.length === 0
              ? "Bu sağlayıcıda görüntülenecek repo bulunamadı."
              : "Arama filtresiyle eşleşen repo yok."}
          </p>
        </div>
      ) : (
        <section className="projects-grid" aria-label="Uzak Repolar">
          {filteredRepos.map((repo) => (
            <article key={`${repo.provider}-${repo.id}`} className="project-card">
              <div className="project-card__head">
                <div className="project-card__title-wrap">
                  <h3 className="project-card__title">{repo.name}</h3>
                  <span
                    className={`badge ${
                      repo.private ? "badge--warning" : "badge--info"
                    }`}
                  >
                    {repo.private ? <Lock size={11} /> : <Globe size={11} />}
                    {repo.private ? "Private" : "Public"}
                  </span>
                </div>
                <span className="git-pill mono tabular">
                  <Star size={12} /> {repo.stargazers_count}
                </span>
              </div>

              <span className="mono muted truncate">{repo.full_name}</span>

              {repo.description && (
                <p className="repo-desc">{repo.description}</p>
              )}

              <div className="tag-row">
                {repo.language && (
                  <span className="tech-tag">{repo.language}</span>
                )}
                <span className="badge badge--neutral mono">
                  <GitBranch size={11} /> {repo.default_branch}
                </span>
              </div>

              <div className="project-card__footer">
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => openCloneModal(repo)}
                >
                  <Download size={13} />
                  <span>Klonla</span>
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => onOpenUrl(repo.html_url)}
                >
                  <ExternalLink size={13} />
                  <span>Tarayıcı</span>
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {/* Klonlama Modalı */}
      {cloneTarget && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onClick={() => !cloning && setCloneTarget(null)}
        >
          <form
            className="dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clone-dialog-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleConfirmClone}
          >
            <div className="dialog-header">
              <div className="dialog-icon dialog-icon--primary">
                <Download size={18} />
              </div>
              <div className="dialog-title-wrap">
                <h2 id="clone-dialog-title" className="dialog-title">
                  Repoyu Klonla: {cloneTarget.name}
                </h2>
                <p className="dialog-description mono truncate">
                  {cloneTarget.clone_url}
                </p>
              </div>
            </div>

            <label className="form-field">
              <span>Hedef İş Klasörü</span>
              <div className="input-with-btn">
                {workspaces.length > 0 ? (
                  <select
                    value={cloneWorkspaceDir}
                    onChange={(e) => setCloneWorkspaceDir(e.target.value)}
                  >
                    {workspaces.map((ws) => (
                      <option key={ws.id} value={ws.path}>
                        {ws.label} ({ws.path})
                      </option>
                    ))}
                    {cloneWorkspaceDir &&
                      !workspaces.some((w) => w.path === cloneWorkspaceDir) && (
                        <option value={cloneWorkspaceDir}>
                          {cloneWorkspaceDir}
                        </option>
                      )}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="text-input"
                    value={cloneWorkspaceDir}
                    onChange={(e) => setCloneWorkspaceDir(e.target.value)}
                    placeholder="/Users/.../dev"
                  />
                )}
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => void handlePickDir(setCloneWorkspaceDir)}
                >
                  <FolderOpen size={14} />
                  <span>Seç</span>
                </button>
              </div>
            </label>

            <label className="form-field">
              <span>Klasör Adı (opsiyonel)</span>
              <input
                type="text"
                className="text-input"
                value={cloneFolderName}
                onChange={(e) => setCloneFolderName(e.target.value)}
                placeholder={cloneTarget.name}
              />
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={openAfterClone}
                onChange={(e) => setOpenAfterClone(e.target.checked)}
              />
              <span>Klonlama tamamlanınca IDE&apos;de aç</span>
            </label>

            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={cloning}
                onClick={() => setCloneTarget(null)}
              >
                Vazgeç
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={!cloneWorkspaceDir}
                onClick={() => onOpenFinder(cloneWorkspaceDir)}
              >
                <FolderOpen size={13} />
                <span>Hedefi Aç</span>
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={cloning}
              >
                {openAfterClone ? <Code2 size={14} /> : <Download size={14} />}
                <span>{cloning ? "Klonlanıyor..." : "Klonla"}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
