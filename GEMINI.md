# Antigravity Project Instructions

Refer to the primary rules and developer guidelines defined in [AGENTS.md](AGENTS.md).

All agents working on this workspace MUST adhere to:
1. No Electron, No PowerShell — pure native Tauri v2 + Rust WASAPI.
2. Active utilization of `context7` for crate documentation and `nuphus-mcp` for desktop automation and testing.
3. Strict adherence to the 44-method IPC contract, clean DOM event listeners, and low-latency (<1 ms) MIDI routing.
4. Proactive delegation to subagents (`invoke_subagent`, `send_message`) for deep codebase research, parallel tasks, and isolated UI/desktop verification.
