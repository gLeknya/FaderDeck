use crate::system::focus::get_focused_application as win32_get_focused;
use crate::system::icons::get_application_icons as win32_get_icons;
use crate::system::keyboard::{send_key as win32_send_key, SendKeyResult};
use crate::system::runner::{
    launch_application, run_user_script as win32_run_script,
    set_process_window_visibility as win32_set_visibility, LaunchResult, VisibilityResult,
};
use crate::window::hud_window::show_volume_hud as win32_show_hud;
use crate::window::main_window::{handle_window_control as win32_window_control, set_close_to_tray};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use windows::core::PCWSTR;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

#[tauri::command]
pub fn get_focused_application() -> Value {
    let app = win32_get_focused();
    json!({
        "success": true,
        "application": app
    })
}

#[tauri::command]
pub fn launch_app(file_path: String) -> LaunchResult {
    launch_application(&file_path)
}

#[tauri::command]
pub fn run_user_script(file_path: String) -> LaunchResult {
    win32_run_script(&file_path)
}

#[tauri::command]
pub fn set_process_window_visibility(
    process_name: String,
    visible: Option<bool>,
    executable_path: Option<String>,
) -> VisibilityResult {
    win32_set_visibility(
        &process_name,
        visible,
        executable_path.as_deref().unwrap_or(""),
    )
}

#[tauri::command]
pub fn send_key(key: String, target_hint: Option<String>) -> SendKeyResult {
    win32_send_key(&key, target_hint.as_deref().unwrap_or(""))
}

#[tauri::command]
pub fn get_application_icons(application_paths: Option<Vec<String>>) -> Value {
    let paths = application_paths.unwrap_or_default();
    let icons = win32_get_icons(&paths);
    json!({
        "success": true,
        "icons": icons
    })
}

#[tauri::command]
pub fn get_app_info() -> Value {
    json!({
        "name": "FaderDeck",
        "version": "2.0.0",
        "platform": "win32",
        "arch": "x64",
        "engine": "tauri_v2_rust",
        "releaseChannel": "b",
        "releaseBadgeLabel": "beta",
        "updatedAt": null,
        "bugReportUrl": "https://github.com/gLeknya/FaderDeck/issues",
        "releasesUrl": "https://github.com/gLeknya/FaderDeck/releases"
    })
}

#[tauri::command]
pub fn check_for_updates(_options: Option<Value>) -> Value {
    json!({
        "success": true,
        "updateAvailable": false
    })
}

pub fn is_allowed_external_url(target_url: &str) -> bool {
    let trimmed = target_url.trim();
    let lower = trimmed.to_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

pub fn safe_open_external_url(target_url: &str) -> bool {
    if !is_allowed_external_url(target_url) {
        return false;
    }

    let trimmed = target_url.trim();
    let wide_file: Vec<u16> = trimmed.encode_utf16().chain(std::iter::once(0)).collect();
    let wide_open: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();

    unsafe {
        let res = ShellExecuteW(
            HWND(std::ptr::null_mut()),
            PCWSTR(wide_open.as_ptr()),
            PCWSTR(wide_file.as_ptr()),
            PCWSTR(std::ptr::null()),
            PCWSTR(std::ptr::null()),
            SW_SHOWNORMAL,
        );
        res.0 as usize > 32
    }
}

#[tauri::command]
pub fn open_external_url(target_url: String) -> Value {
    let success = safe_open_external_url(&target_url);
    json!({ "success": success })
}

#[tauri::command]
pub fn show_volume_hud(app: AppHandle, payload: Value) {
    win32_show_hud(&app, payload);
}

#[tauri::command]
pub fn toggle_devtools(app: AppHandle) -> Value {
    if let Some(_window) = app.get_webview_window("main") {
        #[cfg(debug_assertions)]
        {
            if _window.is_devtools_open() {
                _window.close_devtools();
                return json!({ "success": true, "isOpen": false });
            } else {
                _window.open_devtools();
                return json!({ "success": true, "isOpen": true });
            }
        }
    }
    json!({ "success": false })
}

#[tauri::command]
pub fn toggle_debug_panel() -> Value {
    json!({ "success": true, "visible": false })
}

#[tauri::command]
pub fn notify_developer_mode_changed() -> Value {
    json!({ "success": true })
}

#[tauri::command]
pub fn set_close_to_tray_enabled(enabled: bool) -> Value {
    set_close_to_tray(enabled);
    json!({ "success": true })
}

#[tauri::command]
pub fn exit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn window_control(app: AppHandle, action: String) {
    win32_window_control(&app, &action);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_allowed_external_url() {
        assert!(is_allowed_external_url("https://github.com/gLeknya/FaderDeck"));
        assert!(is_allowed_external_url("http://localhost:3000/test"));
        assert!(is_allowed_external_url("  HTTPS://EXAMPLE.COM  "));
        assert!(!is_allowed_external_url("cmd.exe /c calc.exe"));
        assert!(!is_allowed_external_url("file:///c:/windows/system32/calc.exe"));
        assert!(!is_allowed_external_url("javascript:alert(1)"));
        assert!(!is_allowed_external_url("powershell -c evil"));
    }
}

