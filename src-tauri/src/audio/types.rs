use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioApplication {
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
    pub volume: f64,
    pub muted: bool,
    pub peak: f32,
    #[serde(rename = "peakLevel")]
    pub peak_level: f32,
    #[serde(rename = "hasAudioSession")]
    pub has_audio_session: bool,
    #[serde(rename = "sessionCount")]
    pub session_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub flow: String,
    #[serde(rename = "isDefault")]
    pub is_default: bool,
    pub volume: f64,
    pub muted: bool,
    pub peak: f32,
    #[serde(rename = "peakLevel")]
    pub peak_level: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioState {
    pub process: String,
    pub volume: f64,
    pub muted: bool,
    pub peak: f32,
    #[serde(rename = "peakLevel")]
    pub peak_level: f32,
    #[serde(rename = "hasAudioSession")]
    pub has_audio_session: bool,
    #[serde(rename = "sessionCount")]
    pub session_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetVolumeResult {
    pub success: bool,
    pub volume: f64,
    pub process: String,
    pub muted: bool,
    #[serde(rename = "updatedCount")]
    pub updated_count: usize,
    #[serde(rename = "hasAudioSession")]
    pub has_audio_session: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetMuteResult {
    pub success: bool,
    pub muted: bool,
    pub process: String,
    pub volume: f64,
    #[serde(rename = "updatedCount")]
    pub updated_count: usize,
    #[serde(rename = "hasAudioSession")]
    pub has_audio_session: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceListResult {
    pub success: bool,
    pub flow: String,
    pub devices: Vec<AudioDevice>,
}
