use faderdeck_lib::audio::*;
use faderdeck_lib::midi::parser::*;
use faderdeck_lib::profile::*;
use faderdeck_lib::system::process::list_running_processes;
use serde_json::json;
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn test_audio_endpoints_and_sessions() {
    let devices = list_audio_devices("all");
    println!("Found {} audio devices", devices.devices.len());
    assert!(devices.success);

    let sessions = list_detected_sessions().unwrap_or_default();
    println!("Found {} active audio sessions", sessions.len());

    let vol = get_master_volume();
    println!("Master volume: {:?}", vol);
    assert!(vol.is_ok());
    let v = vol.unwrap();
    assert!((0.0..=100.0).contains(&v));
}

#[test]
fn test_process_listing() {
    let procs = list_running_processes();
    println!("Found {} running processes", procs.len());
    assert!(!procs.is_empty());
    // There must be at least one process with a window or name
    assert!(procs.iter().any(|p| !p.process.is_empty()));
}

#[test]
fn test_profile_lifecycle() {
    let temp_dir = std::env::temp_dir().join(format!("faderdeck_ipc_test_{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    let storage = ProfileStorage::with_base_dir(temp_dir.clone());

    let profile_data = json!({
        "version": 1,
        "meta": {
            "name": "Integration Test Profile"
        },
        "channels": [
            {
                "id": 101,
                "app": "master",
                "appName": "System volume",
                "title": "Master Fader",
                "faderCC": 7,
                "faderMapping": { "channel": 0, "control": 7 },
                "volume": 85
            }
        ],
        "standaloneButtons": [],
        "bindings": { "faders": [], "buttons": [] },
        "audio": { "assignments": [] },
        "settings": { "midiInputId": "TestPort" }
    });

    let save = storage.save_profile("Integration Test Profile", profile_data);
    assert!(save.success);

    let load = storage.load_profile("Integration Test Profile");
    assert!(load.success);
    let loaded = load.data.unwrap();
    assert_eq!(loaded["meta"]["name"], "Integration Test Profile");

    let faders = loaded["bindings"]["faders"].as_array().unwrap();
    assert_eq!(faders.len(), 1);
    assert_eq!(faders[0]["process"], "master");
    assert_eq!(faders[0]["faderCC"], 7);

    let del = storage.delete_profile("Integration Test Profile");
    assert!(del.success);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_midi_parsing_all_types() {
    // CC
    let cc_bytes = [0xB2, 10, 64];
    let cc = parse_midi_message(&cc_bytes).unwrap();
    assert!(matches!(cc, MidiParsedMessage::ControlChange { channel: 2, control: 10, value: 64, .. }));

    // Note On
    let n_bytes = [0x90, 36, 127];
    let note = parse_midi_message(&n_bytes).unwrap();
    assert!(matches!(note, MidiParsedMessage::NoteOn { channel: 0, note: 36, velocity: 127 }));

    // Note Off
    let noff_bytes = [0x80, 36, 64];
    let noff = parse_midi_message(&noff_bytes).unwrap();
    assert!(matches!(noff, MidiParsedMessage::NoteOff { channel: 0, note: 36, velocity: 64 }));
}

#[test]
fn test_get_application_icons() {
    let icons = faderdeck_lib::system::icons::get_application_icons(&[
        "C:\\Windows\\explorer.exe".to_string(),
    ]);
    println!("Icons extracted: {}", icons.len());
    assert!(!icons.is_empty(), "Failed to extract icon from explorer.exe");
    for (path, url) in &icons {
        assert!(url.starts_with("data:image/png;base64,"));
        println!("Icon for {}: {} chars", path, url.len());
    }
}

#[test]
fn test_midi_router_multi_channel() {
    let router = faderdeck_lib::midi::router::MidiRouter::new();
    let profile = json!({
        "channels": [
            {
                "id": 1,
                "app": "master",
                "appName": "System volume",
                "faderMapping": { "channel": 0, "control": 7 }
            },
            {
                "id": 2,
                "app": "spotify.exe",
                "appName": "Spotify",
                "faderMapping": { "channel": 1, "control": 7 }
            }
        ]
    });
    router.update_bindings_from_profile(&profile);

    let target_ch0 = router.handle_control_change(0, 7, 50.0);
    assert!(target_ch0.is_some());
    assert_eq!(target_ch0.unwrap().process, "master", "Channel 0 CC 7 should route to master!");

    let target_ch1 = router.handle_control_change(1, 7, 75.0);
    assert!(target_ch1.is_some());
    assert_eq!(target_ch1.unwrap().process, "spotify.exe", "Channel 1 CC 7 should route to spotify.exe!");
}

#[test]
fn test_midi_router_pitch_bend() {
    let router = faderdeck_lib::midi::router::MidiRouter::new();
    let profile = json!({
        "channels": [
            {
                "id": 1,
                "app": "master",
                "appName": "System volume",
                "faderMapping": { "type": "pitch_bend", "channel": 0 }
            },
            {
                "id": 2,
                "app": "discord.exe",
                "appName": "Discord",
                "faderMapping": { "type": "pitch_bend", "channel": 2 }
            }
        ]
    });
    router.update_bindings_from_profile(&profile);

    let target_ch0 = router.handle_pitch_bend(0, 80.0);
    assert!(target_ch0.is_some());
    assert_eq!(target_ch0.unwrap().process, "master");

    let target_ch2 = router.handle_pitch_bend(2, 60.0);
    assert!(target_ch2.is_some());
    assert_eq!(target_ch2.unwrap().process, "discord.exe");

    let target_ch1 = router.handle_pitch_bend(1, 50.0);
    assert!(target_ch1.is_none(), "Channel 1 without pitch bend binding should be None");
}

#[test]
fn test_midi_router_omni_fallback() {
    let router = faderdeck_lib::midi::router::MidiRouter::new();
    let profile = json!({
        "channels": [
            {
                "id": 1,
                "app": "master",
                "appName": "System volume",
                "faderCC": 7
            },
            {
                "id": 2,
                "app": "game.exe",
                "appName": "Game",
                "faderMapping": { "channel": 5, "control": 7 }
            }
        ]
    });
    router.update_bindings_from_profile(&profile);

    // Channel 5 has explicit binding to game.exe
    let target_ch5 = router.handle_control_change(5, 7, 100.0);
    assert!(target_ch5.is_some());
    assert_eq!(target_ch5.unwrap().process, "game.exe");

    // Any other channel (e.g. 0, 1, 9) falls back to legacy omni faderCC 7 (master)
    let target_ch0 = router.handle_control_change(0, 7, 50.0);
    assert!(target_ch0.is_some());
    assert_eq!(target_ch0.unwrap().process, "master");

    let target_ch9 = router.handle_control_change(9, 7, 25.0);
    assert!(target_ch9.is_some());
    assert_eq!(target_ch9.unwrap().process, "master");

    // Unmapped CC returns None
    let target_ch0_cc10 = router.handle_control_change(0, 10, 50.0);
    assert!(target_ch0_cc10.is_none());
}

#[test]
fn test_midi_router_empty_and_corrupt_profile() {
    let router = faderdeck_lib::midi::router::MidiRouter::new();
    // Empty object
    router.update_bindings_from_profile(&json!({}));
    assert!(router.handle_control_change(0, 7, 50.0).is_none());

    // Channels with nulls and missing fields
    router.update_bindings_from_profile(&json!({
        "channels": [
            null,
            {},
            { "id": null, "app": null },
            { "faderMapping": null, "faderCC": null }
        ]
    }));
    assert!(router.handle_control_change(0, 7, 50.0).is_none());
}

#[test]
fn test_midi_learn_pitch_bend_and_cc() {
    let learn = faderdeck_lib::midi::learn::MidiLearnManager::new();
    learn.start_learn("fader", "chan-1");

    let pb_msg = MidiParsedMessage::PitchBend {
        channel: 3,
        value: 8192,
        normalized_value: 50.0,
    };
    let learned = learn.process_message(&pb_msg);
    assert!(learned.is_some());
    let l = learned.unwrap();
    assert_eq!(l["type"], "pitch_bend");
    assert_eq!(l["channel"], 3);
    assert_eq!(l["resolution"], "14bit");
}

#[test]
fn test_media_and_keyboard() {
    let sessions = faderdeck_lib::media::winrt::list_media_sessions();
    assert!(sessions["success"].as_bool().unwrap());

    // Test send_key with a virtual key
    let key_res = faderdeck_lib::system::keyboard::send_key("space", "");
    println!("key_res: {:?}", key_res);
    // In headless or elevated foreground environments, SendInput may be blocked by UIPI
    // but the key resolution and pipeline should be valid.
    assert!(key_res.error.as_deref() != Some("invalid-key"));
}




