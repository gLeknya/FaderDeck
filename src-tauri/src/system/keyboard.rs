use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    VIRTUAL_KEY, VK_BACK, VK_DELETE, VK_DOWN, VK_END, VK_ESCAPE, VK_HOME, VK_INSERT, VK_LEFT,
    VK_MEDIA_NEXT_TRACK, VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK, VK_MEDIA_STOP, VK_NEXT,
    VK_PRIOR, VK_RETURN, VK_RIGHT, VK_SPACE, VK_TAB, VK_UP, VK_VOLUME_DOWN, VK_VOLUME_MUTE,
    VK_VOLUME_UP,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendKeyResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suppressed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(rename = "targetHint", skip_serializing_if = "Option::is_none")]
    pub target_hint: Option<String>,
}

static MEDIA_KEY_THROTTLE: LazyLock<Mutex<HashMap<String, Instant>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

const DEBOUNCE_DURATION: Duration = Duration::from_millis(260);

fn resolve_virtual_key(key: &str) -> Option<(VIRTUAL_KEY, bool)> {
    let normalized = key.trim();
    let lower = normalized.to_lowercase();

    // Returns (VIRTUAL_KEY, is_media)
    match lower.as_str() {
        "mediaplaypause" | "playpause" => Some((VK_MEDIA_PLAY_PAUSE, true)),
        "medianexttrack" | "nexttrack" => Some((VK_MEDIA_NEXT_TRACK, true)),
        "mediaprevioustrack" | "previoustrack" => Some((VK_MEDIA_PREV_TRACK, true)),
        "mediastop" | "stop" => Some((VK_MEDIA_STOP, true)),
        "volumemute" => Some((VK_VOLUME_MUTE, true)),
        "volumedown" => Some((VK_VOLUME_DOWN, true)),
        "volumeup" => Some((VK_VOLUME_UP, true)),

        "enter" | "return" => Some((VK_RETURN, false)),
        "escape" | "esc" => Some((VK_ESCAPE, false)),
        "tab" => Some((VK_TAB, false)),
        "space" => Some((VK_SPACE, false)),
        "arrowup" | "up" => Some((VK_UP, false)),
        "arrowdown" | "down" => Some((VK_DOWN, false)),
        "arrowleft" | "left" => Some((VK_LEFT, false)),
        "arrowright" | "right" => Some((VK_RIGHT, false)),
        "delete" => Some((VK_DELETE, false)),
        "backspace" => Some((VK_BACK, false)),
        "home" => Some((VK_HOME, false)),
        "end" => Some((VK_END, false)),
        "pageup" => Some((VK_PRIOR, false)),
        "pagedown" => Some((VK_NEXT, false)),
        "insert" => Some((VK_INSERT, false)),

        _ => {
            // Function keys F1..F24
            if lower.starts_with('f') {
                if let Ok(num) = lower[1..].parse::<u16>() {
                    if (1..=24).contains(&num) {
                        return Some((VIRTUAL_KEY(0x70 + num - 1), false));
                    }
                }
            }

            // Single letters A-Z
            if normalized.len() == 1 {
                let ch = normalized.chars().next().unwrap();
                if ch.is_ascii_alphabetic() {
                    return Some((VIRTUAL_KEY(ch.to_ascii_uppercase() as u16), false));
                }
                if ch.is_ascii_digit() {
                    return Some((VIRTUAL_KEY(ch as u16), false));
                }
            }

            None
        }
    }
}

pub fn send_key(key: &str, target_hint: &str) -> SendKeyResult {
    let (vk, is_media) = match resolve_virtual_key(key) {
        Some(pair) => pair,
        None => {
            return SendKeyResult {
                success: false,
                error: Some("invalid-key".to_string()),
                suppressed: None,
                key: Some(key.to_string()),
                target_hint: Some(target_hint.to_string()),
            };
        }
    };

    if is_media {
        let mut throttle = MEDIA_KEY_THROTTLE.lock();
        let now = Instant::now();
        if let Some(last) = throttle.get(key) {
            if now.duration_since(*last) < DEBOUNCE_DURATION {
                return SendKeyResult {
                    success: true,
                    error: None,
                    suppressed: Some(true),
                    key: Some(key.to_string()),
                    target_hint: Some(target_hint.to_string()),
                };
            }
        }
        throttle.insert(key.to_string(), now);
    }

    unsafe {
        let down_input = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: KEYBD_EVENT_FLAGS(0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };

        let up_input = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };

        let inputs = [down_input, up_input];
        let sent = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);

        if sent == 2 {
            SendKeyResult {
                success: true,
                error: None,
                suppressed: Some(false),
                key: Some(key.to_string()),
                target_hint: Some(target_hint.to_string()),
            }
        } else {
            SendKeyResult {
                success: false,
                error: Some("send-input-failed".to_string()),
                suppressed: None,
                key: Some(key.to_string()),
                target_hint: Some(target_hint.to_string()),
            }
        }
    }
}
