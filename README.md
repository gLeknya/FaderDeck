# FaderDeck

FaderDeck is an Electron desktop app for Windows that controls application volume, audio devices, media transport, and custom actions from a mixer-style UI with MIDI integration.

The current codebase is focused on beta readiness, maintainability, and safe iteration on the existing feature set. Some layout-editor groundwork exists in the renderer and state model, but that UI is intentionally parked and hidden for now.

## Quick Start

```bash
npm install
npm start
```

`npm start` and `npm run dev` both launch the app locally.

## Checks

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run check
```

`npm run check` runs lint, typecheck, and tests. Run `npm run format:check`
separately before release.

Current script coverage is intentionally uneven:

- `format` and `format:check` cover the main process, backend, shared code, renderer source, overlay files, and root configs.
- `lint` and `typecheck` currently cover `main.js`, preload files, `backend/`, `shared/`, and tests.
- Renderer `web/js` runtime code still depends on manual smoke testing plus targeted syntax checks before release.

## Build

```bash
npm run build:dir
npm run build
npm run dist:win
```

- `build:dir` creates an unpacked build.
- `build` runs the default `electron-builder` packaging flow.
- `dist:win` builds the Windows NSIS installer.

Build output is written to `release/`.

## Architecture Overview

- `main.js`, `preload.js`, `overlay-preload.js`: Electron shell, window/tray/HUD wiring, and preload bridge exposure.
- `backend/`: Node-side managers for audio sessions, devices, media transport, focused app lookup, profiles, keyboard/system actions, and PowerShell workers.
- `shared/ipc-contract.js`: single source of truth for preload and main-process IPC method names.
- `web/js/state/`: persisted renderer data plus session-only UI slices.
- `web/js/actions/`: renderer use-case coordination and mutation entry points.
- `web/js/runtime/`: live runtime state such as audio app discovery and button runtime polling.
- `web/js/midi/`: WebMIDI discovery, learn/bind runtime, pickup logic, and MIDI indicator output.
- `web/js/ui/`, `web/js/app.js`, `web/js/channels.js`, `web/js/buttons.js`: renderer orchestration and UI rendering.
- `web/overlay/`: overlay windows such as the volume HUD.

More detail lives in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Beta Release Notes

- Use [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) before cutting a beta build.
- Track shipped work in [CHANGELOG.md](./CHANGELOG.md).
- If you change `main.js`, preload files, backend managers, or PowerShell scripts, do a full app restart before smoke testing.
