use crate::state::AppState;
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub fn midi_list_ports(state: State<'_, AppState>) -> Value {
    let inputs = state.midi_engine.list_input_ports();
    let outputs = state.midi_engine.list_output_ports();
    json!({
        "success": true,
        "inputs": inputs,
        "outputs": outputs
    })
}

#[tauri::command]
pub fn midi_select_input(port_id: String, state: State<'_, AppState>) -> Value {
    let ok = state.midi_engine.select_input_port(&port_id);
    json!({ "success": ok })
}

#[tauri::command]
pub fn midi_select_output(port_id: String, state: State<'_, AppState>) -> Value {
    let ok = state.midi_engine.select_output_port(&port_id);
    json!({ "success": ok })
}

#[tauri::command]
pub fn midi_send_output(bytes: Vec<u8>, state: State<'_, AppState>) -> Value {
    let ok = state.midi_engine.send_output_bytes(&bytes);
    json!({ "success": ok })
}

#[tauri::command]
pub fn midi_learn_start(
    target_type: String,
    target_id: String,
    state: State<'_, AppState>,
) -> Value {
    state.midi_engine.learn().start_learn(&target_type, &target_id);
    json!({ "success": true })
}

#[tauri::command]
pub fn midi_learn_cancel(state: State<'_, AppState>) -> Value {
    state.midi_engine.learn().cancel_learn();
    json!({ "success": true })
}
