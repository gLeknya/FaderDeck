# AGENTS.md — Developer and AI Agent Guidelines for FaderDeck

> **PRIME DIRECTIVE FOR ALL AI AGENTS:**
> This repository is a greenfield rewrite of FaderDeck from Electron/PowerShell to native **Tauri v2 + Rust + System WebView2**.
> Before reading other files or suggesting modifications, you MUST familiarize yourself with the architectural invariants and MCP tool capabilities outlined in this document.

---

## 1. Project Context & Non-Negotiable Rules

1. **No Electron, No PowerShell**:
   - The original Electron/PowerShell codebase in `FaderDeck_old/` is an immutable, read-only reference archive. Never modify, execute, or reintroduce Electron or PowerShell scripts into `FaderDeck_rework/`.
   - The entire backend runs in a single native Win32 process compiled from `src-tauri/` via Rust.

2. **Performance & Resource Limits**:
   - Binary size: ~3.4 MB standalone executable (`src-tauri/target/release/faderdeck.exe`).
   - RAM footprint: ~25–50 MB total (including WebView2 child processes).
   - Latency: Fader/knob MIDI-to-audio adjustments must execute in **< 1 ms** directly in the background MIDI thread.

3. **Internal UI Libraries First**:
   - For all scrollable UI surfaces, **must** use `fader-scroll` via `ui/js/fader-scroll-bridge.js`. Never use native `::-webkit-scrollbar` or `scrollbar-width` CSS.
   - For all concave fillets, inverted corners, joined block contours, and animated polygons, **must** use `corner-bite` (`ui/corner-bite/`). Never use CSS pseudo-element hacks or ad-hoc SVG masks.
   - Library sources in `ui/scroll-lib/` and `ui/corner-bite/` are considered pristine components; do not modify their internal implementations unless an integration bug is explicitly confirmed or requested.

---

## 2. Authorized MCP Tools

Agents working on this project are equipped with and encouraged to use specialized MCP servers:

### `context7` (Documentation & Library Research)
- **When to use**: Whenever you need accurate, up-to-date documentation, API signatures, or best practices for crates and frameworks (e.g. Tauri v2, `midir`, `windows-rs` 0.58, `serde`, `parking_lot`).
- **Tools**:
  - `call_mcp_tool` with `ServerName: "context7"`, `ToolName: "resolve-library-id"`
  - `call_mcp_tool` with `ServerName: "context7"`, `ToolName: "query-docs"`

### `nuphus-mcp` (Desktop Computer Use & UI Automation)
- **When to use**: To inspect running application windows, test physical mouse clicks and keyboard shortcuts, capture actual window screenshots, and automate UI testing without guessing.
- **Key Tools**:
  - `desktop_windows_list`: Find visible HWNDs, window titles, coordinates, and process IDs.
  - `desktop_window_screenshot`: Capture the visual state of the FaderDeck window or Volume HUD overlay.
  - `desktop_mouse`: Perform native mouse clicks (`action: "click"`, `button: "left"`, `x`, `y`).
  - `desktop_semantic_observe` & `desktop_semantic_execute`: Query and invoke Windows UI Automation (UIA) elements.
  - `desktop_window_activate` & `desktop_window_move`: Control window positioning across displays.

---

## 3. Subagent Strategy & Autonomous Delegation

Agents are expected to proactively utilize subagents (`invoke_subagent`, `send_message`) to maintain high development velocity, isolate context, and parallelize complex tasks:

1. **When to Delegate to Subagents**:
   - **Deep Codebase & Legacy Exploration**: When analyzing large chunks of `FaderDeck_old/` or reviewing architectural patterns across multiple crates, delegate to the `research` subagent to keep the main agent's context clean and focused.
   - **Parallel Module Implementation**: When implementing independent modules (e.g. adding new WASAPI audio endpoint methods while refining UI stylesheets), launch specialized subagents concurrently.
   - **Isolated Verification & Debugging**: Offload tedious diagnostic loops, Playwright checks, or multi-step UIA desktop automation (`nuphus-mcp`) to a subagent that reports back with screenshots and structured results.

2. **Subagent Best Practices**:
   - **Clear Deliverables**: Give subagents clear, actionable prompts detailing specific goals, constraints (e.g. no PowerShell, close Win32 handles), and expected outputs.
   - **Reuse Active Subagents**: If a task is a continuation of previous work, communicate via `send_message` rather than creating redundant agents.
   - **No Polling**: Rely on Antigravity's reactive wakeup. Never write busy-wait loops while waiting for subagents; stop tool calling to yield control.

---

## 4. Core Architecture & Subsystems

### A. Windows WASAPI Audio Engine (`src-tauri/src/audio/`)
- All audio control is implemented in pure Rust via Win32 COM interfaces (`IMMDeviceEnumerator`, `IAudioEndpointVolume`, `IAudioSessionEnumerator`, `ISimpleAudioVolume`).
- Default playback/recording device switching is handled via the undocumented COM interface `IPolicyConfigVista` (CLSID `{294935ce-f637-4e7c-a41b-ab255460b862}`).
- **Safety Rule**: Every Win32 process handle obtained via `OpenProcess` must be explicitly closed using `CloseHandle` to guarantee zero handle leaks.

### B. Hardware MIDI Engine (`src-tauri/src/midi/`)
- The `midir` thread runs asynchronously in the background.
- **Direct Routing**: Moving a hardware fader invokes WASAPI volume adjustment directly inside the MIDI thread (`router.rs`), completely bypassing the Web engine.
- Supports 7-bit CC, 14-bit high-resolution CC pairs, Pitch Bend, Note On/Off, and MIDI Feedback (LED/motorized faders).

### C. Window Management & Volume HUD (`src-tauri/src/window/`)
- **Main Window**: Frameless window (`decorations: false`). Closes to the system tray.
- **Single System Tray**: Created exclusively in `src-tauri/src/lib.rs` / `tray.rs` via `TrayIconBuilder`. Do NOT add `"trayIcon"` to `tauri.conf.json`, as this produces a duplicate tray icon.
- **Volume HUD**: Transparent, click-through overlay (`WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW`). It must never steal input focus from fullscreen games.

### D. Frontend & WebView2 Integration (`ui/`)
- Vanilla HTML5 / CSS3 / ES6+ in `ui/`.
- `ui/js/adapters/tauri-bridge.js` exposes `window.faderDeck` implementing all 44 IPC contract methods and polyfills W3C WebMIDI (`navigator.requestMIDIAccess`).
- **CSP & Click Invariant**:
  - Do NOT use inline HTML `onclick="..."` attributes. Modern WebView2 CSP blocks them. Always bind events via `addEventListener` in JavaScript.
  - All interactive elements inside `.toolbar` must retain `-webkit-app-region: no-drag` in `style.css` so that Windows does not intercept clicks as window dragging.

### E. Custom Scrollbars Engine (`ui/scroll-lib/`, `fader-scroll`)
- **Documentation**: See [`ui/scroll-lib/README.md`](ui/scroll-lib/README.md) and [`ui/scroll-lib/ARCHITECTURE.md`](ui/scroll-lib/ARCHITECTURE.md).
- **Mandatory Usage**: All custom scrolling containers across FaderDeck views must be powered by `fader-scroll`. Ad-hoc native scrollbar styling (`::-webkit-scrollbar*`, `scrollbar-width`, `scrollbar-color`, `scrollbar-gutter`) is strictly prohibited.
- **Unified Bridge**: Always import and initialize via [`ui/js/fader-scroll-bridge.js`](ui/js/fader-scroll-bridge.js) (or access `window.faderScroll` for non-module scripts). The bridge configures application defaults and presets (e.g. `preset: 'thin'`).
- **Declarative vs Programmatic**:
  - Declarative: Add `data-scroll="y"` (or `"x"`, `"both"`) and optional attributes like `data-scroll-preset="thin"`. Auto-initialized via `initScrolls()`.
  - Programmatic: Call `createScroll(viewportEl, options)`. Query active instances via `getInstance(viewportEl)`.
- **Layout Invariant (Manual Host Wrapping)**:
  - Flexbox and Grid layouts, or elements with explicit layout sizing (`flex: 1`, `height: 100%`, `position: absolute/fixed`), must **not** rely on `fader-scroll`'s auto-wrapping fallback (which wraps the element and can collapse flex dimensions).
  - Explicitly wrap the scrolling element in a host: `<div class="some-panel-host sb-host"><div class="some-panel-viewport" data-scroll="y">...</div></div>`. Transfer layout-governing properties (`flex`, `height`, `min-height`) to the `.sb-host` wrapper and set the scrolling viewport to `width: 100%; height: 100%; min-height: 0;`.
- **Theming & Styling**:
  - All scrollbar visual properties are centralized in [`ui/fader-scroll-theme.css`](ui/fader-scroll-theme.css) using `--sb-*` custom properties (`--sb-thickness`, `--sb-thumb-bg`, `--sb-thumb-bg-hover`, `--sb-thumb-bg-active`, `--sb-thumb-radius`).
  - Do not write element-specific CSS overrides on `.sb-track` or `.sb-thumb`. Create or use presets (`.sb-theme-thin`) if custom styling is needed.
- **Dynamic Lifecycle**:
  - Dynamically created or re-rendered views (e.g. dropdown panels, entity editor sub-panels, modal dialogs) must invoke `destroy()` on their `fader-scroll` instance before tearing down or rebuilding DOM nodes to avoid detached RAF loops or memory leaks.
- **Permitted Native Scroll Exceptions**:
  - Top-level document scrolling (`html`, `body`).
  - Native form input controls: `<textarea>`, `<select>`, `<input>`.
  - Embedded `<iframe>` elements.
  - Elements with `overflow: hidden` (non-scrollable clipping boundaries).

### F. Concave & Inverted Fillets Engine (`ui/corner-bite/`, `corner-bite`)
- **Documentation**: See [`ui/corner-bite/README.md`](ui/corner-bite/README.md) and [`ui/corner-bite/ARCHITECTURE.md`](ui/corner-bite/ARCHITECTURE.md).
- **Mandatory Usage**: Whenever designing or implementing concave/inverted fillets (inner rounded corners), joined block contours (e.g., sidebars merging into header/player panels), or animated morphing polygons, **must** use `corner-bite`.
- **Prohibited Hacks**: Do not implement inverted corners via pseudo-elements (`::before`/`::after` with negative border-radii), background-image radial gradients, or hardcoded static SVG corner masks.
- **Rendering Modes**:
  - `mode: 'svg'` (default): Inserts an underlying `<svg class="corner-bite-layer">` with `<path>`. Best for gradients, drop shadows (`filter: drop-shadow`), and continuous borders. Elements must have `background: transparent`.
  - `mode: 'clip'`: Sets `clip-path: path(...)` directly on the element. Ideal for clipping inner content, `backdrop-filter`, or background images.
  - `mode: 'patches'`: Places small concave corner wedges over touching blocks, preserving existing opaque CSS backgrounds.
- **Core APIs**:
  - `attach(element, options)`: Single element or polygon contour.
  - `joinShapes([el1, el2], options)`: Merges separate DOM elements into a single continuous outline with concave fillets at intersections.
  - `glue(containerSelector, options)`: Automatically discovers and joins child elements with `[data-concave-part]`.
  - `animate(controller, targetGeometry, options)`: Smoothly interpolates geometry coordinates while keeping fillets mathematically exact every frame.
- **Styling & Lifecycle**:
  - Style via `--cb-fill`, `--cb-stroke`, and `--cb-stroke-width` on `.corner-bite-layer` or call `setGradient(controller, options)`.
  - Always invoke `controller.destroy()` when tearing down parent components.

---

## 5. Verification & Build Commands

Always run these commands from `c:\projects\code\FaderDeck_rework\src-tauri`:

1. **Run Tests**:
   ```powershell
   & "$env:USERPROFILE\.cargo\bin\cargo.exe" test
   ```
   All 17 unit and integration tests must pass.

2. **Compile Release Binary**:
   ```powershell
   taskkill /F /IM faderdeck.exe /T
   & "$env:USERPROFILE\.cargo\bin\cargo.exe" build --release
   ```
   Output: `src-tauri\target\release\faderdeck.exe` (~3.4 MB).

3. **Remote Debugging (WebView2 CDP)**:
   - Run `faderdeck.exe` with argument `--remote-debugging-port=9222`.
   - Inspect console logs, DOM elements, or capture screenshots via `http://localhost:9222/json`.
