use parking_lot::Mutex;
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::LazyLock;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_EXSTYLE, SWP_FRAMECHANGED, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    WS_EX_TRANSPARENT,
};

static HUD_GENERATION: LazyLock<AtomicU64> = LazyLock::new(|| AtomicU64::new(0));
static CONFIGURED_HWNDS: LazyLock<Mutex<Vec<isize>>> = LazyLock::new(|| Mutex::new(Vec::new()));

pub fn configure_hud_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("volume-hud") {
        if let Ok(raw_hwnd) = window.hwnd() {
            let hwnd_val = raw_hwnd.0 as isize;
            let mut list = CONFIGURED_HWNDS.lock();
            if !list.contains(&hwnd_val) {
                unsafe {
                    let hwnd = HWND(raw_hwnd.0 as *mut _);
                    let ex = GetWindowLongW(hwnd, GWL_EXSTYLE);
                    let flags = (WS_EX_TRANSPARENT.0 | WS_EX_LAYERED.0 | WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0) as i32;
                    let _ = SetWindowLongW(hwnd, GWL_EXSTYLE, ex | flags);
                    let _ = SetWindowPos(
                        hwnd,
                        HWND(std::ptr::null_mut()),
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_NOACTIVATE,
                    );
                }
                list.push(hwnd_val);
            }
        }
    }
}

pub fn show_volume_hud(app: &AppHandle, payload: Value) {
    let window = match app.get_webview_window("volume-hud") {
        Some(w) => w,
        None => return,
    };

    configure_hud_window(app);

    let orientation = payload
        .get("presentation")
        .and_then(|p| p.get("orientation"))
        .and_then(|o| o.as_str())
        .unwrap_or("horizontal");

    let (logical_width, logical_height) = if orientation == "vertical" {
        (194.0, 242.0)
    } else {
        (328.0, 126.0)
    };

    let scale = window.scale_factor().unwrap_or(1.0);
    let phys_width = (logical_width * scale).round() as u32;
    let phys_height = (logical_height * scale).round() as u32;

    let _ = window.set_size(Size::Physical(PhysicalSize {
        width: phys_width,
        height: phys_height,
    }));

    // Center horizontally near bottom
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let screen_size = monitor.size();
        let bottom_margin = (48.0 * scale).round() as i32;
        let x = (screen_size.width as i32 - phys_width as i32) / 2;
        let y = screen_size.height as i32 - phys_height as i32 - bottom_margin;
        let _ = window.set_position(Position::Physical(PhysicalPosition { x, y }));
    }

    let _ = window.emit("volume-hud:update", &payload);
    let _ = window.emit("volume-hud:visibility", serde_json::json!({ "visible": true }));
    let _ = window.show();

    // Bump generation for debounce auto-hide
    let current_gen = HUD_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app_handle = app.clone();

    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1350));
        if HUD_GENERATION.load(Ordering::SeqCst) != current_gen {
            return; // Superseded by a newer volume HUD display
        }

        if let Some(win) = app_handle.get_webview_window("volume-hud") {
            let _ = win.emit("volume-hud:visibility", serde_json::json!({ "visible": false }));
            std::thread::sleep(Duration::from_millis(200));
            if HUD_GENERATION.load(Ordering::SeqCst) == current_gen {
                let _ = win.hide();
            }
        }
    });
}
