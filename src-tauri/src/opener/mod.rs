use std::path::Path;
use std::process::Command;

/// Opens a local directory or file in the operating system's native file manager.
pub fn open_in_file_manager(path: &str) -> Result<(), String> {
    let target = validate_existing_path(path)?;

    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(target).spawn();

    #[cfg(target_os = "windows")]
    let status = Command::new("explorer").arg(target).spawn();

    #[cfg(target_os = "linux")]
    let status = Command::new("xdg-open").arg(target).spawn();

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let status: std::io::Result<std::process::Child> = Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "unsupported operating system",
    ));

    status
        .map(|_| ())
        .map_err(|err| format!("failed to open file manager for '{path}': {err}"))
}

/// Opens a project directory in the requested IDE (`code`, `cursor`, `antigravity`),
/// or auto-detects an available IDE, falling back to the native file manager.
pub fn open_in_ide(path: &str, ide: Option<&str>) -> Result<(), String> {
    let target = validate_existing_path(path)?;

    let candidates: Vec<&str> = match ide.map(str::trim).filter(|s| !s.is_empty()) {
        Some(requested) => {
            if !is_safe_ide_name(requested) {
                return Err(format!("invalid_ide_name: '{requested}'"));
            }
            vec![requested]
        }
        None => vec!["cursor", "code", "antigravity"],
    };

    for candidate in &candidates {
        if try_spawn_ide(candidate, target) {
            return Ok(());
        }
    }

    open_in_file_manager(path)
}

/// Opens an HTTP or HTTPS URL in the default system browser.
/// Rejects any non-HTTP(S) scheme for security.
pub fn open_url(url: &str) -> Result<(), String> {
    let clean_url = validate_http_url(url)?;

    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(clean_url).spawn();

    #[cfg(target_os = "windows")]
    let status = Command::new("explorer").arg(clean_url).spawn();

    #[cfg(target_os = "linux")]
    let status = Command::new("xdg-open").arg(clean_url).spawn();

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let status: std::io::Result<std::process::Child> = Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "unsupported operating system",
    ));

    status
        .map(|_| ())
        .map_err(|err| format!("failed to open url '{clean_url}': {err}"))
}

/// Prompts the user with a native OS folder picker dialog.
/// Returns `Ok(None)` if the user cancels the dialog.
pub fn pick_directory() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("osascript")
            .args([
                "-e",
                r#"POSIX path of (choose folder with prompt "Select workspace directory")"#,
            ])
            .output()
            .map_err(|err| format!("osascript failed: {err}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("-128") || stderr.to_lowercase().contains("cancel") {
                return Ok(None);
            }
            return Err(format!("folder picker error: {}", stderr.trim()));
        }

        let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if selected.is_empty() {
            return Ok(None);
        }
        let normalized = selected.trim_end_matches('/');
        if normalized.is_empty() {
            Ok(Some("/".to_string()))
        } else {
            Ok(Some(normalized.to_string()))
        }
    }

    #[cfg(target_os = "linux")]
    {
        let output = Command::new("zenity")
            .args([
                "--file-selection",
                "--directory",
                "--title=Select workspace directory",
            ])
            .output()
            .map_err(|err| format!("zenity failed: {err}"))?;

        if !output.status.success() {
            // Exit code 1 means user cancelled the dialog.
            if output.status.code() == Some(1) {
                return Ok(None);
            }
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("folder picker error: {}", stderr.trim()));
        }

        let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if selected.is_empty() {
            Ok(None)
        } else {
            Ok(Some(selected))
        }
    }

    #[cfg(target_os = "windows")]
    {
        let script = concat!(
            "Add-Type -AssemblyName System.Windows.Forms; ",
            "$d = New-Object System.Windows.Forms.FolderBrowserDialog; ",
            "$d.Description = 'Select workspace directory'; ",
            "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }"
        );
        let output = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
            .map_err(|err| format!("powershell failed: {err}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("folder picker error: {}", stderr.trim()));
        }

        let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if selected.is_empty() {
            Ok(None)
        } else {
            Ok(Some(selected))
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("unsupported operating system".to_string())
    }
}

fn validate_existing_path(path: &str) -> Result<&Path, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("invalid_path: empty path".to_string());
    }
    let p = Path::new(trimmed);
    if !p.exists() {
        return Err(format!("path_not_found: '{trimmed}'"));
    }
    Ok(p)
}

fn validate_http_url(url: &str) -> Result<&str, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("invalid_url_scheme: empty url".to_string());
    }
    if trimmed.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(format!("invalid_url_scheme: control or whitespace in '{trimmed}'"));
    }
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        Ok(trimmed)
    } else {
        Err(format!(
            "invalid_url_scheme: only http:// and https:// are allowed ('{trimmed}')"
        ))
    }
}

fn is_safe_ide_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn try_spawn_ide(ide: &str, target: &Path) -> bool {
    if Command::new(ide).arg(target).spawn().is_ok() {
        return true;
    }

    #[cfg(target_os = "macos")]
    {
        let app_name = match ide.to_lowercase().as_str() {
            "code" => Some("Visual Studio Code"),
            "cursor" => Some("Cursor"),
            "antigravity" => Some("Antigravity"),
            _ => None,
        };
        if let Some(app) = app_name {
            if Command::new("open")
                .args(["-a", app])
                .arg(target)
                .spawn()
                .is_ok()
            {
                return true;
            }
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_http_url_allows_http_and_https_only() {
        assert_eq!(
            validate_http_url("https://affexai.com"),
            Ok("https://affexai.com")
        );
        assert_eq!(
            validate_http_url("http://localhost:3000"),
            Ok("http://localhost:3000")
        );
        assert!(open_url("file:///etc/passwd").is_err());
        assert!(open_url("javascript:alert(1)").is_err());
        assert!(open_url("ftp://example.com").is_err());
        assert!(open_url("https://example.com\nrm -rf /").is_err());
        assert!(open_url("").is_err());
    }

    #[test]
    fn test_open_rejects_missing_path() {
        let missing = "/nonexistent_affexdesk_path_123456789";
        assert!(open_in_file_manager(missing).is_err());
        assert!(open_in_ide(missing, Some("code")).is_err());
    }

    #[test]
    fn test_ide_name_validation() {
        assert!(is_safe_ide_name("code"));
        assert!(is_safe_ide_name("cursor"));
        assert!(is_safe_ide_name("antigravity"));
        assert!(!is_safe_ide_name("code; rm -rf /"));
        assert!(!is_safe_ide_name("../bin/sh"));
    }
}
