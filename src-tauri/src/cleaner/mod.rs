use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanerItem {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub category: String,
    pub risk: String, // "safe" | "review"
    pub size_bytes: u64,
    pub default_selected: bool,
    pub path_hint: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanerScanReport {
    pub scanned_at: String,
    pub total_reclaimable_bytes: u64,
    pub safe_reclaimable_bytes: u64,
    pub review_reclaimable_bytes: u64,
    pub docker_available: bool,
    pub items: Vec<CleanerItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanerRunItemResult {
    pub id: String,
    pub title: String,
    pub ok: bool,
    pub freed_bytes: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanerRunReport {
    pub total_freed_bytes: u64,
    pub succeeded: usize,
    pub failed: usize,
    pub needs_docker_restart: bool,
    pub results: Vec<CleanerRunItemResult>,
}

static LAST_CLEANER_SCAN: OnceLock<Mutex<Option<CleanerScanReport>>> = OnceLock::new();

fn last_cleaner_cache() -> &'static Mutex<Option<CleanerScanReport>> {
    LAST_CLEANER_SCAN.get_or_init(|| Mutex::new(None))
}

fn cleaner_cache_file_path() -> Option<PathBuf> {
    let base = dirs::data_local_dir().or_else(dirs::home_dir)?;
    Some(base.join("AffeXDesk").join("cleaner_scan_cache.json"))
}

pub fn get_cached_cleaner_scan() -> Option<CleanerScanReport> {
    if let Ok(guard) = last_cleaner_cache().lock() {
        if let Some(ref cached) = *guard {
            return Some(cached.clone());
        }
    }
    let path = cleaner_cache_file_path()?;
    let raw = fs::read_to_string(path).ok()?;
    let parsed: CleanerScanReport = serde_json::from_str(&raw).ok()?;
    if let Ok(mut guard) = last_cleaner_cache().lock() {
        *guard = Some(parsed.clone());
    }
    Some(parsed)
}

fn save_cached_cleaner_scan(report: &CleanerScanReport) {
    if let Ok(mut guard) = last_cleaner_cache().lock() {
        *guard = Some(report.clone());
    }
    if let Some(path) = cleaner_cache_file_path() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string(report) {
            let _ = fs::write(path, json);
        }
    }
}

pub fn invalidate_cleaner_cache() {
    if let Ok(mut guard) = last_cleaner_cache().lock() {
        *guard = None;
    }
    if let Some(path) = cleaner_cache_file_path() {
        let _ = fs::remove_file(path);
    }
}

fn extended_path_env() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    if cfg!(target_os = "macos") {
        format!("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:{current}")
    } else {
        current
    }
}

fn run_cli_with_timeout(bin: &str, args: &[&str], timeout_secs: u64) -> Result<String, String> {
    use std::io::Read;
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    let mut child = Command::new(bin)
        .args(args)
        .env("PATH", extended_path_env())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("{bin} çalıştırılamadı: {err}"))?;

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) => {
                if started.elapsed() >= Duration::from_secs(timeout_secs) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "{bin} komutu {timeout_secs} sn içinde yanıt vermedi (zaman aşımı)."
                    ));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(err) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{bin} beklenirken hata oluştu: {err}"));
            }
        }
    };

    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_string(&mut stdout);
    }
    if let Some(mut err) = child.stderr.take() {
        let _ = err.read_to_string(&mut stderr);
    }

    if !status.success() {
        let err_trim = stderr.trim().to_string();
        let out_trim = stdout.trim().to_string();
        let detail = if !err_trim.is_empty() {
            err_trim
        } else {
            out_trim
        };
        return Err(if detail.is_empty() {
            format!("{bin} hata koduyla sonlandı: {status}")
        } else {
            detail
        });
    }

    Ok(stdout)
}

fn run_cli(bin: &str, args: &[&str]) -> Result<String, String> {
    run_cli_with_timeout(bin, args, 300)
}

/// Parses human size strings from Docker CLI such as:
/// "165.1GB", "193.4GB (95%)", "884.7kB (100%)", "20.77GB", "0B", "512MB"
pub fn parse_docker_size_bytes(raw: &str) -> u64 {
    let token = raw.split_whitespace().next().unwrap_or("").trim();
    if token.is_empty() {
        return 0;
    }

    let split_idx = token
        .find(|c: char| !c.is_ascii_digit() && c != '.')
        .unwrap_or(token.len());
    let num_str = &token[..split_idx];
    let unit = token[split_idx..].trim().to_ascii_lowercase();

    let value: f64 = match num_str.parse::<f64>() {
        Ok(v) if v.is_finite() && v >= 0.0 => v,
        _ => return 0,
    };

    let multiplier: f64 = match unit.as_str() {
        "b" | "" => 1.0,
        "kb" | "kib" => 1024.0,
        "mb" | "mib" => 1024.0 * 1024.0,
        "gb" | "gib" => 1024.0 * 1024.0 * 1024.0,
        "tb" | "tib" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => 1.0,
    };

    (value * multiplier).round() as u64
}

#[derive(Debug, Default)]
struct DockerDfSummary {
    available: bool,
    build_cache_bytes: u64,
    build_cache_count: u64,
    images_reclaimable_bytes: u64,
    images_total_count: u64,
    images_active_count: u64,
    containers_reclaimable_bytes: u64,
    containers_stopped_count: u64,
    volumes_reclaimable_bytes: u64,
    volumes_unused_count: u64,
}

#[derive(Deserialize)]
struct DockerDfRow {
    #[serde(rename = "Type")]
    kind: String,
    #[serde(rename = "TotalCount")]
    total_count: String,
    #[serde(rename = "Active")]
    active: String,
    #[serde(rename = "Size")]
    size: String,
    #[serde(rename = "Reclaimable")]
    reclaimable: String,
}

fn parse_docker_df_json_lines(stdout: &str) -> DockerDfSummary {
    let mut summary = DockerDfSummary {
        available: true,
        ..Default::default()
    };

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(row) = serde_json::from_str::<DockerDfRow>(trimmed) else {
            continue;
        };
        let total_n = row.total_count.trim().parse::<u64>().unwrap_or(0);
        let active_n = row.active.trim().parse::<u64>().unwrap_or(0);
        let size_bytes = parse_docker_size_bytes(&row.size);
        let reclaimable_bytes = parse_docker_size_bytes(&row.reclaimable);

        match row.kind.to_ascii_lowercase().as_str() {
            "build cache" => {
                // `docker builder prune -a -f` reclaims all unused build cache entries
                summary.build_cache_bytes = size_bytes.max(reclaimable_bytes);
                summary.build_cache_count = total_n;
            }
            "images" => {
                summary.images_reclaimable_bytes = reclaimable_bytes;
                summary.images_total_count = total_n;
                summary.images_active_count = active_n;
            }
            "containers" => {
                summary.containers_reclaimable_bytes = reclaimable_bytes;
                summary.containers_stopped_count = total_n.saturating_sub(active_n);
            }
            "local volumes" => {
                summary.volumes_reclaimable_bytes = reclaimable_bytes;
                summary.volumes_unused_count = total_n.saturating_sub(active_n);
            }
            _ => {}
        }
    }

    summary
}

fn inspect_docker_df() -> DockerDfSummary {
    match run_cli_with_timeout("docker", &["system", "df", "--format", "{{json .}}"], 180) {
        Ok(stdout) => parse_docker_df_json_lines(&stdout),
        Err(_) => DockerDfSummary::default(),
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn measure_dir_fast(path: &Path) -> u64 {
    use std::io::Read;
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    if !path.exists() {
        return 0;
    }
    let Ok(mut child) = Command::new("du")
        .args(["-skx"])
        .arg(path)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return 0;
    };

    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let mut stdout = String::new();
                if let Some(mut out) = child.stdout.take() {
                    let _ = out.read_to_string(&mut stdout);
                }
                if let Some(first) = stdout.split_whitespace().next() {
                    if let Ok(kb) = first.parse::<u64>() {
                        return kb.saturating_mul(1024);
                    }
                }
                return 0;
            }
            Ok(None) => {
                if started.elapsed() >= Duration::from_secs(30) {
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
fn measure_dir_fast(path: &Path) -> u64 {
    fn walk(p: &Path) -> u64 {
        let Ok(meta) = fs::symlink_metadata(p) else {
            return 0;
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
        let mut total = 0u64;
        if let Ok(rd) = fs::read_dir(p) {
            for e in rd.flatten() {
                total = total.saturating_add(walk(&e.path()));
            }
        }
        total
    }
    walk(path)
}

fn pnpm_store_paths(home: &Path) -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        vec![home.join("Library/pnpm"), home.join("Library/Caches/pnpm")]
    } else if cfg!(target_os = "windows") {
        let mut out = Vec::new();
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            out.push(PathBuf::from(&local).join("pnpm-store"));
            out.push(PathBuf::from(local).join("pnpm-cache"));
        }
        out
    } else {
        vec![
            home.join(".local/share/pnpm/store"),
            home.join(".cache/pnpm"),
        ]
    }
}

fn pip_cache_path(home: &Path) -> PathBuf {
    if cfg!(target_os = "macos") {
        home.join("Library/Caches/pip")
    } else if cfg!(target_os = "windows") {
        std::env::var("LOCALAPPDATA")
            .map(|p| PathBuf::from(p).join("pip").join("Cache"))
            .unwrap_or_else(|_| home.join("AppData/Local/pip/Cache"))
    } else {
        home.join(".cache/pip")
    }
}

fn playwright_cache_path(home: &Path) -> PathBuf {
    if cfg!(target_os = "macos") {
        home.join("Library/Caches/ms-playwright")
    } else if cfg!(target_os = "windows") {
        std::env::var("LOCALAPPDATA")
            .map(|p| PathBuf::from(p).join("ms-playwright"))
            .unwrap_or_else(|_| home.join("AppData/Local/ms-playwright"))
    } else {
        home.join(".cache/ms-playwright")
    }
}

fn browser_cache_paths(home: &Path) -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        vec![
            home.join("Library/Caches/Google/Chrome"),
            home.join("Library/Caches/Firefox"),
        ]
    } else if cfg!(target_os = "linux") {
        vec![
            home.join(".cache/google-chrome"),
            home.join(".cache/mozilla/firefox"),
        ]
    } else {
        Vec::new()
    }
}

fn app_updater_cache_dirs(home: &Path) -> Vec<PathBuf> {
    if !cfg!(target_os = "macos") {
        return Vec::new();
    }
    let caches_dir = home.join("Library/Caches");
    let Ok(rd) = fs::read_dir(&caches_dir) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if name.ends_with("-updater") {
            let path = entry.path();
            if let Ok(meta) = fs::symlink_metadata(&path) {
                if !meta.file_type().is_symlink() && meta.is_dir() {
                    found.push(path);
                }
            }
        }
    }
    found
}

fn clear_directory_contents(dir: &Path) -> Result<(), String> {
    let meta = match fs::symlink_metadata(dir) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("Klasör bilgisi alınamadı ({}): {e}", dir.display())),
    };
    if meta.file_type().is_symlink() {
        return Err(format!("Güvenlik hatası: Symlink dizin temizlenemez ({})", dir.display()));
    }
    if !meta.is_dir() {
        return Err(format!("Hedef bir klasör değil ({})", dir.display()));
    }

    let rd = fs::read_dir(dir).map_err(|e| format!("Klasör okunamadı ({}): {e}", dir.display()))?;
    let mut errors: Vec<String> = Vec::new();
    for entry_res in rd {
        let entry = match entry_res {
            Ok(e) => e,
            Err(e) => {
                errors.push(format!("girdi okunamadı: {e}"));
                continue;
            }
        };
        let p = entry.path();
        let entry_meta = match fs::symlink_metadata(&p) {
            Ok(m) => m,
            Err(e) => {
                errors.push(format!("{}: {e}", p.display()));
                continue;
            }
        };
        let remove_res = if entry_meta.file_type().is_symlink() || !entry_meta.is_dir() {
            fs::remove_file(&p)
        } else {
            fs::remove_dir_all(&p)
        };
        if let Err(e) = remove_res {
            errors.push(format!("{}: {e}", p.display()));
        }
    }
    if !errors.is_empty() {
        return Err(format!(
            "Bazı öğeler silinemedi ({}): {}",
            dir.display(),
            errors.join("; ")
        ));
    }
    Ok(())
}

pub fn scan_system_cleaner() -> Result<CleanerScanReport, String> {
    let home = dirs::home_dir().ok_or_else(|| "Ev dizini bulunamadı.".to_string())?;
    let mut items: Vec<CleanerItem> = Vec::new();

    // 1. Docker (cross-platform)
    let docker = inspect_docker_df();
    if docker.available {
        if docker.build_cache_bytes > 0 {
            items.push(CleanerItem {
                id: "docker_build_cache".to_string(),
                title: "Docker Build Cache".to_string(),
                subtitle: format!("{} derleme katmanı önbelleği", docker.build_cache_count),
                category: "docker".to_string(),
                risk: "safe".to_string(),
                size_bytes: docker.build_cache_bytes,
                default_selected: true,
                path_hint: Some("docker builder prune -a -f".to_string()),
                note: Some("Veri kaybı olmaz; sonraki Docker build işlemi yalnızca gerekli katmanları indirir.".to_string()),
            });
        }
        if docker.images_reclaimable_bytes > 0 {
            let unused = docker
                .images_total_count
                .saturating_sub(docker.images_active_count);
            items.push(CleanerItem {
                id: "docker_unused_images".to_string(),
                title: "Kullanılmayan Docker İmajları".to_string(),
                subtitle: format!(
                    "{} kullanılmayan / {} toplam imaj",
                    unused, docker.images_total_count
                ),
                category: "docker".to_string(),
                risk: "review".to_string(),
                size_bytes: docker.images_reclaimable_bytes,
                default_selected: false,
                path_hint: Some("docker image prune -a -f".to_string()),
                note: Some("Çalışan konteynerlerin imajlarına dokunmaz; durmuş projelerin imajlarını kaldırır (yeniden indirme gerektirebilir).".to_string()),
            });
        }
        if docker.containers_stopped_count > 0 {
            items.push(CleanerItem {
                id: "docker_stopped_containers".to_string(),
                title: "Durmuş Docker Konteynerleri".to_string(),
                subtitle: format!("{} durmuş konteyner", docker.containers_stopped_count),
                category: "docker".to_string(),
                risk: "review".to_string(),
                size_bytes: docker.containers_reclaimable_bytes.max(1024),
                default_selected: false,
                path_hint: Some("docker container prune -f".to_string()),
                note: Some("Çalışmayan (exited) konteynerleri kaldırır; durdurulmuş proje ortamlarını kontrol ederek seçin.".to_string()),
            });
        }
        if docker.volumes_reclaimable_bytes > 0 {
            items.push(CleanerItem {
                id: "docker_unused_volumes".to_string(),
                title: "Kullanılmayan Docker Volume'leri".to_string(),
                subtitle: format!(
                    "{} bağlı olmayan volume (yalnızca dangling anonim volume'ler temizlenir)",
                    docker.volumes_unused_count
                ),
                category: "docker".to_string(),
                risk: "review".to_string(),
                size_bytes: docker.volumes_reclaimable_bytes,
                default_selected: false,
                path_hint: Some("docker volume prune -f".to_string()),
                note: Some("Yalnızca sahipsiz (dangling) anonim volume'leri temizler; adlandırılmış volume'ler korunur. Durmuş konteyner temizliği ile aynı anda çalıştırılamaz.".to_string()),
            });
        }
    }

    // 2. pnpm Store
    let pnpm_paths = pnpm_store_paths(&home);
    let pnpm_bytes: u64 = pnpm_paths.iter().map(|p| measure_dir_fast(p)).sum();
    if pnpm_bytes > 10 * 1024 * 1024 {
        items.push(CleanerItem {
            id: "pnpm_store".to_string(),
            title: "pnpm Paket Deposu (Store Prune)".to_string(),
            subtitle: "Artık hiçbir projenin kullanmadığı pnpm paket önbellekleri".to_string(),
            category: "package_managers".to_string(),
            risk: "safe".to_string(),
            size_bytes: pnpm_bytes,
            default_selected: true,
            path_hint: pnpm_paths.first().map(|p| p.to_string_lossy().to_string()),
            note: Some("Aktif projelerdeki node_modules'a dokunmaz, yalnızca sahipsiz paketleri temizler.".to_string()),
        });
    }

    // 3. npm Cache
    let npm_dir = home.join(".npm/_cacache");
    let npm_bytes = measure_dir_fast(&npm_dir);
    if npm_bytes > 10 * 1024 * 1024 {
        items.push(CleanerItem {
            id: "npm_cache".to_string(),
            title: "npm Paket Önbelleği".to_string(),
            subtitle: "İndirilmiş npm arşiv önbelleği".to_string(),
            category: "package_managers".to_string(),
            risk: "safe".to_string(),
            size_bytes: npm_bytes,
            default_selected: true,
            path_hint: Some(npm_dir.to_string_lossy().to_string()),
            note: Some("Tamamen güvenlidir; gerektiğinde otomatik yeniden indirilir.".to_string()),
        });
    }

    // 4. pip & uv Caches
    let pip_dir = pip_cache_path(&home);
    let pip_bytes = measure_dir_fast(&pip_dir);
    if pip_bytes > 10 * 1024 * 1024 {
        items.push(CleanerItem {
            id: "pip_cache".to_string(),
            title: "Python pip Önbelleği".to_string(),
            subtitle: "İndirilmiş Python wheel/tar.gz paket önbelleği".to_string(),
            category: "package_managers".to_string(),
            risk: "safe".to_string(),
            size_bytes: pip_bytes,
            default_selected: true,
            path_hint: Some(pip_dir.to_string_lossy().to_string()),
            note: Some("Kurulu sanal ortamları (.venv) etkilemez.".to_string()),
        });
    }

    let uv_dir = home.join(".cache/uv");
    let uv_bytes = measure_dir_fast(&uv_dir);
    if uv_bytes > 10 * 1024 * 1024 {
        items.push(CleanerItem {
            id: "uv_cache".to_string(),
            title: "Python uv Önbelleği".to_string(),
            subtitle: "uv paket önbellek havuzu".to_string(),
            category: "package_managers".to_string(),
            risk: "safe".to_string(),
            size_bytes: uv_bytes,
            default_selected: true,
            path_hint: Some(uv_dir.to_string_lossy().to_string()),
            note: Some("Tamamen güvenlidir; uv cache clean ile temizlenir.".to_string()),
        });
    }

    // 5. macOS Homebrew Cache
    if cfg!(target_os = "macos") {
        let brew_dir = home.join("Library/Caches/Homebrew");
        let brew_bytes = measure_dir_fast(&brew_dir);
        if brew_bytes > 10 * 1024 * 1024 {
            items.push(CleanerItem {
                id: "homebrew_cache".to_string(),
                title: "Homebrew Kurulum Önbelleği".to_string(),
                subtitle: "Eski brew indirilen kurulum paketleri".to_string(),
                category: "package_managers".to_string(),
                risk: "safe".to_string(),
                size_bytes: brew_bytes,
                default_selected: true,
                path_hint: Some(brew_dir.to_string_lossy().to_string()),
                note: Some("Kurulu brew araçlarına dokunmaz, yalnızca eski indirme dosyalarını siler.".to_string()),
            });
        }

        // 6. Xcode DerivedData
        let derived_dir = home.join("Library/Developer/Xcode/DerivedData");
        let derived_bytes = measure_dir_fast(&derived_dir);
        if derived_bytes > 20 * 1024 * 1024 {
            items.push(CleanerItem {
                id: "xcode_derived_data".to_string(),
                title: "Xcode DerivedData".to_string(),
                subtitle: "Eski derleme ve indeks artıkları".to_string(),
                category: "dev_tools".to_string(),
                risk: "safe".to_string(),
                size_bytes: derived_bytes,
                default_selected: true,
                path_hint: Some(derived_dir.to_string_lossy().to_string()),
                note: Some("Xcode projeyi açınca otomatik yeniden oluşturur.".to_string()),
            });
        }

        // 7. Old App Updater Caches
        let updater_dirs = app_updater_cache_dirs(&home);
        let updater_bytes: u64 = updater_dirs.iter().map(|p| measure_dir_fast(p)).sum();
        if updater_bytes > 10 * 1024 * 1024 {
            items.push(CleanerItem {
                id: "app_updaters_cache".to_string(),
                title: "Eski Uygulama Güncelleyici Kalıntıları".to_string(),
                subtitle: format!("{} adet *-updater önbellek klasörü", updater_dirs.len()),
                category: "system_caches".to_string(),
                risk: "safe".to_string(),
                size_bytes: updater_bytes,
                default_selected: true,
                path_hint: Some(home.join("Library/Caches").to_string_lossy().to_string()),
                note: Some("Kurulumu tamamlanmış eski DMG/ZIP güncelleme önbellekleridir.".to_string()),
            });
        }
    }

    // 8. Playwright Browser Binaries (Review)
    let pw_dir = playwright_cache_path(&home);
    let pw_bytes = measure_dir_fast(&pw_dir);
    if pw_bytes > 50 * 1024 * 1024 {
        items.push(CleanerItem {
            id: "ms_playwright_cache".to_string(),
            title: "Playwright Test Tarayıcıları".to_string(),
            subtitle: "Chromium/WebKit/Firefox test motoru kopyaları".to_string(),
            category: "dev_tools".to_string(),
            risk: "review".to_string(),
            size_bytes: pw_bytes,
            default_selected: false,
            path_hint: Some(pw_dir.to_string_lossy().to_string()),
            note: Some("E2E test çalıştırmıyorsanız güvenle silebilirsiniz; gerektiğinde npx playwright install ile geri gelir.".to_string()),
        });
    }

    // 9. Browser HTTP Caches (Review)
    let b_paths = browser_cache_paths(&home);
    let b_bytes: u64 = b_paths.iter().map(|p| measure_dir_fast(p)).sum();
    if b_bytes > 50 * 1024 * 1024 {
        items.push(CleanerItem {
            id: "browser_caches".to_string(),
            title: "Tarayıcı Önbellekleri (Chrome & Firefox)".to_string(),
            subtitle: "Yalnızca geçici sayfa/görsel önbelleği (şifre & sekmeler korunur)".to_string(),
            category: "browsers".to_string(),
            risk: "review".to_string(),
            size_bytes: b_bytes,
            default_selected: false,
            path_hint: b_paths.first().map(|p| p.to_string_lossy().to_string()),
            note: Some("Yer imleri, şifreler ve oturumlar silinmez; yalnızca geçici önbellek temizlenir.".to_string()),
        });
    }

    items.sort_by(|a, b| {
        b.size_bytes
            .cmp(&a.size_bytes)
            .then_with(|| a.title.cmp(&b.title))
    });

    let safe_reclaimable_bytes: u64 = items
        .iter()
        .filter(|i| i.risk == "safe")
        .map(|i| i.size_bytes)
        .sum();
    let review_reclaimable_bytes: u64 = items
        .iter()
        .filter(|i| i.risk != "safe")
        .map(|i| i.size_bytes)
        .sum();
    let total_reclaimable_bytes = safe_reclaimable_bytes.saturating_add(review_reclaimable_bytes);

    let report = CleanerScanReport {
        scanned_at: chrono::Utc::now().to_rfc3339(),
        total_reclaimable_bytes,
        safe_reclaimable_bytes,
        review_reclaimable_bytes,
        docker_available: docker.available,
        items,
    };

    save_cached_cleaner_scan(&report);
    Ok(report)
}

pub fn run_system_cleaner(item_ids: &[String]) -> Result<CleanerRunReport, String> {
    if item_ids.is_empty() {
        return Err("Temizlenecek en az bir kalem seçin.".to_string());
    }

    let home = dirs::home_dir().ok_or_else(|| "Ev dizini bulunamadı.".to_string())?;
    let mut results = Vec::new();
    let mut total_freed_bytes = 0u64;
    let mut succeeded = 0usize;
    let mut failed = 0usize;
    let mut needs_docker_restart = false;

    let has_stopped_containers = item_ids
        .iter()
        .any(|raw| raw.trim() == "docker_stopped_containers");

    for raw_id in item_ids {
        let id = raw_id.trim();
        let res = match id {
            "docker_build_cache" => {
                let before = inspect_docker_df().build_cache_bytes;
                match run_cli("docker", &["builder", "prune", "-a", "-f"]) {
                    Ok(_) => {
                        let after = inspect_docker_df().build_cache_bytes;
                        let freed = before.saturating_sub(after);
                        needs_docker_restart = true;
                        CleanerRunItemResult {
                            id: id.to_string(),
                            title: "Docker Build Cache".to_string(),
                            ok: true,
                            freed_bytes: freed,
                            message: "Docker derleme önbelleği temizlendi.".to_string(),
                        }
                    }
                    Err(e) => CleanerRunItemResult {
                        id: id.to_string(),
                        title: "Docker Build Cache".to_string(),
                        ok: false,
                        freed_bytes: 0,
                        message: e,
                    },
                }
            }
            "docker_unused_images" => {
                let before = inspect_docker_df().images_reclaimable_bytes;
                match run_cli("docker", &["image", "prune", "-a", "-f"]) {
                    Ok(_) => {
                        let after = inspect_docker_df().images_reclaimable_bytes;
                        let freed = before.saturating_sub(after);
                        needs_docker_restart = true;
                        CleanerRunItemResult {
                            id: id.to_string(),
                            title: "Kullanılmayan Docker İmajları".to_string(),
                            ok: true,
                            freed_bytes: freed,
                            message: "Kullanılmayan Docker imajları kaldırıldı.".to_string(),
                        }
                    }
                    Err(e) => CleanerRunItemResult {
                        id: id.to_string(),
                        title: "Kullanılmayan Docker İmajları".to_string(),
                        ok: false,
                        freed_bytes: 0,
                        message: e,
                    },
                }
            }
            "docker_stopped_containers" => {
                let before = inspect_docker_df().containers_reclaimable_bytes;
                match run_cli("docker", &["container", "prune", "-f"]) {
                    Ok(_) => {
                        let after = inspect_docker_df().containers_reclaimable_bytes;
                        let freed = before.saturating_sub(after);
                        needs_docker_restart = true;
                        CleanerRunItemResult {
                            id: id.to_string(),
                            title: "Durmuş Docker Konteynerleri".to_string(),
                            ok: true,
                            freed_bytes: freed,
                            message: "Durmuş konteynerler temizlendi.".to_string(),
                        }
                    }
                    Err(e) => CleanerRunItemResult {
                        id: id.to_string(),
                        title: "Durmuş Docker Konteynerleri".to_string(),
                        ok: false,
                        freed_bytes: 0,
                        message: e,
                    },
                }
            }
            "docker_unused_volumes" => {
                if has_stopped_containers {
                    CleanerRunItemResult {
                        id: id.to_string(),
                        title: "Kullanılmayan Docker Volume'leri".to_string(),
                        ok: false,
                        freed_bytes: 0,
                        message: "Güvenlik kilidi: Durmuş konteyner temizliği ile volume temizliği aynı anda çalıştırılamaz".to_string(),
                    }
                } else {
                    let before = inspect_docker_df().volumes_reclaimable_bytes;
                    match run_cli("docker", &["volume", "prune", "-f"]) {
                        Ok(_) => {
                            let after = inspect_docker_df().volumes_reclaimable_bytes;
                            let freed = before.saturating_sub(after);
                            needs_docker_restart = true;
                            CleanerRunItemResult {
                                id: id.to_string(),
                                title: "Kullanılmayan Docker Volume'leri".to_string(),
                                ok: true,
                                freed_bytes: freed,
                                message: "Sahipsiz (dangling) anonim Docker volume'leri temizlendi.".to_string(),
                            }
                        }
                        Err(e) => CleanerRunItemResult {
                            id: id.to_string(),
                            title: "Kullanılmayan Docker Volume'leri".to_string(),
                            ok: false,
                            freed_bytes: 0,
                            message: e,
                        },
                    }
                }
            }
            "pnpm_store" => {
                let paths = pnpm_store_paths(&home);
                let before: u64 = paths.iter().map(|p| measure_dir_fast(p)).sum();
                let cli_res = run_cli("pnpm", &["store", "prune"]);
                // Ayrıca Library/Caches/pnpm önbelleğini temizle
                if cfg!(target_os = "macos") {
                    let _ = clear_directory_contents(&home.join("Library/Caches/pnpm"));
                }
                let after: u64 = paths.iter().map(|p| measure_dir_fast(p)).sum();
                let freed = before.saturating_sub(after);
                match cli_res {
                    Ok(_) => CleanerRunItemResult {
                        id: id.to_string(),
                        title: "pnpm Paket Deposu".to_string(),
                        ok: true,
                        freed_bytes: freed,
                        message: "pnpm store prune tamamlandı.".to_string(),
                    },
                    Err(e) => CleanerRunItemResult {
                        id: id.to_string(),
                        title: "pnpm Paket Deposu".to_string(),
                        ok: freed > 0,
                        freed_bytes: freed,
                        message: if freed > 0 {
                            "pnpm önbellek dizini temizlendi.".to_string()
                        } else {
                            e
                        },
                    },
                }
            }
            "npm_cache" => {
                let dir = home.join(".npm/_cacache");
                let before = measure_dir_fast(&dir);
                let res = run_cli("npm", &["cache", "clean", "--force"])
                    .or_else(|_| clear_directory_contents(&dir).map(|_| String::new()));
                let after = measure_dir_fast(&dir);
                let freed = before.saturating_sub(after);
                CleanerRunItemResult {
                    id: id.to_string(),
                    title: "npm Paket Önbelleği".to_string(),
                    ok: res.is_ok(),
                    freed_bytes: freed,
                    message: res
                        .map(|_| "npm önbelleği temizlendi.".to_string())
                        .unwrap_or_else(|e| e),
                }
            }
            "pip_cache" => {
                let dir = pip_cache_path(&home);
                let before = measure_dir_fast(&dir);
                let res = clear_directory_contents(&dir);
                let after = measure_dir_fast(&dir);
                let freed = before.saturating_sub(after);
                CleanerRunItemResult {
                    id: id.to_string(),
                    title: "Python pip Önbelleği".to_string(),
                    ok: res.is_ok(),
                    freed_bytes: freed,
                    message: res
                        .map(|_| "pip önbelleği temizlendi.".to_string())
                        .unwrap_or_else(|e| e),
                }
            }
            "uv_cache" => {
                let dir = home.join(".cache/uv");
                let before = measure_dir_fast(&dir);
                let res = run_cli("uv", &["cache", "clean"])
                    .or_else(|_| clear_directory_contents(&dir).map(|_| String::new()));
                let after = measure_dir_fast(&dir);
                let freed = before.saturating_sub(after);
                CleanerRunItemResult {
                    id: id.to_string(),
                    title: "Python uv Önbelleği".to_string(),
                    ok: res.is_ok(),
                    freed_bytes: freed,
                    message: res
                        .map(|_| "uv önbelleği temizlendi.".to_string())
                        .unwrap_or_else(|e| e),
                }
            }
            "homebrew_cache" => {
                let dir = home.join("Library/Caches/Homebrew");
                let before = measure_dir_fast(&dir);
                let res = run_cli("brew", &["cleanup", "-s"])
                    .or_else(|_| clear_directory_contents(&dir).map(|_| String::new()));
                let after = measure_dir_fast(&dir);
                let freed = before.saturating_sub(after);
                CleanerRunItemResult {
                    id: id.to_string(),
                    title: "Homebrew Kurulum Önbelleği".to_string(),
                    ok: res.is_ok(),
                    freed_bytes: freed,
                    message: res
                        .map(|_| "Homebrew önbelleği temizlendi.".to_string())
                        .unwrap_or_else(|e| e),
                }
            }
            "xcode_derived_data" => {
                let dir = home.join("Library/Developer/Xcode/DerivedData");
                let before = measure_dir_fast(&dir);
                let res = clear_directory_contents(&dir);
                let after = measure_dir_fast(&dir);
                let freed = before.saturating_sub(after);
                CleanerRunItemResult {
                    id: id.to_string(),
                    title: "Xcode DerivedData".to_string(),
                    ok: res.is_ok(),
                    freed_bytes: freed,
                    message: res
                        .map(|_| "Xcode DerivedData temizlendi.".to_string())
                        .unwrap_or_else(|e| e),
                }
            }
            "app_updaters_cache" => {
                let dirs = app_updater_cache_dirs(&home);
                let before: u64 = dirs.iter().map(|p| measure_dir_fast(p)).sum();
                let mut errors: Vec<String> = Vec::new();
                for d in &dirs {
                    if let Err(e) = clear_directory_contents(d) {
                        errors.push(e);
                    }
                }
                let after: u64 = dirs.iter().map(|p| measure_dir_fast(p)).sum();
                let freed = before.saturating_sub(after);
                let ok = errors.is_empty();
                CleanerRunItemResult {
                    id: id.to_string(),
                    title: "Eski Uygulama Güncelleyici Kalıntıları".to_string(),
                    ok,
                    freed_bytes: freed,
                    message: if ok {
                        format!("{} güncelleyici önbelleği temizlendi.", dirs.len())
                    } else {
                        errors.join(" | ")
                    },
                }
            }
            "ms_playwright_cache" => {
                let dir = playwright_cache_path(&home);
                let before = measure_dir_fast(&dir);
                let res = clear_directory_contents(&dir);
                let after = measure_dir_fast(&dir);
                let freed = before.saturating_sub(after);
                CleanerRunItemResult {
                    id: id.to_string(),
                    title: "Playwright Test Tarayıcıları".to_string(),
                    ok: res.is_ok(),
                    freed_bytes: freed,
                    message: res
                        .map(|_| "Playwright tarayıcı önbelleği temizlendi.".to_string())
                        .unwrap_or_else(|e| e),
                }
            }
            "browser_caches" => {
                let paths = browser_cache_paths(&home);
                let before: u64 = paths.iter().map(|p| measure_dir_fast(p)).sum();
                let mut errors: Vec<String> = Vec::new();
                for d in &paths {
                    if let Err(e) = clear_directory_contents(d) {
                        errors.push(e);
                    }
                }
                let after: u64 = paths.iter().map(|p| measure_dir_fast(p)).sum();
                let freed = before.saturating_sub(after);
                let ok = errors.is_empty();
                CleanerRunItemResult {
                    id: id.to_string(),
                    title: "Tarayıcı Önbellekleri".to_string(),
                    ok,
                    freed_bytes: freed,
                    message: if ok {
                        "Tarayıcı geçici önbellekleri temizlendi.".to_string()
                    } else {
                        errors.join(" | ")
                    },
                }
            }
            unknown => CleanerRunItemResult {
                id: unknown.to_string(),
                title: unknown.to_string(),
                ok: false,
                freed_bytes: 0,
                message: "Bilinmeyen veya izin verilmeyen temizlik kalemi.".to_string(),
            },
        };

        if res.ok {
            succeeded += 1;
            total_freed_bytes = total_freed_bytes.saturating_add(res.freed_bytes);
        } else {
            failed += 1;
        }
        results.push(res);
    }

    invalidate_cleaner_cache();
    crate::disk_analyzer::invalidate_all_disk_caches();

    Ok(CleanerRunReport {
        total_freed_bytes,
        succeeded,
        failed,
        needs_docker_restart: cfg!(target_os = "macos") && needs_docker_restart,
        results,
    })
}

#[cfg(target_os = "macos")]
pub fn restart_docker_desktop() -> Result<(), String> {
    let _ = Command::new("osascript")
        .args(["-e", r#"quit app "Docker Desktop""#])
        .status();
    std::thread::sleep(std::time::Duration::from_secs(2));
    let status = Command::new("open")
        .args(["-a", "Docker Desktop"])
        .status()
        .map_err(|e| format!("Docker Desktop yeniden başlatılamadı: {e}"))?;
    if !status.success() {
        return Err("Docker Desktop başlatılamadı.".to_string());
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn restart_docker_desktop() -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_docker_size_bytes_handles_units_and_percentages() {
        assert_eq!(parse_docker_size_bytes("0B"), 0);
        assert_eq!(parse_docker_size_bytes("1kB"), 1024);
        assert_eq!(
            parse_docker_size_bytes("135.7GB (82%)"),
            (135.7_f64 * 1024.0 * 1024.0 * 1024.0).round() as u64
        );
        assert_eq!(
            parse_docker_size_bytes("884.7kB (100%)"),
            (884.7_f64 * 1024.0).round() as u64
        );
    }

    #[test]
    fn parse_docker_df_json_lines_parses_all_four_rows() {
        let sample = r#"
{"Active":"17","Reclaimable":"135.7GB (82%)","Size":"165.1GB","TotalCount":"134","Type":"Images"}
{"Active":"0","Reclaimable":"884.7kB (100%)","Size":"884.7kB","TotalCount":"44","Type":"Containers"}
{"Active":"33","Reclaimable":"193.4GB (95%)","Size":"202.2GB","TotalCount":"1203","Type":"Local Volumes"}
{"Active":"0","Reclaimable":"20.77GB","Size":"203.3GB","TotalCount":"1426","Type":"Build Cache"}
"#;
        let parsed = parse_docker_df_json_lines(sample);
        assert!(parsed.available);
        assert_eq!(parsed.images_total_count, 134);
        assert_eq!(parsed.images_active_count, 17);
        assert_eq!(parsed.containers_stopped_count, 44);
        assert_eq!(parsed.volumes_unused_count, 1170);
        assert!(parsed.build_cache_bytes > 200 * 1024 * 1024 * 1024);
        assert!(parsed.volumes_reclaimable_bytes > 190 * 1024 * 1024 * 1024);
    }

    #[test]
    fn run_system_cleaner_rejects_empty_and_unknown_ids() {
        assert!(run_system_cleaner(&[]).is_err());
        let rep = run_system_cleaner(&["rm_rf_root".to_string()]).expect("returns structured report");
        assert_eq!(rep.succeeded, 0);
        assert_eq!(rep.failed, 1);
        assert!(!rep.results[0].ok);
    }

    #[test]
    fn clear_directory_contents_rejects_symlinks_and_cache_uses_affexdesk_dir() {
        if let Some(p) = cleaner_cache_file_path() {
            assert!(p.to_string_lossy().contains("AffeXDesk"));
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            use std::time::{SystemTime, UNIX_EPOCH};

            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let base = std::env::temp_dir().join(format!("affexdesk_cleaner_sym_{nanos}"));
            let real_dir = base.join("real");
            let link_dir = base.join("link-updater");
            fs::create_dir_all(&real_dir).unwrap();
            fs::write(real_dir.join("keep.txt"), b"keep").unwrap();
            symlink(&real_dir, &link_dir).unwrap();

            let err = clear_directory_contents(&link_dir).expect_err("symlink dir must be rejected");
            assert!(err.contains("Symlink"));
            assert!(real_dir.join("keep.txt").exists());

            let _ = fs::remove_dir_all(&base);
        }
    }
}
