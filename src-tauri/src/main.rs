#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Disable background timer and rendering throttling in WebView2 so MIDI and audio stay responsive in background
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--disable-background-timer-throttling --disable-renderer-backgrounding --remote-debugging-port=9222",
    );

    faderdeck_lib::run();
}
