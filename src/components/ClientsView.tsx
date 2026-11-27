import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Briefcase,
  Calendar,
  CheckCircle2,
  ClipboardCopy,
  Code2,
  ExternalLink,
  FolderOpen,
  Monitor,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  api,
  type ClientInput,
  type ClientProjectInput,
  type ClientProjectRecord,
  type ClientRecord,
} from "../lib/api";
import { ConfirmDialog } from "./ConfirmDialog";

export interface ClientsViewProps {
  onOpenFinder: (path: string) => void;
  onOpenIde: (path: string) => void;
  onOpenUrl: (url: string) => void;
  onNotify: (tone: "success" | "error" | "info", text: string) => void;
}

const REMOTE_TOOL_LABELS: Record<string, string> = {
  rustdesk: "RustDesk",
  hoptodesk: "HopToDesk",
  anydesk: "AnyDesk",
  vnc: "VNC / Screen Sharing",
  rdp: "RDP (Windows)",
  ssh: "SSH",
};

const STATUS_META: Record<
  string,
  { label: string; badgeClass: string }
> = {
  lead: { label: "Teklif / Plan", badgeClass: "badge--neutral" },
  active: { label: "Aktif", badgeClass: "badge--info" },
  waiting: { label: "Müşteri Bekleniyor", badgeClass: "badge--warning" },
  review: { label: "İncelemede", badgeClass: "badge--warning" },
  done: { label: "Tamamlandı", badgeClass: "badge--success" },
};

const PRIORITY_META: Record<
  string,
  { label: string; badgeClass: string }
> = {
  low: { label: "Düşük", badgeClass: "badge--neutral" },
  normal: { label: "Normal", badgeClass: "badge--neutral" },
  high: { label: "Yüksek", badgeClass: "badge--warning" },
  urgent: { label: "Acil", badgeClass: "badge--danger" },
};

const CLIENT_INVITE_TEMPLATE = `Merhaba, uzak destek bağlantısı için ücretsiz ve güvenli RustDesk kullanıyoruz:
1) https://rustdesk.com adresinden RustDesk'i indirip açın.
2) Windows kullanıyorsanız tam müdahale (kurulum/ayar ekranları) için sol alttaki "Yükle (Install)" butonuna bir kez basın.
3) macOS kullanıyorsanız açılan pencerede Erişilebilirlik ve Ekran Kaydı izinlerini işaretleyin.
4) Ekrandaki 9 haneli ID numarasını ve tek seferlik şifreyi bana iletmeniz yeterli.`;

const EMPTY_CLIENT_FORM: ClientInput = {
  id: null,
  name: "",
  contact_name: "",
  contact_info: "",
  remote_tool: "rustdesk",
  remote_id: "",
  os_info: "",
  notes: "",
};

const EMPTY_PROJECT_FORM: ClientProjectInput = {
  id: null,
  client_id: 0,
  title: "",
  status: "active",
  priority: "normal",
  progress_pct: 20,
  due_date: "",
  local_path: "",
  live_url: "",
  notes: "",
};

function formatShortDate(iso: string | null): string {
  if (!iso) return "Henüz bağlanılmadı";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function ClientsView({
  onOpenFinder,
  onOpenIde,
  onOpenUrl,
  onNotify,
}: ClientsViewProps) {
  const [subTab, setSubTab] = useState<"projects" | "clients">("projects");
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [projects, setProjects] = useState<ClientProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingId, setConnectingId] = useState<number | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<number | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Forms
  const [clientFormOpen, setClientFormOpen] = useState(false);
  const [clientForm, setClientForm] = useState<ClientInput>(EMPTY_CLIENT_FORM);
  const [savingClient, setSavingClient] = useState(false);

  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [projectForm, setProjectForm] =
    useState<ClientProjectInput>(EMPTY_PROJECT_FORM);
  const [savingProject, setSavingProject] = useState(false);

  // Delete dialogs
  const [deleteClientTarget, setDeleteClientTarget] =
    useState<ClientRecord | null>(null);
  const [deleteProjectTarget, setDeleteProjectTarget] =
    useState<ClientProjectRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reloadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cList, pList] = await Promise.all([
        api.listClients(),
        api.listClientProjects(),
      ]);
      setClients(cList);
      setProjects(pList);
    } catch (err) {
      onNotify("error", `Müşteri verileri yüklenemedi: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  const clientsById = useMemo(() => {
    const map = new Map<number, ClientRecord>();
    for (const c of clients) {
      map.set(c.id, c);
    }
    return map;
  }, [clients]);

  const projectCountByClient = useMemo(() => {
    const counts = new Map<number, number>();
    for (const p of projects) {
      counts.set(p.client_id, (counts.get(p.client_id) ?? 0) + 1);
    }
    return counts;
  }, [projects]);

  const activeProjectsCount = useMemo(
    () =>
      projects.filter((p) => p.status !== "done" && p.status !== "lead").length,
    [projects]
  );

  const urgentProjectsCount = useMemo(
    () =>
      projects.filter(
        (p) =>
          p.status !== "done" &&
          (p.priority === "urgent" || p.priority === "high")
      ).length,
    [projects]
  );

  const doneProjectsCount = useMemo(
    () => projects.filter((p) => p.status === "done").length,
    [projects]
  );

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return projects.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (clientFilter !== "all" && p.client_id !== clientFilter) return false;
      if (q) {
        const clientName = (clientsById.get(p.client_id)?.name ?? "").toLowerCase();
        const hay = `${p.title} ${clientName} ${p.notes}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [projects, statusFilter, clientFilter, searchQuery, clientsById]);

  const filteredClients = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) =>
      `${c.name} ${c.contact_name} ${c.remote_id} ${c.os_info} ${c.notes}`
        .toLowerCase()
        .includes(q)
    );
  }, [clients, searchQuery]);

  const copyText = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        onNotify("success", `${label} panoya kopyalandı.`);
      } catch {
        onNotify("error", "Panoya kopyalanamadı.");
      }
    },
    [onNotify]
  );

  const handleConnectRemote = useCallback(
    async (client: ClientRecord) => {
      if (!client.remote_id.trim()) {
        onNotify(
          "info",
          `${client.name} için henüz Uzak Bağlantı ID tanımlanmamış.`
        );
        return;
      }
      setConnectingId(client.id);
      try {
        const uri = await api.connectRemoteClient(client.id);
        onNotify(
          "success",
          `${client.name} bağlantısı başlatıldı (${uri}).`
        );
        void reloadAll();
      } catch (err) {
        onNotify("error", String(err));
      } finally {
        setConnectingId(null);
      }
    },
    [onNotify, reloadAll]
  );

  const handleSaveClient = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!clientForm.name.trim()) {
        onNotify("error", "Müşteri / firma adı zorunludur.");
        return;
      }
      setSavingClient(true);
      try {
        await api.saveClient(clientForm);
        onNotify(
          "success",
          clientForm.id ? "Müşteri güncellendi." : "Yeni müşteri eklendi."
        );
        setClientFormOpen(false);
        setClientForm(EMPTY_CLIENT_FORM);
        await reloadAll();
      } catch (err) {
        onNotify("error", `Müşteri kaydedilemedi: ${String(err)}`);
      } finally {
        setSavingClient(false);
      }
    },
    [clientForm, onNotify, reloadAll]
  );

  const handleSaveProject = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!projectForm.title.trim()) {
        onNotify("error", "Proje adı zorunludur.");
        return;
      }
      if (!projectForm.client_id) {
        onNotify("error", "Lütfen bir müşteri seçin (önce müşteri ekleyin).");
        return;
      }
      setSavingProject(true);
      try {
        await api.saveClientProject(projectForm);
        onNotify(
          "success",
          projectForm.id ? "Proje güncellendi." : "Yeni müşteri projesi eklendi."
        );
        setProjectFormOpen(false);
        setProjectForm(EMPTY_PROJECT_FORM);
        await reloadAll();
      } catch (err) {
        onNotify("error", `Proje kaydedilemedi: ${String(err)}`);
      } finally {
        setSavingProject(false);
      }
    },
    [projectForm, onNotify, reloadAll]
  );

  const handleQuickProjectUpdate = useCallback(
    async (
      project: ClientProjectRecord,
      patch: Partial<Pick<ClientProjectRecord, "status" | "progress_pct">>
    ) => {
      try {
        const nextStatus = patch.status ?? project.status;
        const nextProgress =
          patch.progress_pct !== undefined
            ? Math.max(0, Math.min(100, patch.progress_pct))
            : nextStatus === "done"
            ? 100
            : project.progress_pct;
        await api.saveClientProject({
          id: project.id,
          client_id: project.client_id,
          title: project.title,
          status: nextStatus,
          priority: project.priority,
          progress_pct: nextProgress,
          due_date: project.due_date,
          local_path: project.local_path,
          live_url: project.live_url,
          notes: project.notes,
        });
        await reloadAll();
      } catch (err) {
        onNotify("error", `Proje güncellenemedi: ${String(err)}`);
      }
    },
    [onNotify, reloadAll]
  );

  const handleConfirmDeleteClient = useCallback(async () => {
    if (!deleteClientTarget) return;
    setDeleting(true);
    try {
      await api.deleteClient(deleteClientTarget.id);
      onNotify("success", `${deleteClientTarget.name} silindi.`);
      setDeleteClientTarget(null);
      await reloadAll();
    } catch (err) {
      onNotify("error", `Müşteri silinemedi: ${String(err)}`);
    } finally {
      setDeleting(false);
    }
  }, [deleteClientTarget, onNotify, reloadAll]);

  const handleConfirmDeleteProject = useCallback(async () => {
    if (!deleteProjectTarget) return;
    setDeleting(true);
    try {
      await api.deleteClientProject(deleteProjectTarget.id);
      onNotify("success", `${deleteProjectTarget.title} silindi.`);
      setDeleteProjectTarget(null);
      await reloadAll();
    } catch (err) {
      onNotify("error", `Proje silinemedi: ${String(err)}`);
    } finally {
      setDeleting(false);
    }
  }, [deleteProjectTarget, onNotify, reloadAll]);

  const openNewProjectForm = () => {
    if (clients.length === 0) {
      setSubTab("clients");
      setClientForm(EMPTY_CLIENT_FORM);
      setClientFormOpen(true);
      onNotify("info", "Önce ilk müşterinizi ekleyin, ardından proje oluşturun.");
      return;
    }
    setProjectForm({
      ...EMPTY_PROJECT_FORM,
      client_id: clients[0].id,
    });
    setProjectFormOpen(true);
  };

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1 className="view-title">Müşteriler & Uzak Destek</h1>
          <p className="view-subtitle">
            Müşteri projelerini takip edin ve RustDesk / HopToDesk / AnyDesk ile
            tek tıkla uzak masaüstü bağlantısı kurun (sıfır sunucu yükü, yerel SQLite).
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() =>
              void copyText(
                CLIENT_INVITE_TEMPLATE,
                "Müşteri RustDesk kurulum & yetki mesajı"
              )
            }
          >
            <ClipboardCopy size={14} />
            <span>Müşteri Davet Mesajı Kopyala</span>
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              setSubTab("clients");
              setClientForm(EMPTY_CLIENT_FORM);
              setClientFormOpen(true);
            }}
          >
            <Plus size={14} />
            <span>Yeni Müşteri</span>
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setSubTab("projects");
              openNewProjectForm();
            }}
          >
            <Plus size={14} />
            <span>Yeni Proje</span>
          </button>
        </div>
      </header>

      {/* 4'lü Operatör KPI Şeridi */}
      <section className="metrics-grid" aria-label="Müşteri ve Proje Özeti">
        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <Users size={15} className="text-cyan" /> Toplam Müşteri
            </span>
            <span className="badge badge--neutral">Yerel Rehber</span>
          </div>
          <div className="metric-card__value tabular">{clients.length}</div>
          <p className="metric-card__meta">
            {clients.filter((c) => c.remote_id.trim().length > 0).length} uzak
            bağlantı ID kayıtlı
          </p>
        </article>

        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <Briefcase size={15} className="text-indigo" /> Aktif Projeler
            </span>
            <span className="badge badge--info">Devam Ediyor</span>
          </div>
          <div className="metric-card__value tabular">{activeProjectsCount}</div>
          <p className="metric-card__meta">
            Toplam {projects.length} kayıtlı müşteri işi
          </p>
        </article>

        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <Monitor size={15} className="text-warning" /> Acil / Yüksek Öncelik
            </span>
            <span
              className={`badge ${
                urgentProjectsCount > 0 ? "badge--warning" : "badge--success"
              }`}
            >
              {urgentProjectsCount > 0 ? "Öncelikli" : "Sakin"}
            </span>
          </div>
          <div className="metric-card__value tabular">{urgentProjectsCount}</div>
          <p className="metric-card__meta">Teslim veya destek bekleyen işler</p>
        </article>

        <article className="metric-card">
          <div className="metric-card__head">
            <span className="metric-card__label">
              <CheckCircle2 size={15} className="text-emerald" /> Tamamlanan
            </span>
            <span className="badge badge--success">Teslim Edildi</span>
          </div>
          <div className="metric-card__value tabular">{doneProjectsCount}</div>
          <p className="metric-card__meta">Kapatılan müşteri projeleri</p>
        </article>
      </section>

      {/* Alt Sekmeler + Arama */}
      <div className="clients-bar">
        <div className="subtabs-bar" role="tablist" style={{ borderBottom: "none", paddingBottom: 0 }}>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === "projects"}
            className={`subtab-btn ${subTab === "projects" ? "subtab-btn--active" : ""}`}
            onClick={() => setSubTab("projects")}
          >
            <Briefcase size={14} />
            <span>Proje Takip Panosu ({projects.length})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === "clients"}
            className={`subtab-btn ${subTab === "clients" ? "subtab-btn--active" : ""}`}
            onClick={() => setSubTab("clients")}
          >
            <Monitor size={14} />
            <span>Uzak Destek & Müşteriler ({clients.length})</span>
          </button>
        </div>

        <div className="search-box" style={{ maxWidth: 280 }}>
          <Search size={14} className="muted" />
          <input
            type="text"
            placeholder="Müşteri, proje veya ID ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Yeni / Düzenle Müşteri Formu */}
      {clientFormOpen && (
        <form className="panel client-form" onSubmit={(e) => void handleSaveClient(e)}>
          <div className="panel__head">
            <h2 className="panel__title">
              {clientForm.id ? "Müşteriyi Düzenle" : "Yeni Müşteri & Uzak Bağlantı"}
            </h2>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setClientFormOpen(false)}
              aria-label="Formu kapat"
            >
              <X size={15} />
            </button>
          </div>

          <div className="client-form__grid">
            <label className="field">
              <span>Müşteri / Firma Adı *</span>
              <input
                type="text"
                required
                placeholder="Örn. ABC Mimarlık"
                value={clientForm.name}
                onChange={(e) =>
                  setClientForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Yetkili Kişi</span>
              <input
                type="text"
                placeholder="Örn. Ahmet Yılmaz"
                value={clientForm.contact_name}
                onChange={(e) =>
                  setClientForm((f) => ({ ...f, contact_name: e.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Telefon / E-posta</span>
              <input
                type="text"
                placeholder="0532 ... / ahmet@..."
                value={clientForm.contact_info}
                onChange={(e) =>
                  setClientForm((f) => ({ ...f, contact_info: e.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Uzak Bağlantı Aracı</span>
              <select
                value={clientForm.remote_tool}
                onChange={(e) =>
                  setClientForm((f) => ({ ...f, remote_tool: e.target.value }))
                }
              >
                {Object.entries(REMOTE_TOOL_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Bağlantı ID / Host</span>
              <input
                type="text"
                placeholder="Örn. 123 456 789"
                value={clientForm.remote_id}
                onChange={(e) =>
                  setClientForm((f) => ({ ...f, remote_id: e.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Sistem / Yazılım Notu</span>
              <input
                type="text"
                placeholder="Örn. Windows 11 · Allplan 2026"
                value={clientForm.os_info}
                onChange={(e) =>
                  setClientForm((f) => ({ ...f, os_info: e.target.value }))
                }
              />
            </label>
          </div>

          <label className="field">
            <span>Notlar</span>
            <input
              type="text"
              placeholder="Özel destek notu, lisans bilgisi vb."
              value={clientForm.notes}
              onChange={(e) =>
                setClientForm((f) => ({ ...f, notes: e.target.value }))
              }
            />
          </label>

          <div className="header-actions" style={{ justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setClientFormOpen(false)}
            >
              Vazgeç
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={savingClient}
            >
              {savingClient ? "Kaydediliyor..." : "Kaydet"}
            </button>
          </div>
        </form>
      )}

      {/* Yeni / Düzenle Proje Formu */}
      {projectFormOpen && (
        <form className="panel client-form" onSubmit={(e) => void handleSaveProject(e)}>
          <div className="panel__head">
            <h2 className="panel__title">
              {projectForm.id ? "Projeyi Düzenle" : "Yeni Müşteri Projesi"}
            </h2>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setProjectFormOpen(false)}
              aria-label="Formu kapat"
            >
              <X size={15} />
            </button>
          </div>

          <div className="client-form__grid">
            <label className="field">
              <span>Müşteri *</span>
              <select
                required
                value={projectForm.client_id}
                onChange={(e) =>
                  setProjectForm((f) => ({
                    ...f,
                    client_id: Number(e.target.value),
                  }))
                }
              >
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Proje / İş Başlığı *</span>
              <input
                type="text"
                required
                placeholder="Örn. Allplan 2026 Geçiş & Şablon Kurulumu"
                value={projectForm.title}
                onChange={(e) =>
                  setProjectForm((f) => ({ ...f, title: e.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Durum</span>
              <select
                value={projectForm.status}
                onChange={(e) =>
                  setProjectForm((f) => ({ ...f, status: e.target.value }))
                }
              >
                {Object.entries(STATUS_META).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Öncelik</span>
              <select
                value={projectForm.priority}
                onChange={(e) =>
                  setProjectForm((f) => ({ ...f, priority: e.target.value }))
                }
              >
                {Object.entries(PRIORITY_META).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>İlerleme (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={projectForm.progress_pct}
                onChange={(e) =>
                  setProjectForm((f) => ({
                    ...f,
                    progress_pct: Number(e.target.value) || 0,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Teslim Tarihi</span>
              <input
                type="date"
                value={projectForm.due_date}
                onChange={(e) =>
                  setProjectForm((f) => ({ ...f, due_date: e.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Yerel Klasör Yolu (opsiyonel)</span>
              <input
                type="text"
                placeholder="/Users/.../dev/..."
                value={projectForm.local_path}
                onChange={(e) =>
                  setProjectForm((f) => ({ ...f, local_path: e.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Canlı URL / Link (opsiyonel)</span>
              <input
                type="url"
                placeholder="https://..."
                value={projectForm.live_url}
                onChange={(e) =>
                  setProjectForm((f) => ({ ...f, live_url: e.target.value }))
                }
              />
            </label>
          </div>

          <label className="field">
            <span>Notlar / Sonraki Adım</span>
            <input
              type="text"
              placeholder="Yapılacaklar, müşteri talebi vb."
              value={projectForm.notes}
              onChange={(e) =>
                setProjectForm((f) => ({ ...f, notes: e.target.value }))
              }
            />
          </label>

          <div className="header-actions" style={{ justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setProjectFormOpen(false)}
            >
              Vazgeç
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={savingProject}
            >
              {savingProject ? "Kaydediliyor..." : "Kaydet"}
            </button>
          </div>
        </form>
      )}

      {/* SEKME 1: PROJE TAKİP PANOSU */}
      {subTab === "projects" && (
        <section className="panel">
          <div className="panel__head">
            <div className="ai-filter-row">
              {[
                ["all", "Tümü"],
                ["active", "Aktif"],
                ["waiting", "Beklemede"],
                ["review", "İncelemede"],
                ["lead", "Teklif"],
                ["done", "Tamamlandı"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`subtab-btn ${
                    statusFilter === key ? "subtab-btn--active" : ""
                  }`}
                  onClick={() => setStatusFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {clients.length > 0 && (
              <select
                className="inline-select"
                value={clientFilter === "all" ? "all" : String(clientFilter)}
                onChange={(e) =>
                  setClientFilter(
                    e.target.value === "all" ? "all" : Number(e.target.value)
                  )
                }
                aria-label="Müşteriye göre filtrele"
              >
                <option value="all">Tüm Müşteriler</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {loading && projects.length === 0 ? (
            <div className="empty-inline">Müşteri projeleri yükleniyor...</div>
          ) : filteredProjects.length === 0 ? (
            <div className="empty-inline">
              Henüz kayıtlı müşteri projesi yok. Sağ üstteki{" "}
              <strong>Yeni Müşteri</strong> ve <strong>Yeni Proje</strong>{" "}
              butonlarıyla başlayın.
            </div>
          ) : (
            <div className="clients-grid">
              {filteredProjects.map((proj) => {
                const client = clientsById.get(proj.client_id);
                const statusInfo = STATUS_META[proj.status] ?? {
                  label: proj.status,
                  badgeClass: "badge--neutral",
                };
                const priorityInfo = PRIORITY_META[proj.priority] ?? {
                  label: proj.priority,
                  badgeClass: "badge--neutral",
                };

                return (
                  <article key={proj.id} className="project-track-card">
                    <div className="project-track-card__head">
                      <span className="badge badge--neutral">
                        {client?.name ?? "Müşteri"}
                      </span>
                      <div className="header-actions" style={{ gap: 6 }}>
                        <span className={`badge ${priorityInfo.badgeClass}`}>
                          {priorityInfo.label}
                        </span>
                        <span className={`badge ${statusInfo.badgeClass}`}>
                          {statusInfo.label}
                        </span>
                      </div>
                    </div>

                    <div className="project-track-card__body">
                      <strong className="project-track-card__title">
                        {proj.title}
                      </strong>
                      {proj.notes && (
                        <p className="cleaner-row__sub">{proj.notes}</p>
                      )}
                      {proj.due_date && (
                        <span className="mono muted" style={{ fontSize: 11 }}>
                          <Calendar
                            size={11}
                            style={{ verticalAlign: "-1px", marginRight: 4 }}
                          />
                          Teslim: {proj.due_date}
                        </span>
                      )}
                    </div>

                    <div className="project-track-card__progress">
                      <div className="disk-legend-item__top">
                        <span className="muted" style={{ fontSize: 11 }}>
                          İlerleme
                        </span>
                        <strong className="tabular" style={{ fontSize: 12 }}>
                          %{proj.progress_pct}
                        </strong>
                      </div>
                      <div className="progress-track">
                        <div
                          className={`progress-fill ${
                            proj.progress_pct >= 100
                              ? "progress-fill--emerald"
                              : "progress-fill--cyan"
                          }`}
                          style={{ width: `${proj.progress_pct}%` }}
                        />
                      </div>
                    </div>

                    <div className="project-track-card__actions">
                      <select
                        className="inline-select"
                        value={proj.status}
                        onChange={(e) =>
                          void handleQuickProjectUpdate(proj, {
                            status: e.target.value,
                          })
                        }
                        aria-label="Durum değiştir"
                      >
                        {Object.entries(STATUS_META).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v.label}
                          </option>
                        ))}
                      </select>

                      {proj.progress_pct < 100 && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm tabular"
                          onClick={() =>
                            void handleQuickProjectUpdate(proj, {
                              progress_pct: Math.min(100, proj.progress_pct + 10),
                            })
                          }
                        >
                          +10%
                        </button>
                      )}

                      {client && client.remote_id.trim() && (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={connectingId === client.id}
                          onClick={() => void handleConnectRemote(client)}
                        >
                          <Monitor size={13} />
                          <span>Bağlan</span>
                        </button>
                      )}

                      {proj.local_path && (
                        <>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => onOpenFinder(proj.local_path)}
                            title="Finder'da Aç"
                          >
                            <FolderOpen size={13} />
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => onOpenIde(proj.local_path)}
                            title="IDE'de Aç"
                          >
                            <Code2 size={13} />
                          </button>
                        </>
                      )}

                      {proj.live_url && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => onOpenUrl(proj.live_url)}
                          title="Canlı Linki Aç"
                        >
                          <ExternalLink size={13} />
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          setProjectForm({
                            id: proj.id,
                            client_id: proj.client_id,
                            title: proj.title,
                            status: proj.status,
                            priority: proj.priority,
                            progress_pct: proj.progress_pct,
                            due_date: proj.due_date,
                            local_path: proj.local_path,
                            live_url: proj.live_url,
                            notes: proj.notes,
                          });
                          setProjectFormOpen(true);
                        }}
                        title="Düzenle"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger-soft btn--sm"
                        onClick={() => setDeleteProjectTarget(proj)}
                        title="Sil"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* SEKME 2: UZAK DESTEK & MÜŞTERİLER */}
      {subTab === "clients" && (
        <section className="panel">
          <div className="panel__head">
            <div>
              <h2 className="panel__title">
                <Monitor size={16} className="text-cyan" /> Müşteri Uzak Destek
                Rehberi
              </h2>
              <p className="view-subtitle">
                RustDesk / HopToDesk / AnyDesk ID'lerini kaydedin ve tek tıkla
                bağlantı başlatın.
              </p>
            </div>
            <span className="badge badge--info tabular">
              {filteredClients.length} müşteri
            </span>
          </div>

          {loading && clients.length === 0 ? (
            <div className="empty-inline">Müşteriler yükleniyor...</div>
          ) : filteredClients.length === 0 ? (
            <div className="empty-inline">
              Henüz müşteri eklenmedi. <strong>Yeni Müşteri</strong> butonuyla
              ilk müşterinizi ve RustDesk ID'sini ekleyin.
            </div>
          ) : (
            <div className="clients-grid">
              {filteredClients.map((client) => {
                const toolLabel =
                  REMOTE_TOOL_LABELS[client.remote_tool] ?? client.remote_tool;
                const projCount = projectCountByClient.get(client.id) ?? 0;
                return (
                  <article key={client.id} className="project-track-card">
                    <div className="project-track-card__head">
                      <span className="badge badge--info">{toolLabel}</span>
                      <span className="badge badge--neutral tabular">
                        {projCount} proje
                      </span>
                    </div>

                    <div className="project-track-card__body">
                      <strong className="project-track-card__title">
                        {client.name}
                      </strong>
                      {(client.contact_name || client.contact_info) && (
                        <p className="cleaner-row__sub">
                          {[client.contact_name, client.contact_info]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                      {client.remote_id && (
                        <div className="client-id-strip">
                          <span className="mono">{client.remote_id}</span>
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() =>
                              void copyText(client.remote_id, "Bağlantı ID")
                            }
                            title="ID Kopyala"
                          >
                            <ClipboardCopy size={13} />
                          </button>
                        </div>
                      )}
                      {client.os_info && (
                        <span className="mono muted" style={{ fontSize: 11 }}>
                          {client.os_info}
                        </span>
                      )}
                      {client.notes && (
                        <p className="cleaner-row__note">{client.notes}</p>
                      )}
                      <span className="muted" style={{ fontSize: 11 }}>
                        Son bağlantı: {formatShortDate(client.last_connected_at)}
                      </span>
                    </div>

                    <div className="project-track-card__actions">
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        disabled={
                          connectingId === client.id || !client.remote_id.trim()
                        }
                        onClick={() => void handleConnectRemote(client)}
                      >
                        <Monitor size={13} />
                        <span>
                          {connectingId === client.id
                            ? "Açılıyor..."
                            : `${toolLabel} ile Bağlan`}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          setClientForm({
                            id: client.id,
                            name: client.name,
                            contact_name: client.contact_name,
                            contact_info: client.contact_info,
                            remote_tool: client.remote_tool,
                            remote_id: client.remote_id,
                            os_info: client.os_info,
                            notes: client.notes,
                          });
                          setClientFormOpen(true);
                        }}
                        title="Düzenle"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger-soft btn--sm"
                        onClick={() => setDeleteClientTarget(client)}
                        title="Sil"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      <ConfirmDialog
        open={Boolean(deleteClientTarget)}
        title="Müşteriyi Sil"
        description={
          deleteClientTarget
            ? `"${deleteClientTarget.name}" müşterisi ve ona bağlı tüm proje kayıtları silinecek. Devam etmek istiyor musunuz?`
            : ""
        }
        confirmLabel="Sil"
        cancelLabel="Vazgeç"
        tone="danger"
        busy={deleting}
        onConfirm={() => void handleConfirmDeleteClient()}
        onCancel={() => {
          if (!deleting) setDeleteClientTarget(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteProjectTarget)}
        title="Müşteri Projesini Sil"
        description={
          deleteProjectTarget
            ? `"${deleteProjectTarget.title}" proje kaydı takip panosundan silinecek (yerel klasörünüze dokunulmaz).`
            : ""
        }
        confirmLabel="Sil"
        cancelLabel="Vazgeç"
        tone="danger"
        busy={deleting}
        onConfirm={() => void handleConfirmDeleteProject()}
        onCancel={() => {
          if (!deleting) setDeleteProjectTarget(null);
        }}
      />
    </div>
  );
}
