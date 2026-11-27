import { useEffect, useState } from "react";
import {
  FolderPlus,
  Mail,
  Save,
  Share2,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { WorkspaceRecord } from "../lib/api";

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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDefaultIde(settings.default_ide || "code");
    setRefreshSecs(settings.refresh_interval_secs || "5");
  }, [settings]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveSettings({
        ...settings,
        default_ide: defaultIde,
        refresh_interval_secs: refreshSecs,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1 className="view-title">Ayarlar</h1>
          <p className="view-subtitle">
            İş klasörleri, varsayılan geliştirme araçları ve modül yönetimi
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

      {/* Tercihler */}
      <form className="panel settings-form" onSubmit={handleSave}>
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

        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            <Save size={15} />
            <span>{saving ? "Kaydediliyor..." : "Ayarları Kaydet"}</span>
          </button>
        </div>
      </form>

      {/* Faz 2 Opsiyonel Modüller */}
      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Faz 2 Opsiyonel Modüller</h2>
          <span className="badge badge--info">Yol Haritası</span>
        </div>

        <div className="modules-grid">
          <article className="module-card">
            <div className="module-card__head">
              <Share2 size={18} className="text-cyan" />
              <span className="badge badge--neutral">Hazırlık</span>
            </div>
            <h3>Sosyal Merkez MCP Köprüsü</h3>
            <p>
              Yayın takvimi, çoklu platform içerik kuyruğu ve etkileşim
              metriklerini MCP üzerinden yerel komuta merkezine bağlar.
            </p>
          </article>

          <article className="module-card">
            <div className="module-card__head">
              <Mail size={18} className="text-indigo" />
              <span className="badge badge--neutral">Hazırlık</span>
            </div>
            <h3>E-posta Sinyalleri</h3>
            <p>
              Kritik sunucu uyarıları, CI/CD kırılmaları ve müşteri destek
              sinyallerini tek akışta özetler.
            </p>
          </article>

          <article className="module-card">
            <div className="module-card__head">
              <Sparkles size={18} className="text-emerald" />
              <span className="badge badge--neutral">Hazırlık</span>
            </div>
            <h3>Yerel AI Cmd+K</h3>
            <p>
              MLX-Serve veya Ollama üzerinden doğal dil ile süreç kapatma,
              proje arama ve disk temizleme komut paleti.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
