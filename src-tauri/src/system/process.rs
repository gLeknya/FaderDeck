use super::focus::from_wide_slice;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use windows::core::PWSTR;
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessCatalogEntry {
    pub name: String,
    pub process: String,
    #[serde(rename = "processName")]
    pub process_name: String,
    pub path: String,
    #[serde(rename = "mainWindowTitle")]
    pub main_window_title: String,
    #[serde(rename = "hasWindow")]
    pub has_window: bool,
    #[serde(rename = "instanceCount")]
    pub instance_count: usize,
}

pub fn list_running_processes() -> Vec<ProcessCatalogEntry> {
    unsafe {
        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        // pid -> (process_file, path)
        let mut processes: HashMap<u32, (String, String)> = HashMap::new();
        // process_file.to_lowercase() -> count
        let mut counts: HashMap<String, usize> = HashMap::new();

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let pid = entry.th32ProcessID;
                let exe_file = from_wide_slice(&entry.szExeFile);

                if pid > 0 && !exe_file.is_empty() {
                    let key = exe_file.to_lowercase();
                    *counts.entry(key).or_insert(0) += 1;

                    let mut full_path = String::new();
                    if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                        let mut buf = [0u16; 1024];
                        let mut len = buf.len() as u32;
                        if QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok() {
                            full_path = from_wide_slice(&buf[..len as usize]);
                        }
                        let _ = windows::Win32::Foundation::CloseHandle(handle);
                    }

                    processes.insert(pid, (exe_file, full_path));
                }

                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }

        let _ = windows::Win32::Foundation::CloseHandle(snapshot);

        // Map PID -> Main Window Title
        let mut window_map: HashMap<u32, String> = HashMap::new();

        extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> windows::Win32::Foundation::BOOL {
            unsafe {
                if !IsWindowVisible(hwnd).as_bool() {
                    return true.into();
                }

                let mut pid: u32 = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));
                if pid == 0 {
                    return true.into();
                }

                let mut buf = [0u16; 512];
                let len = GetWindowTextW(hwnd, &mut buf);
                if len > 0 {
                    let title = from_wide_slice(&buf[..len as usize]);
                    if !title.is_empty() {
                        let map = &mut *(lparam.0 as *mut HashMap<u32, String>);
                        map.entry(pid).or_insert(title);
                    }
                }

                true.into()
            }
        }

        let _ = EnumWindows(
            Some(enum_proc),
            LPARAM(&mut window_map as *mut HashMap<u32, String> as isize),
        );

        // Group by process name
        let mut aggregated: HashMap<String, ProcessCatalogEntry> = HashMap::new();

        for (pid, (exe_file, full_path)) in processes {
            let key = exe_file.to_lowercase();
            let window_title = window_map.get(&pid).cloned().unwrap_or_default();
            let has_window = !window_title.is_empty();

            if !has_window && is_system_path(&full_path) {
                continue;
            }

            let entry = aggregated.entry(key.clone()).or_insert_with(|| {
                let name = Path::new(&exe_file)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&exe_file)
                    .to_string();

                ProcessCatalogEntry {
                    name,
                    process: exe_file.clone(),
                    process_name: exe_file.trim_end_matches(".exe").to_string(),
                    path: full_path.clone(),
                    main_window_title: window_title.clone(),
                    has_window,
                    instance_count: *counts.get(&key).unwrap_or(&1),
                }
            });

            if !entry.has_window && has_window {
                entry.has_window = true;
                entry.main_window_title = window_title;
                if entry.path.is_empty() && !full_path.is_empty() {
                    entry.path = full_path;
                }
            }
        }

        let mut list: Vec<ProcessCatalogEntry> = aggregated.into_values().collect();
        list.sort_by(|a, b| match (a.has_window, b.has_window) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });

        list
    }
}

fn is_system_path(path: &str) -> bool {
    if path.is_empty() {
        return false;
    }
    let lower = path.to_lowercase();
    lower.starts_with("c:\\windows\\system32")
        || lower.starts_with("c:\\windows\\syswow64")
        || lower.starts_with("c:\\windows\\winsxs")
}
