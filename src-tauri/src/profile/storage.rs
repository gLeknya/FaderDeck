use super::models::{ProfileListItem, ProfileOperationResult};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct ProfileStorage {
    base_dir: PathBuf,
}

impl ProfileStorage {
    pub fn new() -> Self {
        let base_dir = resolve_profiles_dir();
        let _ = fs::create_dir_all(&base_dir);
        migrate_legacy_profiles(&base_dir);
        Self { base_dir }
    }

    pub fn with_base_dir(base_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&base_dir);
        Self { base_dir }
    }

    pub fn get_profiles_directory(&self) -> String {
        self.base_dir.to_string_lossy().to_string()
    }

    pub fn normalize_profile_name(name: &str) -> String {
        let sanitized: String = name
            .chars()
            .map(|c| {
                if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() {
                    ' '
                } else {
                    c
                }
            })
            .collect();

        let collapsed = sanitized
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");

        if collapsed.is_empty() {
            "Profile".to_string()
        } else {
            collapsed
        }
    }

    pub fn get_profile_path(&self, name: &str) -> PathBuf {
        let safe_name = Self::normalize_profile_name(name);
        self.base_dir.join(format!("{}.json", safe_name))
    }

    pub fn get_unique_profile_name(&self, name: &str, exclude: Option<&str>) -> String {
        let base = Self::normalize_profile_name(name);
        let normalized_exclude = exclude.map(Self::normalize_profile_name).unwrap_or_default();

        if (!normalized_exclude.is_empty() && base == normalized_exclude)
            || !self.get_profile_path(&base).exists()
        {
            return base;
        }

        let mut idx = 2;
        loop {
            let candidate = format!("{} {}", base, idx);
            if (!normalized_exclude.is_empty() && candidate == normalized_exclude)
                || !self.get_profile_path(&candidate).exists()
            {
                return candidate;
            }
            idx += 1;
        }
    }

    pub fn create_channel_template(index: usize) -> Value {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        json!({
            "id": (now_ms as u64) + (index as u64),
            "app": "master",
            "appName": "System volume",
            "title": format!("Channel {}", index),
            "faderCC": null,
            "faderMapping": null,
            "volume": 100,
            "buttons": [],
            "skipBinding": false,
            "showBindHint": true,
            "flashOnCreate": false
        })
    }

    pub fn create_profile_template(name: &str, channel_count: usize) -> Value {
        let iso_time = chrono_like_now();
        let channels: Vec<Value> = (1..=channel_count)
            .map(Self::create_channel_template)
            .collect();

        json!({
            "version": 1,
            "meta": {
                "name": name,
                "createdAt": iso_time,
                "updatedAt": iso_time
            },
            "channels": channels,
            "standaloneButtons": [],
            "bindings": {
                "faders": [],
                "buttons": []
            },
            "audio": {
                "assignments": []
            },
            "settings": {
                "midiInputId": null
            }
        })
    }

    pub fn normalize_profile(&self, mut profile: Value, name: &str) -> Value {
        let safe_name = Self::normalize_profile_name(name);
        let now_iso = chrono_like_now();

        if !profile.is_object() {
            profile = json!({});
        }

        let obj = profile.as_object_mut().unwrap();

        // 1. Version
        obj.insert("version".to_string(), json!(1));

        // 2. Meta
        let mut meta = obj
            .get("meta")
            .and_then(|m| m.as_object().cloned())
            .unwrap_or_default();
        let created_at = meta
            .get("createdAt")
            .and_then(|c| c.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| now_iso.clone());
        meta.insert("name".to_string(), json!(safe_name));
        meta.insert("createdAt".to_string(), json!(created_at));
        meta.insert("updatedAt".to_string(), json!(now_iso));
        obj.insert("meta".to_string(), Value::Object(meta));

        // 3. Channels & StandaloneButtons
        let channels = obj
            .get("channels")
            .and_then(|c| c.as_array().cloned())
            .unwrap_or_default();
        obj.entry("standaloneButtons")
            .or_insert_with(|| json!([]));

        // 4. Bindings
        let mut bindings = obj
            .get("bindings")
            .and_then(|b| b.as_object().cloned())
            .unwrap_or_default();

        let mut fader_bindings = Vec::new();
        for ch in &channels {
            let has_mapping = ch.get("faderMapping").map_or(false, |v| !v.is_null());
            let has_cc = ch.get("faderCC").map_or(false, |v| !v.is_null());
            if has_mapping || has_cc {
                fader_bindings.push(json!({
                    "channelId": ch.get("id").cloned().unwrap_or(Value::Null),
                    "process": ch.get("app").and_then(|v| v.as_str()).unwrap_or("master"),
                    "appName": ch.get("appName").and_then(|v| v.as_str()).unwrap_or("System volume"),
                    "title": ch.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                    "faderCC": ch.get("faderCC").cloned().unwrap_or(Value::Null),
                    "faderMapping": ch.get("faderMapping").cloned().unwrap_or(Value::Null)
                }));
            }
        }
        bindings.insert("faders".to_string(), Value::Array(fader_bindings));
        bindings.entry("buttons".to_string()).or_insert_with(|| json!([]));
        obj.insert("bindings".to_string(), Value::Object(bindings));

        // 5. Audio assignments
        let mut audio = obj
            .get("audio")
            .and_then(|a| a.as_object().cloned())
            .unwrap_or_default();

        let mut assignments = Vec::new();
        for ch in &channels {
            let app = ch.get("app").and_then(|v| v.as_str()).unwrap_or("master");
            let target_type = if app == "master" { "master" } else { "application" };
            assignments.push(json!({
                "channelId": ch.get("id").cloned().unwrap_or(Value::Null),
                "process": app,
                "appName": ch.get("appName").and_then(|v| v.as_str()).unwrap_or("System volume"),
                "title": ch.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                "targetType": target_type
            }));
        }
        audio.insert("assignments".to_string(), Value::Array(assignments));
        obj.insert("audio".to_string(), Value::Object(audio));

        // 6. Settings
        obj.entry("settings")
            .or_insert_with(|| json!({ "midiInputId": null }));

        Value::Object(obj.clone())
    }

    pub fn save_profile(&self, name: &str, data: Value) -> ProfileOperationResult {
        let safe_name = Self::normalize_profile_name(name);
        let path = self.get_profile_path(&safe_name);
        let normalized = self.normalize_profile(data, &safe_name);

        match serde_json::to_string_pretty(&normalized) {
            Ok(json_str) => match fs::write(&path, json_str) {
                Ok(_) => {
                    let mut res = ProfileOperationResult::ok();
                    res.name = Some(safe_name);
                    res.path = Some(path.to_string_lossy().to_string());
                    res
                }
                Err(e) => ProfileOperationResult::err(format!("Failed to write profile: {}", e)),
            },
            Err(e) => ProfileOperationResult::err(format!("Serialization error: {}", e)),
        }
    }

    pub fn load_profile(&self, name: &str) -> ProfileOperationResult {
        let safe_name = Self::normalize_profile_name(name);
        let path = self.get_profile_path(&safe_name);

        if !path.exists() {
            return ProfileOperationResult::err("Profile not found");
        }

        match fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str::<Value>(&content) {
                Ok(val) => {
                    let normalized = self.normalize_profile(val, &safe_name);
                    let mut res = ProfileOperationResult::ok();
                    res.data = Some(normalized);
                    res
                }
                Err(e) => ProfileOperationResult::err(format!("Parse error: {}", e)),
            },
            Err(e) => ProfileOperationResult::err(format!("Read error: {}", e)),
        }
    }

    pub fn list_profiles(&self) -> ProfileOperationResult {
        if !self.base_dir.exists() {
            let mut res = ProfileOperationResult::ok();
            res.profiles = Some(Vec::new());
            return res;
        }

        let entries = match fs::read_dir(&self.base_dir) {
            Ok(entries) => entries,
            Err(e) => return ProfileOperationResult::err(format!("Cannot read dir: {}", e)),
        };

        let mut profiles = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                let file_name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                let modified = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as f64)
                    .unwrap_or(0.0);

                let meta = fs::read_to_string(&path)
                    .ok()
                    .and_then(|c| serde_json::from_str::<Value>(&c).ok())
                    .and_then(|v| v.get("meta").cloned())
                    .unwrap_or_else(|| json!({}));

                profiles.push(ProfileListItem {
                    name: file_name.to_string(),
                    path: path.to_string_lossy().to_string(),
                    modified,
                    meta,
                });
            }
        }

        profiles.sort_by(|a, b| b.modified.partial_cmp(&a.modified).unwrap_or(std::cmp::Ordering::Equal));

        let mut res = ProfileOperationResult::ok();
        res.profiles = Some(profiles);
        res
    }

    pub fn delete_profile(&self, name: &str) -> ProfileOperationResult {
        let safe_name = Self::normalize_profile_name(name);
        let path = self.get_profile_path(&safe_name);

        if path.exists() {
            if let Err(e) = fs::remove_file(&path) {
                return ProfileOperationResult::err(format!("Failed to delete: {}", e));
            }
        }

        ProfileOperationResult::ok()
    }

    pub fn rename_profile(&self, from_name: &str, to_name: &str) -> ProfileOperationResult {
        let source_name = Self::normalize_profile_name(from_name);
        let target_name = Self::normalize_profile_name(to_name);
        let source_path = self.get_profile_path(&source_name);
        let target_path = self.get_profile_path(&target_name);

        if !source_path.exists() {
            return ProfileOperationResult::err("Profile not found");
        }

        if source_name != target_name && target_path.exists() {
            return ProfileOperationResult::err("Profile already exists");
        }

        let content = match fs::read_to_string(&source_path) {
            Ok(c) => c,
            Err(e) => return ProfileOperationResult::err(format!("Cannot read source: {}", e)),
        };

        let val = match serde_json::from_str::<Value>(&content) {
            Ok(v) => v,
            Err(e) => return ProfileOperationResult::err(format!("Cannot parse source: {}", e)),
        };

        let normalized = self.normalize_profile(val, &target_name);
        let json_str = match serde_json::to_string_pretty(&normalized) {
            Ok(s) => s,
            Err(e) => return ProfileOperationResult::err(format!("Serialization error: {}", e)),
        };

        if let Err(e) = fs::write(&target_path, json_str) {
            return ProfileOperationResult::err(format!("Failed to write target: {}", e));
        }

        if source_name != target_name && source_path.exists() {
            let _ = fs::remove_file(&source_path);
        }

        let mut res = ProfileOperationResult::ok();
        res.name = Some(target_name);
        res.path = Some(target_path.to_string_lossy().to_string());
        res
    }

    pub fn import_profile(&self, file_path: &str, options: Option<Value>) -> ProfileOperationResult {
        let path = Path::new(file_path);
        if !path.exists() {
            return ProfileOperationResult::err("File not found");
        }

        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(e) => return ProfileOperationResult::err(format!("Read error: {}", e)),
        };

        let val = match serde_json::from_str::<Value>(&content) {
            Ok(v) => v,
            Err(e) => return ProfileOperationResult::err(format!("Parse error: {}", e)),
        };

        let suggested_name = options
            .as_ref()
            .and_then(|o| o.get("name").and_then(|n| n.as_str()))
            .or_else(|| val.get("meta").and_then(|m| m.get("name").and_then(|n| n.as_str())))
            .unwrap_or_else(|| path.file_stem().and_then(|s| s.to_str()).unwrap_or("Imported"));

        let safe_name = self.get_unique_profile_name(suggested_name, None);
        self.save_profile(&safe_name, val)
    }
}

fn resolve_profiles_dir() -> PathBuf {
    if let Some(app_data) = dirs::data_dir() {
        app_data.join("FaderDeck").join("profiles")
    } else if let Some(home) = dirs::home_dir() {
        home.join(".faderdeck").join("profiles")
    } else {
        PathBuf::from("profiles")
    }
}

fn migrate_legacy_profiles(target_dir: &Path) {
    if let Some(home) = dirs::home_dir() {
        let legacy_paths = [
            home.join(".faderdeck").join("profiles"),
            home.join(".midi_mixer").join("profiles"),
        ];

        for legacy in &legacy_paths {
            if legacy.exists() && legacy.is_dir() {
                if let Ok(entries) = fs::read_dir(legacy) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                            if let Some(file_name) = path.file_name() {
                                let dest = target_dir.join(file_name);
                                if !dest.exists() {
                                    let _ = fs::copy(&path, &dest);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

fn chrono_like_now() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Simple ISO 8601 formatting without huge external chrono dependency
    // (days since 1970-01-01)
    let days = now / 86400;
    let rem_secs = now % 86400;
    let hours = rem_secs / 3600;
    let minutes = (rem_secs % 3600) / 60;
    let seconds = rem_secs % 60;

    // Convert days to civil date (Gregorian algorithm)
    let z = days as i64 + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z", y, m, d, hours, minutes, seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_profile_name() {
        assert_eq!(ProfileStorage::normalize_profile_name("my:bad/profile*name?"), "my bad profile name");
        assert_eq!(ProfileStorage::normalize_profile_name("   "), "Profile");
        assert_eq!(ProfileStorage::normalize_profile_name("  Test   Profile  "), "Test Profile");
    }

    #[test]
    fn test_profile_template_generation() {
        let tpl = ProfileStorage::create_profile_template("Default", 3);
        assert_eq!(tpl["version"], 1);
        assert_eq!(tpl["meta"]["name"], "Default");
        assert_eq!(tpl["channels"].as_array().unwrap().len(), 3);
        assert_eq!(tpl["channels"][0]["app"], "master");
        assert_eq!(tpl["channels"][0]["title"], "Channel 1");
    }

    #[test]
    fn test_profile_save_and_load() {
        let temp_dir = std::env::temp_dir().join(format!("faderdeck_test_{}", std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let _ = fs::create_dir_all(&temp_dir);

        let storage = ProfileStorage {
            base_dir: temp_dir.clone(),
        };

        let tpl = ProfileStorage::create_profile_template("Test Studio", 2);
        let save_res = storage.save_profile("Test Studio", tpl);
        assert!(save_res.success);

        let load_res = storage.load_profile("Test Studio");
        assert!(load_res.success);
        let loaded = load_res.data.unwrap();
        assert_eq!(loaded["meta"]["name"], "Test Studio");
        assert_eq!(loaded["channels"].as_array().unwrap().len(), 2);

        // List profiles
        let list_res = storage.list_profiles();
        assert!(list_res.success);
        let list = list_res.profiles.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Test Studio");

        // Clean up
        let _ = fs::remove_dir_all(&temp_dir);
    }
}

