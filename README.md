<pre>
  _____         _           ____            _
 |  ___|_ _  __| | ___ _ __|  _ \  ___  ___| | __
 | |_ / _` |/ _` |/ _ \ '__| | | |/ _ \/ __| |/ /
 |  _| (_| | (_| |  __/ |  | |_| |  __/ (__|   <
 |_|  \__,_|\__,_|\___|_|  |____/ \___|\___|_|\_\
</pre>


## How it works

FaderDeck is split into several layers so UI, application logic, and live device/runtime behavior do not collapse into one place. Electron entry points (`main.js`, `preload.js`, `overlay-preload.js`) handle the desktop shell and bridge, while most product logic lives inside the renderer under `web/`. The renderer is then divided into `state`, `actions`, `runtime`, `midi`, and UI modules such as `app.js`, `channels.js`, and `buttons.js`.

The **state layer** stores low-level renderer data and serialization logic. `app-state.js` keeps a clear boundary between persisted data, session-only UI state, and runtime-only data: profile payloads contain the saved channel/button/layout side, while transient UI state stays under session branches and is intentionally excluded from serialization. `ui-store.js` persists UI settings separately from temporary menu/session state.

The **actions layer** sits above state and acts as the application controller layer. Modules under `web/js/actions/` coordinate use-cases such as channel changes, MIDI binding flows, UI shell actions, and profile persistence, so renderer views do not have to orchestrate several subsystems directly. This keeps event handlers thinner and makes state changes more predictable.

The **runtime layer** owns live, external, or continuously changing state. `audio-runtime.js` manages discovered audio apps and exposes a small runtime API, while `midi-service.js` owns WebMIDI access, live device discovery, parser state, trigger/pickup runtime, and message/output handling. In other words, runtime modules deal with “what is happening right now”, while persisted renderer state only stores what should survive reloads and profile saves.
The **UI layer** is still plain JavaScript and HTML, but it is organized around specialized renderer files. `app.js` acts as the shell/bridge for the main interface, `channels.js` renders mixer channels, and `buttons.js` renders button-related UI. Layout support also exists in the renderer architecture, although parts of the editor work are currently parked and guarded rather than exposed as an active product feature.

Overall, the project is built around one core idea: **state is persisted deliberately, actions coordinate use-cases, runtime modules own live behavior, and UI modules focus on rendering and interaction**. That separation makes it easier to extend the app without turning the renderer into one large coupled script.
