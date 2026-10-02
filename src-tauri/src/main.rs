#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    std::panic::set_hook(Box::new(|info| {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open("c:\\projects\\code\\FaderDeck_rework\\exit_reason.log") {
            let _ = writeln!(f, "PANIC: {:?}", info);
        }
    }));

    // Disable background timer and rendering throttling in WebView2 so MIDI and audio stay responsive in background
    #[cfg(debug_assertions)]
    let browser_args = "--disable-background-timer-throttling --disable-renderer-backgrounding --remote-debugging-port=9222";

    #[cfg(not(debug_assertions))]
    let browser_args = if std::env::args().any(|arg| arg.starts_with("--remote-debugging-port")) {
        "--disable-background-timer-throttling --disable-renderer-backgrounding --remote-debugging-port=9222"
    } else {
        "--disable-background-timer-throttling --disable-renderer-backgrounding"
    };

    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", browser_args);

    {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open("c:\\projects\\code\\FaderDeck_rework\\exit_reason.log") {
            let _ = writeln!(f, "[{:?}] Starting faderdeck_lib::run()", std::time::SystemTime::now());
        }
    }

    faderdeck_lib::run();

    {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open("c:\\projects\\code\\FaderDeck_rework\\exit_reason.log") {
            let _ = writeln!(f, "[{:?}] faderdeck_lib::run() returned normally!", std::time::SystemTime::now());
        }
    }
}
