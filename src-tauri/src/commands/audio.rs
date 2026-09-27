use crate::audio::{
    get_audio_states as wasapi_get_audio_states, get_master_mute, get_master_peak,
    get_master_volume, list_audio_devices as wasapi_list_devices, list_detected_sessions,
    set_audio_device_mute as wasapi_set_device_mute,
    set_audio_device_volume as wasapi_set_device_volume,
    set_default_audio_device as wasapi_set_default_device, set_session_mute, set_session_volume,
    set_sessions_volume_batch, toggle_session_mute, AudioApplication, DeviceListResult,
    SetMuteResult, SetVolumeResult,
};
use crate::state::AppState;
use crate::system::process::list_running_processes;
use serde_json::{json, Value};
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub fn get_audio_applications(state: State<'_, AppState>) -> Value {
    let running = list_running_processes();
    let detected_sessions = list_detected_sessions().unwrap_or_default();
    let remembered = state.remembered_audio_states.lock();

    // Group detected sessions by lowercase process
    let mut session_map: HashMap<String, (f64, bool, f32, usize)> = HashMap::new();
    for s in detected_sessions {
        let key = s.process.to_lowercase();
        let entry = session_map.entry(key).or_insert((s.volume, s.muted, s.peak, 0));
        entry.3 += 1;
        if s.peak > entry.2 {
            entry.2 = s.peak;
        }
    }

    let master_vol = get_master_volume().unwrap_or(100.0);
    let master_muted = get_master_mute().unwrap_or(false);
    let master_peak = get_master_peak();

    let mut applications = Vec::new();

    // 1. Master application
    applications.push(AudioApplication {
        name: "System volume".to_string(),
        process: "master".to_string(),
        process_name: "master".to_string(),
        path: String::new(),
        main_window_title: String::new(),
        has_window: false,
        instance_count: 1,
        volume: if master_muted { 0.0 } else { master_vol },
        muted: master_muted,
        peak: master_peak,
        peak_level: master_peak,
        has_audio_session: true,
        session_count: 1,
    });

    // 2. Running applications
    for p in running {
        let key = p.process.to_lowercase();
        let name_key = p.process_name.to_lowercase();

        if let Some(&(vol, muted, peak, count)) = session_map.get(&key).or_else(|| session_map.get(&name_key)) {
            applications.push(AudioApplication {
                name: p.name,
                process: p.process,
                process_name: p.process_name,
                path: p.path,
                main_window_title: p.main_window_title,
                has_window: p.has_window,
                instance_count: p.instance_count,
                volume: if muted { 0.0 } else { vol },
                muted,
                peak,
                peak_level: peak,
                has_audio_session: true,
                session_count: count,
            });
        } else if let Some(&(rem_vol, rem_muted)) = remembered.get(&key).or_else(|| remembered.get(&name_key)) {
            applications.push(AudioApplication {
                name: p.name,
                process: p.process,
                process_name: p.process_name,
                path: p.path,
                main_window_title: p.main_window_title,
                has_window: p.has_window,
                instance_count: p.instance_count,
                volume: if rem_muted { 0.0 } else { rem_vol },
                muted: rem_muted,
                peak: 0.0,
                peak_level: 0.0,
                has_audio_session: false,
                session_count: 0,
            });
        } else {
            applications.push(AudioApplication {
                name: p.name,
                process: p.process,
                process_name: p.process_name,
                path: p.path,
                main_window_title: p.main_window_title,
                has_window: p.has_window,
                instance_count: p.instance_count,
                volume: 100.0,
                muted: false,
                peak: 0.0,
                peak_level: 0.0,
                has_audio_session: false,
                session_count: 0,
            });
        }
    }

    json!({ "applications": applications })
}

#[tauri::command]
pub fn list_running_applications() -> Value {
    let apps = list_running_processes();
    json!({
        "success": true,
        "applications": apps,
        "fetchedAt": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),
        "fallbackUsed": false
    })
}

#[tauri::command]
pub fn get_audio_states(
    process_names: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> Value {
    let names = process_names.unwrap_or_default();
    let remembered = state.remembered_audio_states.lock();
    let states = wasapi_get_audio_states(&names, &remembered);
    json!({
        "success": true,
        "applications": states
    })
}

#[tauri::command]
pub fn set_app_volume(
    process_name: String,
    volume: f64,
    state: State<'_, AppState>,
) -> SetVolumeResult {
    let res = set_session_volume(&process_name, volume);
    state.remembered_audio_states.lock().insert(
        process_name.to_lowercase(),
        (res.volume, res.muted),
    );
    res
}

#[tauri::command]
pub fn set_app_volume_batch(
    volume_map: HashMap<String, f64>,
    state: State<'_, AppState>,
) -> Value {
    let results = set_sessions_volume_batch(&volume_map);
    let mut updated_count = 0;
    let mut remembered = state.remembered_audio_states.lock();

    for (proc_norm, res) in results {
        if res.updated_count > 0 {
            updated_count += res.updated_count;
        }
        remembered.insert(proc_norm, (res.volume, res.muted));
    }

    json!({
        "success": true,
        "updatedCount": updated_count
    })
}

#[tauri::command]
pub fn toggle_app_mute(
    process_name: String,
    state: State<'_, AppState>,
) -> SetMuteResult {
    let res = toggle_session_mute(&process_name);
    state.remembered_audio_states.lock().insert(
        process_name.to_lowercase(),
        (res.volume, res.muted),
    );
    res
}

#[tauri::command]
pub fn set_app_mute(
    process_name: String,
    muted: bool,
    state: State<'_, AppState>,
) -> SetMuteResult {
    let res = set_session_mute(&process_name, muted);
    state.remembered_audio_states.lock().insert(
        process_name.to_lowercase(),
        (res.volume, res.muted),
    );
    res
}

#[tauri::command]
pub fn list_audio_devices(flow: Option<String>) -> DeviceListResult {
    wasapi_list_devices(flow.as_deref().unwrap_or("all"))
}

#[tauri::command]
pub fn set_audio_device_volume(
    device_id: String,
    volume: f64,
    _flow: Option<String>,
) -> Value {
    let ok = wasapi_set_device_volume(&device_id, volume).is_ok();
    json!({ "success": ok })
}

#[tauri::command]
pub fn set_audio_device_mute(
    device_id: String,
    muted: bool,
    _flow: Option<String>,
) -> Value {
    let ok = wasapi_set_device_mute(&device_id, muted).is_ok();
    json!({ "success": ok })
}

#[tauri::command]
pub fn set_default_audio_device(
    device_id: String,
    flow: Option<String>,
) -> Value {
    let ok = wasapi_set_default_device(&device_id, flow.as_deref().unwrap_or("all")).is_ok();
    json!({ "success": ok })
}
