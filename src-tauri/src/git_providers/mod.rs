use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

const DEFAULT_GITLAB_URL: &str = "https://gitlab.com";
const USER_AGENT: &str = "AffeXDesk";
const HTTP_TIMEOUT_SECS: u64 = 15;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitProviderStatus {
    pub gh_cli_available: bool,
    pub gh_authenticated: bool,
    pub gh_user: Option<String>,
    pub github_token_configured: bool,
    pub gitlab_url: String,
    pub gitlab_token_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RemoteRepo {
    pub provider: String,
    pub id: String,
    pub name: String,
    pub full_name: String,
    pub description: Option<String>,
    pub clone_url: String,
    pub html_url: String,
    pub private: bool,
    pub default_branch: String,
    pub language: Option<String>,
    pub updated_at: String,
    pub stargazers_count: u64,
}

fn non_empty_setting<'a>(settings: &'a HashMap<String, String>, key: &str) -> Option<&'a str> {
    settings
        .get(key)
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
}

fn normalize_gitlab_url(settings: &HashMap<String, String>) -> String {
    non_empty_setting(settings, "gitlab_url")
        .unwrap_or(DEFAULT_GITLAB_URL)
        .trim_end_matches('/')
        .to_string()
}

fn parse_gh_user(output: &str) -> Option<String> {
    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(pos) = trimmed.find("account ") {
            let rest = &trimmed[pos + "account ".len()..];
            if let Some(user) = rest.split_whitespace().next() {
                let cleaned = user.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_');
                if !cleaned.is_empty() {
                    return Some(cleaned.to_string());
                }
            }
        }
        if let Some(pos) = trimmed.find("Logged in to ") {
            let rest = &trimmed[pos + "Logged in to ".len()..];
            if let Some(as_pos) = rest.find(" as ") {
                let after_as = &rest[as_pos + " as ".len()..];
                if let Some(user) = after_as.split_whitespace().next() {
                    let cleaned = user.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_');
                    if !cleaned.is_empty() {
                        return Some(cleaned.to_string());
                    }
                }
            }
        }
    }
    None
}

fn extended_path_env() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    if cfg!(target_os = "macos") {
        format!("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:{current}")
    } else {
        current
    }
}

pub fn check_git_providers(settings: &HashMap<String, String>) -> GitProviderStatus {
    let (gh_cli_available, gh_authenticated, gh_user) = match Command::new("gh")
        .env("PATH", extended_path_env())
        .args(["auth", "status"])
        .output()
    {
        Ok(output) => {
            let combined = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            let authenticated = output.status.success();
            let user = if authenticated {
                parse_gh_user(&combined)
            } else {
                None
            };
            (true, authenticated, user)
        }
        Err(_) => (false, false, None),
    };

    GitProviderStatus {
        gh_cli_available,
        gh_authenticated,
        gh_user,
        github_token_configured: non_empty_setting(settings, "github_token").is_some(),
        gitlab_url: normalize_gitlab_url(settings),
        gitlab_token_configured: non_empty_setting(settings, "gitlab_token").is_some(),
    }
}

fn value_id_to_string(v: &Value) -> String {
    if let Some(s) = v.as_str() {
        s.to_string()
    } else if let Some(n) = v.as_u64() {
        n.to_string()
    } else if let Some(n) = v.as_i64() {
        n.to_string()
    } else {
        String::new()
    }
}

fn parse_github_repos(value: &Value) -> Result<Vec<RemoteRepo>, String> {
    let items = value
        .as_array()
        .ok_or_else(|| "GitHub API returned an unexpected payload (expected array)".to_string())?;

    let mut repos = Vec::with_capacity(items.len());
    for item in items {
        let name = item["name"].as_str().unwrap_or_default().to_string();
        if name.is_empty() {
            continue;
        }
        let full_name = item["full_name"]
            .as_str()
            .unwrap_or(&name)
            .to_string();
        let clone_url = item["clone_url"].as_str().unwrap_or_default().to_string();
        let html_url = item["html_url"].as_str().unwrap_or_default().to_string();

        repos.push(RemoteRepo {
            provider: "github".to_string(),
            id: value_id_to_string(&item["id"]),
            name,
            full_name,
            description: item["description"]
                .as_str()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            clone_url,
            html_url,
            private: item["private"].as_bool().unwrap_or(false),
            default_branch: item["default_branch"]
                .as_str()
                .unwrap_or("main")
                .to_string(),
            language: item["language"]
                .as_str()
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty()),
            updated_at: item["updated_at"].as_str().unwrap_or_default().to_string(),
            stargazers_count: item["stargazers_count"].as_u64().unwrap_or(0),
        });
    }

    Ok(repos)
}

fn parse_gitlab_repos(value: &Value) -> Result<Vec<RemoteRepo>, String> {
    let items = value
        .as_array()
        .ok_or_else(|| "GitLab API returned an unexpected payload (expected array)".to_string())?;

    let mut repos = Vec::with_capacity(items.len());
    for item in items {
        let name = item["name"].as_str().unwrap_or_default().to_string();
        if name.is_empty() {
            continue;
        }
        let full_name = item["path_with_namespace"]
            .as_str()
            .unwrap_or(&name)
            .to_string();
        let clone_url = item["http_url_to_repo"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        let html_url = item["web_url"].as_str().unwrap_or_default().to_string();
        let private = item["visibility"]
            .as_str()
            .map(|vis| vis != "public")
            .unwrap_or(true);
        let updated_at = item["last_activity_at"]
            .as_str()
            .or_else(|| item["updated_at"].as_str())
            .unwrap_or_default()
            .to_string();

        repos.push(RemoteRepo {
            provider: "gitlab".to_string(),
            id: value_id_to_string(&item["id"]),
            name,
            full_name,
            description: item["description"]
                .as_str()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            clone_url,
            html_url,
            private,
            default_branch: item["default_branch"]
                .as_str()
                .unwrap_or("main")
                .to_string(),
            language: item["language"]
                .as_str()
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty()),
            updated_at,
            stargazers_count: item["star_count"].as_u64().unwrap_or(0),
        });
    }

    Ok(repos)
}

fn build_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

pub async fn list_remote_repos(
    provider: &str,
    settings: &HashMap<String, String>,
) -> Result<Vec<RemoteRepo>, String> {
    match provider.trim().to_ascii_lowercase().as_str() {
        "github" => list_github_repos(settings).await,
        "gitlab" => list_gitlab_repos(settings).await,
        other => Err(format!("Unsupported git provider: {other}")),
    }
}

async fn list_github_repos(settings: &HashMap<String, String>) -> Result<Vec<RemoteRepo>, String> {
    if let Some(token) = non_empty_setting(settings, "github_token") {
        let client = build_http_client()?;
        let response = client
            .get("https://api.github.com/user/repos?per_page=50&sort=updated")
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", USER_AGENT)
            .send()
            .await
            .map_err(|e| format!("GitHub API request failed: {e}"))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "GitHub API returned HTTP {}: {}",
                status.as_u16(),
                truncate_error(&body)
            ));
        }

        let payload: Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse GitHub API JSON: {e}"))?;
        return parse_github_repos(&payload);
    }

    let output = tokio::process::Command::new("gh")
        .env("PATH", extended_path_env())
        .args(["api", "user/repos?per_page=50&sort=updated"])
        .output()
        .await
        .map_err(|e| format!("Failed to invoke gh CLI (configure github_token or install gh): {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "gh api failed: {}",
            truncate_error(stderr.trim())
        ));
    }

    let payload: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse gh api output: {e}"))?;
    parse_github_repos(&payload)
}

async fn list_gitlab_repos(settings: &HashMap<String, String>) -> Result<Vec<RemoteRepo>, String> {
    let token = non_empty_setting(settings, "gitlab_token")
        .ok_or_else(|| "GitLab token is not configured in settings (gitlab_token)".to_string())?;
    let base_url = normalize_gitlab_url(settings);
    if !(base_url.starts_with("https://") || base_url.starts_with("http://"))
        || base_url.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("Invalid gitlab_url: must start with https:// or http://".to_string());
    }

    let url = format!(
        "{base_url}/api/v4/projects?membership=true&per_page=50&order_by=updated_at"
    );

    let client = build_http_client()?;
    let response = client
        .get(&url)
        .header("PRIVATE-TOKEN", token)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("GitLab API request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "GitLab API returned HTTP {}: {}",
            status.as_u16(),
            truncate_error(&body)
        ));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitLab API JSON: {e}"))?;
    parse_gitlab_repos(&payload)
}

fn truncate_error(s: &str) -> String {
    const MAX_LEN: usize = 240;
    let trimmed = s.trim();
    if trimmed.len() <= MAX_LEN {
        trimmed.to_string()
    } else {
        let mut end = MAX_LEN;
        while !trimmed.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        format!("{}...", &trimmed[..end])
    }
}

pub fn validate_clone_url(clone_url: &str) -> Result<String, String> {
    let trimmed = clone_url.trim();
    if trimmed.is_empty() {
        return Err("Clone URL cannot be empty".to_string());
    }
    if trimmed.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Clone URL must not contain whitespace or control characters".to_string());
    }
    if !(trimmed.starts_with("https://") || trimmed.starts_with("git@")) {
        return Err("Clone URL must start with https:// or git@".to_string());
    }
    if trimmed == "https://" || trimmed == "git@" {
        return Err("Clone URL is incomplete".to_string());
    }
    Ok(trimmed.to_string())
}

pub fn validate_folder_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Folder name cannot be empty".to_string());
    }
    if trimmed == "." || trimmed == ".." || trimmed.contains("..") {
        return Err("Folder name must not contain path traversal ('..')".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains('\0') {
        return Err("Folder name must not contain path separators".to_string());
    }
    if trimmed.starts_with('-') {
        return Err("Folder name must not start with '-'".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err(
            "Folder name may only contain ASCII letters, digits, '.', '_' and '-'".to_string(),
        );
    }
    Ok(trimmed.to_string())
}

fn derive_folder_name_from_url(clone_url: &str) -> Result<String, String> {
    let stripped = clone_url.trim_end_matches('/');
    let last_segment = stripped
        .rsplit(['/', ':'])
        .next()
        .unwrap_or_default()
        .trim_end_matches(".git");
    validate_folder_name(last_segment)
}

fn ensure_existing_dir(dir: &str) -> Result<PathBuf, String> {
    let trimmed = dir.trim();
    if trimmed.is_empty() {
        return Err("Workspace directory cannot be empty".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.exists() || !path.is_dir() {
        return Err(format!("Workspace directory does not exist: {trimmed}"));
    }
    Ok(path)
}

pub fn clone_repo(
    clone_url: &str,
    target_workspace_dir: &str,
    folder_name: Option<&str>,
) -> Result<String, String> {
    let safe_url = validate_clone_url(clone_url)?;
    let workspace_path = ensure_existing_dir(target_workspace_dir)?;

    let dest_name = match folder_name.map(str::trim).filter(|s| !s.is_empty()) {
        Some(custom) => validate_folder_name(custom)?,
        None => derive_folder_name_from_url(&safe_url)?,
    };

    let target_path = workspace_path.join(&dest_name);
    if target_path.exists() {
        return Err(format!(
            "Target directory already exists: {}",
            target_path.display()
        ));
    }

    let target_str = target_path
        .to_str()
        .ok_or_else(|| "Target path is not valid UTF-8".to_string())?;

    let output = Command::new("git")
        .env("PATH", extended_path_env())
        .args(["clone", "--", &safe_url, target_str])
        .output()
        .map_err(|e| format!("Failed to execute git clone: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git clone failed: {}", truncate_error(&stderr)));
    }

    Ok(target_str.to_string())
}

fn write_template_files(project_dir: &Path, name: &str, template: &str) -> Result<(), String> {
    let readme = format!("# {name}\n\nInitialized with AffeXDesk (`{template}` template).\n");
    fs::write(project_dir.join("README.md"), readme)
        .map_err(|e| format!("Failed to write README.md: {e}"))?;

    match template {
        "empty" => {
            fs::write(project_dir.join(".gitignore"), ".DS_Store\n.env\n")
                .map_err(|e| format!("Failed to write .gitignore: {e}"))?;
        }
        "react-vite" => {
            fs::write(
                project_dir.join(".gitignore"),
                "node_modules/\ndist/\n.DS_Store\n.env\n.env.local\n",
            )
            .map_err(|e| format!("Failed to write .gitignore: {e}"))?;

            let package_json = format!(
                "{{\n  \"name\": \"{name}\",\n  \"private\": true,\n  \"version\": \"0.1.0\",\n  \"type\": \"module\",\n  \"scripts\": {{\n    \"dev\": \"vite\",\n    \"build\": \"vite build\",\n    \"preview\": \"vite preview\"\n  }},\n  \"dependencies\": {{\n    \"react\": \"^19.0.0\",\n    \"react-dom\": \"^19.0.0\"\n  }},\n  \"devDependencies\": {{\n    \"@vitejs/plugin-react\": \"^4.3.0\",\n    \"vite\": \"^6.0.0\"\n  }}\n}}\n"
            );
            fs::write(project_dir.join("package.json"), package_json)
                .map_err(|e| format!("Failed to write package.json: {e}"))?;

            let index_html = format!(
                "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n    <title>{name}</title>\n  </head>\n  <body>\n    <div id=\"root\"></div>\n    <script type=\"module\" src=\"/src/main.jsx\"></script>\n  </body>\n</html>\n"
            );
            fs::write(project_dir.join("index.html"), index_html)
                .map_err(|e| format!("Failed to write index.html: {e}"))?;

            let src_dir = project_dir.join("src");
            fs::create_dir_all(&src_dir)
                .map_err(|e| format!("Failed to create src directory: {e}"))?;
            let main_jsx = format!(
                "import React from 'react';\nimport {{ createRoot }} from 'react-dom/client';\n\nfunction App() {{\n  return <main><h1>{name}</h1></main>;\n}}\n\ncreateRoot(document.getElementById('root')).render(<App />);\n"
            );
            fs::write(src_dir.join("main.jsx"), main_jsx)
                .map_err(|e| format!("Failed to write src/main.jsx: {e}"))?;
        }
        "rust" => {
            fs::write(project_dir.join(".gitignore"), "/target\n.DS_Store\n.env\n")
                .map_err(|e| format!("Failed to write .gitignore: {e}"))?;

            let crate_name = name.replace('.', "_");
            let cargo_toml = format!(
                "[package]\nname = \"{crate_name}\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n"
            );
            fs::write(project_dir.join("Cargo.toml"), cargo_toml)
                .map_err(|e| format!("Failed to write Cargo.toml: {e}"))?;

            let src_dir = project_dir.join("src");
            fs::create_dir_all(&src_dir)
                .map_err(|e| format!("Failed to create src directory: {e}"))?;
            fs::write(
                src_dir.join("main.rs"),
                format!("fn main() {{\n    println!(\"Hello from {name}\");\n}}\n"),
            )
            .map_err(|e| format!("Failed to write src/main.rs: {e}"))?;
        }
        "python" => {
            fs::write(
                project_dir.join(".gitignore"),
                "__pycache__/\n*.py[cod]\n.venv/\nvenv/\n.pytest_cache/\n.DS_Store\n.env\n",
            )
            .map_err(|e| format!("Failed to write .gitignore: {e}"))?;

            let pyproject = format!(
                "[project]\nname = \"{name}\"\nversion = \"0.1.0\"\nrequires-python = \">=3.11\"\n"
            );
            fs::write(project_dir.join("pyproject.toml"), pyproject)
                .map_err(|e| format!("Failed to write pyproject.toml: {e}"))?;

            let main_py = format!(
                "def main() -> None:\n    print(\"Hello from {name}\")\n\n\nif __name__ == \"__main__\":\n    main()\n"
            );
            fs::write(project_dir.join("main.py"), main_py)
                .map_err(|e| format!("Failed to write main.py: {e}"))?;
        }
        other => {
            return Err(format!(
                "Unsupported project template '{other}'. Expected one of: empty, react-vite, rust, python"
            ));
        }
    }

    Ok(())
}

pub fn create_local_project(
    workspace_dir: &str,
    name: &str,
    template: &str,
    create_github_remote: bool,
    private: bool,
) -> Result<String, String> {
    let workspace_path = ensure_existing_dir(workspace_dir)?;
    let safe_name = validate_folder_name(name)?;
    let normalized_template = template.trim().to_ascii_lowercase();

    if !matches!(
        normalized_template.as_str(),
        "empty" | "react-vite" | "rust" | "python"
    ) {
        return Err(format!(
            "Unsupported project template '{template}'. Expected one of: empty, react-vite, rust, python"
        ));
    }

    let project_dir = workspace_path.join(&safe_name);
    if project_dir.exists() {
        return Err(format!(
            "Project directory already exists: {}",
            project_dir.display()
        ));
    }

    fs::create_dir(&project_dir)
        .map_err(|e| format!("Failed to create project directory: {e}"))?;

    if let Err(err) = write_template_files(&project_dir, &safe_name, &normalized_template) {
        let _ = fs::remove_dir_all(&project_dir);
        return Err(err);
    }

    let git_init = Command::new("git")
        .env("PATH", extended_path_env())
        .args(["init", "-b", "main"])
        .current_dir(&project_dir)
        .output()
        .map_err(|e| format!("Failed to execute git init: {e}"))?;

    if !git_init.status.success() {
        let stderr = String::from_utf8_lossy(&git_init.stderr);
        return Err(format!("git init failed: {}", truncate_error(&stderr)));
    }

    let project_path_str = project_dir.to_string_lossy().to_string();

    if create_github_remote {
        let visibility_flag = if private { "--private" } else { "--public" };
        let gh_out = Command::new("gh")
            .env("PATH", extended_path_env())
            .args([
                "repo",
                "create",
                &safe_name,
                visibility_flag,
                "--source",
                ".",
                "--remote",
                "origin",
            ])
            .current_dir(&project_dir)
            .output();

        match gh_out {
            Ok(out) if out.status.success() => {}
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr);
                return Err(format!(
                    "Local project created at {project_path_str}, but failed to create GitHub remote: {}",
                    truncate_error(&stderr)
                ));
            }
            Err(e) => {
                return Err(format!(
                    "Local project created at {project_path_str}, but failed to run gh CLI: {e}"
                ));
            }
        }
    }

    Ok(project_path_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "affexdesk_git_providers_{label}_{}_{}",
            std::process::id(),
            nanos
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn test_validate_clone_url_accepts_https_and_git_ssh() {
        assert!(validate_clone_url("https://github.com/org/repo.git").is_ok());
        assert!(validate_clone_url("git@github.com:org/repo.git").is_ok());
        assert!(validate_clone_url("  https://gitlab.com/group/project.git  ").is_ok());
    }

    #[test]
    fn test_validate_clone_url_rejects_unsafe_schemes_and_whitespace() {
        assert!(validate_clone_url("").is_err());
        assert!(validate_clone_url("http://github.com/org/repo.git").is_err());
        assert!(validate_clone_url("file:///etc/passwd").is_err());
        assert!(validate_clone_url("ssh://git@github.com/org/repo.git").is_err());
        assert!(validate_clone_url("--upload-pack=evil").is_err());
        assert!(validate_clone_url("https://github.com/org/repo.git --config=x").is_err());
    }

    #[test]
    fn test_rejects_path_traversal_in_folder_name_and_clone_repo() {
        assert!(validate_folder_name("..").is_err());
        assert!(validate_folder_name("../escape").is_err());
        assert!(validate_folder_name("foo/../bar").is_err());
        assert!(validate_folder_name("foo/bar").is_err());
        assert!(validate_folder_name("foo\\bar").is_err());
        assert!(validate_folder_name("-leading-dash").is_err());
        assert!(validate_folder_name("valid_project-1.0").is_ok());

        let tmp = make_temp_dir("traversal");
        let tmp_str = tmp.to_string_lossy().to_string();

        let err = clone_repo(
            "https://github.com/org/repo.git",
            &tmp_str,
            Some("../escaped"),
        )
        .expect_err("traversal must be rejected");
        assert!(err.contains("traversal") || err.contains("separator"));

        let err_slash = clone_repo(
            "https://github.com/org/repo.git",
            &tmp_str,
            Some("nested/name"),
        )
        .expect_err("slash must be rejected");
        assert!(err_slash.contains("separator"));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_create_local_project_empty_and_python_templates() {
        let tmp = make_temp_dir("create_project");
        let tmp_str = tmp.to_string_lossy().to_string();

        let empty_path = create_local_project(&tmp_str, "demo-empty", "empty", false, true)
            .expect("create empty project");
        let empty_dir = PathBuf::from(&empty_path);
        assert!(empty_dir.join("README.md").is_file());
        assert!(empty_dir.join(".gitignore").is_file());
        assert!(empty_dir.join(".git").is_dir());

        let py_path = create_local_project(&tmp_str, "demo_python", "python", false, false)
            .expect("create python project");
        let py_dir = PathBuf::from(&py_path);
        assert!(py_dir.join("README.md").is_file());
        assert!(py_dir.join(".gitignore").is_file());
        assert!(py_dir.join("pyproject.toml").is_file());
        assert!(py_dir.join("main.py").is_file());
        assert!(py_dir.join(".git").is_dir());

        let py_main = fs::read_to_string(py_dir.join("main.py")).expect("read main.py");
        assert!(py_main.contains("demo_python"));

        assert!(create_local_project(&tmp_str, "../bad", "empty", false, false).is_err());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_parse_gh_user_and_remote_repo_parsers() {
        let gh_out = "github.com\n  ✓ Logged in to github.com account octocat (keyring)\n";
        assert_eq!(parse_gh_user(gh_out).as_deref(), Some("octocat"));

        let gh_legacy = "github.com\n  ✓ Logged in to github.com as hubot (/path)\n";
        assert_eq!(parse_gh_user(gh_legacy).as_deref(), Some("hubot"));

        let gh_json = json!([
            {
                "id": 42,
                "name": "affexdesk",
                "full_name": "org/affexdesk",
                "description": "Workspace manager",
                "clone_url": "https://github.com/org/affexdesk.git",
                "html_url": "https://github.com/org/affexdesk",
                "private": false,
                "default_branch": "main",
                "language": "Rust",
                "updated_at": "2026-11-27T10:00:00Z",
                "stargazers_count": 12
            }
        ]);
        let gh_repos = parse_github_repos(&gh_json).expect("parse github repos");
        assert_eq!(gh_repos.len(), 1);
        assert_eq!(gh_repos[0].provider, "github");
        assert_eq!(gh_repos[0].id, "42");
        assert_eq!(gh_repos[0].stargazers_count, 12);

        let gl_json = json!([
            {
                "id": 99,
                "name": "internal-api",
                "path_with_namespace": "team/internal-api",
                "description": "",
                "http_url_to_repo": "https://gitlab.com/team/internal-api.git",
                "web_url": "https://gitlab.com/team/internal-api",
                "visibility": "private",
                "default_branch": "main",
                "last_activity_at": "2026-11-26T08:30:00Z",
                "star_count": 3
            }
        ]);
        let gl_repos = parse_gitlab_repos(&gl_json).expect("parse gitlab repos");
        assert_eq!(gl_repos.len(), 1);
        assert_eq!(gl_repos[0].provider, "gitlab");
        assert_eq!(gl_repos[0].full_name, "team/internal-api");
        assert!(gl_repos[0].private);
        assert_eq!(gl_repos[0].description, None);
        assert_eq!(gl_repos[0].stargazers_count, 3);
    }
}
