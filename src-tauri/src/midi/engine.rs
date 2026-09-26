use super::learn::MidiLearnManager;
use super::parser::{parse_midi_message, MidiParsedMessage};
use super::router::MidiRouter;
use midir::{Ignore, MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MidiPortInfo {
    pub id: String,
    pub name: String,
}

pub struct MidiEngine {
    router: Arc<MidiRouter>,
    learn: Arc<MidiLearnManager>,
    selected_input_id: Mutex<Option<String>>,
    selected_output_id: Mutex<Option<String>>,
    input_connection: Mutex<Option<MidiInputConnection<()>>>,
    output_connection: Mutex<Option<MidiOutputConnection>>,
    app_handle: Mutex<Option<AppHandle>>,
}

impl MidiEngine {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            router: Arc::new(MidiRouter::new()),
            learn: Arc::new(MidiLearnManager::new()),
            selected_input_id: Mutex::new(None),
            selected_output_id: Mutex::new(None),
            input_connection: Mutex::new(None),
            output_connection: Mutex::new(None),
            app_handle: Mutex::new(None),
        })
    }

    pub fn set_app_handle(&self, handle: AppHandle) {
        *self.app_handle.lock() = Some(handle);
    }

    pub fn router(&self) -> &Arc<MidiRouter> {
        &self.router
    }

    pub fn learn(&self) -> &Arc<MidiLearnManager> {
        &self.learn
    }

    pub fn list_input_ports(&self) -> Vec<MidiPortInfo> {
        let mut list = Vec::new();
        if let Ok(midi_in) = MidiInput::new("FaderDeck-Scan") {
            for (idx, port) in midi_in.ports().iter().enumerate() {
                let name = midi_in.port_name(port).unwrap_or_else(|_| format!("MIDI In {}", idx));
                list.push(MidiPortInfo {
                    id: name.clone(),
                    name,
                });
            }
        }
        list
    }

    pub fn list_output_ports(&self) -> Vec<MidiPortInfo> {
        let mut list = Vec::new();
        if let Ok(midi_out) = MidiOutput::new("FaderDeck-Scan") {
            for (idx, port) in midi_out.ports().iter().enumerate() {
                let name = midi_out.port_name(port).unwrap_or_else(|_| format!("MIDI Out {}", idx));
                list.push(MidiPortInfo {
                    id: name.clone(),
                    name,
                });
            }
        }
        list
    }

    pub fn select_input_port(self: &Arc<Self>, port_name: &str) -> bool {
        // Drop existing connection
        *self.input_connection.lock() = None;
        *self.selected_input_id.lock() = None;

        let trimmed = port_name.trim();
        if trimmed.is_empty() || trimmed == "__disabled__" {
            return true;
        }

        let mut midi_in = match MidiInput::new("FaderDeck-Input") {
            Ok(m) => m,
            Err(_) => return false,
        };
        midi_in.ignore(Ignore::None);

        let ports = midi_in.ports();
        let target_port = ports.into_iter().find(|p| {
            midi_in
                .port_name(p)
                .map(|n| n.eq_ignore_ascii_case(trimmed))
                .unwrap_or(false)
        });

        let port = match target_port {
            Some(p) => p,
            None => return false,
        };

        let engine = Arc::clone(self);
        let conn = midi_in.connect(
            &port,
            "faderdeck-read",
            move |_timestamp, message, _| {
                engine.handle_incoming_midi_bytes(message);
            },
            (),
        );

        match conn {
            Ok(c) => {
                *self.input_connection.lock() = Some(c);
                *self.selected_input_id.lock() = Some(trimmed.to_string());
                true
            }
            Err(_) => false,
        }
    }

    pub fn select_output_port(&self, port_name: &str) -> bool {
        *self.output_connection.lock() = None;
        *self.selected_output_id.lock() = None;

        let trimmed = port_name.trim();
        if trimmed.is_empty() || trimmed == "__disabled__" {
            return true;
        }

        let midi_out = match MidiOutput::new("FaderDeck-Output") {
            Ok(m) => m,
            Err(_) => return false,
        };

        let ports = midi_out.ports();
        let target_port = ports.into_iter().find(|p| {
            midi_out
                .port_name(p)
                .map(|n| n.eq_ignore_ascii_case(trimmed))
                .unwrap_or(false)
        });

        let port = match target_port {
            Some(p) => p,
            None => return false,
        };

        match midi_out.connect(&port, "faderdeck-write") {
            Ok(c) => {
                *self.output_connection.lock() = Some(c);
                *self.selected_output_id.lock() = Some(trimmed.to_string());
                true
            }
            Err(_) => false,
        }
    }

    pub fn send_output_bytes(&self, bytes: &[u8]) -> bool {
        let mut conn = self.output_connection.lock();
        if let Some(ref mut c) = *conn {
            c.send(bytes).is_ok()
        } else {
            false
        }
    }

    fn handle_incoming_midi_bytes(&self, bytes: &[u8]) {
        let parsed = parse_midi_message(bytes);

        // 1. Direct hardware routing for sub-millisecond volume control
        match parsed {
            Some(MidiParsedMessage::ControlChange {
                channel,
                control,
                normalized_value,
                ..
            }) => {
                self.router.handle_control_change(channel, control, normalized_value);
            }
            Some(MidiParsedMessage::PitchBend {
                channel,
                normalized_value,
                ..
            }) => {
                self.router.handle_pitch_bend(channel, normalized_value);
            }
            _ => {}
        }

        // 2. MIDI Learn handling
        if let Some(ref p) = parsed {
            if let Some(learned) = self.learn.process_message(p) {
                if let Some(ref app) = *self.app_handle.lock() {
                    let _ = app.emit("midi:learned", learned);
                }
            }
        }

        // 3. Emit message to Tauri frontend for WebMIDI compatibility & UI animation
        if let Some(ref app) = *self.app_handle.lock() {
            let port_id = self.selected_input_id.lock().clone();
            let payload = json!({
                "raw": bytes,
                "parsed": parsed,
                "portId": port_id
            });
            let _ = app.emit("midi:message", payload);
        }
    }
}
