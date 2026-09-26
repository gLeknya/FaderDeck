pub mod audio;
pub mod commands;
pub mod media;
pub mod midi;
pub mod profile;
pub mod state;
pub mod system;
pub mod window;

use state::AppState;
use std::time::Duration;
use tauri::{Emitter, Manager};
use window::hud_window::{configure_hud_window, show_volume_hud};
use window::tray::setup_tray;

pub fn run() {
    let app_state = AppState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .setup(|app| {
            let handle = app.handle().clone();

            // 1. Setup system tray
            let _ = setup_tray(&handle);

            // 2. Set AppHandle in MidiEngine
            let state = app.state::<AppState>();
            state.midi_engine.set_app_handle(handle.clone());

            // 3. Connect MidiRouter to Volume HUD
            let hud_handle = handle.clone();
            state.midi_engine.router().set_hud_callback(move |payload| {
                show_volume_hud(&hud_handle, payload);
            });

            // 4. Pre-load default or first profile if present
            let list_res = state.profile_storage.list_profiles();
            if let Some(profiles) = list_res.profiles {
                let target = profiles.iter().find(|p| p.name.eq_ignore_ascii_case("Default")).or_else(|| profiles.first());
                if let Some(item) = target {
                    let load_res = state.profile_storage.load_profile(&item.name);
                    if let Some(profile_data) = load_res.profile.or(load_res.data) {
                        state.midi_engine.router().update_bindings_from_profile(&profile_data);
                    }
                }
            }

            // 5. Configure click-through overlay window
            configure_hud_window(&handle);

            // 6. Background active window focus tracker (emits app:focus-state every 250ms)
            let focus_handle = handle.clone();
            let my_pid = std::process::id();
            std::thread::spawn(move || {
                let mut last_pid = 0u32;
                loop {
                    std::thread::sleep(Duration::from_millis(250));
                    if let Some(focused) = system::focus::get_focused_application() {
                        if focused.pid != last_pid {
                            last_pid = focused.pid;
                            let has_focus = focused.pid == my_pid;
                            let _ = focus_handle.emit("app:focus-state", serde_json::json!({
                                "hasFocus": has_focus,
                                "application": focused
                            }));
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Audio
            commands::get_audio_applications,
            commands::list_running_applications,
            commands::get_audio_states,
            commands::set_app_volume,
            commands::set_app_volume_batch,
            commands::toggle_app_mute,
            commands::set_app_mute,
            commands::list_audio_devices,
            commands::set_audio_device_volume,
            commands::set_audio_device_mute,
            commands::set_default_audio_device,

            // Profile
            commands::save_profile,
            commands::load_profile,
            commands::list_profiles,
            commands::delete_profile,
            commands::rename_profile,
            commands::import_profile,
            commands::get_profile_template,
            commands::get_profiles_directory,
            commands::open_profiles_folder,
            commands::show_profile_in_folder,
            commands::pick_profile_file,
            commands::pick_action_file,

            // System
            commands::get_focused_application,
            commands::launch_app,
            commands::run_user_script,
            commands::set_process_window_visibility,
            commands::send_key,
            commands::get_application_icons,
            commands::get_app_info,
            commands::check_for_updates,
            commands::open_external_url,
            commands::show_volume_hud,
            commands::toggle_devtools,
            commands::toggle_debug_panel,
            commands::notify_developer_mode_changed,
            commands::set_close_to_tray_enabled,
            commands::exit_app,
            commands::window_control,

            // Media
            commands::send_media_transport,
            commands::list_media_sessions,
            commands::get_media_session_state,
            commands::set_media_repeat_mode,
            commands::set_media_option,

            // MIDI
            commands::midi_list_ports,
            commands::midi_select_input,
            commands::midi_select_output,
            commands::midi_send_output,
            commands::midi_learn_start,
            commands::midi_learn_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running faderdeck");
}
