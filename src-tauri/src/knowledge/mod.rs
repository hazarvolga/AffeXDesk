use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasetCard {
    pub id: String,
    pub title: String,
    pub path: String,
    pub summary: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeOverview {
    pub configured: bool,
    pub root_dir: Option<String>,
    pub index_exists: bool,
    pub search_script_exists: bool,
    pub dataset_count: usize,
    pub datasets: Vec<DatasetCard>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeSearchHit {
    pub source: String,
    pub title: String,
    pub snippet: String,
    pub path: Option<String>,
}

fn resolve_exports_dir(root: &Path) -> PathBuf {
    let nested = root.join("exports");
    if nested.is_dir() {
        nested
    } else if root.join("INDEX.md").is_file() || root.join("_index").is_dir() {
        root.to_path_buf()
    } else {
        nested
    }
}

fn truncate_chars(input: &str, max_chars: usize) -> String {
    let trimmed = input.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(max_chars.saturating_sub(1)).collect();
    out.push('…');
    out
}

fn extract_markdown_title_and_summary(content: &str, fallback_id: &str) -> (String, String) {
    let mut title: Option<String> = None;
    let mut summary_lines: Vec<String> = Vec::new();
    let mut in_frontmatter = false;
    let mut in_code_block = false;

    for (idx, raw_line) in content.lines().enumerate() {
        let line = raw_line.trim();

        if idx == 0 && line == "---" {
            in_frontmatter = true;
            continue;
        }
        if in_frontmatter {
            if line == "---" {
                in_frontmatter = false;
            }
            continue;
        }

        if line.starts_with("```") {
            in_code_block = !in_code_block;
            continue;
        }
        if in_code_block {
            continue;
        }

        if line.is_empty() || line == "---" || line == "***" {
            if !summary_lines.is_empty() {
                break;
            }
            continue;
        }

        if let Some(heading) = line.strip_prefix("# ") {
            if title.is_none() {
                let h = heading.trim();
                if !h.is_empty() {
                    title = Some(h.to_string());
                }
            }
            continue;
        }

        if line.starts_with('#') {
            if title.is_none() {
                let h = line.trim_start_matches('#').trim();
                if !h.is_empty() {
                    title = Some(h.to_string());
                }
            }
            continue;
        }

        let cleaned = line
            .trim_start_matches(|c: char| c == '>' || c == '-' || c == '*' || c.is_whitespace())
            .trim();
        if !cleaned.is_empty() {
            summary_lines.push(cleaned.to_string());
            if summary_lines.join(" ").chars().count() >= 180 {
                break;
            }
        }
    }

    let final_title = title.unwrap_or_else(|| fallback_id.replace(['-', '_'], " "));
    let final_summary = if summary_lines.is_empty() {
        String::new()
    } else {
        truncate_chars(&summary_lines.join(" "), 220)
    };

    (final_title, final_summary)
}

fn read_dataset_cards(datasets_dir: &Path) -> Vec<DatasetCard> {
    let mut cards = Vec::new();
    let entries = match fs::read_dir(datasets_dir) {
        Ok(e) => e,
        Err(_) => return cards,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_md = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !is_md {
            continue;
        }

        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("dataset")
            .to_string();
        let size_bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let content = fs::read_to_string(&path).unwrap_or_default();
        let (title, summary) = extract_markdown_title_and_summary(&content, &id);

        cards.push(DatasetCard {
            id,
            title,
            path: path.to_string_lossy().to_string(),
            summary,
            size_bytes,
        });
    }

    cards.sort_by_key(|a| a.id.to_lowercase());
    cards
}

pub fn inspect_knowledge_hub(root_dir: Option<&str>) -> KnowledgeOverview {
    let trimmed = match root_dir.map(str::trim).filter(|s| !s.is_empty()) {
        Some(dir) => dir,
        None => {
            return KnowledgeOverview {
                configured: false,
                root_dir: None,
                index_exists: false,
                search_script_exists: false,
                dataset_count: 0,
                datasets: Vec::new(),
            };
        }
    };

    let root = Path::new(trimmed);
    let exports_dir = resolve_exports_dir(root);
    let index_path = exports_dir.join("INDEX.md");
    let search_script_path = exports_dir.join("_index").join("search_hub.py");
    let datasets_dir = exports_dir.join("_index").join("datasets");

    let index_exists = index_path.is_file();
    let search_script_exists = search_script_path.is_file();
    let datasets = if datasets_dir.is_dir() {
        read_dataset_cards(&datasets_dir)
    } else {
        Vec::new()
    };
    let dataset_count = datasets.len();

    KnowledgeOverview {
        configured: true,
        root_dir: Some(trimmed.to_string()),
        index_exists,
        search_script_exists,
        dataset_count,
        datasets,
    }
}

fn parse_script_output(stdout: &str, limit: usize) -> Vec<KnowledgeSearchHit> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(trimmed) {
        let items = json_val
            .as_array()
            .cloned()
            .or_else(|| json_val.get("results").and_then(|v| v.as_array()).cloned())
            .or_else(|| json_val.get("hits").and_then(|v| v.as_array()).cloned());

        if let Some(arr) = items {
            let mut hits = Vec::new();
            for item in arr.into_iter().take(limit) {
                let source = item
                    .get("source")
                    .or_else(|| item.get("dataset"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("search_hub")
                    .to_string();
                let title = item
                    .get("title")
                    .or_else(|| item.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(&source)
                    .to_string();
                let snippet = item
                    .get("snippet")
                    .or_else(|| item.get("summary"))
                    .or_else(|| item.get("text"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let path = item
                    .get("path")
                    .or_else(|| item.get("file"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                if !title.is_empty() || !snippet.is_empty() {
                    hits.push(KnowledgeSearchHit {
                        source,
                        title,
                        snippet: truncate_chars(&snippet, 260),
                        path,
                    });
                }
            }
            if !hits.is_empty() {
                return hits;
            }
        }
    }

    let mut hits = Vec::new();
    for raw_line in trimmed.lines() {
        if hits.len() >= limit {
            break;
        }
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with("---") || line.starts_with("===") {
            continue;
        }
        let cleaned = line.trim_start_matches(|c: char| c == '-' || c == '*' || c.is_whitespace());
        if cleaned.is_empty() {
            continue;
        }

        if let Some((left, right)) = cleaned.split_once('|') {
            let parts: Vec<&str> = cleaned.split('|').map(str::trim).collect();
            let source = parts.first().copied().unwrap_or("search_hub").to_string();
            let title = parts
                .get(1)
                .copied()
                .filter(|s| !s.is_empty())
                .unwrap_or(left.trim())
                .to_string();
            let snippet = if parts.len() >= 3 {
                parts[2..].join(" | ")
            } else {
                right.trim().to_string()
            };
            hits.push(KnowledgeSearchHit {
                source,
                title,
                snippet: truncate_chars(&snippet, 260),
                path: None,
            });
        } else if let Some(rest) = cleaned.strip_prefix('[') {
            if let Some((src, after)) = rest.split_once(']') {
                let after = after.trim();
                let (title, snippet) = if let Some((t, s)) = after.split_once(':') {
                    (t.trim().to_string(), s.trim().to_string())
                } else {
                    (src.trim().to_string(), after.to_string())
                };
                hits.push(KnowledgeSearchHit {
                    source: src.trim().to_string(),
                    title,
                    snippet: truncate_chars(&snippet, 260),
                    path: None,
                });
            }
        } else if let Some((title, snippet)) = cleaned.split_once(':') {
            hits.push(KnowledgeSearchHit {
                source: "search_hub".to_string(),
                title: title.trim().to_string(),
                snippet: truncate_chars(snippet.trim(), 260),
                path: None,
            });
        } else {
            hits.push(KnowledgeSearchHit {
                source: "search_hub".to_string(),
                title: truncate_chars(cleaned, 80),
                snippet: truncate_chars(cleaned, 260),
                path: None,
            });
        }
    }

    hits
}

fn search_markdown_file(
    file_path: &Path,
    source: &str,
    query_lower: &str,
    terms: &[String],
) -> Option<(usize, KnowledgeSearchHit)> {
    let content = fs::read_to_string(file_path).ok()?;
    let (title, _) = extract_markdown_title_and_summary(&content, source);
    let title_lower = title.to_lowercase();

    let mut score: usize = 0;
    if title_lower.contains(query_lower) {
        score += 10;
    } else {
        for term in terms {
            if title_lower.contains(term) {
                score += 3;
            }
        }
    }

    let mut best_line: Option<(usize, String)> = None;
    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        let lower = line.to_lowercase();
        let mut line_score = 0;
        if lower.contains(query_lower) {
            line_score += 8;
        }
        for term in terms {
            if lower.contains(term) {
                line_score += 2;
            }
        }
        if line_score > 0 {
            score += line_score;
            let replace = match &best_line {
                None => true,
                Some((prev_score, _)) => line_score > *prev_score,
            };
            if replace {
                best_line = Some((line_score, line.to_string()));
            }
        }
    }

    if score == 0 {
        return None;
    }

    let snippet = best_line
        .map(|(_, line)| truncate_chars(&line, 260))
        .unwrap_or_else(|| truncate_chars(&title, 260));

    Some((
        score,
        KnowledgeSearchHit {
            source: source.to_string(),
            title,
            snippet,
            path: Some(file_path.to_string_lossy().to_string()),
        },
    ))
}

fn rust_fallback_search(exports_dir: &Path, query: &str, limit: usize) -> Vec<KnowledgeSearchHit> {
    let query_lower = query.to_lowercase();
    let terms: Vec<String> = query_lower
        .split_whitespace()
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .collect();

    let mut scored_hits: Vec<(usize, KnowledgeSearchHit)> = Vec::new();

    let index_path = exports_dir.join("INDEX.md");
    if index_path.is_file() {
        if let Some(hit) = search_markdown_file(&index_path, "INDEX", &query_lower, &terms) {
            scored_hits.push(hit);
        }
    }

    let datasets_dir = exports_dir.join("_index").join("datasets");
    if let Ok(entries) = fs::read_dir(&datasets_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let is_md = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("md"))
                .unwrap_or(false);
            if !is_md {
                continue;
            }
            let source = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("dataset");
            if let Some(hit) = search_markdown_file(&path, source, &query_lower, &terms) {
                scored_hits.push(hit);
            }
        }
    }

    scored_hits.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.source.cmp(&b.1.source)));
    scored_hits
        .into_iter()
        .take(limit)
        .map(|(_, hit)| hit)
        .collect()
}

fn extended_path_env() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    if cfg!(target_os = "macos") {
        format!("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:{current}")
    } else {
        current
    }
}

pub fn search_knowledge_hub(
    root_dir: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<KnowledgeSearchHit>, String> {
    let trimmed_root = root_dir.trim();
    if trimmed_root.is_empty() {
        return Err("Bilgi bankası kök dizini boş olamaz.".to_string());
    }

    let trimmed_query = query.trim();
    if trimmed_query.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }

    let root = Path::new(trimmed_root);
    if !root.exists() {
        return Err(format!("Bilgi bankası dizini bulunamadı: {}", trimmed_root));
    }

    let exports_dir = resolve_exports_dir(root);
    let script_path = exports_dir.join("_index").join("search_hub.py");

    if script_path.is_file() {
        if let Ok(output) = Command::new("python3")
            .env("PATH", extended_path_env())
            .arg(&script_path)
            .arg("search")
            .arg("--compact")
            .arg("--")
            .arg(trimmed_query)
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let parsed = parse_script_output(&stdout, limit);
                if !parsed.is_empty() {
                    return Ok(parsed);
                }
            }
        }
    }

    Ok(rust_fallback_search(&exports_dir, trimmed_query, limit))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_hub(suffix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "affexdesk_knowledge_test_{}_{}_{}",
            std::process::id(),
            suffix,
            nanos
        ));
        fs::create_dir_all(dir.join("exports").join("_index").join("datasets")).unwrap();
        dir
    }

    #[test]
    fn inspect_unconfigured_returns_empty_overview() {
        let overview = inspect_knowledge_hub(None);
        assert!(!overview.configured);
        assert!(overview.root_dir.is_none());
        assert!(!overview.index_exists);
        assert!(!overview.search_script_exists);
        assert_eq!(overview.dataset_count, 0);
        assert!(overview.datasets.is_empty());

        let blank = inspect_knowledge_hub(Some("   "));
        assert!(!blank.configured);
    }

    #[test]
    fn inspect_and_search_temp_knowledge_hub() {
        let tmp = make_temp_hub("inspect_search");
        let exports = tmp.join("exports");

        fs::write(
            exports.join("INDEX.md"),
            "# Ana Bilgi İndeksi\n\nBu indeks BIM, IFC ve otomasyon veri setlerini listeler.\n",
        )
        .unwrap();

        fs::write(
            exports.join("_index").join("datasets").join("test.md"),
            "# Örnek BIM Veri Seti\n\nIFC 4.3 şemaları, metraj kuralları ve yapı elemanı sınıflandırmaları.\n\n## Detay\nPoz analizi için hazır referans.\n",
        )
        .unwrap();

        let root_str = tmp.to_string_lossy().to_string();
        let overview = inspect_knowledge_hub(Some(&root_str));

        assert!(overview.configured);
        assert_eq!(overview.root_dir.as_deref(), Some(root_str.as_str()));
        assert!(overview.index_exists);
        assert!(!overview.search_script_exists);
        assert_eq!(overview.dataset_count, 1);
        assert_eq!(overview.datasets[0].id, "test");
        assert_eq!(overview.datasets[0].title, "Örnek BIM Veri Seti");
        assert!(overview.datasets[0].summary.contains("IFC 4.3"));
        assert!(overview.datasets[0].size_bytes > 0);

        let hits = search_knowledge_hub(&root_str, "ifc", 5).unwrap();
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().any(|h| h.source == "test"));
        assert!(hits.iter().any(|h| h.source == "INDEX"));
        assert!(hits.iter().all(|h| h.path.is_some()));

        let limited = search_knowledge_hub(&root_str, "ifc", 1).unwrap();
        assert_eq!(limited.len(), 1);

        let _ = fs::remove_dir_all(&tmp);
    }
}
