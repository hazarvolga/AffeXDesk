use std::process::Command;

pub fn build_remote_uri(tool: &str, raw_id: &str) -> Result<String, String> {
    let cleaned_id: String = raw_id.trim().chars().filter(|c| !c.is_whitespace()).collect();
    if cleaned_id.is_empty() {
        return Err("Bağlantı ID / adresi boş olamaz.".to_string());
    }

    let valid_chars = cleaned_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ':' | '@'));
    if !valid_chars {
        return Err("Bağlantı ID geçersiz karakterler içeriyor.".to_string());
    }

    let scheme = match tool.trim().to_ascii_lowercase().as_str() {
        "rustdesk" => format!("rustdesk://{cleaned_id}"),
        "hoptodesk" => format!("hoptodesk://{cleaned_id}"),
        "anydesk" => format!("anydesk:{cleaned_id}"),
        "vnc" => format!("vnc://{cleaned_id}"),
        "rdp" => format!("rdp://{cleaned_id}"),
        "ssh" => format!("ssh://{cleaned_id}"),
        other => {
            return Err(format!(
                "Desteklenmeyen uzak bağlantı aracı: {other}"
            ))
        }
    };

    Ok(scheme)
}

pub fn launch_remote_uri(uri: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg(uri)
            .status()
            .map_err(|e| format!("Uzak bağlantı başlatılamadı: {e}"))?;
        if !status.success() {
            return Err(format!(
                "Uzak bağlantı aracı bulunamadı veya açılamadı ({uri}). İlgili uygulamanın (örn. RustDesk) kurulu olduğundan emin olun."
            ));
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        let status = Command::new("xdg-open")
            .arg(uri)
            .status()
            .map_err(|e| format!("Uzak bağlantı başlatılamadı: {e}"))?;
        if !status.success() {
            return Err(format!("Uzak bağlantı aracı açılamadı ({uri})."));
        }
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let status = Command::new("cmd")
            .args(["/C", "start", "", uri])
            .status()
            .map_err(|e| format!("Uzak bağlantı başlatılamadı: {e}"))?;
        if !status.success() {
            return Err(format!("Uzak bağlantı aracı açılamadı ({uri})."));
        }
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = uri;
        Err("Bu platform desteklenmiyor.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_remote_uri_formats_and_strips_spaces() {
        assert_eq!(
            build_remote_uri("rustdesk", "123 456 789").unwrap(),
            "rustdesk://123456789"
        );
        assert_eq!(
            build_remote_uri("anydesk", "987 654 321").unwrap(),
            "anydesk:987654321"
        );
        assert_eq!(
            build_remote_uri("vnc", "192.168.1.20:5900").unwrap(),
            "vnc://192.168.1.20:5900"
        );
    }

    #[test]
    fn build_remote_uri_rejects_injection_and_unknown_tools() {
        assert!(build_remote_uri("rustdesk", "123;rm -rf /").is_err());
        assert!(build_remote_uri("rustdesk", "").is_err());
        assert!(build_remote_uri("unknown", "123456").is_err());
    }
}
