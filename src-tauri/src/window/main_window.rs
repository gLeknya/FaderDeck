use parking_lot::RwLock;
use std::sync::LazyLock;
use tauri::{AppHandle, Manager};

static CLOSE_TO_TRAY_ENABLED: LazyLock<RwLock<bool>> = LazyLock::new(|| RwLock::new(true));

pub fn set_close_to_tray(enabled: bool) {
    *CLOSE_TO_TRAY_ENABLED.write() = enabled;
}

pub fn is_close_to_tray_enabled() -> bool {
    *CLOSE_TO_TRAY_ENABLED.read()
}

pub fn handle_window_control(app: &AppHandle, action: &str) {
    if let Some(window) = app.get_webview_window("main") {
        match action {
            "minimize" => {
                let _ = window.minimize();
            }
            "maximize" => {
                if let Ok(is_max) = window.is_maximized() {
                    if is_max {
                        let _ = window.unmaximize();
                    } else {
                        let _ = window.maximize();
                    }
                }
            }
            "close" => {
                if is_close_to_tray_enabled() {
                    let _ = window.hide();
                } else {
                    app.exit(0);
                }
            }
            _ => {}
        }
    }
}
