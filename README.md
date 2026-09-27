# FaderDeck

A lightweight native Windows utility that transforms any hardware MIDI controller into an advanced operating system volume mixer.

---

## 1. Description and Purpose

### What is FaderDeck
**FaderDeck** is a high-performance, next-generation application built around the "Stop Shipping a Browser" philosophy. The project is a complete Greenfield refactoring of the original Electron implementation, moving to a native stack based on **Tauri v2 + Rust + System WebView2**.

### What It Does
The application connects the physical faders, knobs, and buttons of any MIDI controller directly to Windows audio streams:
- **Master volume and device control**: Control master output, input endpoints, and per-device volume levels.
- **Individual per-application volume control**: Control specific apps (Discord, Telegram, web browsers, games, media players, Spotify, Yandex Music, etc.) without having to switch windows or leave full-screen apps.
- **Windows 11 media transport integration**: Control playback via hardware buttons (Play/Pause, Next/Previous Track, Mute).
- **On-screen Volume HUD overlay**: A non-intrusive on-screen display showing volume adjustments directly on top of games and fullscreen applications with sub-millisecond response latency (<1 ms).
- **Minimal system footprint**: Consumes only ~25–50 MB of RAM with a 3.4 MB standalone executable (compared to 300–500 MB RAM and 5–8 background processes in Electron-based versions).

---

### How to Build

#### System Requirements
1. **OS**: Windows 10 (64-bit) or Windows 11.
2. **Rust**: Latest stable toolchain (installed via [rustup.rs](https://rustup.rs/)).
3. **C++ Build Tools**: Visual Studio Build Tools with the "Desktop development with C++" workload.
4. **WebView2 Runtime**: Pre-installed on Windows 10/11 by default (Evergreen runtime).

#### Build & Run

1. **Clone or download the repository**:
   ```powershell
   git clone https://github.com/CodeFader/FaderDeck.git
   cd FaderDeck
   ```

2. **Run in development mode**:
   ```powershell
   cd src-tauri
   cargo run
   ```

3. **Build an optimized release binary**:
   ```powershell
   cd src-tauri
   cargo build --release
   ```
   The compiled, optimized executable will be located at:
   `src-tauri\target\release\faderdeck.exe`.

   *The app is fully portable: simply copy `faderdeck.exe` to test or run it on any other Windows PC.*

---

## 2. Project Architecture and Technical Decisions

FaderDeck's architecture is based on modular separation between a high-speed system-level Rust backend and a lightweight web user interface.

```
FaderDeck
├── src-tauri/                 # Native Backend (Rust + Tauri v2)
│   ├── src/
│   │   ├── audio/             # Windows WASAPI COM Audio Engine
│   │   │   ├── wasapi.rs      # Master volume & mute (IAudioEndpointVolume)
│   │   │   ├── sessions.rs    # Per-app audio sessions (IAudioSessionManager2, ISimpleAudioVolume)
│   │   │   ├── devices.rs     # Audio endpoint enumeration (eRender / eCapture)
│   │   │   └── policy_config.rs # Default device switching (IPolicyConfigVista COM)
│   │   ├── midi/              # Hardware MIDI Engine
│   │   │   ├── engine.rs      # Background message reception thread via midir
│   │   │   ├── parser.rs      # CC (7-bit, 14-bit), Note On/Off, Pitch Bend parsing
│   │   │   ├── router.rs      # Direct MIDI -> WASAPI routing (<1 ms latency)
│   │   │   └── learn.rs       # Interactive mapping manager (MIDI Learn)
│   │   ├── media/             # Windows 11 Media Controls (SMTC & Win32 AppCommands)
│   │   ├── system/            # Win32 Services: active window focus tracking, icon extraction
│   │   ├── window/            # Window Management, System Tray, and Transparent Volume HUD
│   │   ├── profile/           # Profile serialization & storage (%APPDATA%\FaderDeck)
│   │   ├── commands/          # 44 IPC command handlers for the UI
│   │   └── lib.rs             # Tauri v2 entry point and setup lifecycle
│   ├── Cargo.toml             # Dependencies & release profiles (LTO, opt-level="z")
│   └── tauri.conf.json        # Window, security, capability, and tray configuration
└── ui/                        # Web Interface (Vanilla HTML5 / CSS3 / ES6+)
    ├── index.html             # Mixer layout, settings panels, and modals
    ├── style.css              # Custom styling, animations, and responsive rules
    ├── js/
    │   ├── adapters/          # Tauri IPC Bridge & WebMIDI Polyfill
    │   ├── state/             # Reactive state management stores
    │   ├── runtime/           # Audio session and button interaction runtimes
    │   └── actions/           # UI action dispatchers
    └── overlay/               # Standalone click-through Volume HUD overlay
```

### Key Technical Decisions

1. **Direct WASAPI COM Integration (Zero PowerShell)**:
   - Completely eliminates `powershell.exe` worker processes and external script wrappers.
   - All audio operations use direct Win32 COM interfaces (`IMMDeviceEnumerator`, `IAudioEndpointVolume`, `IAudioSessionEnumerator`, `ISimpleAudioVolume`).
   - Default playback device switching is handled instantly via the undocumented `IPolicyConfigVista` COM interface (CLSID `{294935ce-f637-4e7c-a41b-ab255460b862}`).
   - Guaranteed zero handle leaks: all Win32 `OpenProcess` handles are strictly managed through RAII / `CloseHandle`.

2. **Ultra-Low Latency MIDI Routing Bypassing WebView**:
   - The `midir` thread receives hardware MIDI messages in an asynchronous OS-level thread.
   - When a fader or knob is moved, WASAPI volume adjustment is executed **directly from the MIDI thread**, bypassing the Web engine entirely. Volume adjustments occur in under 1 ms.
   - Full background responsiveness: zero throttling or audio lag when the application window is minimized to the system tray.

3. **Dual-Window Model with Click-Through Transparent HUD**:
   - Main Window (`main`): Frameless desktop interface with smooth minimize-to-tray behavior.
   - Overlay Window (`volume-hud`): Transparent, topmost window configured with Win32 extended styles `WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW`. Completely avoids stealing input focus or disrupting full-screen games.

4. **IPC Contract Adapter and WebMIDI Polyfill**:
   - `ui/js/adapters/tauri-bridge.js` implements a polyfill for the standard W3C Web MIDI API (`navigator.requestMIDIAccess`), connecting the original web frontend directly to Tauri's native Rust event pipeline via `invoke` and `listen`.
   - Maintains 100% backward compatibility with the existing profile JSON schema and all 44 IPC methods.

---

## 3. Roadmap

### Implemented Features (Current Version)

- [x] **Hardware MIDI Support**:
  - **Faders**: Full support for 7-bit (Control Change) and 14-bit high-resolution inputs (Pitch Bend and dual-CC pairs).
  - **Buttons**: Toggle and Momentary modes, Note On / Note Off processing.
  - **Knobs & Encoders**: Absolute value processing with configurable normalization curves.
  - **Bidirectional Indication (MIDI Feedback)**: Output signals sent back to the controller to drive button LEDs and motorized fader states.
  - **Interactive MIDI Learn**: One-click physical controller assignment through the configuration modal.
- [x] **Windows 11 Media Integration**:
  - Transport playback control via System Media Transport Controls (SMTC) and Win32 AppCommands (Play/Pause, Next Track, Previous Track, Mute).
  - Intelligent auto-targeting for currently active media players (Spotify, Yandex Music, web browser media).
- [x] **Volume HUD (On-Screen Overlay)**:
  - Transparent volume pop-up overlay displayed over all apps and full-screen games during controller adjustment.
  - Displays application icons (extracted in real-time via Win32 `SHGetFileInfoW`), session titles, percentage, and visual volume meter.
  - Built-in debounce timer with smooth automatic hide animations.
- [x] **Window Manager and System Tray**:
  - Single compact Windows notification tray icon with context menu and quick window restoration.
  - Background operation mode on window close.
