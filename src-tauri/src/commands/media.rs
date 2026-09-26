use crate::media::winrt::{
    get_media_session_state as winrt_get_session, list_media_sessions as winrt_list_sessions,
    send_media_transport as winrt_send_transport, set_media_option as winrt_set_option,
    set_media_repeat_mode as winrt_set_repeat, MediaTransportResult,
};
use serde_json::Value;

#[tauri::command]
pub fn send_media_transport(
    command: String,
    target_app_id: Option<String>,
) -> MediaTransportResult {
    winrt_send_transport(&command, target_app_id.as_deref().unwrap_or(""))
}

#[tauri::command]
pub fn list_media_sessions() -> Value {
    winrt_list_sessions()
}

#[tauri::command]
pub fn get_media_session_state(target_app_id: Option<String>) -> Value {
    winrt_get_session(target_app_id.as_deref().unwrap_or(""))
}

#[tauri::command]
pub fn set_media_repeat_mode(
    mode: Option<String>,
    target_app_id: Option<String>,
) -> Value {
    winrt_set_repeat(
        mode.as_deref().unwrap_or("off"),
        target_app_id.as_deref().unwrap_or(""),
    )
}

#[tauri::command]
pub fn set_media_option(
    command: String,
    enabled: Option<bool>,
    target_app_id: Option<String>,
) -> Value {
    winrt_set_option(
        &command,
        enabled.unwrap_or(true),
        target_app_id.as_deref().unwrap_or(""),
    )
}
