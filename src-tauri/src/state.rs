use crate::midi::MidiEngine;
use crate::profile::ProfileStorage;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;

pub struct AppState {
    pub profile_storage: Arc<ProfileStorage>,
    pub midi_engine: Arc<MidiEngine>,
    pub remembered_audio_states: Mutex<HashMap<String, (f64, bool)>>,
    pub active_profile_name: Mutex<String>,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {
            profile_storage: Arc::new(ProfileStorage::new()),
            midi_engine: MidiEngine::new(),
            remembered_audio_states: Mutex::new(HashMap::new()),
            active_profile_name: Mutex::new("Default".to_string()),
        }
    }
}
