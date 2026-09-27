use super::parser::MidiParsedMessage;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearnResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mapping: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub struct MidiLearnState {
    active: bool,
    target_type: String, // "fader" or "button"
    target_id: String,
    started_at: Instant,
    timeout: Duration,
}

impl Default for MidiLearnState {
    fn default() -> Self {
        Self {
            active: false,
            target_type: String::new(),
            target_id: String::new(),
            started_at: Instant::now(),
            timeout: Duration::from_secs(8),
        }
    }
}

pub struct MidiLearnManager {
    state: Mutex<MidiLearnState>,
}

impl Default for MidiLearnManager {
    fn default() -> Self {
        Self::new()
    }
}

impl MidiLearnManager {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(MidiLearnState::default()),
        }
    }

    pub fn start_learn(&self, target_type: &str, target_id: &str) {
        let mut s = self.state.lock();
        s.active = true;
        s.target_type = target_type.to_string();
        s.target_id = target_id.to_string();
        s.started_at = Instant::now();
    }

    pub fn cancel_learn(&self) {
        let mut s = self.state.lock();
        s.active = false;
    }

    pub fn process_message(&self, message: &MidiParsedMessage) -> Option<Value> {
        let mut s = self.state.lock();
        if !s.active {
            return None;
        }

        if s.started_at.elapsed() > s.timeout {
            s.active = false;
            return None;
        }

        let mapping = match (s.target_type.as_str(), message) {
            ("fader", MidiParsedMessage::ControlChange { channel, control, .. }) => {
                Some(json!({
                    "type": "control_change",
                    "channel": channel,
                    "control": control,
                    "resolution": "7bit"
                }))
            }
            ("fader", MidiParsedMessage::PitchBend { channel, .. }) => {
                Some(json!({
                    "type": "pitch_bend",
                    "channel": channel,
                    "resolution": "14bit"
                }))
            }
            ("button", MidiParsedMessage::NoteOn { channel, note, .. }) => {
                Some(json!({
                    "type": "note",
                    "channel": channel,
                    "note": note
                }))
            }
            ("button", MidiParsedMessage::ControlChange { channel, control, .. }) => {
                Some(json!({
                    "type": "control_change",
                    "channel": channel,
                    "control": control
                }))
            }
            _ => None,
        };

        if mapping.is_some() {
            s.active = false;
        }

        mapping
    }
}
