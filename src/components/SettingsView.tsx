import { useEffect, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  FolderOpen,
  FolderPlus,
  GitBranch,
  RefreshCw,
  Save,
  Share2,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  api,
  type AiStatus,
  type SocialBridgeSnapshot,
  type WorkspaceRecord,
} from "../lib/api";

export interface SettingsViewProps {
  workspaces: WorkspaceRecord[];
  settings: Record<string, string>;
  onAddWorkspace: () => void;
  onRemoveWorkspace: (id: number) => Promise<void>;
  onSaveSettings: (next: Record<string, string>) => Promise<void>;
}

const IDE_OPTIONS = [
  { value: "code", label: "Visual Studio Code (code)" },
  { value: "cursor", label: "Cursor (cursor)" },
  { value: "antigravity", label: "Antigravity (antigravity)" },
];

const REFRESH_OPTIONS = [
  { value: "3", label: "3 saniye (Yüksek frekans)" },
  { value: "5", label: "5 saniye (Önerilen)" },
  { value: "10", label: "10 saniye (Dengeli)" },
  { value: "30", label: "30 saniye (Düşük güç)" },
];

export function SettingsView({
  workspaces,
  settings,
  onAddWorkspace,
  onRemoveWorkspace,
  onSaveSettings,
}: SettingsViewProps) {
  const [defaultIde, setDefaultIde] = useState(settings.default_ide || "code");
  const [refreshSecs, setRefreshSecs] = useState(
    settings.refresh_interval_secs || "5"
  );

  // Faz 2 Canlı Ayarlar
  const [socialEnabled, setSocialEnabled] = useState(
    settings.module_social_bridge === "true"
  );
  const [socialUrl, setSocialUrl] = useState(
    settings.social_mcp_url || "http://127.0.0.1:49157/mcp"
  );
  const [scraplingDir, setScraplingDir] = useState(
    settings.scrapling_dir || ""
  );
  const [githubToken, setGithubToken] = useState(settings.github_token || "");
  const [gitlabUrl, setGitlabUrl] = useState(
    settings.gitlab_url || "https://gitlab.com"
  );
  const [gitlabToken, setGitlabToken] = useState(settings.gitlab_token || "");
  const [aiBaseUrl, setAiBaseUrl] = useState(
    settings.ai_base_url || "http://127.0.0.1:11234/v1"
  );
  const [aiModel, setAiModel] = useState(settings.ai_model || "");

  const [saving, setSaving] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<AiStatus | null>(null);
  const [testingSocial, setTestingSocial] = useState(false);
  const [socialTestResult, setSocialTestResult] =
    useState<SocialBridgeSnapshot | null>(null);

  useEffect(() => {
    setDefaultIde(settings.default_ide || "code");
    setRefreshSecs(settings.refresh_interval_secs || "5");
    setSocialEnabled(settings.module_social_bridge === "true");
    setSocialUrl(settings.social_mcp_url || "http://127.0.0.1:49157/mcp");
    setScraplingDir(settings.scrapling_dir || "");
    setGithubToken(settings.github_token || "");
    setGitlabUrl(settings.gitlab_url || "https://gitlab.com");
    setGitlabToken(settings.gitlab_token || "");
    setAiBaseUrl(settings.ai_base_url || "http://127.0.0.1:11234/v1");
    setAiModel(settings.ai_model || "");
  }, [settings]);

  function buildNextSettings(): Record<string, string> {
    return {
      ...settings,
      default_ide: defaultIde,
      refresh_interval_secs: refreshSecs,
      module_social_bridge: socialEnabled ? "true" : "false",
      social_mcp_url: socialUrl.trim(),
      scrapling_dir: scraplingDir.trim(),
      github_token: githubToken.trim(),
      gitlab_url: gitlabUrl.trim() || "https://gitlab.com",
      gitlab_token: gitlabToken.trim(),
      ai_base_url: aiBaseUrl.trim(),
      ai_model: aiModel.trim(),
    };
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveSettings(buildNextSettings());
    } finally {
      setSaving(false);
    }
  }

  async function handlePickScraplingDir() {
    const picked = await api.pickWorkspaceDir();
    if (picked) {
      setScraplingDir(picked);
    }
  }

  async function handleTestAi() {
    setTestingAi(true);
    try {
      await onSaveSettings(buildNextSettings());
      const res = await api.checkAiStatus();
      setAiTestResult(res);
    } finally {
      setTestingAi(false);
    }
  }

  async function handleTestSocial() {
    setTestingSocial(true);
    try {
      await onSaveSettings(buildNextSettings());
      const res = await api.fetchSocialSnapshot();
      setSocialTestResult(res);
    } finally {
      setTestingSocial(false);
    }
  }

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1 className="view-title">Ayarlar</h1>
          <p className="view-subtitle">
            İş klasörleri, varsayılan geliştirme araçları ve Faz 2 canlı
            entegrasyonları
          </p>
        </div>
      </header>

      {/* Tanımlı İş Klasörleri */}
      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Tanımlı İş Klasörleri</h2>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={onAddWorkspace}
          >
            <FolderPlus size={14} />
            <span>+ Klasör Ekle</span>
          </button>
        </div>

        {workspaces.length === 0 ? (
          <p className="empty-hint">
            Henüz iş klasörü eklenmedi. Projelerinizi taramak için bir kök
            klasör ekleyin.
          </p>
        ) : (
          <ul className="workspace-list">
            {workspaces.map((ws) => (
              <li key={ws.id} className="workspace-row">
                <div>
                  <strong>{ws.label}</strong>
                  <p className="mono muted">{ws.path}</p>
                </div>
                <button
                  type="button"
                  className="btn btn--danger-soft btn--sm"
                  onClick={() => onRemoveWorkspace(ws.id)}
                >
                  <Trash2 size={13} />
                  <span>Kaldır</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Tercihler + Faz 2 Canlı Ayarlar */}
      <form className="view-stack" onSubmit={handleSave}>
        <section className="panel settings-form">
          <div className="panel__head">
            <h2 className="panel__title">Geliştirici Tercihleri</h2>
          </div>

          <div className="form-grid">
            <label className="form-field">
              <span>Varsayılan IDE</span>
              <select
                value={defaultIde}
                onChange={(e) => setDefaultIde(e.target.value)}
              >
                {IDE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field">
              <span>Telemetri Yenileme Sıklığı</span>
              <select
                value={refreshSecs}
                onChange={(e) => setRefreshSecs(e.target.value)}
              >
                {REFRESH_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {/* Sosyal Merkez MCP Köprüsü */}
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">
              <Share2 size={16} className="text-cyan" /> Sosyal Merkez MCP
              Köprüsü
            </h2>
            <label className="toggle-pill">
              <input
                type="checkbox"
                checked={socialEnabled}
                onChange={(e) => setSocialEnabled(e.target.checked)}
              />
              <span>{socialEnabled ? "Aktif" : "Pasif"}</span>
            </label>
          </div>

          <div className="form-grid">
            <label className="form-field form-field--full">
              <span>MCP Endpoint URL</span>
              <div className="input-with-btn">
                <input
                  type="url"
                  className="text-input"
                  placeholder="http://127.0.0.1:49157/mcp"
                  value={socialUrl}
                  onChange={(e) => setSocialUrl(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => void handleTestSocial()}
                  disabled={testingSocial}
                >
                  <RefreshCw
                    size={13}
                    className={testingSocial ? "spin" : ""}
                  />
                  <span>Bağlantıyı Test Et</span>
                </button>
              </div>
            </label>
          </div>

          {socialTestResult && (
            <div className="test-result-row">
              {socialTestResult.connected ? (
                <>
                  <CheckCircle2 size={14} className="text-emerald" />
                  <span>
                    Bağlı ({socialTestResult.accounts.length} hesap,{" "}
                    {socialTestResult.published_count} yayınlanan,{" "}
                    {socialTestResult.scheduled_count} planlı)
                  </span>
                </>
              ) : (
                <>
                  <XCircle size={14} className="text-warning" />
                  <span>
                    {socialTestResult.error || "Sosyal Merkez MCP çevrimdışı"}
                  </span>
                </>
              )}
            </div>
          )}
        </section>

        {/* Scrapling Bilgi Bankası */}
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">
              <BookOpen size={16} className="text-indigo" /> Scrapling Bilgi
              Bankası
            </h2>
          </div>

          <label className="form-field">
            <span>Bilgi Bankası Klasörü (`scrapling_dir`)</span>
            <div className="input-with-btn">
              <input
                type="text"
                className="text-input"
                placeholder="/Users/.../dev/lab/scrapling"
                value={scraplingDir}
                onChange={(e) => setScraplingDir(e.target.value)}
              />
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => void handlePickScraplingDir()}
              >
                <FolderOpen size={14} />
                <span>Klasör Seç</span>
              </button>
            </div>
          </label>
        </section>

        {/* GitHub & GitLab */}
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">
              <GitBranch size={16} className="text-cyan" /> GitHub &amp; GitLab
              Sağlayıcıları
            </h2>
          </div>

          <div className="form-grid">
            <label className="form-field form-field--full">
              <span>GitHub Personal Access Token (opsiyonel — yoksa gh CLI kullanılır)</span>
              <input
                type="password"
                className="text-input"
                placeholder="ghp_..."
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                autoComplete="off"
              />
            </label>

            <label className="form-field">
              <span>GitLab URL</span>
              <input
                type="url"
                className="text-input"
                placeholder="https://gitlab.com"
                value={gitlabUrl}
                onChange={(e) => setGitlabUrl(e.target.value)}
              />
            </label>

            <label className="form-field">
              <span>GitLab Private Token</span>
              <input
                type="password"
                className="text-input"
                placeholder="glpat-..."
                value={gitlabToken}
                onChange={(e) => setGitlabToken(e.target.value)}
                autoComplete="off"
              />
            </label>
          </div>
        </section>

        {/* Yerel AI (MLX-Serve / Ollama) */}
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">
              <Sparkles size={16} className="text-emerald" /> Yerel AI Asistan
              (Cmd+K)
            </h2>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => void handleTestAi()}
              disabled={testingAi}
            >
              <RefreshCw size={13} className={testingAi ? "spin" : ""} />
              <span>Bağlantıyı Test Et</span>
            </button>
          </div>

          <div className="form-grid">
            <label className="form-field">
              <span>AI Base URL (MLX-Serve veya Ollama)</span>
              <input
                type="url"
                className="text-input"
                placeholder="http://127.0.0.1:11234/v1"
                value={aiBaseUrl}
                onChange={(e) => setAiBaseUrl(e.target.value)}
              />
            </label>

            <label className="form-field">
              <span>Model Adı (boş bırakılırsa otomatik seçilir)</span>
              <input
                type="text"
                className="text-input"
                placeholder="mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit"
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
              />
            </label>
          </div>

          {aiTestResult && (
            <div className="test-result-row">
              {aiTestResult.online ? (
                <>
                  <CheckCircle2 size={14} className="text-emerald" />
                  <span>
                    Çevrimiçi ({aiTestResult.provider}) · Model:{" "}
                    <code className="mono">{aiTestResult.model || "—"}</code> (
                    {aiTestResult.available_models.length} model)
                  </span>
                </>
              ) : (
                <>
                  <XCircle size={14} className="text-warning" />
                  <span>
                    Sunucuya ulaşılamadı ({aiTestResult.base_url}). Yerel komut
                    çözücü yedek olarak çalışır.
                  </span>
                </>
              )}
            </div>
          )}
        </section>

        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            <Save size={15} />
            <span>{saving ? "Kaydediliyor..." : "Ayarları Kaydet"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
