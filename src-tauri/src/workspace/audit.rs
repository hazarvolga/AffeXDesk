use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Component, Path};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectCommitItem {
    pub hash: String,
    pub date_rel: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevOpsRuleResult {
    pub id: String,
    pub category: String, // "git" | "security" | "deploy" | "docs" | "quality"
    pub title: String,
    pub status: String, // "pass" | "warn" | "fail"
    pub detail: String,
    pub fix_action: Option<String>,
    #[serde(default)]
    pub is_custom: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomDevOpsRule {
    pub id: String,
    pub title: String,
    pub category: String,   // "git" | "security" | "deploy" | "docs" | "quality"
    pub check_type: String, // "file_exists" | "file_contains" | "file_absent"
    pub target_path: String,
    pub pattern: Option<String>,
    pub severity: String,   // "warn" | "fail"
    pub weight: u32,        // 1..=20
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DevOpsRulesConfig {
    #[serde(default)]
    pub disabled_builtin_ids: Vec<String>,
    #[serde(default)]
    pub custom_rules: Vec<CustomDevOpsRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectAuditReport {
    pub project_path: String,
    pub project_name: String,
    pub score: u8,
    pub grade: String,
    pub passed_count: usize,
    pub warn_count: usize,
    pub fail_count: usize,
    pub git_remote_provider: Option<String>,
    pub git_remote_url: Option<String>,
    pub git_branch: Option<String>,
    pub deploy_targets: Vec<String>,
    pub recent_commits: Vec<ProjectCommitItem>,
    pub dirty_files: Vec<String>,
    pub rules: Vec<DevOpsRuleResult>,
}

fn run_git(dir: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

fn sanitize_remote_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(scheme_idx) = trimmed.find("://") {
        let scheme = &trimmed[..scheme_idx + 3];
        let rest = &trimmed[scheme_idx + 3..];
        if let Some(at_idx) = rest.find('@') {
            return format!("{scheme}{}", &rest[at_idx + 1..]);
        }
    }
    trimmed.to_string()
}

fn detect_remote_provider(url: &str) -> String {
    let lower = url.to_ascii_lowercase();
    if lower.contains("github.com") {
        "GitHub".to_string()
    } else if lower.contains("gitlab.com") || lower.contains("gitlab") {
        "GitLab".to_string()
    } else if lower.contains("bitbucket.org") {
        "Bitbucket".to_string()
    } else {
        "Git Remote".to_string()
    }
}

fn has_github_workflows(dir: &Path) -> bool {
    let wf = dir.join(".github").join("workflows");
    let Ok(rd) = fs::read_dir(wf) else {
        return false;
    };
    rd.flatten().any(|e| {
        let n = e.file_name().to_string_lossy().to_ascii_lowercase();
        n.ends_with(".yml") || n.ends_with(".yaml")
    })
}

fn gitignore_covers_env(content: &str) -> bool {
    content.lines().any(|line| {
        let t = line.trim();
        !t.starts_with('#') && (t == ".env" || t == ".env*" || t == ".env.*" || t == "*.env")
    })
}

fn is_safe_relative_path(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return false;
    }
    let p = Path::new(trimmed);
    if p.is_absolute() {
        return false;
    }
    for comp in p.components() {
        if matches!(comp, Component::ParentDir | Component::RootDir | Component::Prefix(_)) {
            return false;
        }
    }
    true
}

pub fn audit_project(project_path: &str) -> Result<ProjectAuditReport, String> {
    audit_project_with_config(project_path, &DevOpsRulesConfig::default())
}

pub fn audit_project_with_config(
    project_path: &str,
    config: &DevOpsRulesConfig,
) -> Result<ProjectAuditReport, String> {
    let dir = Path::new(project_path.trim());
    if !dir.exists() || !dir.is_dir() {
        return Err(format!("Proje klasörü bulunamadı: {}", dir.display()));
    }

    let is_enabled = |id: &str| !config.disabled_builtin_ids.iter().any(|x| x == id);

    let project_name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Proje")
        .to_string();

    let has_git = dir.join(".git").exists();
    let git_branch = if has_git {
        run_git(dir, &["rev-parse", "--abbrev-ref", "HEAD"])
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    } else {
        None
    };

    let git_remote_url = if has_git {
        run_git(dir, &["remote", "get-url", "origin"])
            .map(|s| sanitize_remote_url(&s))
            .filter(|s| !s.is_empty())
    } else {
        None
    };
    let git_remote_provider = git_remote_url.as_deref().map(detect_remote_provider);

    let dirty_files: Vec<String> = if has_git {
        run_git(dir, &["status", "--short"])
            .map(|s| {
                s.lines()
                    .map(str::trim_end)
                    .filter(|l| !l.is_empty())
                    .take(25)
                    .map(ToString::to_string)
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let recent_commits: Vec<ProjectCommitItem> = if has_git {
        run_git(dir, &["log", "-5", "--pretty=format:%h\t%cr\t%s"])
            .map(|s| {
                s.lines()
                    .filter_map(|line| {
                        let mut parts = line.splitn(3, '\t');
                        let hash = parts.next()?.trim().to_string();
                        let date_rel = parts.next()?.trim().to_string();
                        let message = parts.next()?.trim().to_string();
                        Some(ProjectCommitItem {
                            hash,
                            date_rel,
                            message,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let mut deploy_targets: Vec<String> = Vec::new();
    if let Some(ref prov) = git_remote_provider {
        deploy_targets.push(prov.clone());
    }
    if has_github_workflows(dir) {
        deploy_targets.push("GitHub Actions".to_string());
    }
    if dir.join(".gitlab-ci.yml").is_file() {
        deploy_targets.push("GitLab CI".to_string());
    }
    if dir.join("vercel.json").is_file() || dir.join(".vercel").is_dir() {
        deploy_targets.push("Vercel".to_string());
    }
    if dir.join("netlify.toml").is_file() {
        deploy_targets.push("Netlify".to_string());
    }
    if dir.join("Dockerfile").is_file() {
        deploy_targets.push("Docker".to_string());
    }
    if dir.join("docker-compose.yml").is_file() || dir.join("compose.yml").is_file() {
        deploy_targets.push("Docker Compose".to_string());
    }
    if dir.join("src-tauri").join("tauri.conf.json").is_file() {
        deploy_targets.push("Tauri Desktop".to_string());
    }

    let mut rules: Vec<DevOpsRuleResult> = Vec::new();
    let mut earned: u32 = 0;
    let mut total_weight: u32 = 0;

    // 1. Git initialized (10)
    if is_enabled("git_initialized") {
        total_weight += 10;
        if has_git {
            earned += 10;
            rules.push(DevOpsRuleResult {
                id: "git_initialized".into(),
                category: "git".into(),
                title: "Git Sürüm Kontrolü".into(),
                status: "pass".into(),
                detail: format!("Aktif dal: {}", git_branch.as_deref().unwrap_or("main")),
                fix_action: None,
                is_custom: false,
            });
        } else {
            rules.push(DevOpsRuleResult {
                id: "git_initialized".into(),
                category: "git".into(),
                title: "Git Sürüm Kontrolü".into(),
                status: "fail".into(),
                detail: "Bu klasörde .git deposu bulunamadı.".into(),
                fix_action: None,
                is_custom: false,
            });
        }
    }

    // 2. Git remote connected (10)
    if is_enabled("git_remote_linked") {
        total_weight += 10;
        if let Some(ref url) = git_remote_url {
            earned += 10;
            rules.push(DevOpsRuleResult {
                id: "git_remote_linked".into(),
                category: "git".into(),
                title: "Uzak Depo (GitHub / GitLab)".into(),
                status: "pass".into(),
                detail: format!("Bağlı: {url}"),
                fix_action: None,
                is_custom: false,
            });
        } else {
            rules.push(DevOpsRuleResult {
                id: "git_remote_linked".into(),
                category: "git".into(),
                title: "Uzak Depo (GitHub / GitLab)".into(),
                status: "warn".into(),
                detail: "origin uzak deposu bağlı değil; kod yalnızca yerelde duruyor.".into(),
                fix_action: None,
                is_custom: false,
            });
        }
    }

    // 3. Working tree clean (8)
    if is_enabled("git_working_tree_clean") {
        total_weight += 8;
        if has_git && dirty_files.is_empty() {
            earned += 8;
            rules.push(DevOpsRuleResult {
                id: "git_working_tree_clean".into(),
                category: "git".into(),
                title: "Temiz Çalışma Ağacı".into(),
                status: "pass".into(),
                detail: "Commit edilmemiş bekleyen değişiklik yok.".into(),
                fix_action: None,
                is_custom: false,
            });
        } else if has_git {
            earned += 3;
            rules.push(DevOpsRuleResult {
                id: "git_working_tree_clean".into(),
                category: "git".into(),
                title: "Temiz Çalışma Ağacı".into(),
                status: "warn".into(),
                detail: format!("{} adet commit edilmemiş dosya bekliyor.", dirty_files.len()),
                fix_action: None,
                is_custom: false,
            });
        } else {
            rules.push(DevOpsRuleResult {
                id: "git_working_tree_clean".into(),
                category: "git".into(),
                title: "Temiz Çalışma Ağacı".into(),
                status: "warn".into(),
                detail: "Git deposu olmadığı için durum kontrol edilemedi.".into(),
                fix_action: None,
                is_custom: false,
            });
        }
    }

    // 4. .gitignore present (10)
    let gitignore_path = dir.join(".gitignore");
    let gitignore_content = fs::read_to_string(&gitignore_path).ok();
    if is_enabled("gitignore_present") {
        total_weight += 10;
        if gitignore_content.is_some() {
            earned += 10;
            rules.push(DevOpsRuleResult {
                id: "gitignore_present".into(),
                category: "security".into(),
                title: ".gitignore Yapılandırması".into(),
                status: "pass".into(),
                detail: "Derleme artıkları ve geçici dosyalar hariç tutuluyor.".into(),
                fix_action: None,
                is_custom: false,
            });
        } else {
            rules.push(DevOpsRuleResult {
                id: "gitignore_present".into(),
                category: "security".into(),
                title: ".gitignore Yapılandırması".into(),
                status: "fail".into(),
                detail: ".gitignore dosyası yok; node_modules/target/.env sızabilir.".into(),
                fix_action: Some("create_gitignore".into()),
                is_custom: false,
            });
        }
    }

    // 5. .env security (12)
    if is_enabled("env_security") {
        total_weight += 12;
        let env_tracked = if has_git {
            run_git(dir, &["ls-files", ".env", ".env.local", ".env.production"])
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false)
        } else {
            false
        };
        let ignores_env = gitignore_content
            .as_deref()
            .map(gitignore_covers_env)
            .unwrap_or(false);

        if env_tracked {
            rules.push(DevOpsRuleResult {
                id: "env_security".into(),
                category: "security".into(),
                title: ".env Gizlilik Koruması".into(),
                status: "fail".into(),
                detail: "KRİTİK: .env dosyası Git tarafından izleniyor! Sırlar repoya sızabilir."
                    .into(),
                fix_action: None,
                is_custom: false,
            });
        } else if ignores_env {
            earned += 12;
            rules.push(DevOpsRuleResult {
                id: "env_security".into(),
                category: "security".into(),
                title: ".env Gizlilik Koruması".into(),
                status: "pass".into(),
                detail: ".env dosyaları .gitignore ile korunuyor ve Git'te izlenmiyor.".into(),
                fix_action: None,
                is_custom: false,
            });
        } else {
            earned += 6;
            rules.push(DevOpsRuleResult {
                id: "env_security".into(),
                category: "security".into(),
                title: ".env Gizlilik Koruması".into(),
                status: "warn".into(),
                detail: ".gitignore içinde açık .env kuralı görünmüyor.".into(),
                fix_action: if gitignore_content.is_none() {
                    Some("create_gitignore".into())
                } else {
                    None
                },
                is_custom: false,
            });
        }
    }

    // 6. .env.example template (6)
    if is_enabled("env_example_present") {
        total_weight += 6;
        let has_env_file = dir.join(".env").is_file() || dir.join(".env.local").is_file();
        let has_env_example =
            dir.join(".env.example").is_file() || dir.join(".env.sample").is_file();
        if has_env_example || !has_env_file {
            earned += 6;
            rules.push(DevOpsRuleResult {
                id: "env_example_present".into(),
                category: "security".into(),
                title: ".env.example Şablonu".into(),
                status: "pass".into(),
                detail: if has_env_example {
                    "Ortam değişkeni şablonu (.env.example) hazır.".into()
                } else {
                    "Projede .env bağımlılığı görünmüyor.".into()
                },
                fix_action: None,
                is_custom: false,
            });
        } else {
            rules.push(DevOpsRuleResult {
                id: "env_example_present".into(),
                category: "security".into(),
                title: ".env.example Şablonu".into(),
                status: "warn".into(),
                detail: ".env mevcut ancak ekip/açık kaynak için .env.example şablonu eksik."
                    .into(),
                fix_action: Some("create_env_example".into()),
                is_custom: false,
            });
        }
    }

    // 7. CI/CD pipeline (10)
    if is_enabled("ci_pipeline_present") {
        total_weight += 10;
        let has_ci = has_github_workflows(dir) || dir.join(".gitlab-ci.yml").is_file();
        if has_ci {
            earned += 10;
            rules.push(DevOpsRuleResult {
                id: "ci_pipeline_present".into(),
                category: "deploy".into(),
                title: "CI/CD Otomasyon Hattı".into(),
                status: "pass".into(),
                detail: "GitHub Actions veya GitLab CI iş akışı tanımlı.".into(),
                fix_action: None,
                is_custom: false,
            });
        } else {
            rules.push(DevOpsRuleResult {
                id: "ci_pipeline_present".into(),
                category: "deploy".into(),
                title: "CI/CD Otomasyon Hattı".into(),
                status: "warn".into(),
                detail: "Otomatik test/build hattı (.github/workflows) bulunamadı.".into(),
                fix_action: Some("create_github_ci".into()),
                is_custom: false,
            });
        }
    }

    // 8. Deployment / Container config (8)
    if is_enabled("deploy_config_present") {
        total_weight += 8;
        let has_deploy_cfg = dir.join("Dockerfile").is_file()
            || dir.join("docker-compose.yml").is_file()
            || dir.join("compose.yml").is_file()
            || dir.join("vercel.json").is_file()
            || dir.join("netlify.toml").is_file()
            || dir.join("src-tauri").join("tauri.conf.json").is_file();
        if has_deploy_cfg {
            earned += 8;
            rules.push(DevOpsRuleResult {
                id: "deploy_config_present".into(),
                category: "deploy".into(),
                title: "Dağıtım / Paketleme Yapılandırması".into(),
                status: "pass".into(),
                detail: "Docker, Vercel, Netlify veya Tauri dağıtım dosyası algılandı.".into(),
                fix_action: None,
                is_custom: false,
            });
        } else {
            earned += 3;
            rules.push(DevOpsRuleResult {
                id: "deploy_config_present".into(),
                category: "deploy".into(),
                title: "Dağıtım / Paketleme Yapılandırması".into(),
                status: "warn".into(),
                detail: "Dockerfile / vercel.json / tauri.conf.json algılanmadı.".into(),
                fix_action: None,
                is_custom: false,
            });
        }
    }

    // 9. README.md (8)
    if is_enabled("readme_present") {
        total_weight += 8;
        let has_readme = dir.join("README.md").is_file() || dir.join("readme.md").is_file();
        if has_readme {
            earned += 8;
            rules.push(DevOpsRuleResult {
                id: "readme_present".into(),
                category: "docs".into(),
                title: "README Dokümantasyonu".into(),
                status: "pass".into(),
                detail: "README.md mevcut.".into(),
                fix_action: None,
                is_custom: false,
            });
        } else {
            rules.push(DevOpsRuleResult {
                id: "readme_present".into(),
                category: "docs".into(),
                title: "README Dokümantasyonu".into(),
                status: "fail".into(),
                detail: "README.md eksik; kurulum ve kullanım notu yok.".into(),
                fix_action: Some("create_readme".into()),
                is_custom: false,
            });
        }
    }

    // 10. LICENSE (6)
    if is_enabled("license_present") {
        total_weight += 6;
        let has_license = dir.join("LICENSE").is_file() || dir.join("LICENSE.md").is_file();
        if has_license {
            earned += 6;
            rules.push(DevOpsRuleResult {
                id: "license_present".into(),
                category: "docs".into(),
                title: "Lisans Dosyası".into(),
                status: "pass".into(),
                detail: "LICENSE dosyası tanımlı.".into(),
                fix_action: None,
                is_custom: false,
            });
        } else {
            rules.push(DevOpsRuleResult {
                id: "license_present".into(),
                category: "docs".into(),
                title: "Lisans Dosyası".into(),
                status: "warn".into(),
                detail: "LICENSE dosyası eksik (açık kaynak/müşteri teslimi için önerilir).".into(),
                fix_action: None,
                is_custom: false,
            });
        }
    }

    // 11. Handoff / Spec docs (4)
    if is_enabled("handoff_or_spec") {
        total_weight += 4;
        let has_spec = dir.join("HANDOFF.md").is_file()
            || dir.join("PRD.md").is_file()
            || dir.join("DESIGN.md").is_file()
            || dir.join("docs").is_dir();
        if has_spec {
            earned += 4;
            rules.push(DevOpsRuleResult {
                id: "handoff_or_spec".into(),
                category: "docs".into(),
                title: "Devir / Teknik Tasarım Notu".into(),
                status: "pass".into(),
                detail: "HANDOFF / PRD / docs klasörü mevcut.".into(),
                fix_action: None,
                is_custom: false,
            });
        } else {
            rules.push(DevOpsRuleResult {
                id: "handoff_or_spec".into(),
                category: "docs".into(),
                title: "Devir / Teknik Tasarım Notu".into(),
                status: "warn".into(),
                detail: "HANDOFF.md veya docs/ bulunamadı.".into(),
                fix_action: None,
                is_custom: false,
            });
        }
    }

    // 12. Test & build scripts (8)
    if is_enabled("test_and_build_scripts") {
        total_weight += 8;
        let pkg_content = fs::read_to_string(dir.join("package.json")).ok();
        let has_js_tests = pkg_content
            .as_deref()
            .map(|c| c.contains("\"test\"") && c.contains("\"build\""))
            .unwrap_or(false);
        let has_tests = has_js_tests
            || dir.join("Cargo.toml").is_file()
            || dir.join("src-tauri").join("Cargo.toml").is_file()
            || dir.join("tests").is_dir()
            || dir.join("pytest.ini").is_file();
        if has_tests {
            earned += 8;
            rules.push(DevOpsRuleResult {
                id: "test_and_build_scripts".into(),
                category: "quality".into(),
                title: "Test & Derleme Altyapısı".into(),
                status: "pass".into(),
                detail: "Otomatik test veya derleme yapılandırması algılandı.".into(),
                fix_action: None,
                is_custom: false,
            });
        } else {
            rules.push(DevOpsRuleResult {
                id: "test_and_build_scripts".into(),
                category: "quality".into(),
                title: "Test & Derleme Altyapısı".into(),
                status: "warn".into(),
                detail: "Standart test/build scripti veya tests/ klasörü bulunamadı.".into(),
                fix_action: None,
                is_custom: false,
            });
        }
    }

    // Custom user-defined rules
    for custom in &config.custom_rules {
        if !custom.enabled {
            continue;
        }
        let w = custom.weight.clamp(1, 20);
        total_weight += w;

        let fail_status = if custom.severity == "fail" {
            "fail"
        } else {
            "warn"
        };

        if !is_safe_relative_path(&custom.target_path) {
            rules.push(DevOpsRuleResult {
                id: custom.id.clone(),
                category: custom.category.clone(),
                title: custom.title.clone(),
                status: "warn".into(),
                detail: "Geçersiz dosya yolu (yalnızca proje içi göreli yol kullanılabilir)."
                    .into(),
                fix_action: None,
                is_custom: true,
            });
            continue;
        }

        let target = dir.join(custom.target_path.trim());
        let (passed, detail) = match custom.check_type.as_str() {
            "file_exists" => {
                if target.exists() {
                    (true, format!("Mevcut: {}", custom.target_path))
                } else {
                    (false, format!("Bulunamadı: {}", custom.target_path))
                }
            }
            "file_absent" => {
                if !target.exists() {
                    (
                        true,
                        format!("Temiz: {} projede yok.", custom.target_path),
                    )
                } else {
                    (
                        false,
                        format!("İstenmeyen dosya mevcut: {}", custom.target_path),
                    )
                }
            }
            "file_contains" => {
                let pat = custom.pattern.as_deref().unwrap_or("").trim();
                if pat.is_empty() {
                    (false, "Aranacak metin (pattern) boş bırakılmış.".into())
                } else if let Ok(content) = fs::read_to_string(&target) {
                    if content.contains(pat) {
                        (
                            true,
                            format!("{} içinde '{}' bulundu.", custom.target_path, pat),
                        )
                    } else {
                        (
                            false,
                            format!("{} içinde '{}' bulunamadı.", custom.target_path, pat),
                        )
                    }
                } else {
                    (false, format!("Dosya okunamadı: {}", custom.target_path))
                }
            }
            other => (false, format!("Bilinmeyen kontrol tipi: {other}")),
        };

        if passed {
            earned += w;
        }
        rules.push(DevOpsRuleResult {
            id: custom.id.clone(),
            category: custom.category.clone(),
            title: custom.title.clone(),
            status: if passed {
                "pass".into()
            } else {
                fail_status.into()
            },
            detail,
            fix_action: None,
            is_custom: true,
        });
    }

    let score = (earned * 100)
        .checked_div(total_weight)
        .map(|v| v.min(100) as u8)
        .unwrap_or(100);
    let grade = match score {
        92..=100 => "A+",
        80..=91 => "A",
        65..=79 => "B",
        50..=64 => "C",
        _ => "D",
    }
    .to_string();

    let passed_count = rules.iter().filter(|r| r.status == "pass").count();
    let warn_count = rules.iter().filter(|r| r.status == "warn").count();
    let fail_count = rules.iter().filter(|r| r.status == "fail").count();

    Ok(ProjectAuditReport {
        project_path: dir.to_string_lossy().to_string(),
        project_name,
        score,
        grade,
        passed_count,
        warn_count,
        fail_count,
        git_remote_provider,
        git_remote_url,
        git_branch,
        deploy_targets,
        recent_commits,
        dirty_files,
        rules,
    })
}

fn write_new_file_only(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Klasör oluşturulamadı ({}): {e}", parent.display()))?;
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                format!("Dosya zaten mevcut, üzerine yazılmadı: {}", path.display())
            } else {
                format!("Dosya oluşturulamadı ({}): {e}", path.display())
            }
        })?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Dosya yazılamadı ({}): {e}", path.display()))
}

pub fn apply_project_rule_fix(project_path: &str, fix_action: &str) -> Result<String, String> {
    let dir = Path::new(project_path.trim());
    if !dir.exists() || !dir.is_dir() {
        return Err(format!("Proje klasörü bulunamadı: {}", dir.display()));
    }
    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Project");

    match fix_action.trim() {
        "create_gitignore" => {
            let content = "# Dependencies & Builds\nnode_modules/\ndist/\nbuild/\n.next/\n.turbo/\ntarget/\n.venv/\nvenv/\n__pycache__/\n.pytest_cache/\n\n# Environment & Secrets\n.env\n.env.*\n!.env.example\n\n# OS & Editors\n.DS_Store\nThumbs.db\n";
            write_new_file_only(&dir.join(".gitignore"), content)?;
            Ok(".gitignore şablonu oluşturuldu.".into())
        }
        "create_env_example" => {
            let content = "# Copy this file to .env and fill in real values (never commit .env)\nAPP_ENV=development\nPORT=3000\n";
            write_new_file_only(&dir.join(".env.example"), content)?;
            Ok(".env.example şablonu oluşturuldu.".into())
        }
        "create_readme" => {
            let content = format!(
                "# {name}\n\n## Overview\n\nDescribe the purpose, architecture, and key workflows of `{name}`.\n\n## Getting Started\n\n```bash\n# Install dependencies & run locally\n```\n\n## Verification\n\n```bash\n# Run tests and build checks\n```\n"
            );
            write_new_file_only(&dir.join("README.md"), &content)?;
            Ok("README.md taslağı oluşturuldu.".into())
        }
        "create_github_ci" => {
            let has_pkg = dir.join("package.json").is_file();
            let content = if has_pkg {
                "name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - run: npm ci\n      - run: npm run build\n"
            } else {
                "name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo \"Add your build and test commands here\"\n"
            };
            write_new_file_only(&dir.join(".github/workflows/ci.yml"), content)?;
            Ok(".github/workflows/ci.yml başlangıç hattı oluşturuldu.".into())
        }
        other => Err(format!("Bilinmeyen düzeltme aksiyonu: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_project(prefix: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("affexdesk_audit_{prefix}_{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn audit_scores_missing_files_and_safe_fix_creates_without_overwriting() {
        let dir = make_temp_project("basic");
        let path_str = dir.to_string_lossy().to_string();

        let report1 = audit_project(&path_str).expect("audit succeeds");
        assert!(report1.score < 50);
        assert!(report1
            .rules
            .iter()
            .any(|r| r.id == "gitignore_present" && r.status == "fail"));

        let msg =
            apply_project_rule_fix(&path_str, "create_gitignore").expect("creates gitignore");
        assert!(msg.contains(".gitignore"));
        assert!(apply_project_rule_fix(&path_str, "create_gitignore").is_err());

        let report2 = audit_project(&path_str).expect("second audit succeeds");
        assert!(report2.score > report1.score);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn custom_rules_and_disabled_builtins_work_and_reject_traversal() {
        let dir = make_temp_project("custom");
        fs::write(dir.join("tsconfig.json"), r#"{ "compilerOptions": { "strict": true } }"#)
            .unwrap();
        let path_str = dir.to_string_lossy().to_string();

        let cfg = DevOpsRulesConfig {
            disabled_builtin_ids: vec![
                "license_present".into(),
                "handoff_or_spec".into(),
            ],
            custom_rules: vec![
                CustomDevOpsRule {
                    id: "c1".into(),
                    title: "TS Strict".into(),
                    category: "quality".into(),
                    check_type: "file_contains".into(),
                    target_path: "tsconfig.json".into(),
                    pattern: Some("\"strict\": true".into()),
                    severity: "fail".into(),
                    weight: 10,
                    enabled: true,
                },
                CustomDevOpsRule {
                    id: "c2".into(),
                    title: "No Traversal".into(),
                    category: "security".into(),
                    check_type: "file_exists".into(),
                    target_path: "../etc/passwd".into(),
                    pattern: None,
                    severity: "fail".into(),
                    weight: 5,
                    enabled: true,
                },
            ],
        };

        let rep = audit_project_with_config(&path_str, &cfg).expect("custom audit succeeds");
        assert!(!rep.rules.iter().any(|r| r.id == "license_present"));
        assert!(rep.rules.iter().any(|r| r.id == "c1" && r.status == "pass" && r.is_custom));
        assert!(rep.rules.iter().any(|r| r.id == "c2" && r.status == "warn" && r.is_custom));

        let _ = fs::remove_dir_all(&dir);
    }
}
