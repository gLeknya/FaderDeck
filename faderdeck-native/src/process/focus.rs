use napi::Result;
use napi_derive::napi;
use std::time::Instant;
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
    SetForegroundWindow, ShowWindow, SW_RESTORE,
};
use windows::core::PWSTR;

use super::types::FocusedWindow;
use crate::util::string::from_wide_slice;

#[napi]
pub fn get_focused_window() -> Result<Option<FocusedWindow>> {
    let start = Instant::now();

    let result = unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            tracing::debug!(target: "native:focus", "No foreground window");
            return Ok(None);
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));

        if pid == 0 {
            tracing::debug!(target: "native:focus", "No process ID for foreground window");
            return Ok(None);
        }

        // Get window title
        let mut title_buf = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, &mut title_buf);
        let window_title = if title_len > 0 {
            from_wide_slice(&title_buf[..title_len as usize])
        } else {
            String::new()
        };

        // Get process path
        let process_handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        let (process_path, process_name) = if let Ok(handle) = process_handle {
            let mut path_buf = [0u16; 1024];
            let mut path_len = path_buf.len() as u32;

            if QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(path_buf.as_mut_ptr()), &mut path_len).is_ok() {
                let full_path = from_wide_slice(&path_buf[..path_len as usize]);
                let name = std::path::Path::new(&full_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                let name_without_ext = name.trim_end_matches(".exe").to_string();
                (full_path, name_without_ext)
            } else {
                (String::new(), String::new())
            }
        } else {
            (String::new(), String::new())
        };

        let process_file = if !process_path.is_empty() {
            std::path::Path::new(&process_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string()
        } else {
            format!("{}.exe", process_name)
        };

        let has_window = !window_title.is_empty();

        let elapsed = start.elapsed();
        tracing::debug!(
            target: "native:focus",
            latency_us = elapsed.as_micros(),
            pid = pid,
            has_window = has_window,
            "get_focused_window completed"
        );

        Ok(Some(FocusedWindow {
            pid,
            process: process_file,
            process_name,
            path: process_path,
            main_window_title: window_title,
            has_window,
        }))
    };

    result
}

#[napi]
pub fn focus_window_by_pid(pid: u32) -> Result<bool> {
    let start = Instant::now();

    unsafe {
        let mut target_hwnd: HWND = HWND(std::ptr::null_mut());

        extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> windows::Win32::Foundation::BOOL {
            unsafe {
                let target_pid = lparam.0 as u32;
                let mut window_pid: u32 = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut window_pid as *mut u32));

                if window_pid == target_pid && IsWindowVisible(hwnd).as_bool() {
                    let target_hwnd_ptr = lparam.0 as *mut HWND;
                    *target_hwnd_ptr = hwnd;
                    return false.into(); // Stop enumeration
                }

                true.into()
            }
        }

        windows::Win32::UI::WindowsAndMessaging::EnumWindows(
            Some(enum_windows_proc),
            LPARAM(&mut target_hwnd as *mut HWND as isize),
        )
        .ok();

        if !target_hwnd.0.is_null() {
            ShowWindow(target_hwnd, SW_RESTORE);
            let result = SetForegroundWindow(target_hwnd).as_bool();

            let elapsed = start.elapsed();
            tracing::debug!(
                target: "native:focus",
                latency_us = elapsed.as_micros(),
                pid = pid,
                success = result,
                "focus_window_by_pid completed"
            );

            Ok(result)
        } else {
            tracing::debug!(
                target: "native:focus",
                pid = pid,
                "No visible window found for PID"
            );
            Ok(false)
        }
    }
}
