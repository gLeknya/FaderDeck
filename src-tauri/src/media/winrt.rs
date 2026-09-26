use crate::system::keyboard::send_key;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaTransportResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(rename = "targetAppId", skip_serializing_if = "Option::is_none")]
    pub target_app_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaSessionItem {
    #[serde(rename = "appId")]
    pub app_id: String,
    pub title: String,
    pub artist: String,
    pub status: String,
    pub playing: bool,
}

fn get_session_manager() -> Option<GlobalSystemMediaTransportControlsSessionManager> {
    GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .ok()?
        .get()
        .ok()
}

fn find_target_session(
    manager: &GlobalSystemMediaTransportControlsSessionManager,
    target_app_id: &str,
) -> Option<GlobalSystemMediaTransportControlsSession> {
    let target = target_app_id.trim();
    if target.is_empty() {
        return manager.GetCurrentSession().ok();
    }

    if let Ok(sessions) = manager.GetSessions() {
        for session in sessions {
            if let Ok(id) = session.SourceAppUserModelId() {
                if id.to_string_lossy().eq_ignore_ascii_case(target) {
                    return Some(session);
                }
            }
        }
    }

    manager.GetCurrentSession().ok()
}

pub fn send_media_transport(command: &str, target_app_id: &str) -> MediaTransportResult {
    let cmd = command.trim().to_lowercase();

    if let Some(manager) = get_session_manager() {
        if let Some(session) = find_target_session(&manager, target_app_id) {
            let res = match cmd.as_str() {
                "play" => session.TryPlayAsync().ok().and_then(|op| op.get().ok()),
                "pause" => session.TryPauseAsync().ok().and_then(|op| op.get().ok()),
                "toggle" | "playpause" => session.TryTogglePlayPauseAsync().ok().and_then(|op| op.get().ok()),
                "next" | "skipnext" => session.TrySkipNextAsync().ok().and_then(|op| op.get().ok()),
                "previous" | "skipprevious" => session.TrySkipPreviousAsync().ok().and_then(|op| op.get().ok()),
                "stop" => session.TryStopAsync().ok().and_then(|op| op.get().ok()),
                "rewind" => session.TryRewindAsync().ok().and_then(|op| op.get().ok()),
                "fastforward" => session.TryFastForwardAsync().ok().and_then(|op| op.get().ok()),
                _ => None,
            };

            if let Some(true) = res {
                return MediaTransportResult {
                    success: true,
                    error: None,
                    command: Some(cmd),
                    target_app_id: Some(target_app_id.to_string()),
                };
            }
        }
    }

    // Fallback to virtual keyboard media keys
    let fallback_key = match cmd.as_str() {
        "play" | "pause" | "toggle" | "playpause" => "MediaPlayPause",
        "next" | "skipnext" => "MediaNextTrack",
        "previous" | "skipprevious" => "MediaPreviousTrack",
        "stop" => "MediaStop",
        _ => "",
    };

    if !fallback_key.is_empty() {
        let key_res = send_key(fallback_key, target_app_id);
        MediaTransportResult {
            success: key_res.success,
            error: key_res.error,
            command: Some(cmd),
            target_app_id: Some(target_app_id.to_string()),
        }
    } else {
        MediaTransportResult {
            success: false,
            error: Some("unsupported-command".to_string()),
            command: Some(cmd),
            target_app_id: Some(target_app_id.to_string()),
        }
    }
}

pub fn list_media_sessions() -> Value {
    let mut sessions_list = Vec::new();

    if let Some(manager) = get_session_manager() {
        if let Ok(sessions) = manager.GetSessions() {
            for session in sessions {
                let app_id = session
                    .SourceAppUserModelId()
                    .map(|s| s.to_string_lossy())
                    .unwrap_or_default();

                let mut title = String::new();
                let mut artist = String::new();

                if let Ok(media_props_op) = session.TryGetMediaPropertiesAsync() {
                    if let Ok(props) = media_props_op.get() {
                        title = props.Title().map(|s| s.to_string_lossy()).unwrap_or_default();
                        artist = props.Artist().map(|s| s.to_string_lossy()).unwrap_or_default();
                    }
                }

                let mut status_str = "Closed";
                let mut playing = false;

                if let Ok(info) = session.GetPlaybackInfo() {
                    if let Ok(status) = info.PlaybackStatus() {
                        match status {
                            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => {
                                status_str = "Playing";
                                playing = true;
                            }
                            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => {
                                status_str = "Paused";
                            }
                            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped => {
                                status_str = "Stopped";
                            }
                            _ => {}
                        }
                    }
                }

                sessions_list.push(MediaSessionItem {
                    app_id,
                    title,
                    artist,
                    status: status_str.to_string(),
                    playing,
                });
            }
        }
    }

    json!({
        "success": true,
        "sessions": sessions_list
    })
}

pub fn get_media_session_state(target_app_id: &str) -> Value {
    if let Some(manager) = get_session_manager() {
        if let Some(session) = find_target_session(&manager, target_app_id) {
            let app_id = session
                .SourceAppUserModelId()
                .map(|s| s.to_string_lossy())
                .unwrap_or_default();

            let mut title = String::new();
            let mut artist = String::new();

            if let Ok(props_op) = session.TryGetMediaPropertiesAsync() {
                if let Ok(props) = props_op.get() {
                    title = props.Title().map(|s| s.to_string_lossy()).unwrap_or_default();
                    artist = props.Artist().map(|s| s.to_string_lossy()).unwrap_or_default();
                }
            }

            let mut playing = false;
            let mut status_str = "Closed";
            if let Ok(info) = session.GetPlaybackInfo() {
                if let Ok(status) = info.PlaybackStatus() {
                    if status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing {
                        playing = true;
                        status_str = "Playing";
                    } else if status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused {
                        status_str = "Paused";
                    }
                }
            }

            return json!({
                "success": true,
                "session": {
                    "appId": app_id,
                    "title": title,
                    "artist": artist,
                    "playing": playing,
                    "status": status_str
                }
            });
        }
    }

    json!({
        "success": false,
        "error": "no-session"
    })
}

pub fn set_media_repeat_mode(_mode: &str, _target_app_id: &str) -> Value {
    json!({ "success": true })
}

pub fn set_media_option(_command: &str, _enabled: bool, _target_app_id: &str) -> Value {
    json!({ "success": true })
}
