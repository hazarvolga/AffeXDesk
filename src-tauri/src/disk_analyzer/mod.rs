use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use sysinfo::Disks;

const MAX_ENTRIES: usize = 40;
const MAX_SCAN_THREADS: usize = 10;
const DU_TIMEOUT_SECS: u64 = 25;
const QUICK_WINS_CACHE_TTL_SECS: u64 = 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskEntry {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub pct_of_parent: f32,
    pub is_dir: bool,
    pub category: String,
    pub safe_to_clean: bool,
    pub clean_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryTotal {
    pub category: String,
    pub label: String,
    pub size_bytes: u64,
    pub pct: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskBreakdownReport {
    pub root_path: String,
    pub parent_path: Option<String>,
    pub total_scanned_bytes: u64,
    pub disk_total_bytes: u64,
    pub disk_used_bytes: u64,
    pub disk_available_bytes: u64,
    pub entries: Vec<DiskEntry>,
    pub category_totals: Vec<CategoryTotal>,
    pub quick_wins: Vec<DiskEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedDiskBreakdown {
    pub report: DiskBreakdownReport,
    pub scanned_at: String,
    #[serde(default)]
    pub include_protected: bool,
}

#[cfg(target_os = "macos")]
pub fn check_full_disk_access() -> bool {
    // /Library/Application Support/com.apple.TCC yalnızca Tam Disk Erişimi (FDA) verildiğinde okunabilir
    // ve okuma denemesi macOS izin penceresi (popup) tetiklemez.
    if fs::read_dir("/Library/Application Support/com.apple.TCC").is_ok() {
        return true;
    }
    if let Some(home) = dirs::home_dir() {
        let safari_dir = home.join("Library/Safari");
        if safari_dir.exists() && fs::read_dir(&safari_dir).is_ok() {
            return true;
        }
    }
    false
}

#[cfg(not(target_os = "macos"))]
pub fn check_full_disk_access() -> bool {
    true
}

#[cfg(target_os = "macos")]
pub fn open_full_disk_access_settings() -> Result<(), String> {
    use std::process::Command;
    let status = Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
        .status()
        .map_err(|err| format!("Sistem Ayarları açılamadı: {err}"))?;
    if !status.success() {
        return Err("Sistem Ayarları Tam Disk Erişimi ekranı açılamadı.".to_string());
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn open_full_disk_access_settings() -> Result<(), String> {
    Ok(())
}

struct QuickWinsCache {
    fetched_at: Instant,
    include_protected: bool,
    items: Vec<DiskEntry>,
}

static QUICK_WINS_CACHE: OnceLock<Mutex<Option<QuickWinsCache>>> = OnceLock::new();
static LAST_REPORT_CACHE: OnceLock<Mutex<Option<CachedDiskBreakdown>>> = OnceLock::new();

fn quick_wins_cache() -> &'static Mutex<Option<QuickWinsCache>> {
    QUICK_WINS_CACHE.get_or_init(|| Mutex::new(None))
}

fn last_report_cache() -> &'static Mutex<Option<CachedDiskBreakdown>> {
    LAST_REPORT_CACHE.get_or_init(|| Mutex::new(None))
}

fn disk_cache_file_path() -> Option<PathBuf> {
    let base = dirs::data_local_dir().or_else(dirs::home_dir)?;
    Some(base.join("AffeXDesk").join("disk_scan_cache.json"))
}

pub fn get_cached_disk_breakdown() -> Option<CachedDiskBreakdown> {
    if let Ok(guard) = last_report_cache().lock() {
        if let Some(ref cached) = *guard {
            return Some(cached.clone());
        }
    }

    let path = disk_cache_file_path()?;
    let raw = fs::read_to_string(path).ok()?;
    let parsed: CachedDiskBreakdown = serde_json::from_str(&raw).ok()?;
    if let Ok(mut guard) = last_report_cache().lock() {
        *guard = Some(parsed.clone());
    }
    Some(parsed)
}

fn save_cached_disk_breakdown(report: &DiskBreakdownReport, include_protected: bool) {
    let entry = CachedDiskBreakdown {
        report: report.clone(),
        scanned_at: chrono::Utc::now().to_rfc3339(),
        include_protected,
    };
    if let Ok(mut guard) = last_report_cache().lock() {
        *guard = Some(entry.clone());
    }
    if let Some(path) = disk_cache_file_path() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string(&entry) {
            let _ = fs::write(path, json);
        }
    }
}

pub fn invalidate_all_disk_caches() {
    if let Ok(mut guard) = last_report_cache().lock() {
        *guard = None;
    }
    if let Ok(mut guard) = quick_wins_cache().lock() {
        *guard = None;
    }
    if let Some(path) = disk_cache_file_path() {
        let _ = fs::remove_file(path);
    }
}

#[cfg(target_os = "macos")]
fn is_macos_tcc_gated(path: &Path, home: Option<&Path>) -> bool {
    let Some(h) = home else {
        return false;
    };
    let h_norm = normalize_path(h);
    let p_norm = normalize_path(path);
    let Ok(rel) = p_norm.strip_prefix(&h_norm) else {
        return false;
    };
    let rel_str = rel.to_string_lossy();
    let rel_lower = rel_str.replace('\\', "/").to_lowercase();

    // Doğrudan macOS TCC izin penceresi tetikleyen kullanıcı klasörleri ve alt yolları
    const USER_TCC_ROOTS: [&str; 7] = [
        "desktop",
        "documents",
        "downloads",
        "pictures",
        "music",
        "movies",
        ".trash",
    ];
    if USER_TCC_ROOTS
        .iter()
        .any(|root| rel_lower == *root || rel_lower.starts_with(&format!("{root}/")))
    {
        return true;
    }

    // ~/Library altındaki TCC korumalı sistem/kişisel veri klasörleri
    const LIBRARY_TCC_PREFIXES: [&str; 22] = [
        "library/mail",
        "library/messages",
        "library/calendars",
        "library/contacts",
        "library/safari",
        "library/reminders",
        "library/photos",
        "library/homekit",
        "library/suggestions",
        "library/personalizationportrait",
        "library/biome",
        "library/statuskit",
        "library/trial",
        "library/metadata",
        "library/accounts",
        "library/cookies",
        "library/containers/com.apple.mail",
        "library/containers/com.apple.safari",
        "library/containers/com.apple.photos",
        "library/application support/mobilesync",
        "library/application support/addressbook",
        "library/application support/callhistorydb",
    ];

    LIBRARY_TCC_PREFIXES
        .iter()
        .any(|prefix| rel_lower == *prefix || rel_lower.starts_with(&format!("{prefix}/")))
}

#[cfg(not(target_os = "macos"))]
fn is_macos_tcc_gated(_path: &Path, _home: Option<&Path>) -> bool {
    false
}

pub fn category_label(category: &str) -> &'static str {
    match category {
        "ai_models" => "AI Modelleri",
        "dev_cache" => "Dev Cache",
        "media_render" => "Medya / Render",
        "system_cache" => "Sistem Önbelleği",
        "downloads" => "İndirilenler",
        "projects" => "Projeler",
        _ => "Diğer",
    }
}

fn normalize_path(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut normalized = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

fn protected_paths_for_home(home: Option<&Path>) -> Vec<PathBuf> {
    let mut protected: Vec<PathBuf> = vec![
        PathBuf::from("/"),
        PathBuf::from("/System"),
        PathBuf::from("/Applications"),
        PathBuf::from("/Users"),
        PathBuf::from("/Library"),
        PathBuf::from("/usr"),
        PathBuf::from("/bin"),
        PathBuf::from("/sbin"),
        PathBuf::from("/etc"),
        PathBuf::from("/var"),
        PathBuf::from("/private"),
        PathBuf::from("/Volumes"),
        PathBuf::from("/opt"),
    ];

    if let Some(h) = home {
        let h_norm = normalize_path(h);
        protected.push(h_norm.clone());
        for sub in [
            "Desktop",
            "Documents",
            "Downloads",
            "Movies",
            "Library",
            "dev",
            "Pictures",
            "Music",
            "Public",
            "Applications",
            ".ssh",
            ".gnupg",
            ".Trash",
        ] {
            protected.push(h_norm.join(sub));
        }
    }

    protected
}

fn protected_prefix_paths_for_home(home: Option<&Path>) -> Vec<PathBuf> {
    let mut prefixes: Vec<PathBuf> = vec![
        PathBuf::from("/System"),
        PathBuf::from("/usr"),
        PathBuf::from("/bin"),
        PathBuf::from("/sbin"),
        PathBuf::from("/etc"),
        PathBuf::from("/var"),
        PathBuf::from("/private"),
        PathBuf::from("/Applications"),
    ];

    if let Some(h) = home {
        let h_norm = normalize_path(h);
        prefixes.push(h_norm.join(".ssh"));
        prefixes.push(h_norm.join(".gnupg"));
        prefixes.push(h_norm.join("Library").join("Keychains"));
    }

    prefixes
}

fn is_protected_windows_path(raw: &str) -> bool {
    let normalized = raw
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase();

    if normalized == "c:" || normalized == "c:/users" {
        return true;
    }

    const WINDOWS_PREFIXES: [&str; 3] = [
        "c:/windows",
        "c:/program files",
        "c:/program files (x86)",
    ];
    WINDOWS_PREFIXES
        .iter()
        .any(|prefix| normalized == *prefix || normalized.starts_with(&format!("{prefix}/")))
}

pub fn is_protected_path(path: &Path) -> bool {
    let home = dirs::home_dir();
    is_protected_path_with_home(path, home.as_deref())
}

fn is_protected_path_with_home(path: &Path, home: Option<&Path>) -> bool {
    let raw = path.to_string_lossy().trim().to_string();
    if raw.is_empty() {
        return true;
    }

    if is_protected_windows_path(&raw) {
        return true;
    }

    let norm = normalize_path(path);
    let canonical = fs::canonicalize(path).ok().map(|p| normalize_path(&p));
    let protected = protected_paths_for_home(home);

    for p in &protected {
        let p_norm = normalize_path(p);
        if norm == p_norm {
            return true;
        }
        if let Some(ref c) = canonical {
            if *c == p_norm {
                return true;
            }
            if let Ok(p_canon) = fs::canonicalize(p) {
                if *c == normalize_path(&p_canon) {
                    return true;
                }
            }
        }
    }

    let prefixes = protected_prefix_paths_for_home(home);
    for prefix in &prefixes {
        let p_norm = normalize_path(prefix);
        if norm.starts_with(&p_norm) {
            return true;
        }
        if let Some(ref c) = canonical {
            if c.starts_with(&p_norm) {
                return true;
            }
            if let Ok(p_canon) = fs::canonicalize(prefix) {
                if c.starts_with(normalize_path(&p_canon)) {
                    return true;
                }
            }
        }
    }

    false
}

pub fn classify_entry(path: &Path, name: &str) -> (String, bool, Option<String>) {
    let path_lower = path.to_string_lossy().replace('\\', "/").to_lowercase();
    let name_lower = name.to_lowercase();
    let protected = is_protected_path(path);

    let (category, mut safe_to_clean, hint) = if path_lower.contains("/.cache/huggingface")
        || path_lower.contains("huggingface")
        || name_lower == ".ollama"
        || path_lower.ends_with("/.ollama")
        || path_lower.contains("/.ollama/")
        || name_lower == ".lmstudio"
        || path_lower.ends_with("/.lmstudio")
        || path_lower.contains("/.lmstudio/")
        || name_lower == ".mlx-serve"
        || path_lower.ends_with("/.mlx-serve")
        || path_lower.contains("/.mlx-serve/")
        || name_lower.ends_with(".gguf")
        || name_lower.ends_with(".safetensors")
    {
        (
            "ai_models",
            true,
            Some("Yerel AI model ağırlıkları — kullanılmayan modeller güvenle temizlenebilir.".to_string()),
        )
    } else if name_lower == "deriveddata"
        || path_lower.contains("/xcode/deriveddata")
        || path_lower.contains("com.docker.docker")
        || name_lower == "node_modules"
        || name_lower == ".cargo"
        || name_lower == ".npm"
        || name_lower == ".pnpm-store"
        || name_lower == ".yarn"
        || name_lower == ".gradle"
        || name_lower == ".m2"
        || name_lower == "target"
        || name_lower == ".next"
        || name_lower == ".nuxt"
        || name_lower == ".turbo"
        || name_lower == ".venv"
        || name_lower == "__pycache__"
        || path_lower.contains("/coresimulator")
        || path_lower.contains("/cocoapods")
    {
        let dev_hint = if path_lower.contains("com.docker.docker") {
            "Docker konteyner/imaj deposu — kullanılmayan imajlar için Docker temizliği önerilir."
        } else {
            "Geliştirici derleme / paket önbelleği — güvenle silinip yeniden oluşturulabilir."
        };
        ("dev_cache", true, Some(dev_hint.to_string()))
    } else if name_lower == "movies"
        || path_lower.contains("/cacheclip")
        || path_lower.contains("/render files")
        || path_lower.contains("/media cache")
        || path_lower.contains("/davinci")
        || path_lower.contains("/final cut")
        || name_lower.ends_with(".mp4")
        || name_lower.ends_with(".mov")
        || name_lower.ends_with(".mkv")
        || name_lower.ends_with(".mxf")
        || name_lower.ends_with(".wav")
        || name_lower.ends_with(".avi")
    {
        let is_render_cache = path_lower.contains("cache") || path_lower.contains("render");
        let media_hint = if is_render_cache {
            "Video/render önbelleği — güvenle temizlenebilir."
        } else {
            "Medya ve video dosyaları — silmeden önce içeriği kontrol edin."
        };
        ("media_render", is_render_cache, Some(media_hint.to_string()))
    } else if name_lower == ".trash"
        || path_lower.ends_with("/.trash")
        || path_lower.contains("/library/caches")
        || name_lower == "caches"
        || name_lower == ".cache"
        || path_lower.contains("/library/logs")
        || name_lower == "logs"
    {
        let cache_hint = if name_lower == ".trash" || path_lower.ends_with("/.trash") {
            "Çöp Sepeti içeriği — Finder üzerinden boşaltılabilir."
        } else {
            "Sistem/uygulama önbelleği — güvenle temizlenebilir."
        };
        ("system_cache", true, Some(cache_hint.to_string()))
    } else if path_lower.contains("/library/application support")
        || name_lower == "application support"
        || name_lower == "library"
        || path_lower.contains("/library/containers")
        || path_lower.contains("/library/group containers")
    {
        (
            "system_cache",
            false,
            Some("Uygulama verileri içerir — içine girip kullanmadığınız uygulamaları temizleyin.".to_string()),
        )
    } else if name_lower == "downloads"
        || path_lower.ends_with("/downloads")
        || name_lower.ends_with(".dmg")
        || name_lower.ends_with(".pkg")
        || name_lower.ends_with(".iso")
        || name_lower.ends_with(".zip")
    {
        (
            "downloads",
            true,
            Some("İndirilen kurulum dosyaları ve arşivler — kontrol edip temizleyebilirsiniz.".to_string()),
        )
    } else if name_lower == "dev"
        || name_lower == "projects"
        || name_lower == "workspace"
        || name_lower == "workspaces"
        || name_lower == "repos"
        || name_lower == "documents"
        || path_lower.contains("/dev/")
    {
        (
            "projects",
            false,
            Some("Proje klasörü — içine girip node_modules/target gibi önbellekleri temizleyin.".to_string()),
        )
    } else {
        ("other", false, None)
    };

    if protected {
        safe_to_clean = false;
    }

    (category.to_string(), safe_to_clean, hint)
}

fn read_primary_disk_space() -> (u64, u64, u64) {
    let disks = Disks::new_with_refreshed_list();
    if disks.is_empty() {
        return (0, 0, 0);
    }

    let root_mount = if cfg!(target_os = "windows") {
        "C:\\"
    } else {
        "/"
    };

    let selected = disks
        .iter()
        .find(|d| d.mount_point().to_string_lossy().eq_ignore_ascii_case(root_mount))
        .or_else(|| disks.iter().max_by_key(|d| d.total_space()));

    match selected {
        Some(disk) => {
            let total = disk.total_space();
            let available = disk.available_space().min(total);
            let used = total.saturating_sub(available);
            (total, used, available)
        }
        None => (0, 0, 0),
    }
}

fn dir_size_recursive_fs(root: &Path) -> u64 {
    let meta = match fs::symlink_metadata(root) {
        Ok(m) => m,
        Err(_) => return 0,
    };
    if meta.file_type().is_symlink() {
        return 0;
    }
    if meta.is_file() {
        return meta.len();
    }
    if !meta.is_dir() {
        return 0;
    }

    let mut total: u64 = 0;
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return 0,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if let Ok(m) = fs::symlink_metadata(&path) {
            if m.file_type().is_symlink() {
                continue;
            }
            if m.is_file() {
                total = total.saturating_add(m.len());
            } else if m.is_dir() {
                total = total.saturating_add(dir_size_recursive_fs(&path));
            }
        }
    }

    total
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn measure_dir_size(path: &Path, include_protected: bool) -> u64 {
    // macOS'ta Tam Disk Erişimi yoksa ~/Library doğrudan `du` ile taranırsa Mail/Messages/Safari TCC izin pencereleri açılır.
    // Tam Disk Modu açık değilse yalnızca TCC dışı alt klasörleri ölç.
    #[cfg(target_os = "macos")]
    if !include_protected {
        if let Some(home) = dirs::home_dir() {
            if is_macos_tcc_gated(path, Some(&home)) {
                return 0;
            }
            let norm = normalize_path(path);
            let lib_dir = normalize_path(&home.join("Library"));
            let app_support_dir = normalize_path(&home.join("Library/Application Support"));
            let containers_dir = normalize_path(&home.join("Library/Containers"));
            if norm == lib_dir || norm == app_support_dir || norm == containers_dir {
                let mut sum: u64 = 0;
                if let Ok(rd) = fs::read_dir(path) {
                    for entry in rd.flatten() {
                        let child = entry.path();
                        if is_macos_tcc_gated(&child, Some(&home)) {
                            continue;
                        }
                        if let Ok(m) = fs::symlink_metadata(&child) {
                            if m.file_type().is_symlink() {
                                continue;
                            }
                            if m.is_dir() {
                                let child_norm = normalize_path(&child);
                                if child_norm == app_support_dir || child_norm == containers_dir {
                                    sum = sum.saturating_add(measure_dir_size(&child, false));
                                } else {
                                    sum = sum.saturating_add(measure_dir_size_raw(&child));
                                }
                            } else if m.is_file() {
                                sum = sum.saturating_add(m.len());
                            }
                        }
                    }
                }
                return sum;
            }
        }
    }

    let _ = include_protected;
    measure_dir_size_raw(path)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn measure_dir_size_raw(path: &Path) -> u64 {
    use std::io::Read;
    use std::process::{Command, Stdio};

    let Ok(mut child) = Command::new("du")
        .args(["-skx"])
        .arg(path)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return dir_size_recursive_fs(path);
    };

    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let mut out = String::new();
                if let Some(mut stdout) = child.stdout.take() {
                    let _ = stdout.read_to_string(&mut out);
                }
                if let Some(first_token) = out.split_whitespace().next() {
                    if let Ok(kb) = first_token.parse::<u64>() {
                        return kb.saturating_mul(1024);
                    }
                }
                return 0;
            }
            Ok(None) => {
                if started.elapsed() >= Duration::from_secs(DU_TIMEOUT_SECS) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return 0;
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return 0;
            }
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn measure_dir_size(path: &Path, _include_protected: bool) -> u64 {
    dir_size_recursive_fs(path)
}

fn measure_path_size(path: &Path) -> u64 {
    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(_) => return 0,
    };
    if meta.file_type().is_symlink() {
        return 0;
    }
    if meta.is_file() {
        return meta.len();
    }
    if meta.is_dir() {
        return measure_dir_size(path, true);
    }
    0
}

fn measure_paths_parallel(items: &[(String, PathBuf, bool)], include_protected: bool) -> Vec<u64> {
    let len = items.len();
    if len == 0 {
        return Vec::new();
    }

    let results: Vec<Mutex<u64>> = (0..len).map(|_| Mutex::new(0)).collect();
    let cursor = AtomicUsize::new(0);
    let worker_count = len.clamp(1, MAX_SCAN_THREADS);

    std::thread::scope(|scope| {
        for _ in 0..worker_count {
            let cursor_ref = &cursor;
            let results_ref = &results;
            scope.spawn(move || loop {
                let idx = cursor_ref.fetch_add(1, Ordering::Relaxed);
                if idx >= len {
                    break;
                }
                let (_, ref path, is_dir) = items[idx];
                let size = if is_dir {
                    measure_dir_size(path, include_protected)
                } else {
                    fs::symlink_metadata(path).map(|m| m.len()).unwrap_or(0)
                };
                if let Ok(mut slot) = results_ref[idx].lock() {
                    *slot = size;
                }
            });
        }
    });

    results
        .into_iter()
        .map(|m| m.into_inner().unwrap_or(0))
        .collect()
}

fn scan_quick_wins(
    home: &Path,
    disk_used_bytes: u64,
    force_refresh: bool,
    include_protected: bool,
    known_sizes: &HashMap<PathBuf, u64>,
) -> Vec<DiskEntry> {
    if !force_refresh {
        if let Ok(guard) = quick_wins_cache().lock() {
            if let Some(ref cached) = *guard {
                if cached.include_protected == include_protected
                    && cached.fetched_at.elapsed() < Duration::from_secs(QUICK_WINS_CACHE_TTL_SECS)
                {
                    return cached.items.clone();
                }
            }
        }
    }

    let mut candidate_paths: Vec<(String, PathBuf)> = vec![
        ("HuggingFace Cache".to_string(), home.join(".cache/huggingface")),
        ("Ollama Modelleri".to_string(), home.join(".ollama")),
        ("LM Studio".to_string(), home.join(".lmstudio")),
        ("MLX-Serve".to_string(), home.join(".mlx-serve")),
        ("macOS Caches".to_string(), home.join("Library/Caches")),
        (
            "Xcode DerivedData".to_string(),
            home.join("Library/Developer/Xcode/DerivedData"),
        ),
        (
            "Docker Disk İmajı".to_string(),
            home.join("Library/Containers/com.docker.docker"),
        ),
        ("Cargo Cache".to_string(), home.join(".cargo")),
        ("npm Cache".to_string(), home.join(".npm")),
        ("pnpm Store".to_string(), home.join("Library/pnpm/store")),
        ("Homebrew Cache".to_string(), home.join("Library/Caches/Homebrew")),
        ("Gradle Cache".to_string(), home.join(".gradle")),
        ("Python / UV Cache".to_string(), home.join(".cache/uv")),
        ("Geliştirme (dev)".to_string(), home.join("dev")),
    ];

    if include_protected {
        candidate_paths.extend([
            ("İndirilenler (Downloads)".to_string(), home.join("Downloads")),
            ("Filmler (Movies)".to_string(), home.join("Movies")),
            ("Belgeler (Documents)".to_string(), home.join("Documents")),
            ("Masaüstü (Desktop)".to_string(), home.join("Desktop")),
            ("Çöp Sepeti (.Trash)".to_string(), home.join(".Trash")),
            (
                "Application Support".to_string(),
                home.join("Library/Application Support"),
            ),
            ("Uygulamalar (/Applications)".to_string(), PathBuf::from("/Applications")),
            ("Homebrew (/opt/homebrew)".to_string(), PathBuf::from("/opt/homebrew")),
            (
                "Sistem App Support (/Library)".to_string(),
                PathBuf::from("/Library/Application Support"),
            ),
        ]);
    }

    let existing: Vec<(String, PathBuf, bool)> = candidate_paths
        .into_iter()
        .filter_map(|(label, full)| {
            let meta = fs::symlink_metadata(&full).ok()?;
            if meta.file_type().is_symlink() {
                return None;
            }
            Some((label, full, meta.is_dir()))
        })
        .collect();

    let mut already_measured: Vec<((String, PathBuf, bool), u64)> = Vec::new();
    let mut to_measure: Vec<(String, PathBuf, bool)> = Vec::new();
    for item in existing {
        let norm = normalize_path(&item.1);
        if let Some(&sz) = known_sizes.get(&norm) {
            already_measured.push((item, sz));
        } else {
            to_measure.push(item);
        }
    }

    let fresh_sizes = measure_paths_parallel(&to_measure, include_protected);
    let mut combined: Vec<((String, PathBuf, bool), u64)> = already_measured;
    combined.extend(to_measure.into_iter().zip(fresh_sizes));

    let mut items: Vec<DiskEntry> = combined
        .into_iter()
        .filter(|(_, size)| *size > 0)
        .map(|((label, path, is_dir), size_bytes)| {
            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&label);
            let (category, safe_to_clean, clean_hint) = classify_entry(&path, file_name);
            let pct_of_parent = if disk_used_bytes > 0 {
                ((size_bytes as f64 / disk_used_bytes as f64) * 100.0) as f32
            } else {
                0.0
            };

            DiskEntry {
                name: label,
                path: path.to_string_lossy().to_string(),
                size_bytes,
                pct_of_parent,
                is_dir,
                category,
                safe_to_clean,
                clean_hint,
            }
        })
        .collect();

    items.sort_by(|a, b| {
        b.size_bytes
            .cmp(&a.size_bytes)
            .then_with(|| a.name.cmp(&b.name))
    });

    if let Ok(mut guard) = quick_wins_cache().lock() {
        *guard = Some(QuickWinsCache {
            fetched_at: Instant::now(),
            include_protected,
            items: items.clone(),
        });
    }

    items
}

fn expand_tilde(raw: &str, home: Option<&Path>) -> PathBuf {
    let trimmed = raw.trim();
    if let Some(h) = home {
        if trimmed == "~" {
            return h.to_path_buf();
        }
        if let Some(rest) = trimmed.strip_prefix("~/") {
            return h.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

pub fn scan_disk_breakdown(
    target_dir: Option<&str>,
    include_protected: bool,
) -> Result<DiskBreakdownReport, String> {
    let home = dirs::home_dir();
    let requested_root = match target_dir.map(str::trim).filter(|s| !s.is_empty()) {
        Some(dir) => expand_tilde(dir, home.as_deref()),
        None => home
            .clone()
            .ok_or_else(|| "Ev dizini bulunamadı.".to_string())?,
    };

    if !requested_root.exists() {
        return Err(format!(
            "Hedef dizin bulunamadı: {}",
            requested_root.to_string_lossy()
        ));
    }
    if !requested_root.is_dir() {
        return Err(format!(
            "Hedef bir klasör değil: {}",
            requested_root.to_string_lossy()
        ));
    }

    let root = fs::canonicalize(&requested_root).unwrap_or(requested_root);
    let root_path = root.to_string_lossy().to_string();
    let parent_path = root.parent().map(|p| p.to_string_lossy().to_string());

    let is_home_root = match &home {
        Some(h) => {
            let h_canon = fs::canonicalize(h).unwrap_or_else(|_| h.clone());
            target_dir.is_none() || root == h_canon
        }
        None => false,
    };

    let read_dir = fs::read_dir(&root)
        .map_err(|err| format!("Klasör okunamadı ({root_path}): {err}"))?;

    let mut children: Vec<(String, PathBuf, bool)> = Vec::new();
    for entry in read_dir.flatten() {
        let path = entry.path();
        if !include_protected && is_macos_tcc_gated(&path, home.as_deref()) {
            continue;
        }
        let meta = match fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        children.push((name, path, meta.is_dir()));
    }

    // Tam Disk Modunda ana ev taramasına sistem genelindeki büyük klasörleri de ekle
    #[cfg(target_os = "macos")]
    if is_home_root && include_protected {
        for (label, sys_path) in [
            ("/Applications", "/Applications"),
            ("/opt/homebrew", "/opt/homebrew"),
            ("/Library/Application Support", "/Library/Application Support"),
        ] {
            let pb = PathBuf::from(sys_path);
            if pb.exists() && pb.is_dir() {
                children.push((label.to_string(), pb, true));
            }
        }
    }

    let sizes = measure_paths_parallel(&children, include_protected);
    let total_scanned_bytes: u64 = sizes
        .iter()
        .fold(0u64, |acc, &sz| acc.saturating_add(sz));

    let mut category_sums: HashMap<String, u64> = HashMap::new();
    let mut entries: Vec<DiskEntry> = children
        .into_iter()
        .zip(sizes)
        .map(|((name, path, is_dir), size_bytes)| {
            let (category, safe_to_clean, clean_hint) = classify_entry(&path, &name);
            *category_sums.entry(category.clone()).or_insert(0) = category_sums
                .get(&category)
                .copied()
                .unwrap_or(0)
                .saturating_add(size_bytes);

            let pct_of_parent = if total_scanned_bytes > 0 {
                ((size_bytes as f64 / total_scanned_bytes as f64) * 100.0) as f32
            } else {
                0.0
            };

            DiskEntry {
                name,
                path: path.to_string_lossy().to_string(),
                size_bytes,
                pct_of_parent,
                is_dir,
                category,
                safe_to_clean,
                clean_hint,
            }
        })
        .collect();

    entries.sort_by(|a, b| {
        b.size_bytes
            .cmp(&a.size_bytes)
            .then_with(|| a.name.cmp(&b.name))
    });
    entries.truncate(MAX_ENTRIES);

    let mut category_totals: Vec<CategoryTotal> = category_sums
        .into_iter()
        .filter(|(_, bytes)| *bytes > 0)
        .map(|(category, size_bytes)| {
            let pct = if total_scanned_bytes > 0 {
                ((size_bytes as f64 / total_scanned_bytes as f64) * 100.0) as f32
            } else {
                0.0
            };
            CategoryTotal {
                label: category_label(&category).to_string(),
                category,
                size_bytes,
                pct,
            }
        })
        .collect();

    category_totals.sort_by(|a, b| {
        b.size_bytes
            .cmp(&a.size_bytes)
            .then_with(|| a.category.cmp(&b.category))
    });

    let (disk_total_bytes, disk_used_bytes, disk_available_bytes) = read_primary_disk_space();

    let mut known_sizes: HashMap<PathBuf, u64> = HashMap::new();
    for entry in &entries {
        known_sizes.insert(normalize_path(Path::new(&entry.path)), entry.size_bytes);
    }

    let quick_wins = if is_home_root {
        if let Some(ref h) = home {
            scan_quick_wins(h, disk_used_bytes, true, include_protected, &known_sizes)
        } else {
            Vec::new()
        }
    } else if let Ok(guard) = quick_wins_cache().lock() {
        guard
            .as_ref()
            .filter(|c| c.include_protected == include_protected)
            .map(|c| c.items.clone())
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let report = DiskBreakdownReport {
        root_path,
        parent_path,
        total_scanned_bytes,
        disk_total_bytes,
        disk_used_bytes,
        disk_available_bytes,
        entries,
        category_totals,
        quick_wins,
    };

    if is_home_root {
        save_cached_disk_breakdown(&report, include_protected);
    }

    Ok(report)
}

pub fn move_path_to_trash(path: &str) -> Result<u64, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("protected_path".to_string());
    }

    let home = dirs::home_dir();
    let target = expand_tilde(trimmed, home.as_deref());

    if is_protected_path_with_home(&target, home.as_deref()) {
        return Err("protected_path".to_string());
    }

    let meta = match fs::symlink_metadata(&target) {
        Ok(m) => m,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(format!("Yol bulunamadı: {}", target.to_string_lossy()));
        }
        Err(err) => {
            return Err(format!(
                "Yol bilgisi alınamadı ({}): {err}",
                target.to_string_lossy()
            ));
        }
    };

    if meta.file_type().is_symlink() {
        return Err("symlink_not_allowed".to_string());
    }

    let canonical = fs::canonicalize(&target).map_err(|err| {
        format!(
            "Yol çözümlenemedi ({}): {err}",
            target.to_string_lossy()
        )
    })?;
    if is_protected_path_with_home(&canonical, home.as_deref()) {
        return Err("protected_path".to_string());
    }

    let reclaimed_bytes = measure_path_size(&canonical);

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // 1. Birincil: macOS yerleşik `/usr/bin/trash` (NSFileManager.trashItemAtURL kullanır;
        //    Finder Apple Events otomasyon izni gerektirmez, gizli .cache klasörlerinde de çalışır).
        let trash_bin = Path::new("/usr/bin/trash");
        let mut trashed = false;
        let mut last_err = String::new();

        if trash_bin.exists() {
            match Command::new(trash_bin).arg(&canonical).output() {
                Ok(output) if output.status.success() && !canonical.exists() => {
                    trashed = true;
                }
                Ok(output) => {
                    last_err = String::from_utf8_lossy(&output.stderr).trim().to_string();
                }
                Err(err) => {
                    last_err = err.to_string();
                }
            }
        }

        // 2. Yedek (eski macOS veya /usr/bin/trash başarısız olursa): doğrudan ~/.Trash içine atomik taşıma
        if !trashed {
            if let Some(ref h) = home {
                let trash_dir = h.join(".Trash");
                if trash_dir.is_dir() {
                    let base_name = canonical
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("trashed_item");
                    let mut dest = trash_dir.join(base_name);
                    if dest.exists() {
                        let ts = chrono::Utc::now().timestamp_millis();
                        dest = trash_dir.join(format!("{base_name}_{ts}"));
                    }
                    match fs::rename(&canonical, &dest) {
                        Ok(()) => {
                            trashed = true;
                        }
                        Err(err) => {
                            last_err = format!("{last_err} | ~/.Trash taşıma hatası: {err}");
                        }
                    }
                }
            }
        }

        if !trashed || canonical.exists() {
            return Err(format!(
                "Çöp Sepetine taşınamadı: {}",
                if last_err.is_empty() {
                    "Bilinmeyen hata (Tam Disk Erişimi gerekebilir)".to_string()
                } else {
                    last_err
                }
            ));
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        let gio_ok = Command::new("gio")
            .arg("trash")
            .arg("--")
            .arg(&canonical)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if !gio_ok {
            let trash_put_ok = Command::new("trash-put")
                .arg("--")
                .arg(&canonical)
                .status()
                .map(|s| s.success())
                .unwrap_or(false);

            if !trash_put_ok {
                return Err("trash_unavailable".to_string());
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;

        let script = r#"
Add-Type -AssemblyName Microsoft.VisualBasic
$p = $env:AFFEX_TRASH_PATH
if (Test-Path -LiteralPath $p -PathType Container) {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
} else {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
}
"#;
        let output = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("AFFEX_TRASH_PATH", &canonical)
            .output()
            .map_err(|err| format!("Windows Geri Dönüşüm Kutusu komutu çalıştırılamadı: {err}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!("Geri Dönüşüm Kutusuna taşınamadı: {stderr}"));
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        return Err("trash_unavailable".to_string());
    }

    invalidate_all_disk_caches();
    Ok(reclaimed_bytes)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskAiModel {
    pub id: String,
    pub provider: String, // "huggingface" | "mlx-serve" | "ollama" | "lmstudio"
    pub path: String,
    pub size_bytes: u64,
    pub last_modified_days: u64,
    pub status: String, // "active" | "unused" | "incomplete"
    pub status_label: String,
}

fn dir_has_incomplete_blobs(dir: &Path) -> bool {
    let blobs = dir.join("blobs");
    if let Ok(rd) = fs::read_dir(blobs) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if name.ends_with(".incomplete") {
                return true;
            }
        }
    }
    false
}

fn days_since_modified(path: &Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return 0;
    };
    let Ok(modified) = meta.modified() else {
        return 0;
    };
    modified
        .elapsed()
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0)
}

fn normalize_model_key(raw: &str) -> String {
    raw.trim().to_ascii_lowercase()
}

pub fn scan_disk_ai_models(active_model_ids: &[String]) -> Vec<DiskAiModel> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };

    let active_set: std::collections::HashSet<String> = active_model_ids
        .iter()
        .map(|s| normalize_model_key(s))
        .collect();

    // (display_id, provider, path)
    let mut candidates: Vec<(String, String, PathBuf)> = Vec::new();

    // 1. HuggingFace Hub cache: ~/.cache/huggingface/hub/models--org--repo
    let hf_hub = home.join(".cache/huggingface/hub");
    if let Ok(rd) = fs::read_dir(&hf_hub) {
        for entry in rd.flatten() {
            let path = entry.path();
            let Ok(meta) = fs::symlink_metadata(&path) else {
                continue;
            };
            if meta.file_type().is_symlink() || !meta.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some(rest) = name.strip_prefix("models--") {
                let display = rest.replace("--", "/");
                candidates.push((display, "huggingface".to_string(), path));
            }
        }
    }

    // 2. MLX-Serve models: ~/.mlx-serve/models/<org>/<repo>
    let mlx_models = home.join(".mlx-serve/models");
    if let Ok(org_rd) = fs::read_dir(&mlx_models) {
        for org_entry in org_rd.flatten() {
            let org_path = org_entry.path();
            let Ok(org_meta) = fs::symlink_metadata(&org_path) else {
                continue;
            };
            if org_meta.file_type().is_symlink() || !org_meta.is_dir() {
                continue;
            }
            let org_name = org_entry.file_name().to_string_lossy().to_string();
            if let Ok(repo_rd) = fs::read_dir(&org_path) {
                for repo_entry in repo_rd.flatten() {
                    let repo_path = repo_entry.path();
                    let Ok(repo_meta) = fs::symlink_metadata(&repo_path) else {
                        continue;
                    };
                    if repo_meta.file_type().is_symlink() || !repo_meta.is_dir() {
                        continue;
                    }
                    let repo_name = repo_entry.file_name().to_string_lossy().to_string();
                    candidates.push((
                        format!("{org_name}/{repo_name}"),
                        "mlx-serve".to_string(),
                        repo_path,
                    ));
                }
            }
        }
    }

    // 3. LM Studio models: ~/.lmstudio/models/<org>/<repo>
    let lms_models = home.join(".lmstudio/models");
    if let Ok(org_rd) = fs::read_dir(&lms_models) {
        for org_entry in org_rd.flatten() {
            let org_path = org_entry.path();
            let Ok(org_meta) = fs::symlink_metadata(&org_path) else {
                continue;
            };
            if org_meta.file_type().is_symlink() || !org_meta.is_dir() {
                continue;
            }
            let org_name = org_entry.file_name().to_string_lossy().to_string();
            if let Ok(repo_rd) = fs::read_dir(&org_path) {
                for repo_entry in repo_rd.flatten() {
                    let repo_path = repo_entry.path();
                    let Ok(repo_meta) = fs::symlink_metadata(&repo_path) else {
                        continue;
                    };
                    if repo_meta.file_type().is_symlink() || !repo_meta.is_dir() {
                        continue;
                    }
                    let repo_name = repo_entry.file_name().to_string_lossy().to_string();
                    candidates.push((
                        format!("{org_name}/{repo_name}"),
                        "lmstudio".to_string(),
                        repo_path,
                    ));
                }
            }
        }
    }

    let measure_input: Vec<(String, PathBuf, bool)> = candidates
        .iter()
        .map(|(id, _, p)| (id.clone(), p.clone(), true))
        .collect();
    let sizes = measure_paths_parallel(&measure_input, false);

    let mut models: Vec<DiskAiModel> = candidates
        .into_iter()
        .zip(sizes)
        .map(|((id, provider, path), size_bytes)| {
            let days = days_since_modified(&path);
            let is_incomplete = size_bytes < 10 * 1024 * 1024 || dir_has_incomplete_blobs(&path);
            let norm_id = normalize_model_key(&id);
            let is_active = !is_incomplete
                && active_set.iter().any(|live| {
                    live == &norm_id
                        || live.ends_with(&format!("/{norm_id}"))
                        || norm_id.ends_with(&format!("/{live}"))
                });

            let (status, status_label) = if is_incomplete {
                ("incomplete".to_string(), "Yarım Kalıntı".to_string())
            } else if is_active {
                ("active".to_string(), "Aktif (Sunucuda)".to_string())
            } else if days > 0 {
                ("unused".to_string(), format!("Kullanılmıyor ({days}g)"))
            } else {
                ("unused".to_string(), "Kullanılmıyor".to_string())
            };

            DiskAiModel {
                id,
                provider,
                path: path.to_string_lossy().to_string(),
                size_bytes,
                last_modified_days: days,
                status,
                status_label,
            }
        })
        .collect();

    models.sort_by(|a, b| {
        b.size_bytes
            .cmp(&a.size_bytes)
            .then_with(|| a.id.cmp(&b.id))
    });
    models
}

pub fn delete_path_permanently(path: &str) -> Result<u64, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("protected_path".to_string());
    }

    let home = dirs::home_dir();
    let target = expand_tilde(trimmed, home.as_deref());

    if is_protected_path_with_home(&target, home.as_deref()) {
        return Err("protected_path".to_string());
    }

    // `.git` dizini veya içindeki herhangi bir dosya kalıcı silinemez
    if target
        .components()
        .any(|c| c.as_os_str().to_string_lossy() == ".git")
    {
        return Err("protected_path".to_string());
    }

    let meta = match fs::symlink_metadata(&target) {
        Ok(m) => m,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(format!("Yol bulunamadı: {}", target.to_string_lossy()));
        }
        Err(err) => {
            return Err(format!(
                "Yol bilgisi alınamadı ({}): {err}",
                target.to_string_lossy()
            ));
        }
    };

    if meta.file_type().is_symlink() {
        return Err("symlink_not_allowed".to_string());
    }

    let canonical = fs::canonicalize(&target).map_err(|err| {
        format!(
            "Yol çözümlenemedi ({}): {err}",
            target.to_string_lossy()
        )
    })?;

    if is_protected_path_with_home(&canonical, home.as_deref()) {
        return Err("protected_path".to_string());
    }

    let reclaimed_bytes = measure_path_size(&canonical);

    if meta.is_dir() {
        fs::remove_dir_all(&canonical).map_err(|err| {
            format!(
                "Klasör kalıcı olarak silinemedi ({}): {err}",
                canonical.to_string_lossy()
            )
        })?;
    } else {
        fs::remove_file(&canonical).map_err(|err| {
            format!(
                "Dosya kalıcı olarak silinemedi ({}): {err}",
                canonical.to_string_lossy()
            )
        })?;
    }

    invalidate_all_disk_caches();
    crate::cleaner::invalidate_cleaner_cache();
    Ok(reclaimed_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "affexdesk_disk_{prefix}_{}_{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn delete_path_permanently_rejects_protected_and_deletes_temp_dir() {
        assert_eq!(
            delete_path_permanently("/System"),
            Err("protected_path".to_string())
        );
        assert_eq!(
            delete_path_permanently("/tmp/demo/.git"),
            Err("protected_path".to_string())
        );

        let test_base = dirs::home_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join(".cache");
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = test_base.join(format!("affexdesk_perm_delete_{}_{nanos}", std::process::id()));
        fs::create_dir_all(&dir).expect("create temp dir");
        let payload = dir.join("model.bin");
        fs::write(&payload, vec![b'X'; 32 * 1024]).expect("write payload");
        assert!(dir.exists());

        let freed = delete_path_permanently(&dir.to_string_lossy()).expect("delete succeeds");
        assert!(freed > 0);
        assert!(!dir.exists());
    }

    #[test]
    fn move_path_to_trash_rejects_protected_paths() {
        assert_eq!(move_path_to_trash("/"), Err("protected_path".to_string()));
        assert_eq!(
            move_path_to_trash("/System"),
            Err("protected_path".to_string())
        );
        assert_eq!(
            move_path_to_trash("/Applications"),
            Err("protected_path".to_string())
        );
        assert_eq!(
            move_path_to_trash("/Users"),
            Err("protected_path".to_string())
        );

        if let Some(home) = dirs::home_dir() {
            let home_str = home.to_string_lossy().to_string();
            assert_eq!(
                move_path_to_trash(&home_str),
                Err("protected_path".to_string())
            );
            assert_eq!(
                move_path_to_trash(&home.join("Desktop").to_string_lossy()),
                Err("protected_path".to_string())
            );
            assert_eq!(
                move_path_to_trash(&home.join("Documents").to_string_lossy()),
                Err("protected_path".to_string())
            );
            assert_eq!(
                move_path_to_trash(&home.join("Library").to_string_lossy()),
                Err("protected_path".to_string())
            );
            assert_eq!(
                move_path_to_trash(&home.join("dev").to_string_lossy()),
                Err("protected_path".to_string())
            );
            assert_eq!(
                move_path_to_trash(&home.join("Pictures").to_string_lossy()),
                Err("protected_path".to_string())
            );
        }
    }

    #[test]
    fn classify_entry_maps_known_categories() {
        let (cat, safe, hint) =
            classify_entry(Path::new("/Users/tester/.cache/huggingface"), "huggingface");
        assert_eq!(cat, "ai_models");
        assert!(safe);
        assert!(hint.is_some());

        let (cat, safe, _) = classify_entry(
            Path::new("/Users/tester/Library/Developer/Xcode/DerivedData"),
            "DerivedData",
        );
        assert_eq!(cat, "dev_cache");
        assert!(safe);

        let (cat, safe, _) =
            classify_entry(Path::new("/Users/tester/Library/Caches"), "Caches");
        assert_eq!(cat, "system_cache");
        assert!(safe);

        let (cat, safe, _) = classify_entry(Path::new("/Users/tester/Downloads"), "Downloads");
        assert_eq!(cat, "downloads");
        assert!(safe);

        let (cat, safe, _) =
            classify_entry(Path::new("/Users/tester/Movies/CacheClip"), "CacheClip");
        assert_eq!(cat, "media_render");
        assert!(safe);

        let (cat, safe, _) = classify_entry(Path::new("/Users/tester/dev/my-app"), "my-app");
        assert_eq!(cat, "projects");
        assert!(!safe);

        let (cat, safe, _) = classify_entry(Path::new("/tmp/random_blob.bin"), "random_blob.bin");
        assert_eq!(cat, "other");
        assert!(!safe);
    }

    #[test]
    fn scan_disk_breakdown_sorts_entries_and_computes_percentages() {
        let root = unique_temp_dir("breakdown");
        let big_file = root.join("large_archive.zip");
        let small_file = root.join("notes.txt");
        let sub_dir = root.join("node_modules");
        fs::create_dir_all(&sub_dir).expect("create node_modules");

        // Write distinctly sized files so both st_size and du block sizes sort deterministically
        fs::write(&big_file, vec![b'A'; 128 * 1024]).expect("write big file");
        fs::write(&small_file, vec![b'B'; 2 * 1024]).expect("write small file");
        fs::write(sub_dir.join("bundle.js"), vec![b'C'; 48 * 1024]).expect("write bundle");

        let report = scan_disk_breakdown(Some(&root.to_string_lossy()), false)
            .expect("scan_disk_breakdown succeeds");

        assert_eq!(report.entries.len(), 3);
        assert_eq!(report.entries[0].name, "large_archive.zip");
        assert_eq!(report.entries[0].category, "downloads");
        assert!(!report.entries[0].is_dir);

        assert_eq!(report.entries[1].name, "node_modules");
        assert_eq!(report.entries[1].category, "dev_cache");
        assert!(report.entries[1].is_dir);
        assert_eq!(report.entries[1].safe_to_clean, !is_protected_path(&sub_dir));

        assert_eq!(report.entries[2].name, "notes.txt");
        assert_eq!(report.entries[2].category, "other");

        assert!(report.entries[0].size_bytes >= report.entries[1].size_bytes);
        assert!(report.entries[1].size_bytes >= report.entries[2].size_bytes);
        assert!(report.total_scanned_bytes > 0);

        let pct_sum: f32 = report.entries.iter().map(|e| e.pct_of_parent).sum();
        assert!(
            (pct_sum - 100.0).abs() < 0.5,
            "expected pct_of_parent sum ~100.0, got {pct_sum}"
        );

        let cat_pct_sum: f32 = report.category_totals.iter().map(|c| c.pct).sum();
        assert!(
            (cat_pct_sum - 100.0).abs() < 0.5,
            "expected category_totals pct sum ~100.0, got {cat_pct_sum}"
        );
        assert!(report.parent_path.is_some());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn protected_paths_cover_prefixes_windows_roots_and_user_roots() {
        let fake_home = Path::new("/Users/tester");

        // Prefix protection
        assert!(is_protected_path_with_home(Path::new("/System/Library/CoreServices"), Some(fake_home)));
        assert!(is_protected_path_with_home(Path::new("/etc/hosts"), Some(fake_home)));
        assert!(is_protected_path_with_home(Path::new("/Applications/Safari.app"), Some(fake_home)));
        assert!(is_protected_path_with_home(Path::new("/usr/local/bin"), Some(fake_home)));
        assert!(is_protected_path_with_home(Path::new("/private/var/db"), Some(fake_home)));
        assert!(is_protected_path_with_home(Path::new("/Users/tester/.ssh/id_ed25519"), Some(fake_home)));
        assert!(is_protected_path_with_home(Path::new("/Users/tester/.gnupg/pubring.kbx"), Some(fake_home)));
        assert!(is_protected_path_with_home(Path::new("/Users/tester/Library/Keychains/login.keychain-db"), Some(fake_home)));

        // Windows system roots
        assert!(is_protected_path_with_home(Path::new("C:\\"), Some(fake_home)));
        assert!(is_protected_path_with_home(Path::new("C:\\Windows\\System32"), Some(fake_home)));
        assert!(is_protected_path_with_home(Path::new("C:\\Program Files\\App"), Some(fake_home)));
        assert!(is_protected_path_with_home(Path::new("C:\\Program Files (x86)\\App"), Some(fake_home)));
        assert!(is_protected_path_with_home(Path::new("C:\\Users"), Some(fake_home)));
        assert!(!is_protected_path_with_home(Path::new("C:\\Users\\tester\\Downloads\\old.zip"), Some(fake_home)));

        // Downloads & Movies root protection (but allow children)
        assert!(is_protected_path_with_home(Path::new("/Users/tester/Downloads"), Some(fake_home)));
        assert!(is_protected_path_with_home(Path::new("/Users/tester/Movies"), Some(fake_home)));
        assert!(!is_protected_path_with_home(Path::new("/Users/tester/Downloads/old.dmg"), Some(fake_home)));
        assert!(!is_protected_path_with_home(Path::new("/Users/tester/Movies/CacheClip"), Some(fake_home)));

        // Parent traversal cannot bypass protection
        assert!(is_protected_path_with_home(Path::new("/Users/tester/Downloads/../.ssh/id_rsa"), Some(fake_home)));

        #[cfg(target_os = "macos")]
        {
            assert!(is_macos_tcc_gated(Path::new("/Users/tester/Desktop/report.pdf"), Some(fake_home)));
            assert!(is_macos_tcc_gated(Path::new("/Users/tester/Documents/sub/file.txt"), Some(fake_home)));
            assert!(is_macos_tcc_gated(Path::new("/Users/tester/Library/Application Support/MobileSync/Backup"), Some(fake_home)));
            assert!(!is_macos_tcc_gated(Path::new("/Users/tester/Library/Caches/Homebrew"), Some(fake_home)));
        }
    }

    #[cfg(unix)]
    #[test]
    fn move_path_to_trash_rejects_symlinks() {
        use std::os::unix::fs::symlink;

        let home = dirs::home_dir().expect("home dir");
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = home.join(format!(".affexdesk_test_trash_sym_{}_{nanos}", std::process::id()));
        fs::create_dir_all(&dir).expect("create test dir");
        let real_file = dir.join("real.txt");
        let link_file = dir.join("link.txt");
        fs::write(&real_file, b"hello").expect("write real");
        symlink(&real_file, &link_file).expect("create symlink");

        let res = move_path_to_trash(&link_file.to_string_lossy());
        assert_eq!(res, Err("symlink_not_allowed".to_string()));
        assert!(real_file.exists());

        let _ = fs::remove_dir_all(&dir);
    }
}
