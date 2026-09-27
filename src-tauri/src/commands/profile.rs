use crate::profile::models::ProfileOperationResult;
use crate::profile::ProfileStorage;
use crate::state::AppState;
use serde_json::{json, Value};
use std::process::Command;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn save_profile(
    name: String,
    data: Value,
    state: State<'_, AppState>,
) -> ProfileOperationResult {
    let res = state.profile_storage.save_profile(&name, data.clone());
    if res.success {
        state.midi_engine.router().update_bindings_from_profile(&data);
        *state.active_profile_name.lock() = name;
    }
    res
}

#[tauri::command]
pub fn load_profile(
    name: String,
    state: State<'_, AppState>,
) -> ProfileOperationResult {
    let res = state.profile_storage.load_profile(&name);
    if res.success {
        if let Some(ref data) = res.data {
            state.midi_engine.router().update_bindings_from_profile(data);
        }
        *state.active_profile_name.lock() = name;
    }
    res
}

#[tauri::command]
pub fn list_profiles(state: State<'_, AppState>) -> ProfileOperationResult {
    state.profile_storage.list_profiles()
}

#[tauri::command]
pub fn delete_profile(
    name: String,
    state: State<'_, AppState>,
) -> ProfileOperationResult {
    state.profile_storage.delete_profile(&name)
}

#[tauri::command]
pub fn rename_profile(
    from_name: String,
    to_name: String,
    state: State<'_, AppState>,
) -> ProfileOperationResult {
    state.profile_storage.rename_profile(&from_name, &to_name)
}

#[tauri::command]
pub fn import_profile(
    file_path: String,
    options: Option<Value>,
    state: State<'_, AppState>,
) -> ProfileOperationResult {
    state.profile_storage.import_profile(&file_path, options)
}

#[tauri::command]
pub fn get_profile_template(
    options: Option<Value>,
    _state: State<'_, AppState>,
) -> Value {
    let name = options
        .as_ref()
        .and_then(|o| o.get("name").and_then(|n| n.as_str()))
        .unwrap_or("Default");
    let count = options
        .as_ref()
        .and_then(|o| o.get("channelCount").and_then(|c| c.as_u64()))
        .unwrap_or(0) as usize;

    json!({
        "success": true,
        "profile": ProfileStorage::create_profile_template(name, count)
    })
}

#[tauri::command]
pub fn get_profiles_directory(state: State<'_, AppState>) -> Value {
    json!({
        "success": true,
        "path": state.profile_storage.get_profiles_directory()
    })
}

#[tauri::command]
pub fn open_profiles_folder(state: State<'_, AppState>) -> Value {
    let path = state.profile_storage.get_profiles_directory();
    let _ = Command::new("explorer.exe").arg(&path).spawn();
    json!({ "success": true, "path": path })
}

#[tauri::command]
pub fn show_profile_in_folder(profile_path: String) -> Value {
    let clean_path = profile_path.replace('/', "\\");
    let _ = Command::new("explorer.exe")
        .arg(format!("/select,{}", clean_path))
        .spawn();
    json!({ "success": true })
}

#[tauri::command]
pub async fn pick_profile_file(app: tauri::AppHandle) -> Value {
    let file = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("JSON Profiles", &["json"])
            .add_filter("All Files", &["*"])
            .blocking_pick_file()
    })
    .await
    .unwrap_or(None);

    match file {
        Some(path) => json!({
            "success": true,
            "canceled": false,
            "filePath": path.to_string()
        }),
        None => json!({
            "success": false,
            "canceled": true,
            "filePath": null
        }),
    }
}

#[tauri::command]
pub async fn pick_action_file(app: tauri::AppHandle, mode: Option<String>) -> Value {
    let file = tauri::async_runtime::spawn_blocking(move || {
        let is_script = mode.as_deref().unwrap_or("app") == "script";
        let mut builder = app.dialog().file();

        if is_script {
            builder = builder
                .add_filter("Scripts", &["ps1", "cmd", "bat", "js", "cjs", "mjs", "vbs", "wsf"])
                .add_filter("All Files", &["*"]);
        } else {
            builder = builder
                .add_filter("Applications", &["exe", "lnk", "cmd", "bat", "appref-ms"])
                .add_filter("All Files", &["*"]);
        }

        builder.blocking_pick_file()
    })
    .await
    .unwrap_or(None);

    match file {
        Some(path) => json!({
            "success": true,
            "canceled": false,
            "filePath": path.to_string()
        }),
        None => json!({
            "success": false,
            "canceled": true,
            "filePath": null
        }),
    }
}
