use napi::Result;
use napi_derive::napi;
use std::collections::HashMap;
use std::time::Instant;
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::WindowsAndMessaging::{GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible};
use windows::core::PWSTR;

use super::types::ProcessInfo;
use crate::util::string::from_wide_slice;

struct WindowInfo {
    pid: u32,
    title: String,
}

#[napi]
pub fn list_processes() -> Result<Vec<ProcessInfo>> {
    let start = Instant::now();

    unsafe {
        // Step 1: Enumerate all processes
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
            .map_err(|e| napi::Error::from_reason(format!("Failed to create snapshot: {}", e)))?;

        let mut process_entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        let mut processes: HashMap<u32, (String, String)> = HashMap::new();

        if Process32FirstW(snapshot, &mut process_entry).is_ok() {
            loop {
                let pid = process_entry.th32ProcessID;
                let exe_file = from_wide_slice(&process_entry.szExeFile);

                if pid > 0 && !exe_file.is_empty() {
                    // Try to get full path
                    let process_handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
                    let full_path = if let Ok(handle) = process_handle {
                        let mut path_buf = [0u16; 1024];
                        let mut path_len = path_buf.len() as u32;

                        if QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(path_buf.as_mut_ptr()), &mut path_len).is_ok() {
                            from_wide_slice(&path_buf[..path_len as usize])
                        } else {
                            String::new()
                        }
                    } else {
                        String::new()
                    };

                    processes.insert(pid, (exe_file, full_path));
                }

                if Process32NextW(snapshot, &mut process_entry).is_err() {
                    break;
                }
            }
        }

        // Step 2: Enumerate windows and match to PIDs
        let mut window_map: HashMap<u32, String> = HashMap::new();

        extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> windows::Win32::Foundation::BOOL {
            unsafe {
                if !IsWindowVisible(hwnd).as_bool() {
                    return true.into();
                }

                let mut pid: u32 = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));

                if pid == 0 {
                    return true.into();
                }

                let mut title_buf = [0u16; 512];
                let title_len = GetWindowTextW(hwnd, &mut title_buf);

                if title_len > 0 {
                    let title = from_wide_slice(&title_buf[..title_len as usize]);
                    if !title.is_empty() {
                        let map_ptr = lparam.0 as *mut HashMap<u32, String>;
                        (*map_ptr).entry(pid).or_insert(title);
                    }
                }

                true.into()
            }
        }

        windows::Win32::UI::WindowsAndMessaging::EnumWindows(
            Some(enum_windows_proc),
            LPARAM(&mut window_map as *mut HashMap<u32, String> as isize),
        )
        .ok();

        // Step 3: Build result list
        let mut result: Vec<ProcessInfo> = Vec::new();

        for (pid, (exe_file, full_path)) in processes {
            let window_title = window_map.get(&pid).cloned().unwrap_or_default();
            let has_window = !window_title.is_empty();

            // Filter system processes without windows
            if !has_window && should_filter_system_process(&full_path) {
                continue;
            }

            let process_name = exe_file.trim_end_matches(".exe").to_string();

            result.push(ProcessInfo {
                pid,
                process: exe_file,
                process_name,
                path: full_path,
                main_window_title: window_title,
                has_window,
            });
        }

        // Sort: windowed apps first, then by process name
        result.sort_by(|a, b| {
            match (a.has_window, b.has_window) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.process.to_lowercase().cmp(&b.process.to_lowercase()),
            }
        });

        let elapsed = start.elapsed();
        tracing::debug!(
            target: "native:process",
            latency_ms = elapsed.as_millis(),
            count = result.len(),
            "list_processes completed"
        );

        Ok(result)
    }
}

fn should_filter_system_process(path: &str) -> bool {
    if path.is_empty() {
        return false;
    }

    let path_lower = path.to_lowercase();
    let system_prefixes = [
        "c:\\windows\\system32",
        "c:\\windows\\syswow64",
        "c:\\windows\\winsxs",
    ];

    system_prefixes.iter().any(|prefix| path_lower.starts_with(prefix))
}
