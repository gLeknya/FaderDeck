use super::types::{AudioState, SetMuteResult, SetVolumeResult};
use super::wasapi::{get_default_render_device, get_master_mute, get_master_peak, get_master_volume, set_master_mute, set_master_volume};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::path::Path;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use windows::core::{Interface, Result};
use windows::Win32::Foundation::{BOOL, CloseHandle};
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::Media::Audio::{
    IAudioSessionControl, IAudioSessionControl2, IAudioSessionEnumerator,
    IAudioSessionManager2, ISimpleAudioVolume,
};
use windows::Win32::System::Com::CLSCTX_ALL;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::core::PWSTR;

pub struct DetectedSession {
    pub pid: u32,
    pub process: String,
    pub process_name: String,
    pub path: String,
    pub volume: f64,
    pub muted: bool,
    pub peak: f32,
    pub control: IAudioSessionControl,
}

pub struct ComSendSync<T>(pub T);
unsafe impl<T> Send for ComSendSync<T> {}
unsafe impl<T> Sync for ComSendSync<T> {}

static CACHED_SESSION_MANAGER: LazyLock<parking_lot::Mutex<Option<ComSendSync<IAudioSessionManager2>>>> =
    LazyLock::new(|| parking_lot::Mutex::new(None));

pub fn invalidate_session_manager_cache() {
    let mut guard = CACHED_SESSION_MANAGER.lock();
    *guard = None;
}

pub fn get_session_manager() -> Result<IAudioSessionManager2> {
    {
        let guard = CACHED_SESSION_MANAGER.lock();
        if let Some(ref wrapper) = *guard {
            return Ok(wrapper.0.clone());
        }
    }

    let device = get_default_render_device()?;
    let mgr: IAudioSessionManager2 = unsafe { device.Activate(CLSCTX_ALL, None)? };
    let mut guard = CACHED_SESSION_MANAGER.lock();
    *guard = Some(ComSendSync(mgr.clone()));
    Ok(mgr)
}

struct CachedProcessInfo {
    file_name: String,
    process_name: String,
    full_path: String,
    cached_at: Instant,
}

static PROCESS_INFO_CACHE: LazyLock<RwLock<HashMap<u32, CachedProcessInfo>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

fn get_process_info_from_pid(pid: u32) -> (String, String, String) {
    if pid == 0 {
        return (String::new(), String::new(), String::new());
    }

    let now = Instant::now();
    const TTL: Duration = Duration::from_secs(5);

    // Fast path: cached PID mapping
    {
        let cache = PROCESS_INFO_CACHE.read();
        if let Some(entry) = cache.get(&pid) {
            if now.duration_since(entry.cached_at) < TTL {
                return (
                    entry.file_name.clone(),
                    entry.process_name.clone(),
                    entry.full_path.clone(),
                );
            }
        }
    }

    // Slow path: Win32 QueryFullProcessImageNameW
    let (file_name, process_name, full_path) = unsafe {
        let handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(h) => h,
            Err(_) => return (String::new(), String::new(), String::new()),
        };

        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;

        let res = if QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok() {
            let full_path = String::from_utf16_lossy(&buf[..len as usize]);
            let file_name = Path::new(&full_path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let process_name = file_name.trim_end_matches(".exe").to_string();
            (file_name, process_name, full_path)
        } else {
            (String::new(), String::new(), String::new())
        };

        let _ = CloseHandle(handle);
        res
    };

    if !file_name.is_empty() {
        let mut cache = PROCESS_INFO_CACHE.write();
        if cache.len() > 128 {
            cache.retain(|_, v| now.duration_since(v.cached_at) < TTL);
        }
        cache.insert(
            pid,
            CachedProcessInfo {
                file_name: file_name.clone(),
                process_name: process_name.clone(),
                full_path: full_path.clone(),
                cached_at: now,
            },
        );
    }

    (file_name, process_name, full_path)
}

pub fn list_detected_sessions() -> Result<Vec<DetectedSession>> {
    let session_manager = get_session_manager()?;
    let enumerator: IAudioSessionEnumerator = unsafe { session_manager.GetSessionEnumerator()? };
    let count = unsafe { enumerator.GetCount()? };

    let mut sessions = Vec::new();

    for i in 0..count {
        let control = match unsafe { enumerator.GetSession(i) } {
            Ok(c) => c,
            Err(_) => continue,
        };

        let control2 = match control.cast::<IAudioSessionControl2>() {
            Ok(c2) => c2,
            Err(_) => continue,
        };

        let pid = match unsafe { control2.GetProcessId() } {
            Ok(p) => p,
            Err(_) => continue,
        };

        if pid == 0 {
            continue;
        }

        let (process_file, process_name, full_path) = get_process_info_from_pid(pid);
        if process_file.is_empty() {
            continue;
        }

        let mut volume = 100.0f64;
        let mut muted = false;
        if let Ok(sav) = control.cast::<ISimpleAudioVolume>() {
            if let Ok(v) = unsafe { sav.GetMasterVolume() } {
                volume = (v as f64 * 100.0).clamp(0.0, 100.0);
            }
            if let Ok(m) = unsafe { sav.GetMute() } {
                muted = m.as_bool();
            }
        }

        let mut peak = 0.0f32;
        if let Ok(meter) = control.cast::<IAudioMeterInformation>() {
            if let Ok(p) = unsafe { meter.GetPeakValue() } {
                peak = p.clamp(0.0, 1.0);
            }
        }

        sessions.push(DetectedSession {
            pid,
            process: process_file,
            process_name,
            path: full_path,
            volume,
            muted,
            peak,
            control,
        });
    }

    Ok(sessions)
}

pub fn set_session_volume(process_or_name: &str, volume: f64) -> SetVolumeResult {
    let normalized = process_or_name.trim().to_lowercase();
    let is_master = normalized == "master" || normalized == "system volume";

    if is_master {
        let _ = set_master_volume(volume);
        let actual_vol = get_master_volume().unwrap_or(volume);
        let is_muted = get_master_mute().unwrap_or(false);
        return SetVolumeResult {
            success: true,
            volume: actual_vol,
            process: "master".to_string(),
            muted: is_muted,
            updated_count: 1,
            has_audio_session: true,
        };
    }

    let scalar = (volume / 100.0).clamp(0.0, 1.0) as f32;
    let mut updated = 0;
    let mut any_muted = false;

    let target_exe = if normalized.ends_with(".exe") {
        normalized.clone()
    } else {
        format!("{}.exe", normalized)
    };

    if let Ok(session_manager) = get_session_manager() {
        if let Ok(enumerator) = unsafe { session_manager.GetSessionEnumerator() } {
            if let Ok(count) = unsafe { enumerator.GetCount() } {
                for i in 0..count {
                    let control = match unsafe { enumerator.GetSession(i) } {
                        Ok(c) => c,
                        Err(_) => continue,
                    };

                    let control2 = match control.cast::<IAudioSessionControl2>() {
                        Ok(c2) => c2,
                        Err(_) => continue,
                    };

                    let pid = match unsafe { control2.GetProcessId() } {
                        Ok(p) => p,
                        Err(_) => continue,
                    };

                    if pid == 0 {
                        continue;
                    }

                    let (proc_file, proc_name, _) = get_process_info_from_pid(pid);
                    let proc_file_lower = proc_file.to_lowercase();
                    let proc_name_lower = proc_name.to_lowercase();

                    if proc_file_lower == normalized
                        || proc_name_lower == normalized
                        || proc_file_lower == target_exe
                    {
                        if let Ok(sav) = control.cast::<ISimpleAudioVolume>() {
                            if unsafe { sav.SetMasterVolume(scalar, std::ptr::null()) }.is_ok() {
                                updated += 1;
                            }
                            if let Ok(m) = unsafe { sav.GetMute() } {
                                if m.as_bool() {
                                    any_muted = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    SetVolumeResult {
        success: true,
        volume: volume.clamp(0.0, 100.0),
        process: process_or_name.to_string(),
        muted: any_muted,
        updated_count: updated,
        has_audio_session: updated > 0,
    }
}

pub fn set_session_mute(process_or_name: &str, muted: bool) -> SetMuteResult {
    let normalized = process_or_name.trim().to_lowercase();
    let is_master = normalized == "master" || normalized == "system volume";

    if is_master {
        let _ = set_master_mute(muted);
        let vol = get_master_volume().unwrap_or(100.0);
        return SetMuteResult {
            success: true,
            muted,
            process: "master".to_string(),
            volume: if muted { 0.0 } else { vol },
            updated_count: 1,
            has_audio_session: true,
        };
    }

    let mut updated = 0;
    let mut last_vol = 100.0;

    let target_exe = if normalized.ends_with(".exe") {
        normalized.clone()
    } else {
        format!("{}.exe", normalized)
    };

    if let Ok(session_manager) = get_session_manager() {
        if let Ok(enumerator) = unsafe { session_manager.GetSessionEnumerator() } {
            if let Ok(count) = unsafe { enumerator.GetCount() } {
                for i in 0..count {
                    let control = match unsafe { enumerator.GetSession(i) } {
                        Ok(c) => c,
                        Err(_) => continue,
                    };

                    let control2 = match control.cast::<IAudioSessionControl2>() {
                        Ok(c2) => c2,
                        Err(_) => continue,
                    };

                    let pid = match unsafe { control2.GetProcessId() } {
                        Ok(p) => p,
                        Err(_) => continue,
                    };

                    if pid == 0 {
                        continue;
                    }

                    let (proc_file, proc_name, _) = get_process_info_from_pid(pid);
                    let proc_file_lower = proc_file.to_lowercase();
                    let proc_name_lower = proc_name.to_lowercase();

                    if proc_file_lower == normalized
                        || proc_name_lower == normalized
                        || proc_file_lower == target_exe
                    {
                        if let Ok(sav) = control.cast::<ISimpleAudioVolume>() {
                            if unsafe { sav.SetMute(BOOL::from(muted), std::ptr::null()) }.is_ok() {
                                updated += 1;
                                if let Ok(v) = unsafe { sav.GetMasterVolume() } {
                                    last_vol = (v as f64 * 100.0).clamp(0.0, 100.0);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    SetMuteResult {
        success: true,
        muted,
        process: process_or_name.to_string(),
        volume: if muted { 0.0 } else { last_vol },
        updated_count: updated,
        has_audio_session: updated > 0,
    }
}

pub fn set_sessions_volume_batch(
    volume_map: &HashMap<String, f64>,
) -> HashMap<String, SetVolumeResult> {
    let mut results: HashMap<String, SetVolumeResult> = HashMap::new();
    let mut normalized_targets: HashMap<String, (String, f32)> = HashMap::new();

    for (name, vol) in volume_map {
        let norm = name.trim().to_lowercase();
        if norm == "master" || norm == "system volume" {
            let res = set_session_volume(name, *vol);
            results.insert(norm, res);
        } else {
            let scalar = (*vol / 100.0).clamp(0.0, 1.0) as f32;
            normalized_targets.insert(norm, (name.clone(), scalar));
        }
    }

    if normalized_targets.is_empty() {
        return results;
    }

    let mut updated_counts: HashMap<String, usize> = HashMap::new();
    let mut any_muteds: HashMap<String, bool> = HashMap::new();

    if let Ok(session_manager) = get_session_manager() {
        if let Ok(enumerator) = unsafe { session_manager.GetSessionEnumerator() } {
            if let Ok(count) = unsafe { enumerator.GetCount() } {
                for i in 0..count {
                    let control = match unsafe { enumerator.GetSession(i) } {
                        Ok(c) => c,
                        Err(_) => continue,
                    };
                    let control2 = match control.cast::<IAudioSessionControl2>() {
                        Ok(c2) => c2,
                        Err(_) => continue,
                    };
                    let pid = match unsafe { control2.GetProcessId() } {
                        Ok(p) => p,
                        Err(_) => continue,
                    };
                    if pid == 0 {
                        continue;
                    }
                    let (proc_file, proc_name, _) = get_process_info_from_pid(pid);
                    let proc_file_lower = proc_file.to_lowercase();
                    let proc_name_lower = proc_name.to_lowercase();

                    for (target_norm, (_original_name, scalar)) in &normalized_targets {
                        let target_exe = if target_norm.ends_with(".exe") {
                            target_norm.clone()
                        } else {
                            format!("{}.exe", target_norm)
                        };

                        if proc_file_lower == *target_norm
                            || proc_name_lower == *target_norm
                            || proc_file_lower == target_exe
                        {
                            if let Ok(sav) = control.cast::<ISimpleAudioVolume>() {
                                if unsafe { sav.SetMasterVolume(*scalar, std::ptr::null()) }.is_ok() {
                                    *updated_counts.entry(target_norm.clone()).or_insert(0) += 1;
                                }
                                if let Ok(m) = unsafe { sav.GetMute() } {
                                    if m.as_bool() {
                                        any_muteds.insert(target_norm.clone(), true);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    for (target_norm, (original_name, scalar)) in normalized_targets {
        let updated = updated_counts.get(&target_norm).copied().unwrap_or(0);
        let muted = any_muteds.get(&target_norm).copied().unwrap_or(false);
        results.insert(
            target_norm,
            SetVolumeResult {
                success: true,
                volume: (scalar as f64 * 100.0).clamp(0.0, 100.0),
                process: original_name,
                muted,
                updated_count: updated,
                has_audio_session: updated > 0,
            },
        );
    }

    results
}

pub fn toggle_session_mute(process_or_name: &str) -> SetMuteResult {
    let normalized = process_or_name.trim().to_lowercase();
    let is_master = normalized == "master" || normalized == "system volume";

    if is_master {
        let current = get_master_mute().unwrap_or(false);
        return set_session_mute("master", !current);
    }

    let sessions = list_detected_sessions().unwrap_or_default();
    let current_muted = sessions
        .iter()
        .find(|s| {
            s.process.to_lowercase() == normalized
                || s.process_name.to_lowercase() == normalized
                || s.process.to_lowercase() == format!("{}.exe", normalized)
        })
        .map(|s| s.muted)
        .unwrap_or(false);

    set_session_mute(process_or_name, !current_muted)
}

pub fn get_audio_states(
    process_names: &[String],
    remembered_states: &HashMap<String, (f64, bool)>,
) -> Vec<AudioState> {
    let sessions = list_detected_sessions().unwrap_or_default();

    // Group sessions by lowercase process
    let mut map: HashMap<String, (f64, bool, f32, usize)> = HashMap::new();
    for s in sessions {
        let key = s.process.to_lowercase();
        let entry = map.entry(key).or_insert((s.volume, s.muted, s.peak, 0));
        entry.3 += 1;
        if s.peak > entry.2 {
            entry.2 = s.peak;
        }
    }

    let mut result = Vec::new();

    for name in process_names {
        let lower = name.trim().to_lowercase();
        if lower == "master" || lower == "system volume" {
            let vol = get_master_volume().unwrap_or(100.0);
            let muted = get_master_mute().unwrap_or(false);
            let peak = get_master_peak();
            result.push(AudioState {
                process: "master".to_string(),
                volume: if muted { 0.0 } else { vol },
                muted,
                peak,
                peak_level: peak,
                has_audio_session: true,
                session_count: 1,
            });
            continue;
        }

        let exe_lower = if lower.ends_with(".exe") {
            lower.clone()
        } else {
            format!("{}.exe", lower)
        };

        if let Some(&(vol, muted, peak, count)) = map.get(&exe_lower).or_else(|| map.get(&lower)) {
            result.push(AudioState {
                process: name.clone(),
                volume: if muted { 0.0 } else { vol },
                muted,
                peak,
                peak_level: peak,
                has_audio_session: true,
                session_count: count,
            });
        } else if let Some(&(rem_vol, rem_muted)) = remembered_states.get(&lower).or_else(|| remembered_states.get(&exe_lower)) {
            result.push(AudioState {
                process: name.clone(),
                volume: if rem_muted { 0.0 } else { rem_vol },
                muted: rem_muted,
                peak: 0.0,
                peak_level: 0.0,
                has_audio_session: false,
                session_count: 0,
            });
        } else {
            result.push(AudioState {
                process: name.clone(),
                volume: 100.0,
                muted: false,
                peak: 0.0,
                peak_level: 0.0,
                has_audio_session: false,
                session_count: 0,
            });
        }
    }

    result
}
