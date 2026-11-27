use chrono::Utc;
use serde::{Deserialize, Serialize};
use sysinfo::{Components, Disks, System};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemMetrics {
    pub cpu_usage_pct: f32,
    pub cpu_cores: usize,
    pub cpu_brand: String,
    pub mem_total_bytes: u64,
    pub mem_used_bytes: u64,
    pub mem_used_pct: f32,
    pub mem_pressure: String,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
    pub disk_total_bytes: u64,
    pub disk_available_bytes: u64,
    pub disk_used_pct: f32,
    pub temperature_c: Option<f32>,
    pub thermal_state: String,
    pub gpu_label: String,
    pub os_name: String,
    pub hostname: String,
    pub uptime_secs: u64,
    pub collected_at: String,
}

pub fn classify_mem_pressure(mem_used_pct: f32) -> String {
    if !mem_used_pct.is_finite() {
        return "normal".to_string();
    }
    if mem_used_pct >= 88.0 {
        "critical".to_string()
    } else if mem_used_pct >= 75.0 {
        "warn".to_string()
    } else {
        "normal".to_string()
    }
}

pub fn classify_thermal_state(temperature_c: Option<f32>) -> String {
    match temperature_c {
        Some(t) if t.is_finite() && t >= 95.0 => "critical".to_string(),
        Some(t) if t.is_finite() && t >= 85.0 => "serious".to_string(),
        Some(t) if t.is_finite() && t >= 72.0 => "fair".to_string(),
        _ => "nominal".to_string(),
    }
}

fn thermal_severity(state: &str) -> u8 {
    match state {
        "critical" => 3,
        "serious" => 2,
        "fair" => 1,
        _ => 0,
    }
}

pub fn parse_macos_pmset_therm(output: &str) -> Option<String> {
    let mut speed_limit: Option<u32> = None;

    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("CPU_Speed_Limit") {
            if let Some(val_str) = rest.split('=').nth(1) {
                if let Ok(val) = val_str.trim().parse::<u32>() {
                    speed_limit = Some(val);
                }
            }
        }
    }

    speed_limit.map(|limit| {
        if limit < 60 {
            "critical".to_string()
        } else if limit < 80 {
            "serious".to_string()
        } else if limit < 95 {
            "fair".to_string()
        } else {
            "nominal".to_string()
        }
    })
}

fn read_primary_disk_usage() -> (u64, u64, f32) {
    let disks = Disks::new_with_refreshed_list();
    if disks.is_empty() {
        return (0, 0, 0.0);
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
            let used_pct = if total > 0 {
                ((used as f64 / total as f64) * 100.0) as f32
            } else {
                0.0
            };
            (total, available, used_pct.clamp(0.0, 100.0))
        }
        None => (0, 0, 0.0),
    }
}

fn read_temperature_c() -> Option<f32> {
    let components = Components::new_with_refreshed_list();
    let mut preferred_max: Option<f32> = None;
    let mut fallback_max: Option<f32> = None;

    for comp in &components {
        let temp = comp.temperature();
        if !temp.is_finite() || temp <= 0.0 || temp >= 150.0 {
            continue;
        }
        let label = comp.label().to_lowercase();
        let is_cpu_sensor = label.contains("cpu")
            || label.contains("soc")
            || label.contains("package")
            || label.contains("tctl")
            || label.contains("tdie")
            || label.contains("core");

        if is_cpu_sensor {
            preferred_max = Some(preferred_max.map_or(temp, |prev| prev.max(temp)));
        }
        fallback_max = Some(fallback_max.map_or(temp, |prev| prev.max(temp)));
    }

    preferred_max.or(fallback_max)
}

#[cfg(target_os = "macos")]
fn enrich_macos_hardware(
    cpu_brand: &mut String,
    thermal_state: &mut String,
) -> String {
    use std::process::Command;

    if let Ok(output) = Command::new("sysctl")
        .args(["-n", "machdep.cpu.brand_string"])
        .output()
    {
        if output.status.success() {
            let brand = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !brand.is_empty() {
                *cpu_brand = brand;
            }
        }
    }

    if let Ok(output) = Command::new("pmset").args(["-g", "therm"]).output() {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            if let Some(pmset_state) = parse_macos_pmset_therm(&text) {
                if thermal_severity(&pmset_state) > thermal_severity(thermal_state) {
                    *thermal_state = pmset_state;
                }
            }
        }
    }

    if cpu_brand.contains("Apple ") {
        format!("{cpu_brand} Integrated GPU")
    } else if !cpu_brand.is_empty() && cpu_brand != "Unknown CPU" {
        format!("{cpu_brand} Graphics")
    } else {
        "Apple GPU".to_string()
    }
}

#[cfg(not(target_os = "macos"))]
fn enrich_macos_hardware(
    _cpu_brand: &mut String,
    _thermal_state: &mut String,
) -> String {
    if cfg!(target_os = "windows") {
        "Windows Display Adapter".to_string()
    } else {
        "System GPU".to_string()
    }
}

pub fn collect_system_metrics() -> SystemMetrics {
    let mut sys = System::new_all();
    sys.refresh_cpu_usage();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let raw_cpu = sys.global_cpu_usage();
    let cpu_usage_pct = if raw_cpu.is_finite() {
        raw_cpu.clamp(0.0, 100.0)
    } else {
        0.0
    };
    let cpu_cores = sys.cpus().len();
    let mut cpu_brand = sys
        .cpus()
        .iter()
        .map(|c| c.brand().trim())
        .find(|b| !b.is_empty())
        .unwrap_or("Unknown CPU")
        .to_string();

    let mem_total_bytes = sys.total_memory();
    let mem_used_bytes = sys.used_memory().min(mem_total_bytes);
    let mem_used_pct = if mem_total_bytes > 0 {
        (((mem_used_bytes as f64 / mem_total_bytes as f64) * 100.0) as f32).clamp(0.0, 100.0)
    } else {
        0.0
    };
    let mem_pressure = classify_mem_pressure(mem_used_pct);

    let swap_total_bytes = sys.total_swap();
    let swap_used_bytes = sys.used_swap().min(swap_total_bytes);

    let (disk_total_bytes, disk_available_bytes, disk_used_pct) = read_primary_disk_usage();

    let temperature_c = read_temperature_c();
    let mut thermal_state = classify_thermal_state(temperature_c);
    let gpu_label = enrich_macos_hardware(&mut cpu_brand, &mut thermal_state);

    let os_name = System::long_os_version()
        .or_else(System::name)
        .unwrap_or_else(|| std::env::consts::OS.to_string());
    let hostname = System::host_name().unwrap_or_else(|| "unknown".to_string());
    let uptime_secs = System::uptime();
    let collected_at = Utc::now().to_rfc3339();

    SystemMetrics {
        cpu_usage_pct,
        cpu_cores,
        cpu_brand,
        mem_total_bytes,
        mem_used_bytes,
        mem_used_pct,
        mem_pressure,
        swap_total_bytes,
        swap_used_bytes,
        disk_total_bytes,
        disk_available_bytes,
        disk_used_pct,
        temperature_c,
        thermal_state,
        gpu_label,
        os_name,
        hostname,
        uptime_secs,
        collected_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mem_pressure_thresholds_classify_correctly() {
        assert_eq!(classify_mem_pressure(0.0), "normal");
        assert_eq!(classify_mem_pressure(74.9), "normal");
        assert_eq!(classify_mem_pressure(75.0), "warn");
        assert_eq!(classify_mem_pressure(87.9), "warn");
        assert_eq!(classify_mem_pressure(88.0), "critical");
        assert_eq!(classify_mem_pressure(100.0), "critical");
        assert_eq!(classify_mem_pressure(f32::NAN), "normal");
    }

    #[test]
    fn thermal_state_thresholds_classify_correctly() {
        assert_eq!(classify_thermal_state(None), "nominal");
        assert_eq!(classify_thermal_state(Some(55.0)), "nominal");
        assert_eq!(classify_thermal_state(Some(72.0)), "fair");
        assert_eq!(classify_thermal_state(Some(85.0)), "serious");
        assert_eq!(classify_thermal_state(Some(95.0)), "critical");
    }

    #[test]
    fn macos_pmset_therm_parser_handles_speed_limits() {
        let nominal = "Note: No thermal warning level has been recorded\n\tCPU_Scheduler_Limit \t= 100\n\tCPU_Available_CPUs \t= 18\n\tCPU_Speed_Limit \t= 100\n";
        assert_eq!(parse_macos_pmset_therm(nominal), Some("nominal".to_string()));

        let throttled = "\tCPU_Speed_Limit \t= 72\n";
        assert_eq!(parse_macos_pmset_therm(throttled), Some("serious".to_string()));

        let critical = "\tCPU_Speed_Limit = 45\n";
        assert_eq!(parse_macos_pmset_therm(critical), Some("critical".to_string()));

        assert_eq!(parse_macos_pmset_therm(""), None);
    }

    #[test]
    fn collect_system_metrics_is_panic_free_and_well_formed() {
        let metrics = collect_system_metrics();
        assert!(metrics.cpu_usage_pct >= 0.0 && metrics.cpu_usage_pct <= 100.0);
        assert!(metrics.cpu_cores >= 1);
        assert!(metrics.mem_total_bytes > 0);
        assert!(metrics.mem_used_pct >= 0.0 && metrics.mem_used_pct <= 100.0);
        assert!(matches!(
            metrics.mem_pressure.as_str(),
            "normal" | "warn" | "critical"
        ));
        assert!(matches!(
            metrics.thermal_state.as_str(),
            "nominal" | "fair" | "serious" | "critical"
        ));
        assert!(!metrics.gpu_label.is_empty());
        assert!(!metrics.os_name.is_empty());
        assert!(!metrics.collected_at.is_empty());
        assert!(serde_json::to_string(&metrics).is_ok());
    }
}
