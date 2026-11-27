import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Code2,
  ExternalLink,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Monitor,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import {
  api,
  type ClientRecord,
  type CustomDevOpsRule,
  type DevOpsRulesConfig,
  type ProjectAuditReport,
  type ProjectInfo,
  type UptimeResult,
} from "../lib/api";
import { formatBytes } from "../lib/format";

export interface ProjectDetailViewProps {
  project: ProjectInfo;
  uptime?: UptimeResult;
  linkedClient?: ClientRecord | null;
  onBack: () => void;
  onOpenFinder: (path: string) => void;
  onOpenIde: (path: string) => void;
  onOpenUrl: (url: string) => void;
  onConnectRemote?: (client: ClientRecord) => void;
  onRequestClean: (project: ProjectInfo) => void;
  onNotify?: (tone: "success" | "error" | "info", text: string) => void;
}

type RuleFilter = "all" | "issues" | "security" | "git_deploy";

const BUILTIN_RULE_META: Array<{ id: string; title: string; category: string }> = [
  { id: "git_initialized", title: "Git Sürüm Kontrolü", category: "Git" },
  { id: "git_remote_linked", title: "Uzak Depo (GitHub / GitLab)", category: "Git" },
  { id: "git_working_tree_clean", title: "Temiz Çalışma Ağacı", category: "Git" },
  { id: "gitignore_present", title: ".gitignore Yapılandırması", category: "Güvenlik" },
  { id: "env_security", title: ".env Gizlilik Koruması", category: "Güvenlik" },
  { id: "env_example_present", title: ".env.example Şablonu", category: "Güvenlik" },
  { id: "ci_pipeline_present", title: "CI/CD Otomasyon Hattı", category: "CI / Yayın" },
  { id: "deploy_config_present", title: "Dağıtım / Paketleme Yapılandırması", category: "CI / Yayın" },
  { id: "readme_present", title: "README Dokümantasyonu", category: "Dokümantasyon" },
  { id: "license_present", title: "Lisans Dosyası", category: "Dokümantasyon" },
  { id: "handoff_or_spec", title: "Devir / Teknik Tasarım Notu", category: "Dokümantasyon" },
  { id: "test_and_build_scripts", title: "Test & Derleme Altyapısı", category: "Kalite & Test" },
];

const FIX_LABELS: Record<string, string> = {
  create_gitignore: ".gitignore Oluştur",
  create_env_example: ".env.example Oluştur",
  create_readme: "README.md Oluştur",
  create_github_ci: "GitHub CI Oluştur",
};

const CATEGORY_LABELS: Record<string, string> = {
  git: "Git",
  security: "Güvenlik",
  deploy: "CI / Yayın",
  docs: "Dokümantasyon",
  quality: "Kalite & Test",
};

export function ProjectDetailView({
  project,
  uptime,
  linkedClient,
  onBack,
  onOpenFinder,
  onOpenIde,
  onOpenUrl,
  onConnectRemote,
  onRequestClean,
  onNotify,
}: ProjectDetailViewProps) {
  const [audit, setAudit] = useState<ProjectAuditReport | null>(null);
  const [rulesConfig, setRulesConfig] = useState<DevOpsRulesConfig>({
    disabled_builtin_ids: [],
    custom_rules: [],
  });
  const [editorOpen, setEditorOpen] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // New custom rule draft
  const [draftTitle, setDraftTitle] = useState("");
  const [draftCategory, setDraftCategory] = useState("quality");
  const [draftCheckType, setDraftCheckType] = useState("file_exists");
  const [draftTargetPath, setDraftTargetPath] = useState("");
  const [draftPattern, setDraftPattern] = useState("");
  const [draftSeverity, setDraftSeverity] = useState("warn");
  const [draftWeight, setDraftWeight] = useState(6);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ruleFilter, setRuleFilter] = useState<RuleFilter>("all");
  const [fixingId, setFixingId] = useState<string | null>(null);

  const runAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rep, cfg] = await Promise.all([
        api.auditProjectRules(project.path),
        api.getDevOpsRulesConfig(),
      ]);
      setAudit(rep);
      setRulesConfig(cfg);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [project.path]);

  useEffect(() => {
    void runAudit();
  }, [runAudit]);

  const persistConfig = async (next: DevOpsRulesConfig, toastText?: string) => {
    setSavingConfig(true);
    try {
      const saved = await api.saveDevOpsRulesConfig(next);
      setRulesConfig(saved);
      const rep = await api.auditProjectRules(project.path);
      setAudit(rep);
      if (toastText) onNotify?.("success", toastText);
    } catch (err) {
      onNotify?.("error", `Kural ayarları kaydedilemedi: ${String(err)}`);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleToggleBuiltin = (ruleId: string) => {
    const isDisabled = rulesConfig.disabled_builtin_ids.includes(ruleId);
    const nextDisabled = isDisabled
      ? rulesConfig.disabled_builtin_ids.filter((id) => id !== ruleId)
      : [...rulesConfig.disabled_builtin_ids, ruleId];
    void persistConfig({
      ...rulesConfig,
      disabled_builtin_ids: nextDisabled,
    });
  };

  const handleAddCustomRule = (e: FormEvent) => {
    e.preventDefault();
    const title = draftTitle.trim();
    const targetPath = draftTargetPath.trim();
    if (!title || !targetPath) {
      onNotify?.("error", "Kural başlığı ve hedef dosya yolu zorunludur.");
      return;
    }
    if (draftCheckType === "file_contains" && !draftPattern.trim()) {
      onNotify?.("error", "'Dosya İçermeli' kuralı için aranacak metin girin.");
      return;
    }
    const newRule: CustomDevOpsRule = {
      id: `custom_${Date.now()}`,
      title,
      category: draftCategory,
      check_type: draftCheckType,
      target_path: targetPath,
      pattern: draftCheckType === "file_contains" ? draftPattern.trim() : null,
      severity: draftSeverity,
      weight: Math.max(1, Math.min(20, Number(draftWeight) || 6)),
      enabled: true,
    };
    setDraftTitle("");
    setDraftTargetPath("");
    setDraftPattern("");
    void persistConfig(
      {
        ...rulesConfig,
        custom_rules: [...rulesConfig.custom_rules, newRule],
      },
      `Özel kural eklendi: ${title}`
    );
  };

  const handleToggleCustom = (id: string) => {
    void persistConfig({
      ...rulesConfig,
      custom_rules: rulesConfig.custom_rules.map((r) =>
        r.id === id ? { ...r, enabled: !r.enabled } : r
      ),
    });
  };

  const handleDeleteCustom = (id: string) => {
    void persistConfig(
      {
        ...rulesConfig,
        custom_rules: rulesConfig.custom_rules.filter((r) => r.id !== id),
      },
      "Özel kural kaldırıldı."
    );
  };

  const handleResetDefaults = () => {
    void persistConfig(
      { disabled_builtin_ids: [], custom_rules: [] },
      "DevOps kural kütüphanesi varsayılanlara sıfırlandı."
    );
  };

  const handleApplyFix = async (ruleId: string, fixAction: string) => {
    setFixingId(ruleId);
    try {
      const msg = await api.applyProjectRuleFix(project.path, fixAction);
      onNotify?.("success", msg);
      await runAudit();
    } catch (err) {
      onNotify?.("error", String(err));
    } finally {
      setFixingId(null);
    }
  };

  const filteredRules = useMemo(() => {
    const list = audit?.rules ?? [];
    if (ruleFilter === "issues") return list.filter((r) => r.status !== "pass");
    if (ruleFilter === "security") return list.filter((r) => r.category === "security");
    if (ruleFilter === "git_deploy") {
      return list.filter((r) => r.category === "git" || r.category === "deploy");
    }
    return list;
  }, [audit, ruleFilter]);

  const scoreTone =
    !audit
      ? "muted"
      : audit.score >= 80
      ? "text-emerald"
      : audit.score >= 60
      ? "text-cyan"
      : "text-warning";

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onBack}
            style={{ marginBottom: 8 }}
          >
            <ArrowLeft size={13} />
            <span>Proje Radarına Dön</span>
          </button>
          <div className="project-card__title-wrap">
            <h1 className="view-title">{project.name}</h1>
            <span className="badge badge--neutral">{project.workspace_label}</span>
            {audit?.git_branch && (
              <span className="badge badge--info mono">
                <GitBranch size={11} /> {audit.git_branch}
              </span>
            )}
          </div>
          <p className="view-subtitle mono">{project.path}</p>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => onOpenFinder(project.path)}
          >
            <FolderOpen size={13} />
            <span>Finder</span>
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => onOpenIde(project.path)}
          >
            <Code2 size={13} />
            <span>IDE</span>
          </button>
          {project.live_url && (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => onOpenUrl(project.live_url!)}
            >
              <ExternalLink size={13} />
              <span>Site</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => void runAudit()}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} />
            <span>Yeniden Denetle</span>
          </button>
        </div>
      </header>

      {/* Üst KPI & Sağlık Puanı Şeridi */}
      <section className="metric-grid" aria-label="Proje Sağlık Özeti">
        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <ShieldCheck size={15} className="text-emerald" /> DevOps / WebDev Skoru
            </span>
            {audit && (
              <span
                className={`badge ${
                  audit.score >= 80
                    ? "badge--success"
                    : audit.score >= 60
                    ? "badge--info"
                    : "badge--warning"
                }`}
              >
                Not: {audit.grade}
              </span>
            )}
          </div>
          <div className={`metric-card__value tabular ${scoreTone}`}>
            {audit ? `${audit.score} / 100` : loading ? "..." : "—"}
          </div>
          <p className="metric-card__meta tabular">
            {audit
              ? `${audit.passed_count} geçti · ${audit.warn_count} uyarı · ${audit.fail_count} kritik`
              : "DevOps / WebDev kuralları kontrol ediliyor"}
          </p>
        </article>

        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <Sparkles size={15} className="text-cyan" /> Algılanan Platformlar
            </span>
          </div>
          <div className="tag-row" style={{ marginTop: 8 }}>
            {audit && audit.deploy_targets.length > 0 ? (
              audit.deploy_targets.map((t) => (
                <span key={t} className="badge badge--info">
                  {t}
                </span>
              ))
            ) : (
              <span className="muted" style={{ fontSize: 12 }}>
                Yalnızca yerel proje
              </span>
            )}
          </div>
          {audit?.git_remote_url && (
            <p className="metric-card__meta mono truncate" title={audit.git_remote_url}>
              {audit.git_remote_url}
            </p>
          )}
        </article>

        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <Trash2 size={15} className="text-warning" /> Proje Önbelleği
            </span>
            {project.reclaimable_bytes > 0 && (
              <button
                type="button"
                className="btn btn--warning-soft btn--sm"
                onClick={() => onRequestClean(project)}
              >
                Temizle
              </button>
            )}
          </div>
          <div className="metric-card__value tabular">
            {formatBytes(project.reclaimable_bytes)}
          </div>
          <p className="metric-card__meta">
            {project.reclaimable_dirs.length > 0
              ? `${project.reclaimable_dirs.length} temizlenebilir klasör`
              : "Temiz — şişkin önbellek yok"}
          </p>
        </article>

        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <Monitor size={15} className="text-indigo" /> Müşteri & Canlı Durum
            </span>
            {uptime && (
              <span
                className={`badge ${
                  uptime.state === "online" ? "badge--success" : "badge--danger"
                }`}
              >
                {uptime.state === "online"
                  ? `Online · ${uptime.latency_ms ?? 0}ms`
                  : "Çevrimdışı"}
              </span>
            )}
          </div>
          <div className="metric-card__value" style={{ fontSize: 18 }}>
            {linkedClient ? linkedClient.name : "Müşterisiz"}
          </div>
          <div className="metric-card__meta">
            {linkedClient && linkedClient.remote_id && onConnectRemote ? (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => onConnectRemote(linkedClient)}
              >
                <Monitor size={12} />
                <span>Uzak Bağlan ({linkedClient.remote_tool})</span>
              </button>
            ) : (
              <span>{project.stack.join(" · ") || "Standart Proje"}</span>
            )}
          </div>
        </article>
      </section>

      {error && (
        <div className="cleaner-result-banner cleaner-result-banner--error" role="alert">
          <AlertTriangle size={16} className="text-danger" />
          <span>Proje denetimi başarısız: {error}</span>
        </div>
      )}

      {/* DevOps / WebDev Kural Kütüphanesi */}
      <section className="panel" aria-label="DevOps ve WebDev Kural Kütüphanesi">
        <div className="panel__head">
          <div>
            <h2 className="panel__title">
              <Wrench size={15} className="text-cyan" /> DevOps & WebDev Kural Kütüphanesi
            </h2>
            <p className="view-subtitle">
              Çalışma disiplininize göre yerleşik kuralları açıp kapatabilir veya kendi özel kurallarınızı ekleyebilirsiniz.
            </p>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className={`btn btn--sm ${editorOpen ? "btn--primary" : "btn--secondary"}`}
              onClick={() => setEditorOpen((prev) => !prev)}
            >
              <SlidersHorizontal size={13} />
              <span>{editorOpen ? "Düzenlemeyi Kapat" : "Kuralları Düzenle"}</span>
            </button>
          </div>
        </div>

        {/* Özelleştirilebilir Kural Düzenleyici Paneli */}
        {editorOpen && (
          <div className="rule-editor-box">
            <div className="rule-editor-box__head">
              <strong>Yerleşik Kurallar (Aç / Kapa)</strong>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={savingConfig}
                onClick={handleResetDefaults}
              >
                <RotateCcw size={12} />
                <span>Varsayılanlara Sıfırla</span>
              </button>
            </div>

            <div className="rule-toggle-grid">
              {BUILTIN_RULE_META.map((item) => {
                const enabled = !rulesConfig.disabled_builtin_ids.includes(item.id);
                return (
                  <label
                    key={item.id}
                    className={`rule-toggle-chip ${
                      enabled ? "rule-toggle-chip--on" : "rule-toggle-chip--off"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={savingConfig}
                      onChange={() => handleToggleBuiltin(item.id)}
                    />
                    <span>{item.title}</span>
                    <span className="muted" style={{ fontSize: 10 }}>
                      {item.category}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="rule-editor-box__head" style={{ marginTop: 14 }}>
              <strong>Özel Kural Ekle ({rulesConfig.custom_rules.length} tanımlı)</strong>
            </div>

            <form className="custom-rule-form" onSubmit={handleAddCustomRule}>
              <input
                type="text"
                placeholder="Kural başlığı (ör. TypeScript Strict Mod)"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
              />
              <select
                value={draftCategory}
                onChange={(e) => setDraftCategory(e.target.value)}
                aria-label="Kural kategorisi"
              >
                <option value="quality">Kalite & Test</option>
                <option value="security">Güvenlik</option>
                <option value="deploy">CI / Yayın</option>
                <option value="git">Git</option>
                <option value="docs">Dokümantasyon</option>
              </select>
              <select
                value={draftCheckType}
                onChange={(e) => setDraftCheckType(e.target.value)}
                aria-label="Kontrol tipi"
              >
                <option value="file_exists">Dosya Olmalı</option>
                <option value="file_contains">Dosya İçermeli</option>
                <option value="file_absent">Dosya Olmamalı</option>
              </select>
              <input
                type="text"
                className="mono"
                placeholder="Göreli dosya (ör. vercel.json)"
                value={draftTargetPath}
                onChange={(e) => setDraftTargetPath(e.target.value)}
              />
              {draftCheckType === "file_contains" && (
                <input
                  type="text"
                  className="mono"
                  placeholder='Aranacak metin (ör. "strict": true)'
                  value={draftPattern}
                  onChange={(e) => setDraftPattern(e.target.value)}
                />
              )}
              <select
                value={draftSeverity}
                onChange={(e) => setDraftSeverity(e.target.value)}
                aria-label="Önem derecesi"
              >
                <option value="warn">Öneri (Uyarı)</option>
                <option value="fail">Kritik (Hata)</option>
              </select>
              <input
                type="number"
                min={1}
                max={20}
                value={draftWeight}
                onChange={(e) => setDraftWeight(Number(e.target.value))}
                title="Puan ağırlığı (1-20)"
                style={{ width: 64 }}
              />
              <button
                type="submit"
                className="btn btn--primary btn--sm"
                disabled={savingConfig}
              >
                <Plus size={13} />
                <span>Ekle</span>
              </button>
            </form>

            {rulesConfig.custom_rules.length > 0 && (
              <div className="custom-rule-list">
                {rulesConfig.custom_rules.map((r) => (
                  <div key={r.id} className="custom-rule-item">
                    <label className="custom-rule-item__check">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        disabled={savingConfig}
                        onChange={() => handleToggleCustom(r.id)}
                      />
                      <strong>{r.title}</strong>
                      <span className="badge badge--neutral mono">{r.check_type}</span>
                      <span className="mono muted">{r.target_path}</span>
                      {r.pattern && (
                        <span className="mono text-cyan">contains "{r.pattern}"</span>
                      )}
                      <span className="badge badge--info tabular">{r.weight}p</span>
                    </label>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Özel kuralı sil"
                      disabled={savingConfig}
                      onClick={() => handleDeleteCustom(r.id)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="filter-pills" role="tablist" style={{ marginBottom: 10 }}>
          {(
            [
              ["all", `Tümü (${audit?.rules.length ?? 0})`],
              [
                "issues",
                `Eksikler (${(audit?.warn_count ?? 0) + (audit?.fail_count ?? 0)})`,
              ],
              ["security", "Güvenlik"],
              ["git_deploy", "Git & CI"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={ruleFilter === id}
              className={`pill ${ruleFilter === id ? "pill--active" : ""}`}
              onClick={() => setRuleFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="rule-list">
          {filteredRules.map((rule) => {
            const isPass = rule.status === "pass";
            const isFail = rule.status === "fail";
            return (
              <div key={rule.id} className={`rule-row rule-row--${rule.status}`}>
                <div className="rule-row__icon">
                  {isPass ? (
                    <CheckCircle2 size={16} className="text-emerald" />
                  ) : isFail ? (
                    <ShieldAlert size={16} className="text-danger" />
                  ) : (
                    <AlertTriangle size={16} className="text-warning" />
                  )}
                </div>
                <div className="rule-row__body">
                  <div className="rule-row__head">
                    <strong>{rule.title}</strong>
                    <span className="badge badge--neutral">
                      {CATEGORY_LABELS[rule.category] ?? rule.category}
                    </span>
                    {rule.is_custom && (
                      <span className="badge badge--info">Özel Kural</span>
                    )}
                  </div>
                  <p className="rule-row__detail">{rule.detail}</p>
                </div>
                <div className="rule-row__action">
                  {rule.fix_action ? (
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      disabled={fixingId === rule.id}
                      onClick={() => void handleApplyFix(rule.id, rule.fix_action!)}
                    >
                      <Sparkles size={12} className="text-cyan" />
                      <span>
                        {fixingId === rule.id
                          ? "Oluşturuluyor..."
                          : FIX_LABELS[rule.fix_action] ?? "Şablon Oluştur"}
                      </span>
                    </button>
                  ) : (
                    <span
                      className={`badge ${
                        isPass
                          ? "badge--success"
                          : isFail
                          ? "badge--danger"
                          : "badge--warning"
                      }`}
                    >
                      {isPass ? "Uygun" : isFail ? "Kritik" : "Öneri"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Alt 2 Sütun: Git Geçmişi + Kirli Dosyalar & Önbellekler */}
      <div className="two-col-grid">
        <section className="panel" aria-label="Son Commitler">
          <div className="panel__head">
            <h2 className="panel__title">
              <GitCommitHorizontal size={15} className="text-cyan" /> Son 5 Commit
            </h2>
          </div>
          {audit && audit.recent_commits.length > 0 ? (
            <ul className="commit-list">
              {audit.recent_commits.map((c) => (
                <li key={c.hash} className="commit-list__row">
                  <span className="badge badge--neutral mono">{c.hash}</span>
                  <span className="commit-list__msg truncate" title={c.message}>
                    {c.message}
                  </span>
                  <span className="muted mono" style={{ fontSize: 11, flexShrink: 0 }}>
                    {c.date_rel}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-inline">Commit geçmişi bulunamadı.</div>
          )}
        </section>

        <section className="panel" aria-label="Değiştirilen Dosyalar ve Önbellekler">
          <div className="panel__head">
            <h2 className="panel__title">
              <GitBranch size={15} className="text-warning" /> Bekleyen Değişiklikler (
              {audit?.dirty_files.length ?? 0})
            </h2>
          </div>
          {audit && audit.dirty_files.length > 0 ? (
            <ul className="dirty-file-list mono">
              {audit.dirty_files.map((line, i) => (
                <li key={`${i}-${line}`} className="dirty-file-list__row truncate">
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-inline">Çalışma ağacı tamamen temiz.</div>
          )}

          {project.reclaimable_dirs.length > 0 && (
            <div className="cache-box" style={{ marginTop: 12 }}>
              <div className="cache-list">
                {project.reclaimable_dirs.map((dir) => (
                  <button
                    key={dir.path}
                    type="button"
                    className="cache-chip cache-chip--clickable mono tabular"
                    onClick={() => onOpenFinder(dir.path)}
                    title={`Finder'da göster: ${dir.path}`}
                  >
                    <FolderOpen size={11} />
                    <span>
                      {dir.name} · {formatBytes(dir.size_bytes)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
