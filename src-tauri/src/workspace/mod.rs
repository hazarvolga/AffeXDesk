pub mod audit;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

pub const ALLOWLISTED_CACHE_DIRS: [&str; 9] = [
    "node_modules",
    "target",
    ".next",
    ".venv",
    "venv",
    "dist",
    ".turbo",
    "__pycache__",
    ".pytest_cache",
];

const MAX_SCAN_DEPTH: usize = 3;

const PROJECT_MARKERS: [&str; 15] = [
    ".git",
    "package.json",
    "Cargo.toml",
    "pyproject.toml",
    "requirements.txt",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "composer.json",
    "Gemfile",
    "pubspec.yaml",
    "CMakeLists.txt",
    "Makefile",
    "Package.swift",
];

const PROGRESS_FILES: [&str; 4] = ["HANDOFF.md", "PRD.md", "TODO.md", "README.md"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReclaimableDir {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    pub workspace_label: String,
    pub stack: Vec<String>,
    pub git_branch: Option<String>,
    pub git_dirty_count: usize,
    pub git_last_commit: Option<String>,
    pub progress_done: usize,
    pub progress_total: usize,
    pub progress_pct: Option<u8>,
    pub live_url: Option<String>,
    pub reclaimable_bytes: u64,
    pub reclaimable_dirs: Vec<ReclaimableDir>,
    pub last_modified_days_ago: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceScanReport {
    pub projects: Vec<ProjectInfo>,
    pub total_projects: usize,
    pub dirty_projects: usize,
    pub total_reclaimable_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanResult {
    pub cleaned_count: usize,
    pub freed_bytes: u64,
    pub errors: Vec<String>,
}

/// Scans workspace roots up to depth 3 for software projects.
/// Each tuple in `roots` is `(root_path, workspace_label)`.
pub fn scan_workspaces(
    roots: &[(String, String)],
    custom_urls: &HashMap<String, String>,
) -> WorkspaceScanReport {
    let mut projects = Vec::new();
    let mut seen_paths: HashSet<PathBuf> = HashSet::new();

    for (root_path_str, label) in roots {
        let root_path = PathBuf::from(root_path_str);
        if !root_path.is_dir() {
            continue;
        }
        discover_projects(
            &root_path,
            label,
            0,
            custom_urls,
            &mut seen_paths,
            &mut projects,
        );
    }

    projects.sort_by(|a, b| {
        a.last_modified_days_ago
            .cmp(&b.last_modified_days_ago)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    let total_projects = projects.len();
    let dirty_projects = projects.iter().filter(|p| p.git_dirty_count > 0).count();
    let total_reclaimable_bytes = projects.iter().map(|p| p.reclaimable_bytes).sum();

    WorkspaceScanReport {
        projects,
        total_projects,
        dirty_projects,
        total_reclaimable_bytes,
    }
}

/// Safely deletes reclaimable cache directories after strict allowlist and traversal checks.
/// Rejects the entire batch with `Err("forbidden_path: ...")` if any path violates security rules.
pub fn clean_reclaimable_paths(paths: &[String]) -> Result<CleanResult, String> {
    let mut validated: Vec<PathBuf> = Vec::with_capacity(paths.len());

    for raw in paths {
        let checked = validate_cleanable_path(raw)?;
        validated.push(checked);
    }

    let mut cleaned_count = 0usize;
    let mut freed_bytes = 0u64;
    let mut errors = Vec::new();

    for target in validated {
        if !target.exists() {
            errors.push(format!("not_found: {}", target.display()));
            continue;
        }
        match fs::symlink_metadata(&target) {
            Ok(meta) => {
                if meta.file_type().is_symlink() {
                    return Err(format!("forbidden_path: symlink {}", target.display()));
                }
                if !meta.is_dir() {
                    errors.push(format!("not_a_directory: {}", target.display()));
                    continue;
                }
            }
            Err(err) => {
                errors.push(format!("metadata_error ({}): {}", target.display(), err));
                continue;
            }
        }

        let size = dir_size_bytes(&target);
        match fs::remove_dir_all(&target) {
            Ok(()) => {
                cleaned_count += 1;
                freed_bytes = freed_bytes.saturating_add(size);
            }
            Err(err) => {
                errors.push(format!("remove_failed ({}): {}", target.display(), err));
            }
        }
    }

    Ok(CleanResult {
        cleaned_count,
        freed_bytes,
        errors,
    })
}

fn validate_cleanable_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("forbidden_path: empty path".to_string());
    }

    let path = Path::new(trimmed);
    if !path.is_absolute() {
        return Err(format!("forbidden_path: relative path not allowed ({trimmed})"));
    }

    for comp in path.components() {
        match comp {
            Component::ParentDir => {
                return Err(format!("forbidden_path: path traversal in {trimmed}"));
            }
            Component::Normal(seg) if seg == ".git" => {
                return Err(format!("forbidden_path: .git is protected ({trimmed})"));
            }
            _ => {}
        }
    }

    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| format!("forbidden_path: root or relative leaf ({trimmed})"))?;

    if parent == path {
        return Err(format!("forbidden_path: root path ({trimmed})"));
    }

    let leaf = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("forbidden_path: invalid leaf name ({trimmed})"))?;

    if leaf == ".git" || !ALLOWLISTED_CACHE_DIRS.contains(&leaf) {
        return Err(format!(
            "forbidden_path: '{leaf}' is not an allowlisted cache directory ({trimmed})"
        ));
    }

    // Reject symlinks on the target itself or any non-OS-root ancestor directory
    for ancestor in path.ancestors() {
        if ancestor.parent().is_none() || ancestor.as_os_str().is_empty() {
            break;
        }
        #[cfg(target_os = "macos")]
        if matches!(
            ancestor.to_str(),
            Some("/var" | "/tmp" | "/etc")
        ) {
            continue;
        }
        if let Ok(meta) = fs::symlink_metadata(ancestor) {
            if meta.file_type().is_symlink() {
                return Err(format!(
                    "forbidden_path: symlink not allowed ({})",
                    ancestor.display()
                ));
            }
        }
    }

    Ok(path.to_path_buf())
}

fn discover_projects(
    dir: &Path,
    workspace_label: &str,
    depth: usize,
    custom_urls: &HashMap<String, String>,
    seen_paths: &mut HashSet<PathBuf>,
    projects: &mut Vec<ProjectInfo>,
) {
    if depth > MAX_SCAN_DEPTH {
        return;
    }

    if is_project_dir(dir) {
        let canonical = fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
        if seen_paths.insert(canonical) {
            projects.push(inspect_project(dir, workspace_label, custom_urls));
        }
        return;
    }

    if depth == MAX_SCAN_DEPTH {
        return;
    }

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }

        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };

        if should_skip_scan_dir(name_str) {
            continue;
        }

        discover_projects(
            &entry.path(),
            workspace_label,
            depth + 1,
            custom_urls,
            seen_paths,
            projects,
        );
    }
}

fn should_skip_scan_dir(name: &str) -> bool {
    name.starts_with('.') || ALLOWLISTED_CACHE_DIRS.contains(&name)
}

fn is_project_dir(dir: &Path) -> bool {
    for marker in PROJECT_MARKERS {
        if dir.join(marker).exists() {
            return true;
        }
    }
    false
}

fn inspect_project(
    dir: &Path,
    workspace_label: &str,
    custom_urls: &HashMap<String, String>,
) -> ProjectInfo {
    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();
    let path_str = dir.to_string_lossy().to_string();

    let stack = detect_stack(dir);
    let (git_branch, git_dirty_count, git_last_commit) = inspect_git(dir);
    let (progress_done, progress_total, progress_pct) = calculate_progress(dir);
    let live_url = detect_live_url(dir, &path_str, custom_urls);
    let (reclaimable_bytes, reclaimable_dirs) = scan_reclaimable_dirs(dir);
    let last_modified_days_ago = compute_last_modified_days_ago(dir);

    ProjectInfo {
        name,
        path: path_str,
        workspace_label: workspace_label.to_string(),
        stack,
        git_branch,
        git_dirty_count,
        git_last_commit,
        progress_done,
        progress_total,
        progress_pct,
        live_url,
        reclaimable_bytes,
        reclaimable_dirs,
        last_modified_days_ago,
    }
}

fn detect_stack(dir: &Path) -> Vec<String> {
    let mut stack: Vec<String> = Vec::new();
    let mut push_unique = |label: &str| {
        if !stack.iter().any(|item| item == label) {
            stack.push(label.to_string());
        }
    };

    let pkg_path = dir.join("package.json");
    if pkg_path.is_file() {
        let mut matched_js_framework = false;
        if let Ok(content) = fs::read_to_string(&pkg_path) {
            if content.contains("\"next\"") {
                push_unique("Next.js");
                matched_js_framework = true;
            }
            if content.contains("\"react\"") {
                push_unique("React");
                matched_js_framework = true;
            }
            if content.contains("\"vue\"") {
                push_unique("Vue");
                matched_js_framework = true;
            }
            if content.contains("\"svelte\"") {
                push_unique("Svelte");
                matched_js_framework = true;
            }
            if content.contains("\"vite\"") {
                push_unique("Vite");
                matched_js_framework = true;
            }
            if content.contains("@tauri-apps/") {
                push_unique("Tauri");
                matched_js_framework = true;
            }
            if content.contains("\"typescript\"") {
                push_unique("TypeScript");
                matched_js_framework = true;
            }
        }
        if dir.join("tsconfig.json").is_file() {
            push_unique("TypeScript");
            matched_js_framework = true;
        }
        if !matched_js_framework {
            push_unique("Node.js");
        }
    }

    if dir.join("src-tauri").is_dir() {
        push_unique("Tauri");
        push_unique("Rust");
    }

    let cargo_path = dir.join("Cargo.toml");
    if cargo_path.is_file() {
        push_unique("Rust");
        if let Ok(content) = fs::read_to_string(&cargo_path) {
            if content.contains("tauri") {
                push_unique("Tauri");
            }
        }
    }

    if dir.join("pyproject.toml").is_file() || dir.join("requirements.txt").is_file() {
        push_unique("Python");
    }
    if dir.join("go.mod").is_file() {
        push_unique("Go");
    }
    if dir.join("pom.xml").is_file()
        || dir.join("build.gradle").is_file()
        || dir.join("build.gradle.kts").is_file()
    {
        push_unique("Java");
    }
    if dir.join("composer.json").is_file() {
        push_unique("PHP");
    }
    if dir.join("pubspec.yaml").is_file() {
        push_unique("Flutter");
    }
    if dir.join("Package.swift").is_file() {
        push_unique("Swift");
    }
    if dir.join("Dockerfile").is_file()
        || dir.join("docker-compose.yml").is_file()
        || dir.join("compose.yml").is_file()
    {
        push_unique("Docker");
    }

    stack
}

fn inspect_git(dir: &Path) -> (Option<String>, usize, Option<String>) {
    if !dir.join(".git").exists() {
        return (None, 0, None);
    }

    let mut branch: Option<String> = None;
    let mut dirty_count: usize = 0;

    if let Ok(output) = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["status", "--porcelain=v1", "-b"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for (idx, line) in stdout.lines().enumerate() {
                if idx == 0 && line.starts_with("## ") {
                    branch = parse_git_branch_header(line);
                } else if !line.trim().is_empty() {
                    dirty_count += 1;
                }
            }
        }
    }

    let last_commit = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["log", "-1", "--format=%cs %s"])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|s| !s.is_empty());

    (branch, dirty_count, last_commit)
}

fn parse_git_branch_header(line: &str) -> Option<String> {
    let rest = line.strip_prefix("## ")?.trim();
    if let Some(after) = rest.strip_prefix("No commits yet on ") {
        return Some(after.trim().to_string());
    }
    if rest.starts_with("HEAD (no branch)") {
        return Some("HEAD".to_string());
    }
    let name = rest
        .split("...")
        .next()
        .unwrap_or(rest)
        .split_whitespace()
        .next()
        .unwrap_or(rest)
        .trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn calculate_progress(dir: &Path) -> (usize, usize, Option<u8>) {
    let mut done = 0usize;
    let mut total = 0usize;

    for filename in PROGRESS_FILES {
        let path = dir.join(filename);
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };

        for line in content.lines() {
            let trimmed = line.trim_start();
            if trimmed.starts_with("- [x]")
                || trimmed.starts_with("- [X]")
                || trimmed.starts_with("* [x]")
                || trimmed.starts_with("* [X]")
            {
                done += 1;
                total += 1;
            } else if trimmed.starts_with("- [ ]") || trimmed.starts_with("* [ ]") {
                total += 1;
            }
        }
    }

    let pct = if total > 0 {
        Some(((done as f64 / total as f64) * 100.0).round().clamp(0.0, 100.0) as u8)
    } else {
        None
    };

    (done, total, pct)
}

fn detect_live_url(
    dir: &Path,
    path_str: &str,
    custom_urls: &HashMap<String, String>,
) -> Option<String> {
    if let Some(url) = custom_urls.get(path_str) {
        if let Some(normalized) = normalize_url(url) {
            return Some(normalized);
        }
    }
    if let Ok(canonical) = fs::canonicalize(dir) {
        let canonical_str = canonical.to_string_lossy();
        if let Some(url) = custom_urls.get(canonical_str.as_ref()) {
            if let Some(normalized) = normalize_url(url) {
                return Some(normalized);
            }
        }
    }

    // Check CNAME
    if let Ok(cname) = fs::read_to_string(dir.join("CNAME")) {
        if let Some(first) = cname.lines().map(str::trim).find(|l| !l.is_empty()) {
            if let Some(normalized) = normalize_url(first) {
                return Some(normalized);
            }
        }
    }

    // Check package.json homepage
    if let Ok(pkg_str) = fs::read_to_string(dir.join("package.json")) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&pkg_str) {
            if let Some(homepage) = val.get("homepage").and_then(|v| v.as_str()) {
                if let Some(normalized) = normalize_http_only(homepage) {
                    return Some(normalized);
                }
            }
        }
    }

    // Check vercel.json alias / url
    if let Ok(vercel_str) = fs::read_to_string(dir.join("vercel.json")) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&vercel_str) {
            if let Some(alias) = val.get("alias") {
                if let Some(s) = alias.as_str() {
                    if let Some(normalized) = normalize_url(s) {
                        return Some(normalized);
                    }
                } else if let Some(arr) = alias.as_array() {
                    for item in arr {
                        if let Some(s) = item.as_str() {
                            if let Some(normalized) = normalize_url(s) {
                                return Some(normalized);
                            }
                        }
                    }
                }
            }
            if let Some(url) = val.get("url").and_then(|v| v.as_str()) {
                if let Some(normalized) = normalize_url(url) {
                    return Some(normalized);
                }
            }
        }
    }

    None
}

fn normalize_http_only(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn normalize_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.contains(char::is_whitespace) {
        return None;
    }
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        Some(trimmed.to_string())
    } else if trimmed.contains('.') && !trimmed.contains("://") {
        Some(format!("https://{trimmed}"))
    } else {
        None
    }
}

fn scan_reclaimable_dirs(project_dir: &Path) -> (u64, Vec<ReclaimableDir>) {
    let mut found = Vec::new();
    collect_reclaimable(project_dir, 0, &mut found);

    found.sort_by_key(|a| std::cmp::Reverse(a.size_bytes));
    let total = found.iter().map(|d| d.size_bytes).sum();
    (total, found)
}

fn collect_reclaimable(dir: &Path, depth: usize, out: &mut Vec<ReclaimableDir>) {
    // Check direct children (depth 0) and one nested level (depth 1, e.g., src-tauri/target).
    if depth > 1 {
        return;
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if !ft.is_dir() || ft.is_symlink() {
            continue;
        }

        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };

        if name_str == ".git" {
            continue;
        }

        let entry_path = entry.path();
        if ALLOWLISTED_CACHE_DIRS.contains(&name_str) {
            let size_bytes = dir_size_bytes(&entry_path);
            out.push(ReclaimableDir {
                name: name_str.to_string(),
                path: entry_path.to_string_lossy().to_string(),
                size_bytes,
            });
        } else if !name_str.starts_with('.') {
            collect_reclaimable(&entry_path, depth + 1, out);
        }
    }
}

fn dir_size_bytes(path: &Path) -> u64 {
    let mut total: u64 = 0;
    let mut stack = vec![path.to_path_buf()];

    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                stack.push(entry.path());
            } else if let Ok(meta) = entry.metadata() {
                total = total.saturating_add(meta.len());
            }
        }
    }

    total
}

fn compute_last_modified_days_ago(dir: &Path) -> u64 {
    let mut latest = fs::metadata(dir)
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if let Some(name_str) = name.to_str() {
                if name_str.starts_with('.') || ALLOWLISTED_CACHE_DIRS.contains(&name_str) {
                    continue;
                }
            }
            if let Ok(meta) = entry.metadata() {
                if let Ok(modified) = meta.modified() {
                    if modified > latest {
                        latest = modified;
                    }
                }
            }
        }
    }

    SystemTime::now()
        .duration_since(latest)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::UNIX_EPOCH;

    fn make_temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("affexdesk_{prefix}_{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn test_scan_discovers_project_progress_url_and_reclaimable_size() {
        let root = make_temp_dir("ws_scan");
        let proj = root.join("demo-app");
        fs::create_dir_all(&proj).expect("create project dir");

        fs::write(
            proj.join("package.json"),
            r#"{"name":"demo-app","homepage":"https://demo.example.com","dependencies":{"react":"^19.0.0","typescript":"^5.0.0"}}"#,
        )
        .expect("write package.json");

        fs::write(
            proj.join("TODO.md"),
            "# Tasks\n- [x] Setup repo\n- [X] Add scanner\n- [ ] Ship UI\n- [ ] Publish\n",
        )
        .expect("write TODO.md");

        let nm = proj.join("node_modules").join("pkg");
        fs::create_dir_all(&nm).expect("create node_modules/pkg");
        let payload = vec![b'a'; 4096];
        fs::write(nm.join("index.js"), &payload).expect("write dummy module");

        let roots = vec![(root.to_string_lossy().to_string(), "Lab".to_string())];
        let custom_urls = HashMap::new();
        let report = scan_workspaces(&roots, &custom_urls);

        assert_eq!(report.total_projects, 1);
        assert_eq!(report.projects.len(), 1);
        let p = &report.projects[0];
        assert_eq!(p.name, "demo-app");
        assert_eq!(p.workspace_label, "Lab");
        assert!(p.stack.contains(&"React".to_string()));
        assert!(p.stack.contains(&"TypeScript".to_string()));
        assert_eq!(p.progress_done, 2);
        assert_eq!(p.progress_total, 4);
        assert_eq!(p.progress_pct, Some(50));
        assert_eq!(p.live_url.as_deref(), Some("https://demo.example.com"));
        assert_eq!(p.reclaimable_dirs.len(), 1);
        assert_eq!(p.reclaimable_dirs[0].name, "node_modules");
        assert_eq!(p.reclaimable_dirs[0].size_bytes, 4096);
        assert_eq!(p.reclaimable_bytes, 4096);
        assert_eq!(report.total_reclaimable_bytes, 4096);

        // Clean node_modules safely
        let clean_res = clean_reclaimable_paths(&[p.reclaimable_dirs[0].path.clone()])
            .expect("clean allowlisted node_modules");
        assert_eq!(clean_res.cleaned_count, 1);
        assert_eq!(clean_res.freed_bytes, 4096);
        assert!(clean_res.errors.is_empty());
        assert!(!proj.join("node_modules").exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn test_clean_rejects_git_src_and_traversal() {
        let root = make_temp_dir("ws_security");
        let git_dir = root.join(".git");
        let src_dir = root.join("src");
        fs::create_dir_all(&git_dir).expect("create .git");
        fs::create_dir_all(&src_dir).expect("create src");

        let git_err = clean_reclaimable_paths(&[git_dir.to_string_lossy().to_string()])
            .expect_err("must reject .git");
        assert!(git_err.starts_with("forbidden_path:"));
        assert!(git_dir.exists());

        let src_err = clean_reclaimable_paths(&[src_dir.to_string_lossy().to_string()])
            .expect_err("must reject src");
        assert!(src_err.starts_with("forbidden_path:"));
        assert!(src_dir.exists());

        let traversal = format!("{}/../node_modules", root.display());
        let trav_err = clean_reclaimable_paths(&[traversal]).expect_err("must reject .. traversal");
        assert!(trav_err.starts_with("forbidden_path:"));

        let rel_err = clean_reclaimable_paths(&["node_modules".to_string()])
            .expect_err("must reject relative path");
        assert!(rel_err.starts_with("forbidden_path:"));

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let real_nm = root.join("real_target");
            fs::create_dir_all(&real_nm).expect("create real_target");
            let sym_nm = root.join("node_modules");
            symlink(&real_nm, &sym_nm).expect("create symlink node_modules");
            let sym_err = clean_reclaimable_paths(&[sym_nm.to_string_lossy().to_string()])
                .expect_err("must reject symlink target");
            assert!(sym_err.starts_with("forbidden_path:"));
            assert!(real_nm.exists());

            let sym_parent = root.join("sym_parent");
            symlink(&root, &sym_parent).expect("create symlink parent");
            let sym_parent_err = clean_reclaimable_paths(&[sym_parent
                .join("dist")
                .to_string_lossy()
                .to_string()])
            .expect_err("must reject symlink ancestor");
            assert!(sym_parent_err.starts_with("forbidden_path:"));
        }

        let _ = fs::remove_dir_all(&root);
    }
}
