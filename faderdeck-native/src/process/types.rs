use napi_derive::napi;
use serde::{Deserialize, Serialize};

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusedWindow {
    pub pid: u32,
    pub process: String,
    pub process_name: String,
    pub path: String,
    pub main_window_title: String,
    pub has_window: bool,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub process: String,
    pub process_name: String,
    pub path: String,
    pub main_window_title: String,
    pub has_window: bool,
}
