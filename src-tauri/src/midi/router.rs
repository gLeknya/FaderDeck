use crate::audio::set_session_volume;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

pub const OMNI_CHANNEL: u8 = 255;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MidiBindingKey {
    ControlChange { channel: u8, control: u8 },
    PitchBend { channel: u8 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FaderTarget {
    pub channel_id: Option<Value>,
    pub process: String,
    pub app_name: String,
    pub title: String,
}

#[derive(Default)]
pub struct MidiRouter {
    bindings: RwLock<HashMap<MidiBindingKey, FaderTarget>>,
    hud_callback: RwLock<Option<Arc<dyn Fn(Value) + Send + Sync>>>,
}

impl MidiRouter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_hud_callback<F>(&self, callback: F)
    where
        F: Fn(Value) + Send + Sync + 'static,
    {
        *self.hud_callback.write() = Some(Arc::new(callback));
    }

    pub fn update_bindings_from_profile(&self, profile: &Value) {
        let mut map = HashMap::new();

        if let Some(channels) = profile.get("channels").and_then(|c| c.as_array()) {
            for ch in channels {
                let process = ch.get("app").and_then(|a| a.as_str()).unwrap_or("master").to_string();
                let app_name = ch.get("appName").and_then(|a| a.as_str()).unwrap_or("System volume").to_string();
                let title = ch.get("title").and_then(|t| t.as_str()).unwrap_or("").to_string();
                let channel_id = ch.get("id").cloned();

                let target = FaderTarget {
                    channel_id,
                    process,
                    app_name,
                    title,
                };

                if let Some(mapping) = ch.get("faderMapping").and_then(|m| m.as_object()) {
                    let mapping_type = mapping
                        .get("type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("control_change");

                    let midi_channel = mapping
                        .get("channel")
                        .and_then(|v| v.as_u64())
                        .map(|v| v as u8);

                    if mapping_type == "pitch_bend" || mapping_type == "pitchwheel" {
                        let ch_num = midi_channel.unwrap_or(0);
                        map.insert(MidiBindingKey::PitchBend { channel: ch_num }, target);
                    } else if let Some(control) = mapping.get("control").and_then(|v| v.as_u64()) {
                        let ch_num = midi_channel.unwrap_or(0);
                        map.insert(
                            MidiBindingKey::ControlChange {
                                channel: ch_num,
                                control: control as u8,
                            },
                            target,
                        );
                    }
                } else if let Some(cc) = ch.get("faderCC").and_then(|v| v.as_u64()) {
                    // Legacy binding without explicit faderMapping - treat as omni channel
                    map.insert(
                        MidiBindingKey::ControlChange {
                            channel: OMNI_CHANNEL,
                            control: cc as u8,
                        },
                        target,
                    );
                }
            }
        }

        *self.bindings.write() = map;
    }

    pub fn handle_control_change(&self, midi_channel: u8, control: u8, normalized_value: f64) -> Option<FaderTarget> {
        let bindings = self.bindings.read();
        let target = bindings
            .get(&MidiBindingKey::ControlChange {
                channel: midi_channel,
                control,
            })
            .or_else(|| {
                bindings.get(&MidiBindingKey::ControlChange {
                    channel: OMNI_CHANNEL,
                    control,
                })
            })
            .cloned()?;

        self.apply_volume_and_notify(&target, normalized_value);
        Some(target)
    }

    pub fn handle_pitch_bend(&self, midi_channel: u8, normalized_value: f64) -> Option<FaderTarget> {
        let bindings = self.bindings.read();
        let target = bindings
            .get(&MidiBindingKey::PitchBend {
                channel: midi_channel,
            })
            .or_else(|| {
                bindings.get(&MidiBindingKey::PitchBend {
                    channel: OMNI_CHANNEL,
                })
            })
            .cloned()?;

        self.apply_volume_and_notify(&target, normalized_value);
        Some(target)
    }

    fn apply_volume_and_notify(&self, target: &FaderTarget, normalized_value: f64) {
        // Direct WASAPI execution
        let _ = set_session_volume(&target.process, normalized_value);

        // Notify HUD if registered
        if let Some(ref cb) = *self.hud_callback.read() {
            let payload = json!({
                "title": if target.title.is_empty() { &target.app_name } else { &target.title },
                "subtitle": if target.process == "master" { "" } else { &target.app_name },
                "volume": normalized_value,
                "muted": normalized_value == 0.0,
                "valueText": format!("{}%", normalized_value.round() as i64),
                "presentation": {
                    "enabled": true,
                    "orientation": "horizontal",
                    "showIcon": true,
                    "showTitle": true,
                    "showSubtitle": true,
                    "showPercent": true,
                    "showMeter": true
                }
            });
            cb(payload);
        }
    }
}
