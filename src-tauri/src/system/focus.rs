use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::Path;
use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
    SetForegroundWindow, ShowWindowAsync, SW_RESTORE,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusedApplication {
    pub pid: u32,
    pub process: String,
    #[serde(rename = "processName")]
    pub process_name: String,
    pub path: String,
    #[serde(rename = "mainWindowTitle")]
    pub main_window_title: String,
    #[serde(rename = "hasWindow")]
    pub has_window: bool,
}

pub fn from_wide_slice(slice: &[u16]) -> String {
    let end = slice.iter().position(|&c| c == 0).unwrap_or(slice.len());
    OsString::from_wide(&slice[..end])
        .to_string_lossy()
        .into_owned()
}

pub fn get_focused_application() -> Option<FocusedApplication> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));
        if pid == 0 {
            return None;
        }

        let mut title_buf = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, &mut title_buf);
        let window_title = if title_len > 0 {
            from_wide_slice(&title_buf[..title_len as usize])
        } else {
            String::new()
        };

        let process_handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        let (process_path, process_name, process_file) = if let Ok(handle) = process_handle {
            let mut path_buf = [0u16; 1024];
            let mut path_len = path_buf.len() as u32;

            let info = if QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(path_buf.as_mut_ptr()), &mut path_len).is_ok() {
                let full_path = from_wide_slice(&path_buf[..path_len as usize]);
                let file_name = Path::new(&full_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                let name = file_name.trim_end_matches(".exe").to_string();
                (full_path, name, file_name)
            } else {
                (String::new(), String::new(), String::new())
            };

            let _ = CloseHandle(handle);
            info
        } else {
            (String::new(), String::new(), String::new())
        };

        if process_file.is_empty() {
            return None;
        }

        Some(FocusedApplication {
            pid,
            process: process_file,
            process_name,
            path: process_path,
            has_window: !window_title.is_empty(),
            main_window_title: window_title,
        })
    }
}

pub fn focus_window_by_pid(pid: u32) -> bool {
    unsafe {
        struct EnumContext {
            target_pid: u32,
            target_hwnd: HWND,
        }

        let mut ctx = EnumContext {
            target_pid: pid,
            target_hwnd: HWND(std::ptr::null_mut()),
        };

        extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> windows::Win32::Foundation::BOOL {
            unsafe {
                let ctx = &mut *(lparam.0 as *mut EnumContext);
                let mut window_pid: u32 = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut window_pid as *mut u32));

                if window_pid == ctx.target_pid && IsWindowVisible(hwnd).as_bool() {
                    ctx.target_hwnd = hwnd;
                    return false.into();
                }

                true.into()
            }
        }

        let _ = windows::Win32::UI::WindowsAndMessaging::EnumWindows(
            Some(enum_proc),
            LPARAM(&mut ctx as *mut EnumContext as isize),
        );

        if !ctx.target_hwnd.0.is_null() {
            let _ = ShowWindowAsync(ctx.target_hwnd, SW_RESTORE);
            SetForegroundWindow(ctx.target_hwnd).as_bool()
        } else {
            false
        }
    }
}
