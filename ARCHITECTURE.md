# Architecture

## Purpose

FaderDeck keeps Electron shell code, backend integrations, renderer state, renderer actions, and live runtime logic separate so Windows-specific audio and MIDI behavior does not collapse into one large script.

## Layer Responsibilities

- `main.js`, `preload.js`, `overlay-preload.js`
  - Own Electron windows, tray, overlay/HUD wiring, and IPC registration.
  - Expose the preload bridge used by the renderer.
- `backend/`
  - Own Node-side managers and PowerShell-backed integrations.
  - Handle audio sessions, device enumeration/control, media transport, focused app lookup, profile persistence, and system actions.
- `shared/ipc-contract.js`
  - Defines the canonical IPC method map shared by preload and main.
  - Keeps method naming stable while renderer and backend internals evolve.
- `web/js/state/`
  - Stores renderer-owned state and normalization helpers.
  - Includes persisted profile payload data, session-only UI state, and parked layout-editor session state.
- `web/js/actions/`
  - Coordinates renderer use-cases.
  - Keeps event handlers thin by routing changes through named operations instead of spreading mutation logic across UI modules.
- `web/js/runtime/`
  - Owns live state that changes frequently or depends on external systems.
  - Includes audio app discovery and channel/standalone button runtime polling.
- `web/js/midi/`
  - Owns WebMIDI access, input discovery, learn/bind flows, pickup state, message parsing, and MIDI output indicators.
- `web/js/ui/` plus top-level renderer modules
  - Render DOM, attach interactions, and translate state/runtime snapshots into visible UI.

## State Model

Renderer state is split into three categories:

- Persisted profile data
  - Channels
  - Standalone buttons
  - Layout payload
  - Renderer settings that should survive profile save/load, such as saved MIDI selection metadata
- Persisted local UI settings
  - Stored separately by the UI store
  - Covers app-level preferences that are not part of a profile payload
- Session/runtime-only state
  - Menus, active modals, editor drafts, hover/selection state, runtime button indicators, MIDI parser state, and audio/media discovery snapshots

The important rule is that runtime-only data should not leak into saved profiles, and profile persistence should not be responsible for temporary UI/session state.

## Action Layer

Files under `web/js/actions/` are the renderer's controller layer. They coordinate:

- profile save/load flows
- channel mutations
- standalone button mutations
- MIDI binding flows
- parked layout-editor actions
- UI preference changes

This keeps mutation entry points searchable and helps reviews stay focused on behavior rather than DOM event noise.

## Runtime Modules

Runtime modules are used when data is live, frequent, or externally driven.

- `audio-runtime.js`
  - throttles audio app refresh requests
  - caches icons and keeps app discovery separate from UI code
- `channel-button-runtime.js`
  - polls channel button runtime state only while channel buttons exist
  - keeps button visual/indicator state out of persisted renderer data
- `standalone-button-runtime.js`
  - mirrors the same pattern for standalone buttons

These paths are performance-sensitive and should be changed incrementally.

## MIDI Responsibility Split

MIDI is intentionally split across several concerns:

- renderer state stores saved MIDI selection metadata
- `web/js/midi/midi-service.js` owns live MIDI discovery, parser state, pickup runtime, and output indicator sync
- `web/js/actions/midi-actions.js` coordinates learn/bind flows and renderer-facing operations
- UI files only render MIDI status and bind interactions

That split matters because MIDI timing, pickup behavior, and indicator output are sensitive to duplicate listeners and extra polling.

## IPC Contract

`shared/ipc-contract.js` is the stable boundary between preload and main.

- preload builds the bridge from this file
- main registers handlers from the same method list
- snake_case IPC method names remain intentional for compatibility with the long-lived renderer/global bridge

Avoid renaming public IPC methods unless compatibility is preserved.

## Parked Layout Editor

Layout persistence and layout normalization stay active because saved profiles already carry layout data.

- The layout-editor session model remains in `web/js/state/layout-store.js`.
- Layout actions remain in the repo for compatibility and future work.
- Visible layout-editor UI stays parked and hidden.
- Normal channel and standalone-button flows must continue working without layout-editor UI being enabled.

This is a deliberate compatibility choice, not dead code cleanup debt.

## Runtime-Sensitive Notes

- Audio app discovery in `audio-runtime.js` is demand-driven and throttled.
- Channel and standalone button runtime modules currently use 45 ms polling intervals, but only when matching buttons exist.
- MIDI input health refresh currently runs on focus, on document visibility restore, and on a 15 second interval.
- Focused app lookup is backed by a long-lived PowerShell worker in `backend/processes.js` and should be treated as latency-sensitive glue code.
- Current `lint` and `typecheck` scripts do not cover `web/js`, so renderer regressions still rely on smoke testing plus targeted syntax checks.
