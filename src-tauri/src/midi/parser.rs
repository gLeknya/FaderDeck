use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum MidiParsedMessage {
    #[serde(rename = "control_change")]
    ControlChange {
        channel: u8,
        control: u8,
        value: u8,
        #[serde(rename = "normalizedValue")]
        normalized_value: f64,
    },
    #[serde(rename = "note_on")]
    NoteOn {
        channel: u8,
        note: u8,
        velocity: u8,
    },
    #[serde(rename = "note_off")]
    NoteOff {
        channel: u8,
        note: u8,
        velocity: u8,
    },
    #[serde(rename = "pitch_bend")]
    PitchBend {
        channel: u8,
        value: u16,
        #[serde(rename = "normalizedValue")]
        normalized_value: f64,
    },
    #[serde(rename = "other")]
    Other {
        status: u8,
        data: Vec<u8>,
    },
}

pub fn parse_midi_message(bytes: &[u8]) -> Option<MidiParsedMessage> {
    if bytes.is_empty() {
        return None;
    }

    let status_byte = bytes[0];
    let msg_type = status_byte & 0xF0;
    let channel = status_byte & 0x0F;

    match msg_type {
        0xB0 => {
            // Control Change
            if bytes.len() >= 3 {
                let control = bytes[1];
                let value = bytes[2];
                let normalized = (value as f64 / 127.0) * 100.0;
                Some(MidiParsedMessage::ControlChange {
                    channel,
                    control,
                    value,
                    normalized_value: (normalized * 10.0).round() / 10.0,
                })
            } else {
                None
            }
        }
        0x90 => {
            // Note On
            if bytes.len() >= 3 {
                let note = bytes[1];
                let velocity = bytes[2];
                if velocity == 0 {
                    Some(MidiParsedMessage::NoteOff {
                        channel,
                        note,
                        velocity: 0,
                    })
                } else {
                    Some(MidiParsedMessage::NoteOn {
                        channel,
                        note,
                        velocity,
                    })
                }
            } else {
                None
            }
        }
        0x80 => {
            // Note Off
            if bytes.len() >= 3 {
                let note = bytes[1];
                let velocity = bytes[2];
                Some(MidiParsedMessage::NoteOff {
                    channel,
                    note,
                    velocity,
                })
            } else {
                None
            }
        }
        0xE0 => {
            // Pitch Bend
            if bytes.len() >= 3 {
                let lsb = bytes[1] as u16;
                let msb = bytes[2] as u16;
                let value = (msb << 7) | lsb;
                let normalized = (value as f64 / 16383.0) * 100.0;
                Some(MidiParsedMessage::PitchBend {
                    channel,
                    value,
                    normalized_value: (normalized * 10.0).round() / 10.0,
                })
            } else {
                None
            }
        }
        _ => Some(MidiParsedMessage::Other {
            status: status_byte,
            data: bytes[1..].to_vec(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_control_change() {
        let bytes = [0xB0, 7, 127]; // CC 7 on channel 0, value 127 (max volume)
        let parsed = parse_midi_message(&bytes).unwrap();
        match parsed {
            MidiParsedMessage::ControlChange {
                channel,
                control,
                value,
                normalized_value,
            } => {
                assert_eq!(channel, 0);
                assert_eq!(control, 7);
                assert_eq!(value, 127);
                assert!((normalized_value - 100.0).abs() < 0.1);
            }
            _ => panic!("Expected ControlChange"),
        }
    }

    #[test]
    fn test_parse_note_on_off() {
        let note_on = [0x91, 60, 100]; // Note on channel 1, middle C, vel 100
        let parsed = parse_midi_message(&note_on).unwrap();
        match parsed {
            MidiParsedMessage::NoteOn { channel, note, velocity } => {
                assert_eq!(channel, 1);
                assert_eq!(note, 60);
                assert_eq!(velocity, 100);
            }
            _ => panic!("Expected NoteOn"),
        }

        let note_on_zero = [0x91, 60, 0]; // Velocity 0 should parse as NoteOff
        let parsed_zero = parse_midi_message(&note_on_zero).unwrap();
        match parsed_zero {
            MidiParsedMessage::NoteOff { channel, note, velocity } => {
                assert_eq!(channel, 1);
                assert_eq!(note, 60);
                assert_eq!(velocity, 0);
            }
            _ => panic!("Expected NoteOff for vel 0"),
        }
    }

    #[test]
    fn test_parse_pitch_bend() {
        let pb = [0xE0, 0x00, 0x40]; // Center pitch bend (8192)
        let parsed = parse_midi_message(&pb).unwrap();
        match parsed {
            MidiParsedMessage::PitchBend { channel, value, normalized_value } => {
                assert_eq!(channel, 0);
                assert_eq!(value, 8192);
                assert!((normalized_value - 50.0).abs() < 0.5);
            }
            _ => panic!("Expected PitchBend"),
        }
    }
}

