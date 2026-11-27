import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type UiLanguage = "en" | "tr";

const STORAGE_KEY = "affexdesk.ui_language.v1";

const DICTIONARY: Record<UiLanguage, Record<string, string>> = {
  tr: {
    // Navigation
    "nav.overview": "Genel Bakış",
    "nav.processes": "Süreçler",
    "nav.projects": "Projeler",
    "nav.disk": "Disk Analizi",
    "nav.clients": "Müşteriler & Destek",
    "nav.git": "Git / Repolar",
    "nav.knowledge": "Bilgi Bankası",
    "nav.studio": "Stüdyo & DevOps",
    "nav.settings": "Ayarlar",
    "nav.ai_assistant": "AI Asistan",
    "nav.hud_pin": "Üst Banda Sabitle",
    "nav.hud_on": "Üst Bant: Açık",
    "nav.local_telemetry": "Yerel Telemetri",

    // Telemetry & Thermal
    "telem.cpu": "CPU",
    "telem.ram": "RAM",
    "telem.disk": "DİSK",
    "telem.disk_free": "boş",
    "telem.thermal": "TERMAL",
    "telem.nominal": "Nominal",
    "telem.fair": "Ilık",
    "telem.serious": "Yüksek",
    "telem.critical": "Kritik",
    "telem.normal": "Normal",
    "telem.cores": "çekirdek",
    "telem.uptime": "Çalışma süresi",
    "telem.refresh": "Yenile",
    "telem.detailed_analysis": "Detaylı Analiz →",

    // Overview
    "overview.title": "Komuta Merkezi",
    "overview.cpu_usage": "CPU Kullanımı",
    "overview.unified_ram": "Unified RAM",
    "overview.disk_usage": "Disk Doluluk",
    "overview.thermal_gpu": "Termal & GPU",
    "overview.zombie_procs": "Zombi Dev Süreçleri",
    "overview.reclaimable_disk": "Geri Kazanılabilir Disk",
    "overview.dirty_repos": "Kirli Git Repoları",
    "overview.offline_sites": "Çevrimdışı Canlı Siteler",
    "overview.top_ram_procs": "En Çok RAM Tüketen Süreçler",
    "overview.top_disk_projects": "En Çok Disk Şişiren Projeler",
    "overview.view_all": "Tümünü Gör →",

    // Projects & Detail Cockpit
    "projects.title": "Proje Radarı",
    "projects.check_urls": "Canlı URL'leri Kontrol Et",
    "projects.add_workspace": "+ İş Klasörü Ekle",
    "projects.filter_all": "Tümü",
    "projects.filter_dirty": "Kirli Git",
    "projects.filter_bloated": "Şişkin Disk",
    "projects.filter_live": "Canlı URL",
    "projects.search_placeholder": "Proje, teknoloji veya Git dalı ara...",
    "projects.detail_btn": "Detay →",
    "projects.back_radar": "Proje Radarına Dön",
    "projects.reaudit": "Yeniden Denetle",
    "projects.devops_score": "DevOps / WebDev Skoru",
    "projects.grade": "Not",
    "projects.detected_platforms": "Algılanan Platformlar",
    "projects.local_only": "Yalnızca yerel proje",
    "projects.project_cache": "Proje Önbelleği",
    "projects.clean": "Temizle",
    "projects.client_status": "Müşteri & Canlı Durum",
    "projects.no_client": "Müşterisiz",
    "projects.rule_library": "DevOps & WebDev Kural Kütüphanesi",
    "projects.rule_subtitle": "Çalışma disiplininize göre yerleşik kuralları açıp kapatabilir veya kendi özel kurallarınızı ekleyebilirsiniz.",
    "projects.edit_rules": "Kuralları Düzenle",
    "projects.close_editor": "Düzenlemeyi Kapat",
    "projects.builtin_rules": "Yerleşik Kurallar (Aç / Kapa)",
    "projects.reset_defaults": "Varsayılanlara Sıfırla",
    "projects.add_custom_rule": "Özel Kural Ekle",
    "projects.add": "Ekle",
    "projects.filter_issues": "Eksikler",
    "projects.filter_security": "Güvenlik",
    "projects.filter_git_ci": "Git & CI",
    "projects.recent_commits": "Son 5 Commit",
    "projects.pending_changes": "Bekleyen Değişiklikler",
    "projects.clean_tree": "Çalışma ağacı tamamen temiz.",

    // Disk & Smart Cleaner
    "disk.title": "Disk Analizi",
    "disk.subtitle": "Disk doluluğunu kategorilere ayırın, klasörlerin içine girin ve güvenle Çöp Sepetine taşıyın",
    "disk.tab_map": "Disk Haritası & Gezgin",
    "disk.tab_cleaner": "Akıllı Temizleyici",
    "disk.rescan": "Yeniden Tara",
    "disk.scanning": "Taranıyor...",
    "disk.total_capacity": "Toplam Kapasite",
    "disk.used_space": "Kullanılan Alan",
    "disk.free_space": "Boş Alan",
    "disk.ai_models_title": "Yerel AI Modelleri (HuggingFace / MLX-Serve / LM Studio)",
    "disk.show_list": "Listeyi Aç",
    "disk.hide_list": "Gizle",

    // Cleaner
    "cleaner.total_reclaimable": "Toplam Geri Kazanılabilir",
    "cleaner.safe_space": "Tam Güvenli Alan",
    "cleaner.zero_data_loss": "Veri Kaybı Sıfır",
    "cleaner.selected_clean": "Seçili Temizlik",
    "cleaner.clean_selected": "Seçilenleri Temizle",
    "cleaner.select_all_safe": "Tüm Güvenlileri Seç",
    "cleaner.clear_selection": "Seçimi Temizle",
    "cleaner.rescan": "Temizleyiciyi Yeniden Tara",
    "cleaner.safe_group": "Tam Güvenli Temizlik (Veri Kaybı Sıfır)",
    "cleaner.review_group": "Kontrol Ederek Seç (İsteğe Bağlı Ek Kazanç)",

    // Arcade
    "arcade.score": "SKOR",
    "arcade.high": "REKOR",
    "arcade.lives": "CAN",
    "arcade.controls": "Fare / ←→ Hareket · Tık / Space Ateş",
    "arcade.exit": "Çık (ESC)",
    "arcade.game_over": "OYUN BİTTİ",
    "arcade.play_again": "Tekrar Oyna",
    "arcade.back_work": "Çalışmaya Dön",
  },
  en: {
    // Navigation
    "nav.overview": "Overview",
    "nav.processes": "Processes",
    "nav.projects": "Projects",
    "nav.disk": "Disk Analyzer",
    "nav.clients": "Clients & Remote",
    "nav.git": "Git / Repos",
    "nav.knowledge": "Knowledge Hub",
    "nav.studio": "Studio & DevOps",
    "nav.settings": "Settings",
    "nav.ai_assistant": "AI Assistant",
    "nav.hud_pin": "Pin Top Bar",
    "nav.hud_on": "Top Bar: Pinned",
    "nav.local_telemetry": "Local Telemetry",

    // Telemetry & Thermal
    "telem.cpu": "CPU",
    "telem.ram": "RAM",
    "telem.disk": "DISK",
    "telem.disk_free": "free",
    "telem.thermal": "THERMAL",
    "telem.nominal": "Nominal",
    "telem.fair": "Warm",
    "telem.serious": "High",
    "telem.critical": "Critical",
    "telem.normal": "Normal",
    "telem.cores": "cores",
    "telem.uptime": "Uptime",
    "telem.refresh": "Refresh",
    "telem.detailed_analysis": "Analyze Disk →",

    // Overview
    "overview.title": "Mission Control",
    "overview.cpu_usage": "CPU Usage",
    "overview.unified_ram": "Unified RAM",
    "overview.disk_usage": "Disk Usage",
    "overview.thermal_gpu": "Thermal & GPU",
    "overview.zombie_procs": "Zombie Dev Processes",
    "overview.reclaimable_disk": "Reclaimable Disk",
    "overview.dirty_repos": "Dirty Git Repos",
    "overview.offline_sites": "Offline Live Sites",
    "overview.top_ram_procs": "Top RAM Processes",
    "overview.top_disk_projects": "Largest Project Caches",
    "overview.view_all": "View All →",

    // Projects & Detail Cockpit
    "projects.title": "Project Radar",
    "projects.check_urls": "Check Live URLs",
    "projects.add_workspace": "+ Add Workspace",
    "projects.filter_all": "All",
    "projects.filter_dirty": "Dirty Git",
    "projects.filter_bloated": "Large Cache",
    "projects.filter_live": "Live URL",
    "projects.search_placeholder": "Search project, stack, or Git branch...",
    "projects.detail_btn": "Inspect →",
    "projects.back_radar": "Back to Project Radar",
    "projects.reaudit": "Re-Audit",
    "projects.devops_score": "DevOps / WebDev Score",
    "projects.grade": "Grade",
    "projects.detected_platforms": "Detected Platforms",
    "projects.local_only": "Local-only project",
    "projects.project_cache": "Project Cache",
    "projects.clean": "Clean",
    "projects.client_status": "Client & Live Status",
    "projects.no_client": "Unassigned",
    "projects.rule_library": "DevOps & WebDev Rule Library",
    "projects.rule_subtitle": "Toggle built-in engineering rules or add custom rules tailored to your workflow.",
    "projects.edit_rules": "Edit Rules",
    "projects.close_editor": "Close Editor",
    "projects.builtin_rules": "Built-in Rules (Toggle ON/OFF)",
    "projects.reset_defaults": "Reset Defaults",
    "projects.add_custom_rule": "Add Custom Rule",
    "projects.add": "Add",
    "projects.filter_issues": "Issues",
    "projects.filter_security": "Security",
    "projects.filter_git_ci": "Git & CI",
    "projects.recent_commits": "Recent 5 Commits",
    "projects.pending_changes": "Uncommitted Changes",
    "projects.clean_tree": "Working tree is completely clean.",

    // Disk & Smart Cleaner
    "disk.title": "Disk Analyzer",
    "disk.subtitle": "Break down storage by category, drill into folders, and safely move caches to Trash",
    "disk.tab_map": "Disk Map & Explorer",
    "disk.tab_cleaner": "Smart Cleaner",
    "disk.rescan": "Rescan",
    "disk.scanning": "Scanning...",
    "disk.total_capacity": "Total Capacity",
    "disk.used_space": "Used Space",
    "disk.free_space": "Free Space",
    "disk.ai_models_title": "Local AI Models (HuggingFace / MLX-Serve / LM Studio)",
    "disk.show_list": "Expand List",
    "disk.hide_list": "Collapse",

    // Cleaner
    "cleaner.total_reclaimable": "Total Reclaimable",
    "cleaner.safe_space": "100% Safe Space",
    "cleaner.zero_data_loss": "Zero Data Loss",
    "cleaner.selected_clean": "Selected Cleanup",
    "cleaner.clean_selected": "Clean Selected",
    "cleaner.select_all_safe": "Select All Safe",
    "cleaner.clear_selection": "Clear Selection",
    "cleaner.rescan": "Rescan Cleaner",
    "cleaner.safe_group": "Safe Cleanup (Zero Data Loss)",
    "cleaner.review_group": "Review & Select (Optional Extra Space)",

    // Arcade
    "arcade.score": "SCORE",
    "arcade.high": "BEST",
    "arcade.lives": "LIVES",
    "arcade.controls": "Mouse / ←→ Move · Click / Space Fire",
    "arcade.exit": "Exit (ESC)",
    "arcade.game_over": "GAME OVER",
    "arcade.play_again": "Play Again",
    "arcade.back_work": "Back to Work",
  },
};

function detectInitialLanguage(): UiLanguage {
  const mode = (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE;
  if (mode === "test") return "tr";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "tr") return saved;
  } catch {
    // ignore
  }
  if (typeof navigator !== "undefined") {
    const lang = (navigator.language || "").toLowerCase();
    if (lang.startsWith("tr")) return "tr";
    return "en";
  }
  return "en";
}

interface I18nContextValue {
  lang: UiLanguage;
  setLang: (next: UiLanguage) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: "tr",
  setLang: () => {},
  t: (key) => DICTIONARY.tr[key] ?? key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<UiLanguage>(() => detectInitialLanguage());

  const setLang = useCallback((next: UiLanguage) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  // Keep multiple Tauri windows (main + telemetry-hud) synced automatically
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === "en" || e.newValue === "tr")) {
        setLangState(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      t: (key: string) => DICTIONARY[lang][key] ?? DICTIONARY.en[key] ?? key,
    }),
    [lang, setLang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
