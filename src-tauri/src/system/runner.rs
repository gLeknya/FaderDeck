use super::focus::from_wide_slice;
use serde::{Deserialize, Serialize};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowThreadProcessId, IsWindowVisible, SetForegroundWindow, ShowWindowAsync,
    SW_HIDE, SW_RESTORE, SW_SHOW,
};

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisibilityResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visible: Option<bool>,
}

pub fn launch_application(file_path: &str) -> LaunchResult {
    let path = Path::new(file_path);
    if !path.exists() {
        return LaunchResult {
            success: false,
            error: Some("file-not-found".to_string()),
            path: Some(file_path.to_string()),
        };
    }

    let wide_file: Vec<u16> = file_path.encode_utf16().chain(std::iter::once(0)).collect();
    let wide_open: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();

    unsafe {
        let res = ShellExecuteW(
            HWND(std::ptr::null_mut()),
            PCWSTR(wide_open.as_ptr()),
            PCWSTR(wide_file.as_ptr()),
            PCWSTR(std::ptr::null()),
            PCWSTR(std::ptr::null()),
            SW_SHOW,
        );

        if res.0 as usize > 32 {
            LaunchResult {
                success: true,
                error: None,
                path: Some(file_path.to_string()),
            }
        } else {
            LaunchResult {
                success: false,
                error: Some(format!("ShellExecute error code: {}", res.0 as usize)),
                path: Some(file_path.to_string()),
            }
        }
    }
}

pub const FORBIDDEN_SHELL_CHARS: &[char] = &['&', '|', '<', '>', '^', '%', '\r', '\n', '"'];

pub fn contains_shell_injection_chars(s: &str) -> bool {
    s.chars().any(|c| FORBIDDEN_SHELL_CHARS.contains(&c))
}

pub fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{}", stripped))
    } else if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

pub fn canonicalize_path(path: &Path) -> std::io::Result<PathBuf> {
    let canonical = std::fs::canonicalize(path)?;
    Ok(strip_verbatim_prefix(&canonical))
}

pub fn run_user_script(file_path: &str) -> LaunchResult {
    let path = Path::new(file_path);
    if !path.exists() {
        return LaunchResult {
            success: false,
            error: Some("file-not-found".to_string()),
            path: Some(file_path.to_string()),
        };
    }

    let canonical_path = match canonicalize_path(path) {
        Ok(p) => p,
        Err(e) => {
            return LaunchResult {
                success: false,
                error: Some(format!("Canonicalization error: {}", e)),
                path: Some(file_path.to_string()),
            };
        }
    };

    if !canonical_path.is_file() {
        return LaunchResult {
            success: false,
            error: Some("Target is not a regular file".to_string()),
            path: Some(file_path.to_string()),
        };
    }

    let ext = canonical_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    let canonical_str = canonical_path.to_string_lossy().to_string();

    let child = match ext.as_str() {
        "ps1" => Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                &canonical_str,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn(),
        "cmd" | "bat" => {
            if contains_shell_injection_chars(&canonical_str) {
                return LaunchResult {
                    success: false,
                    error: Some("Invalid characters in script path".to_string()),
                    path: Some(file_path.to_string()),
                };
            }
            Command::new("cmd.exe")
                .args(["/d", "/c", &canonical_str])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
        }
        "vbs" | "wsf" => {
            if contains_shell_injection_chars(&canonical_str) {
                return LaunchResult {
                    success: false,
                    error: Some("Invalid characters in script path".to_string()),
                    path: Some(file_path.to_string()),
                };
            }
            Command::new("wscript.exe")
                .arg(&canonical_str)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
        }
        _ => return launch_application(&canonical_str),
    };

    match child {
        Ok(_) => LaunchResult {
            success: true,
            error: None,
            path: Some(canonical_str),
        },
        Err(e) => LaunchResult {
            success: false,
            error: Some(format!("Failed to spawn script: {}", e)),
            path: Some(file_path.to_string()),
        },
    }
}

pub fn set_process_window_visibility(
    process_name: &str,
    visible: Option<bool>,
    _executable_path: &str,
) -> VisibilityResult {
    let target = process_name.trim().to_lowercase();
    let target_exe = if target.ends_with(".exe") {
        target.clone()
    } else {
        format!("{}.exe", target)
    };

    unsafe {
        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(s) => s,
            Err(_) => {
                return VisibilityResult {
                    success: false,
                    error: Some("process-snapshot-failed".to_string()),
                    visible: None,
                }
            }
        };

        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        let mut target_pids = Vec::new();

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let exe_file = from_wide_slice(&entry.szExeFile).to_lowercase();
                if exe_file == target || exe_file == target_exe {
                    target_pids.push(entry.th32ProcessID);
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = windows::Win32::Foundation::CloseHandle(snapshot);

        if target_pids.is_empty() {
            return VisibilityResult {
                success: false,
                error: Some("process-not-found".to_string()),
                visible: None,
            };
        }

        // Find windows belonging to target PIDs
        struct Context {
            pids: Vec<u32>,
            hwnds: Vec<HWND>,
        }

        let mut ctx = Context {
            pids: target_pids,
            hwnds: Vec::new(),
        };

        extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> windows::Win32::Foundation::BOOL {
            unsafe {
                let mut pid: u32 = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));
                let ctx = &mut *(lparam.0 as *mut Context);
                if ctx.pids.contains(&pid) {
                    ctx.hwnds.push(hwnd);
                }
                true.into()
            }
        }

        let _ = EnumWindows(Some(enum_proc), LPARAM(&mut ctx as *mut Context as isize));

        if ctx.hwnds.is_empty() {
            return VisibilityResult {
                success: false,
                error: Some("window-not-found".to_string()),
                visible: None,
            };
        }

        // Find primary window
        let mut target_hwnd = ctx.hwnds[0];
        for &hwnd in &ctx.hwnds {
            if IsWindowVisible(hwnd).as_bool() {
                target_hwnd = hwnd;
                break;
            }
        }

        let is_visible = IsWindowVisible(target_hwnd).as_bool();
        let next_visible = match visible {
            Some(v) => v,
            None => !is_visible,
        };

        if next_visible {
            let _ = ShowWindowAsync(target_hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(target_hwnd);
        } else {
            let _ = ShowWindowAsync(target_hwnd, SW_HIDE);
        }

        VisibilityResult {
            success: true,
            error: None,
            visible: Some(next_visible),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_verbatim_prefix() {
        let p1 = Path::new(r"\\?\C:\Windows\System32");
        assert_eq!(strip_verbatim_prefix(p1), PathBuf::from(r"C:\Windows\System32"));

        let p2 = Path::new(r"\\?\UNC\server\share\file.txt");
        assert_eq!(strip_verbatim_prefix(p2), PathBuf::from(r"\\server\share\file.txt"));

        let p3 = Path::new(r"C:\Windows\System32");
        assert_eq!(strip_verbatim_prefix(p3), PathBuf::from(r"C:\Windows\System32"));
    }

    #[test]
    fn test_contains_shell_injection_chars() {
        assert!(!contains_shell_injection_chars(r"C:\Scripts\my_safe_script.bat"));
        assert!(!contains_shell_injection_chars(r"C:\Program Files\App\run.cmd"));

        assert!(contains_shell_injection_chars(r"C:\Scripts\test.bat & calc.exe"));
        assert!(contains_shell_injection_chars(r"C:\Scripts\test.bat | notepad"));
        assert!(contains_shell_injection_chars(r"C:\Scripts\test.bat > out.txt"));
        assert!(contains_shell_injection_chars(r"C:\Scripts\test.bat < in.txt"));
        assert!(contains_shell_injection_chars(r"C:\Scripts\test^.bat"));
        assert!(contains_shell_injection_chars(r"C:\Scripts\%PATH%.bat"));
        assert!(contains_shell_injection_chars("C:\\Scripts\\test.bat\ncalc"));
        assert!(contains_shell_injection_chars("C:\\Scripts\\\"test\".bat"));
    }

    #[test]
    fn test_run_user_script_nonexistent() {
        let res = run_user_script(r"C:\non_existent_folder_xyz\test.ps1");
        assert!(!res.success);
        assert_eq!(res.error, Some("file-not-found".to_string()));
    }

    #[test]
    fn test_run_user_script_execution() {
        let temp_dir = std::env::temp_dir();
        let ps1_file = temp_dir.join("faderdeck_test_safe.ps1");
        let cmd_file = temp_dir.join("faderdeck_test_safe.cmd");

        std::fs::write(&ps1_file, "Write-Output 'safe'").expect("write ps1");
        std::fs::write(&cmd_file, "@echo off\r\necho safe\r\n").expect("write cmd");

        let res_ps1 = run_user_script(ps1_file.to_str().unwrap());
        assert!(res_ps1.success, "ps1 execution should succeed: {:?}", res_ps1.error);

        let res_cmd = run_user_script(cmd_file.to_str().unwrap());
        assert!(res_cmd.success, "cmd execution should succeed: {:?}", res_cmd.error);

        std::thread::sleep(std::time::Duration::from_millis(800));
        let _ = std::fs::remove_file(&ps1_file);
        let _ = std::fs::remove_file(&cmd_file);
    }
}
