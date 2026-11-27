use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

const DEFAULT_MLX_BASE_URL: &str = "http://127.0.0.1:11234/v1";
const DEFAULT_OLLAMA_ORIGIN: &str = "http://127.0.0.1:11434";
const PROBE_TIMEOUT_SECS: u64 = 2;
const MAX_WALK_ENTRIES: usize = 25_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreativeCacheItem {
    pub id: String,
    pub app: String,
    pub label: String,
    pub path: String,
    pub size_bytes: u64,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaProbeResult {
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub duration_secs: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub bitrate_kbps: Option<u64>,
    pub lufs: Option<f64>,
    pub youtube_lufs_ok: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAiModel {
    pub id: String,
    pub provider: String,
    pub state: String,
    pub bytes_on_disk: Option<u64>,
    pub bytes_resident: Option<u64>,
}

fn dir_size_bounded(root: &Path, remaining_budget: &mut usize) -> u64 {
    if *remaining_budget == 0 {
        return 0;
    }
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
        if *remaining_budget == 0 {
            break;
        }
        *remaining_budget -= 1;
        let path = entry.path();
        if let Ok(m) = fs::symlink_metadata(&path) {
            if m.file_type().is_symlink() {
                continue;
            }
            if m.is_file() {
                total = total.saturating_add(m.len());
            } else if m.is_dir() {
                total = total.saturating_add(dir_size_bounded(&path, remaining_budget));
            }
        }
    }

    total
}

fn build_cache_item(id: &str, app: &str, label: &str, path: PathBuf) -> CreativeCacheItem {
    let exists = path.exists();
    let size_bytes = if exists {
        let mut budget = MAX_WALK_ENTRIES;
        dir_size_bounded(&path, &mut budget)
    } else {
        0
    };

    CreativeCacheItem {
        id: id.to_string(),
        app: app.to_string(),
        label: label.to_string(),
        path: path.to_string_lossy().to_string(),
        size_bytes,
        exists,
    }
}

pub fn scan_creative_caches() -> Vec<CreativeCacheItem> {
    let mut items = Vec::new();
    let home = dirs::home_dir();

    #[cfg(target_os = "macos")]
    {
        if let Some(ref h) = home {
            items.push(build_cache_item(
                "davinci-cacheclip",
                "DaVinci Resolve",
                "Render CacheClip",
                h.join("Movies").join("CacheClip"),
            ));
            items.push(build_cache_item(
                "adobe-media-cache-files",
                "Adobe Creative Cloud",
                "Media Cache Files",
                h.join("Library")
                    .join("Application Support")
                    .join("Adobe")
                    .join("Common")
                    .join("Media Cache Files"),
            ));
            items.push(build_cache_item(
                "adobe-media-cache-db",
                "Adobe Creative Cloud",
                "Media Cache Database",
                h.join("Library")
                    .join("Application Support")
                    .join("Adobe")
                    .join("Common")
                    .join("Media Cache"),
            ));
        }
        items.push(build_cache_item(
            "blender-temp",
            "Blender",
            "Render Temp",
            PathBuf::from("/tmp/blender"),
        ));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(ref h) = home {
            items.push(build_cache_item(
                "davinci-cacheclip",
                "DaVinci Resolve",
                "Render CacheClip",
                h.join("Videos").join("CacheClip"),
            ));
        }
        if let Some(data_dir) = dirs::data_dir() {
            items.push(build_cache_item(
                "adobe-media-cache-files",
                "Adobe Creative Cloud",
                "Media Cache Files",
                data_dir
                    .join("Adobe")
                    .join("Common")
                    .join("Media Cache Files"),
            ));
        }
        items.push(build_cache_item(
            "blender-temp",
            "Blender",
            "Render Temp",
            std::env::temp_dir().join("blender"),
        ));
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(ref h) = home {
            items.push(build_cache_item(
                "davinci-cacheclip",
                "DaVinci Resolve",
                "Render CacheClip",
                h.join("Videos").join("CacheClip"),
            ));
        }
        items.push(build_cache_item(
            "blender-temp",
            "Blender",
            "Render Temp",
            std::env::temp_dir().join("blender"),
        ));
    }

    // Read-only size telemetry for local AI model cache (never in cleanup allowlist)
    if let Some(h) = home {
        items.push(build_cache_item(
            "huggingface-hub-readonly",
            "HuggingFace / MLX",
            "Model Hub Cache (Salt-Okunur)",
            h.join(".cache").join("huggingface").join("hub"),
        ));
    }

    items
}

fn parse_fps_fraction(raw: &str) -> Option<f64> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "0/0" {
        return None;
    }
    if let Some((num_s, den_s)) = trimmed.split_once('/') {
        let num: f64 = num_s.trim().parse().ok()?;
        let den: f64 = den_s.trim().parse().ok()?;
        if den > 0.0 && num >= 0.0 {
            let fps = num / den;
            if fps.is_finite() && fps > 0.0 {
                return Some((fps * 100.0).round() / 100.0);
            }
        }
        return None;
    }
    let val: f64 = trimmed.parse().ok()?;
    if val.is_finite() && val > 0.0 {
        Some((val * 100.0).round() / 100.0)
    } else {
        None
    }
}

pub fn parse_ffprobe_json(
    path: &str,
    size_bytes: u64,
    payload: &Value,
) -> Result<MediaProbeResult, String> {
    let file_name = Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string();

    let format_obj = payload.get("format");
    let duration_secs = format_obj
        .and_then(|f| f.get("duration"))
        .and_then(Value::as_str)
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v >= 0.0)
        .unwrap_or(0.0);

    let bitrate_kbps = format_obj
        .and_then(|f| f.get("bit_rate"))
        .and_then(Value::as_str)
        .and_then(|s| s.parse::<u64>().ok())
        .map(|bps| bps / 1000);

    let mut width: Option<u32> = None;
    let mut height: Option<u32> = None;
    let mut fps: Option<f64> = None;
    let mut video_codec: Option<String> = None;
    let mut audio_codec: Option<String> = None;

    if let Some(streams) = payload.get("streams").and_then(Value::as_array) {
        for stream in streams {
            let codec_type = stream
                .get("codec_type")
                .and_then(Value::as_str)
                .unwrap_or("");
            if codec_type == "video" && video_codec.is_none() {
                video_codec = stream
                    .get("codec_name")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                width = stream
                    .get("width")
                    .and_then(Value::as_u64)
                    .map(|v| v as u32);
                height = stream
                    .get("height")
                    .and_then(Value::as_u64)
                    .map(|v| v as u32);
                fps = stream
                    .get("avg_frame_rate")
                    .and_then(Value::as_str)
                    .and_then(parse_fps_fraction)
                    .or_else(|| {
                        stream
                            .get("r_frame_rate")
                            .and_then(Value::as_str)
                            .and_then(parse_fps_fraction)
                    });
            } else if codec_type == "audio" && audio_codec.is_none() {
                audio_codec = stream
                    .get("codec_name")
                    .and_then(Value::as_str)
                    .map(str::to_string);
            }
        }
    }

    let lufs: Option<f64> = None;
    let youtube_lufs_ok = lufs.map(|v| (-16.0..=-13.0).contains(&v));

    Ok(MediaProbeResult {
        path: path.to_string(),
        file_name,
        size_bytes,
        duration_secs,
        width,
        height,
        fps,
        video_codec,
        audio_codec,
        bitrate_kbps,
        lufs,
        youtube_lufs_ok,
    })
}

fn resolve_ffprobe_binary() -> &'static str {
    if Path::new("/opt/homebrew/bin/ffprobe").is_file() {
        "/opt/homebrew/bin/ffprobe"
    } else if Path::new("/usr/local/bin/ffprobe").is_file() {
        "/usr/local/bin/ffprobe"
    } else {
        "ffprobe"
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

pub fn inspect_media_file(path: &str) -> Result<MediaProbeResult, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Medya dosya yolu boş olamaz.".to_string());
    }

    let target = Path::new(trimmed);
    if !target.exists() || !target.is_file() {
        return Err(format!("Medya dosyası bulunamadı: {trimmed}"));
    }

    let size_bytes = fs::metadata(target).map(|m| m.len()).unwrap_or(0);
    let ffprobe = resolve_ffprobe_binary();

    let output = Command::new(ffprobe)
        .env("PATH", extended_path_env())
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            "--",
            trimmed,
        ])
        .output()
        .map_err(|err| {
            format!(
                "ffprobe çalıştırılamadı ({ffprobe}). Homebrew ile 'brew install ffmpeg' kurulu olduğundan emin olun: {err}"
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe hata döndürdü: {}", stderr.trim()));
    }

    let payload: Value = serde_json::from_slice(&output.stdout)
        .map_err(|err| format!("ffprobe JSON çıktısı ayrıştırılamadı: {err}"))?;

    parse_ffprobe_json(trimmed, size_bytes, &payload)
}

pub fn pick_media_file() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("osascript")
            .args([
                "-e",
                r#"POSIX path of (choose file with prompt "Medya dosyası seçin" of type {"public.movie", "public.audio", "mp4", "mov", "mkv", "webm", "wav", "mp3", "m4a", "flac"})"#,
            ])
            .output()
            .map_err(|err| format!("osascript failed: {err}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("-128") || stderr.to_lowercase().contains("cancel") {
                return Ok(None);
            }
            return Err(format!("medya seçici hatası: {}", stderr.trim()));
        }

        let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if selected.is_empty() {
            Ok(None)
        } else {
            Ok(Some(selected))
        }
    }

    #[cfg(target_os = "linux")]
    {
        let output = Command::new("zenity")
            .args([
                "--file-selection",
                "--title=Medya dosyası seçin",
                "--file-filter=Medya | *.mp4 *.mov *.mkv *.webm *.wav *.mp3 *.m4a *.flac",
            ])
            .output()
            .map_err(|err| format!("zenity failed: {err}"))?;

        if !output.status.success() {
            return Ok(None);
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
        let script = r#"Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Filter = 'Media Files|*.mp4;*.mov;*.mkv;*.webm;*.wav;*.mp3;*.m4a;*.flac|All Files|*.*'; if ($f.ShowDialog() -eq 'OK') { Write-Output $f.FileName }"#;
        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", script])
            .output()
            .map_err(|err| format!("powershell file picker failed: {err}"))?;

        if !output.status.success() {
            return Ok(None);
        }
        let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if selected.is_empty() {
            Ok(None)
        } else {
            Ok(Some(selected))
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Err("Bu işletim sisteminde dosya seçici desteklenmiyor.".to_string())
    }
}

pub async fn scan_local_ai_models(settings: &HashMap<String, String>) -> Vec<LocalAiModel> {
    let client = match Client::builder()
        .timeout(Duration::from_secs(PROBE_TIMEOUT_SECS))
        .build()
    {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut models = Vec::new();

    let mlx_base = settings
        .get("ai_base_url")
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty() && !s.contains(":11434"))
        .map(|s| {
            if s.ends_with("/v1") {
                s
            } else {
                format!("{s}/v1")
            }
        })
        .unwrap_or_else(|| DEFAULT_MLX_BASE_URL.to_string());

    if let Ok(resp) = client.get(format!("{mlx_base}/models")).send().await {
        if resp.status().is_success() {
            if let Ok(body) = resp.json::<Value>().await {
                if let Some(arr) = body.get("data").and_then(Value::as_array) {
                    for item in arr {
                        if let Some(id) = item.get("id").and_then(Value::as_str) {
                            let trimmed = id.trim();
                            if !trimmed.is_empty() {
                                models.push(LocalAiModel {
                                    id: trimmed.to_string(),
                                    provider: "mlx-serve".to_string(),
                                    state: "ready".to_string(),
                                    bytes_on_disk: item.get("size").and_then(Value::as_u64),
                                    bytes_resident: item
                                        .get("memory_bytes")
                                        .and_then(Value::as_u64),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    let mut ollama_resident: HashMap<String, u64> = HashMap::new();
    if let Ok(resp) = client
        .get(format!("{DEFAULT_OLLAMA_ORIGIN}/api/ps"))
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(body) = resp.json::<Value>().await {
                if let Some(arr) = body.get("models").and_then(Value::as_array) {
                    for item in arr {
                        if let Some(name) = item.get("name").and_then(Value::as_str) {
                            let resident = item
                                .get("size_vram")
                                .and_then(Value::as_u64)
                                .or_else(|| item.get("size").and_then(Value::as_u64))
                                .unwrap_or(0);
                            ollama_resident.insert(name.trim().to_string(), resident);
                        }
                    }
                }
            }
        }
    }

    if let Ok(resp) = client
        .get(format!("{DEFAULT_OLLAMA_ORIGIN}/api/tags"))
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(body) = resp.json::<Value>().await {
                if let Some(arr) = body.get("models").and_then(Value::as_array) {
                    for item in arr {
                        if let Some(name) = item.get("name").and_then(Value::as_str) {
                            let trimmed = name.trim();
                            if !trimmed.is_empty() {
                                let resident = ollama_resident.get(trimmed).copied();
                                models.push(LocalAiModel {
                                    id: trimmed.to_string(),
                                    provider: "ollama".to_string(),
                                    state: if resident.is_some() {
                                        "loaded".to_string()
                                    } else {
                                        "available".to_string()
                                    },
                                    bytes_on_disk: item.get("size").and_then(Value::as_u64),
                                    bytes_resident: resident,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    models
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_ffprobe_json_extracts_video_audio_and_fps() {
        let sample = json!({
            "format": {
                "duration": "612.45",
                "bit_rate": "8500000"
            },
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 1920,
                    "height": 1080,
                    "avg_frame_rate": "24000/1001"
                },
                {
                    "codec_type": "audio",
                    "codec_name": "aac"
                }
            ]
        });

        let parsed = parse_ffprobe_json("/tmp/sample_video.mp4", 42_000_000, &sample).unwrap();
        assert_eq!(parsed.file_name, "sample_video.mp4");
        assert_eq!(parsed.size_bytes, 42_000_000);
        assert!((parsed.duration_secs - 612.45).abs() < 0.01);
        assert_eq!(parsed.width, Some(1920));
        assert_eq!(parsed.height, Some(1080));
        assert_eq!(parsed.fps, Some(23.98));
        assert_eq!(parsed.video_codec.as_deref(), Some("h264"));
        assert_eq!(parsed.audio_codec.as_deref(), Some("aac"));
        assert_eq!(parsed.bitrate_kbps, Some(8500));
    }

    #[test]
    fn inspect_media_file_rejects_missing_and_empty_paths() {
        assert!(inspect_media_file("").is_err());
        assert!(inspect_media_file("/nonexistent/path/video.mp4").is_err());
    }

    #[test]
    fn scan_creative_caches_is_panic_free() {
        let items = scan_creative_caches();
        assert!(!items.is_empty());
        assert!(items.iter().all(|i| !i.id.is_empty() && !i.path.is_empty()));
    }
}
