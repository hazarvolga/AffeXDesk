use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use sysinfo::Disks;

const MAX_ENTRIES: usize = 40;
const MAX_SCAN_THREADS: usize = 6;
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

struct QuickWinsCache {
    fetched_at: Instant,
    items: Vec<DiskEntry>,
}

static QUICK_WINS_CACHE: OnceLock<Mutex<Option<QuickWinsCache>>> = OnceLock::new();

fn quick_wins_cache() -> &'static Mutex<Option<QuickWinsCache>> {
    QUICK_WINS_CACHE.get_or_init(|| Mutex::new(None))
}

fn invalidate_quick_wins_cache() {
    if let Ok(mut guard) = quick_wins_cache().lock() {
        *guard = None;
    }
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
    let mut normalized = PathBuf::new();
    for comp in path.components() {
        normalized.push(comp.as_os_str());
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

pub fn is_protected_path(path: &Path) -> bool {
    let home = dirs::home_dir();
    is_protected_path_with_home(path, home.as_deref())
}

fn is_protected_path_with_home(path: &Path, home: Option<&Path>) -> bool {
    let raw = path.to_string_lossy().trim().to_string();
    if raw.is_empty() {
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
fn measure_dir_size(path: &Path) -> u64 {
    use std::process::Command;

    if let Ok(output) = Command::new("du").args(["-skx"]).arg(path).output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(first_token) = stdout.split_whitespace().next() {
            if let Ok(kb) = first_token.parse::<u64>() {
                return kb.saturating_mul(1024);
            }
        }
    }

    dir_size_recursive_fs(path)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn measure_dir_size(path: &Path) -> u64 {
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
        return measure_dir_size(path);
    }
    0
}

fn measure_paths_parallel(items: &[(String, PathBuf, bool)]) -> Vec<u64> {
    let len = items.len();
    if len == 0 {
        return Vec::new();
    }

    let results: Vec<Mutex<u64>> = (0..len).map(|_| Mutex::new(0)).collect();
    let cursor = AtomicUsize::new(0);
    let worker_count = len.min(MAX_SCAN_THREADS).max(1);

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
                    measure_dir_size(path)
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

fn scan_quick_wins(home: &Path, disk_used_bytes: u64, force_refresh: bool) -> Vec<DiskEntry> {
    if !force_refresh {
        if let Ok(guard) = quick_wins_cache().lock() {
            if let Some(ref cached) = *guard {
                if cached.fetched_at.elapsed() < Duration::from_secs(QUICK_WINS_CACHE_TTL_SECS) {
                    return cached.items.clone();
                }
            }
        }
    }

    let candidates: [(&str, &str); 14] = [
        ("HuggingFace Cache", ".cache/huggingface"),
        ("Ollama Modelleri", ".ollama"),
        ("LM Studio", ".lmstudio"),
        ("MLX-Serve", ".mlx-serve"),
        ("macOS Caches", "Library/Caches"),
        ("Xcode DerivedData", "Library/Developer/Xcode/DerivedData"),
        ("Docker Disk İmajı", "Library/Containers/com.docker.docker"),
        ("Application Support", "Library/Application Support"),
        ("İndirilenler (Downloads)", "Downloads"),
        ("Çöp Sepeti (.Trash)", ".Trash"),
        ("Cargo Cache", ".cargo"),
        ("npm Cache", ".npm"),
        ("Filmler (Movies)", "Movies"),
        ("Geliştirme (dev)", "dev"),
    ];

    let existing: Vec<(String, PathBuf, bool)> = candidates
        .iter()
        .filter_map(|(label, rel)| {
            let full = home.join(rel);
            let meta = fs::symlink_metadata(&full).ok()?;
            if meta.file_type().is_symlink() {
                return None;
            }
            Some(((*label).to_string(), full, meta.is_dir()))
        })
        .collect();

    let sizes = measure_paths_parallel(&existing);

    let mut items: Vec<DiskEntry> = existing
        .into_iter()
        .zip(sizes)
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

pub fn scan_disk_breakdown(target_dir: Option<&str>) -> Result<DiskBreakdownReport, String> {
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

    let read_dir = fs::read_dir(&root)
        .map_err(|err| format!("Klasör okunamadı ({root_path}): {err}"))?;

    let mut children: Vec<(String, PathBuf, bool)> = Vec::new();
    for entry in read_dir.flatten() {
        let path = entry.path();
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

    let sizes = measure_paths_parallel(&children);
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

    let is_home_root = match &home {
        Some(h) => {
            let h_canon = fs::canonicalize(h).unwrap_or_else(|_| h.clone());
            target_dir.is_none() || root == h_canon
        }
        None => false,
    };

    let quick_wins = if is_home_root {
        if let Some(ref h) = home {
            scan_quick_wins(h, disk_used_bytes, false)
        } else {
            Vec::new()
        }
    } else if let Ok(guard) = quick_wins_cache().lock() {
        guard.as_ref().map(|c| c.items.clone()).unwrap_or_default()
    } else {
        Vec::new()
    };

    Ok(DiskBreakdownReport {
        root_path,
        parent_path,
        total_scanned_bytes,
        disk_total_bytes,
        disk_used_bytes,
        disk_available_bytes,
        entries,
        category_totals,
        quick_wins,
    })
}

#[cfg(target_os = "macos")]
fn escape_applescript_string(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
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

    if !target.exists() {
        return Err(format!("Yol bulunamadı: {}", target.to_string_lossy()));
    }

    let canonical = fs::canonicalize(&target).unwrap_or(target);
    if is_protected_path_with_home(&canonical, home.as_deref()) {
        return Err("protected_path".to_string());
    }

    let reclaimed_bytes = measure_path_size(&canonical);

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        let escaped = escape_applescript_string(&canonical.to_string_lossy());
        let script = format!("tell application \"Finder\" to delete POSIX file \"{escaped}\"");
        let output = Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map_err(|err| format!("Finder Çöp Sepeti komutu çalıştırılamadı: {err}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!("Çöp Sepetine taşınamadı: {stderr}"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        let gio_ok = Command::new("gio")
            .arg("trash")
            .arg(&canonical)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if !gio_ok {
            let trash_put_ok = Command::new("trash-put")
                .arg(&canonical)
                .status()
                .map(|s| s.success())
                .unwrap_or(false);

            if !trash_put_ok {
                if canonical.is_dir() {
                    fs::remove_dir_all(&canonical)
                        .map_err(|err| format!("Klasör silinemedi: {err}"))?;
                } else {
                    fs::remove_file(&canonical)
                        .map_err(|err| format!("Dosya silinemedi: {err}"))?;
                }
            }
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        if canonical.is_dir() {
            fs::remove_dir_all(&canonical)
                .map_err(|err| format!("Klasör silinemedi: {err}"))?;
        } else {
            fs::remove_file(&canonical)
                .map_err(|err| format!("Dosya silinemedi: {err}"))?;
        }
    }

    invalidate_quick_wins_cache();
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

        let report = scan_disk_breakdown(Some(&root.to_string_lossy()))
            .expect("scan_disk_breakdown succeeds");

        assert_eq!(report.entries.len(), 3);
        assert_eq!(report.entries[0].name, "large_archive.zip");
        assert_eq!(report.entries[0].category, "downloads");
        assert!(!report.entries[0].is_dir);

        assert_eq!(report.entries[1].name, "node_modules");
        assert_eq!(report.entries[1].category, "dev_cache");
        assert!(report.entries[1].is_dir);
        assert!(report.entries[1].safe_to_clean);

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
}
