use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, Signal, System, UpdateKind};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevProcess {
    pub pid: u32,
    pub name: String,
    pub category: String,
    pub memory_bytes: u64,
    pub cpu_pct: f32,
    pub ports: Vec<u16>,
    pub cwd: Option<String>,
    pub cmd_preview: String,
    pub runtime_secs: u64,
    pub is_zombie_candidate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevProcessReport {
    pub processes: Vec<DevProcess>,
    pub total_dev_memory_bytes: u64,
    pub zombie_count: usize,
    pub zombie_memory_bytes: u64,
    pub listening_ports_count: usize,
}

fn extract_port_from_endpoint(endpoint: &str) -> Option<u16> {
    let cleaned = endpoint
        .split_whitespace()
        .next()
        .unwrap_or("")
        .split("->")
        .next()
        .unwrap_or("")
        .trim();

    let (_, port_str) = cleaned.rsplit_once(':')?;
    port_str.parse::<u16>().ok()
}

pub fn parse_lsof_ports(output: &str) -> HashMap<u32, Vec<u16>> {
    let mut map: HashMap<u32, Vec<u16>> = HashMap::new();
    let mut current_pid: Option<u32> = None;

    for raw_line in output.lines() {
        let line = raw_line.trim();
        if let Some(pid_str) = line.strip_prefix('p') {
            current_pid = pid_str.trim().parse::<u32>().ok();
        } else if let Some(addr_str) = line.strip_prefix('n') {
            if let Some(pid) = current_pid {
                if let Some(port) = extract_port_from_endpoint(addr_str) {
                    let entry = map.entry(pid).or_default();
                    if !entry.contains(&port) {
                        entry.push(port);
                    }
                }
            }
        }
    }

    for ports in map.values_mut() {
        ports.sort_unstable();
    }

    map
}

pub fn parse_netstat_ports(output: &str) -> HashMap<u32, Vec<u16>> {
    let mut map: HashMap<u32, Vec<u16>> = HashMap::new();

    for raw_line in output.lines() {
        let cols: Vec<&str> = raw_line.split_whitespace().collect();
        if cols.len() < 5 {
            continue;
        }
        if !cols[0].eq_ignore_ascii_case("TCP") {
            continue;
        }
        if !cols[3].eq_ignore_ascii_case("LISTENING") {
            continue;
        }
        if let (Some(port), Ok(pid)) = (
            extract_port_from_endpoint(cols[1]),
            cols[4].parse::<u32>(),
        ) {
            let entry = map.entry(pid).or_default();
            if !entry.contains(&port) {
                entry.push(port);
            }
        }
    }

    for ports in map.values_mut() {
        ports.sort_unstable();
    }

    map
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn collect_listening_ports() -> HashMap<u32, Vec<u16>> {
    use std::process::Command;

    let Ok(output) = Command::new("lsof")
        .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pn"])
        .output()
    else {
        return HashMap::new();
    };

    if output.stdout.is_empty() {
        return HashMap::new();
    }

    let text = String::from_utf8_lossy(&output.stdout);
    parse_lsof_ports(&text)
}

#[cfg(target_os = "windows")]
fn collect_listening_ports() -> HashMap<u32, Vec<u16>> {
    use std::process::Command;

    let Ok(output) = Command::new("netstat").args(["-ano"]).output() else {
        return HashMap::new();
    };

    if !output.status.success() {
        return HashMap::new();
    }

    let text = String::from_utf8_lossy(&output.stdout);
    parse_netstat_ports(&text)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn collect_listening_ports() -> HashMap<u32, Vec<u16>> {
    HashMap::new()
}

fn normalize_exe_name(name: &str) -> String {
    let lower = name.trim().to_lowercase();
    lower.strip_suffix(".exe").unwrap_or(&lower).to_string()
}

fn cmd_has_token(cmd_lower: &str, keywords: &[&str]) -> bool {
    cmd_lower
        .split(|c: char| c.is_whitespace() || c == '/' || c == '\\' || c == ':' || c == '=')
        .filter(|tok| !tok.is_empty())
        .any(|tok| {
            let clean = tok.strip_suffix(".exe").unwrap_or(tok);
            keywords.iter().any(|kw| clean == *kw || clean.starts_with(&format!("{kw}-")))
        })
}

pub fn classify_dev_process(name: &str, cmd_preview: &str) -> Option<&'static str> {
    let exe = normalize_exe_name(name);
    let cmd_lower = cmd_preview.to_lowercase();

    // 1. AI runtimes (checked before Python so `python -m mlx_lm` classifies as "ai")
    let ai_keywords = ["mlx", "mlx_lm", "mlx-serve", "ollama", "vllm", "llama-server"];
    if ai_keywords
        .iter()
        .any(|kw| exe == *kw || exe.starts_with(kw))
        || cmd_has_token(&cmd_lower, &ai_keywords)
        || cmd_lower.contains("mlx_lm")
        || cmd_lower.contains("mlx-serve")
    {
        return Some("ai");
    }

    // 2. Databases
    let db_keywords = [
        "postgres",
        "postgresql",
        "redis",
        "redis-server",
        "mysqld",
        "mariadbd",
        "mongod",
        "qdrant",
    ];
    if db_keywords
        .iter()
        .any(|kw| exe == *kw || exe.starts_with(kw))
        || cmd_has_token(&cmd_lower, &db_keywords)
    {
        return Some("db");
    }

    // 3. Containers / Docker
    let docker_keywords = ["docker", "dockerd", "containerd", "colima", "podman"];
    if docker_keywords
        .iter()
        .any(|kw| exe == *kw || exe.starts_with(kw))
        || cmd_has_token(&cmd_lower, &docker_keywords)
    {
        return Some("docker");
    }

    // 4. Rust toolchain
    let rust_keywords = ["cargo", "rustc", "rust-analyzer"];
    if rust_keywords.iter().any(|kw| exe == *kw) || cmd_has_token(&cmd_lower, &rust_keywords) {
        return Some("rust");
    }

    // 5. JavaScript / TypeScript runtimes & bundlers
    let node_exes = ["node", "vite", "next", "bun", "deno", "esbuild", "tsx"];
    let node_cmd_keywords = ["vite", "next", "bun", "deno", "tsx", "ts-node", "webpack", "turbo"];
    if node_exes.iter().any(|kw| exe == *kw) || cmd_has_token(&cmd_lower, &node_cmd_keywords) {
        return Some("node");
    }

    // 6. Python runtimes & servers
    let py_exes = ["python", "python3", "uvicorn", "gunicorn", "pytest", "celery"];
    if py_exes
        .iter()
        .any(|kw| exe == *kw || exe.starts_with("python3."))
        || cmd_has_token(&cmd_lower, &["uvicorn", "gunicorn", "pytest", "celery"])
    {
        return Some("python");
    }

    None
}

fn is_zombie_candidate(cpu_pct: f32, memory_bytes: u64, runtime_secs: u64, has_ports: bool) -> bool {
    const THIRTY_MINS: u64 = 1_800;
    const SIX_HOURS: u64 = 21_600;
    const MEM_150_MB: u64 = 150 * 1024 * 1024;
    const MEM_50_MB: u64 = 50 * 1024 * 1024;

    if runtime_secs >= THIRTY_MINS && cpu_pct < 0.5 && (has_ports || memory_bytes >= MEM_150_MB) {
        return true;
    }

    runtime_secs >= SIX_HOURS && cpu_pct < 0.2 && memory_bytes >= MEM_50_MB
}

fn truncate_preview(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }
    let truncated: String = input.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{truncated}…")
}

pub fn scan_dev_processes() -> DevProcessReport {
    let port_map = collect_listening_ports();
    let self_pid = std::process::id();

    let mut sys = System::new();
    let refresh_kind = ProcessRefreshKind::new()
        .with_cpu()
        .with_memory()
        .with_cmd(UpdateKind::OnlyIfNotSet)
        .with_cwd(UpdateKind::OnlyIfNotSet);
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, refresh_kind);

    let mut processes: Vec<DevProcess> = Vec::new();

    for (pid, proc_info) in sys.processes() {
        let pid_u32 = pid.as_u32();
        if pid_u32 <= 1 || pid_u32 == self_pid {
            continue;
        }

        let name = proc_info.name().to_string_lossy().to_string();
        let cmd_joined = proc_info
            .cmd()
            .iter()
            .map(|arg| arg.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ");
        let cmd_preview = if cmd_joined.is_empty() {
            name.clone()
        } else {
            truncate_preview(&cmd_joined, 200)
        };

        let ports = port_map.get(&pid_u32).cloned().unwrap_or_default();
        let category = match classify_dev_process(&name, &cmd_preview) {
            Some(cat) => cat.to_string(),
            None if ports.iter().any(|&p| (3000..=9999).contains(&p)) => "other".to_string(),
            None => continue,
        };

        let memory_bytes = proc_info.memory();
        let raw_cpu = proc_info.cpu_usage();
        let cpu_pct = if raw_cpu.is_finite() && raw_cpu >= 0.0 {
            raw_cpu
        } else {
            0.0
        };
        let runtime_secs = proc_info.run_time();
        let cwd = proc_info
            .cwd()
            .map(|path| path.to_string_lossy().to_string());
        let zombie = is_zombie_candidate(cpu_pct, memory_bytes, runtime_secs, !ports.is_empty());

        processes.push(DevProcess {
            pid: pid_u32,
            name,
            category,
            memory_bytes,
            cpu_pct,
            ports,
            cwd,
            cmd_preview,
            runtime_secs,
            is_zombie_candidate: zombie,
        });
    }

    processes.sort_by(|a, b| {
        b.memory_bytes
            .cmp(&a.memory_bytes)
            .then_with(|| a.pid.cmp(&b.pid))
    });

    let total_dev_memory_bytes = processes.iter().map(|p| p.memory_bytes).sum();
    let zombie_count = processes.iter().filter(|p| p.is_zombie_candidate).count();
    let zombie_memory_bytes = processes
        .iter()
        .filter(|p| p.is_zombie_candidate)
        .map(|p| p.memory_bytes)
        .sum();
    let listening_ports_count = processes.iter().map(|p| p.ports.len()).sum();

    DevProcessReport {
        processes,
        total_dev_memory_bytes,
        zombie_count,
        zombie_memory_bytes,
        listening_ports_count,
    }
}

pub fn kill_dev_process(pid: u32, force: bool) -> Result<(), String> {
    if pid <= 1 || pid == std::process::id() {
        return Err("protected_pid".to_string());
    }

    let mut sys = System::new();
    let target = Pid::from_u32(pid);
    sys.refresh_processes(ProcessesToUpdate::Some(&[target]), true);

    let Some(process) = sys.process(target) else {
        return Err(format!("process_not_found:{pid}"));
    };

    let signal = if force { Signal::Kill } else { Signal::Term };
    let killed = process
        .kill_with(signal)
        .unwrap_or_else(|| process.kill());

    if killed {
        Ok(())
    } else {
        Err(format!("kill_failed:{pid}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protected_pids_are_always_rejected() {
        assert_eq!(kill_dev_process(0, false), Err("protected_pid".to_string()));
        assert_eq!(kill_dev_process(0, true), Err("protected_pid".to_string()));
        assert_eq!(kill_dev_process(1, false), Err("protected_pid".to_string()));
        assert_eq!(kill_dev_process(1, true), Err("protected_pid".to_string()));
        assert_eq!(
            kill_dev_process(std::process::id(), false),
            Err("protected_pid".to_string())
        );
        assert_eq!(
            kill_dev_process(std::process::id(), true),
            Err("protected_pid".to_string())
        );
    }

    #[test]
    fn lsof_port_parser_extracts_and_deduplicates_ports() {
        let sample = "\
p1234
f10
n*:3000
f11
n127.0.0.1:3000
f12
n[::1]:5173
p5678
n127.0.0.1:11434 (LISTEN)
p9999
ninvalid-endpoint
";
        let parsed = parse_lsof_ports(sample);
        assert_eq!(parsed.get(&1234), Some(&vec![3000, 5173]));
        assert_eq!(parsed.get(&5678), Some(&vec![11434]));
        assert!(!parsed.contains_key(&9999));
    }

    #[test]
    fn netstat_port_parser_extracts_windows_listeners() {
        let sample = "\
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4200
  TCP    [::1]:8080             [::]:0                 LISTENING       4200
  TCP    127.0.0.1:5173         127.0.0.1:54321        ESTABLISHED     4200
";
        let parsed = parse_netstat_ports(sample);
        assert_eq!(parsed.get(&4200), Some(&vec![3000, 8080]));
    }

    #[test]
    fn category_classification_matches_dev_stacks() {
        assert_eq!(classify_dev_process("node", "node /app/server.js"), Some("node"));
        assert_eq!(classify_dev_process("node", "node ./node_modules/.bin/vite"), Some("node"));
        assert_eq!(classify_dev_process("bun", "bun run dev"), Some("node"));
        assert_eq!(classify_dev_process("deno", "deno task start"), Some("node"));
        assert_eq!(classify_dev_process("python3", "python3 -m uvicorn main:app"), Some("python"));
        assert_eq!(classify_dev_process("uvicorn", "uvicorn app:app --port 8000"), Some("python"));
        assert_eq!(classify_dev_process("cargo", "cargo test"), Some("rust"));
        assert_eq!(classify_dev_process("rustc", "rustc --edition=2021"), Some("rust"));
        assert_eq!(classify_dev_process("dockerd", "/usr/bin/dockerd"), Some("docker"));
        assert_eq!(classify_dev_process("postgres", "postgres -D /var/lib/pg"), Some("db"));
        assert_eq!(classify_dev_process("redis-server", "redis-server *:6379"), Some("db"));
        assert_eq!(classify_dev_process("ollama", "ollama serve"), Some("ai"));
        assert_eq!(classify_dev_process("python3", "python3 -m mlx_lm.server --port 11234"), Some("ai"));
        assert_eq!(classify_dev_process("Finder", "/System/Library/CoreServices/Finder.app"), None);
    }

    #[test]
    fn scan_dev_processes_runs_and_sorts_by_memory_desc() {
        let report = scan_dev_processes();
        for pair in report.processes.windows(2) {
            assert!(pair[0].memory_bytes >= pair[1].memory_bytes);
        }
        assert!(serde_json::to_string(&report).is_ok());
    }
}
