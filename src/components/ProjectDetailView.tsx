import { useCallback, useEffect, useMemo, useState } from "react";
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
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  api,
  type ClientRecord,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ruleFilter, setRuleFilter] = useState<RuleFilter>("all");
  const [fixingId, setFixingId] = useState<string | null>(null);

  const runAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rep = await api.auditProjectRules(project.path);
      setAudit(rep);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [project.path]);

  useEffect(() => {
    void runAudit();
  }, [runAudit]);

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
              : "12 DevOps / WebDev kuralı kontrol ediliyor"}
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
              GitHub, GitLab, Vercel, Docker ve güvenlik standartlarına göre canlı proje denetimi. Eksik şablonları tek tıkla güvenle oluşturabilirsiniz (mevcut dosyalar asla ezilmez).
            </p>
          </div>
          <div className="filter-pills" role="tablist">
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
        </div>

        <div className="rule-list">
          {filteredRules.map((rule) => {
            const isPass = rule.status === "pass";
            const isFail = rule.status === "fail";
            return (
              <div
                key={rule.id}
                className={`rule-row rule-row--${rule.status}`}
              >
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
