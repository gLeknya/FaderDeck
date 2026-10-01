use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const EMBEDDED_VERSION_JSON: &str = include_str!("../../../version.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppVersionInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
    pub arch: String,
    pub engine: String,
    #[serde(rename = "releaseChannel")]
    pub release_channel: String,
    #[serde(rename = "releaseChannelCode")]
    pub release_channel_code: String,
    #[serde(rename = "releaseBadgeLabel")]
    pub release_badge_label: String,
    #[serde(rename = "releaseChannelName")]
    pub release_channel_name: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<String>,
    #[serde(rename = "bugReportUrl")]
    pub bug_report_url: String,
    #[serde(rename = "releasesUrl")]
    pub releases_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredVersionRecord {
    pub version: String,
    pub updated_at: String,
}

pub fn format_system_time_iso8601(time: SystemTime) -> String {
    let secs = match time.duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_secs(),
        Err(_) => return "1970-01-01T00:00:00Z".to_string(),
    };

    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let days = secs / 86400;

    let z = days as i64 + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m_month = if mp < 10 { mp + 3 } else { mp - 9 };
    let y_year = if m_month <= 2 { y + 1 } else { y };

    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y_year, m_month, d, h, m, s)
}

fn parse_version_channel_info(version_raw: &str) -> (String, String, String, String) {
    let trimmed = version_raw.trim();
    if trimmed.is_empty() {
        return (
            "stable".to_string(),
            "".to_string(),
            "".to_string(),
            "Stable".to_string(),
        );
    }

    let lower = trimmed.to_lowercase();
    let last_char = lower.chars().last().unwrap_or('\0');

    if lower.ends_with("-beta") || last_char == 'b' {
        (
            "beta".to_string(),
            "b".to_string(),
            "beta".to_string(),
            "Beta".to_string(),
        )
    } else if lower.ends_with("-plus") || last_char == 'p' {
        (
            "plus".to_string(),
            "p".to_string(),
            "plus".to_string(),
            "Plus".to_string(),
        )
    } else if lower.ends_with("-exp") || lower.ends_with("-experimental") || last_char == 'e' {
        (
            "experimental".to_string(),
            "e".to_string(),
            "exp".to_string(),
            "Experimental".to_string(),
        )
    } else {
        (
            "stable".to_string(),
            "".to_string(),
            "".to_string(),
            "Stable".to_string(),
        )
    }
}

pub fn read_app_version_string() -> String {
    // 1. Try file alongside the executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let next_to_exe = parent.join("version.json");
            if let Ok(content) = fs::read_to_string(&next_to_exe) {
                if let Ok(v) = serde_json::from_str::<Value>(&content) {
                    if let Some(ver) = v.get("version").and_then(|s| s.as_str()) {
                        return ver.trim().to_string();
                    }
                }
            }
        }
    }

    // 2. Try current working directory or relative to root
    for candidate in &["version.json", "../version.json", "../../version.json"] {
        if let Ok(content) = fs::read_to_string(candidate) {
            if let Ok(v) = serde_json::from_str::<Value>(&content) {
                if let Some(ver) = v.get("version").and_then(|s| s.as_str()) {
                    return ver.trim().to_string();
                }
            }
        }
    }

    // 3. Fallback to compile-time embedded version.json
    if let Ok(v) = serde_json::from_str::<Value>(EMBEDDED_VERSION_JSON) {
        if let Some(ver) = v.get("version").and_then(|s| s.as_str()) {
            return ver.trim().to_string();
        }
    }

    "0.8.3b".to_string()
}

fn get_app_version_storage_path() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("FaderDeck").join("app_version.json"))
}

pub fn get_or_record_device_update_timestamp(current_version: &str) -> String {
    let storage_path = get_app_version_storage_path();

    if let Some(ref path) = storage_path {
        if path.exists() {
            if let Ok(content) = fs::read_to_string(path) {
                if let Ok(record) = serde_json::from_str::<StoredVersionRecord>(&content) {
                    if record.version == current_version && !record.updated_at.trim().is_empty() {
                        return record.updated_at;
                    }
                }
            }
        }
    }

    // Update detected on this device: determine update time
    let update_time = std::env::current_exe()
        .ok()
        .and_then(|p| fs::metadata(p).ok())
        .and_then(|m| m.modified().ok().or_else(|| m.created().ok()))
        .unwrap_or_else(SystemTime::now);

    let iso_ts = format_system_time_iso8601(update_time);

    if let Some(ref path) = storage_path {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let record = StoredVersionRecord {
            version: current_version.to_string(),
            updated_at: iso_ts.clone(),
        };
        if let Ok(serialized) = serde_json::to_string_pretty(&record) {
            let _ = fs::write(path, serialized);
        }
    }

    iso_ts
}

pub fn get_application_info() -> AppVersionInfo {
    let version = read_app_version_string();
    let (release_channel, release_channel_code, release_badge_label, release_channel_name) =
        parse_version_channel_info(&version);
    let updated_at = Some(get_or_record_device_update_timestamp(&version));

    AppVersionInfo {
        name: "FaderDeck".to_string(),
        version,
        platform: "win32".to_string(),
        arch: "x64".to_string(),
        engine: "tauri_v2_rust".to_string(),
        release_channel,
        release_channel_code,
        release_badge_label,
        release_channel_name,
        updated_at,
        bug_report_url: "https://github.com/gLeknya/FaderDeck/issues".to_string(),
        releases_url: "https://github.com/gLeknya/FaderDeck/releases".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_system_time_iso8601() {
        assert_eq!(
            format_system_time_iso8601(UNIX_EPOCH),
            "1970-01-01T00:00:00Z"
        );
    }

    #[test]
    fn test_parse_channels() {
        let (ch, code, badge, name) = parse_version_channel_info("0.8.3b");
        assert_eq!(ch, "beta");
        assert_eq!(code, "b");
        assert_eq!(badge, "beta");
        assert_eq!(name, "Beta");

        let (ch, code, badge, name) = parse_version_channel_info("0.8.3p");
        assert_eq!(ch, "plus");
        assert_eq!(code, "p");
        assert_eq!(badge, "plus");
        assert_eq!(name, "Plus");

        let (ch, code, badge, name) = parse_version_channel_info("0.8.3e");
        assert_eq!(ch, "experimental");
        assert_eq!(code, "e");
        assert_eq!(badge, "exp");
        assert_eq!(name, "Experimental");

        let (ch, code, badge, name) = parse_version_channel_info("0.8.3");
        assert_eq!(ch, "stable");
        assert_eq!(code, "");
        assert_eq!(badge, "");
        assert_eq!(name, "Stable");
    }
}
