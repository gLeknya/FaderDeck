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

pub fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();

        #[cfg(target_os = "windows")]
        if let Ok(raw_hwnd) = window.hwnd() {
            unsafe {
                use windows::Win32::Foundation::HWND;
                use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
                use windows::Win32::UI::WindowsAndMessaging::{
                    BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId,
                    SetForegroundWindow, SetWindowPos, ShowWindow, HWND_NOTOPMOST, HWND_TOPMOST,
                    SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_RESTORE, SW_SHOW,
                };

                let hwnd = HWND(raw_hwnd.0 as *mut _);
                let _ = ShowWindow(hwnd, SW_RESTORE);
                let _ = ShowWindow(hwnd, SW_SHOW);

                let fg_hwnd = GetForegroundWindow();
                let mut fg_pid = 0u32;
                let fg_thread = GetWindowThreadProcessId(fg_hwnd, Some(&mut fg_pid));
                let cur_thread = GetCurrentThreadId();

                if fg_thread != 0 && fg_thread != cur_thread {
                    let _ = AttachThreadInput(cur_thread, fg_thread, true);
                    let _ = BringWindowToTop(hwnd);
                    let _ = SetForegroundWindow(hwnd);
                    let _ = AttachThreadInput(cur_thread, fg_thread, false);
                } else {
                    let _ = BringWindowToTop(hwnd);
                    let _ = SetForegroundWindow(hwnd);
                }

                // Force z-order pop using TOPMOST -> NOTOPMOST pulse
                let _ = SetWindowPos(
                    hwnd,
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
                );
                let _ = SetWindowPos(
                    hwnd,
                    HWND_NOTOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
                );
            }
        }
    }
}
