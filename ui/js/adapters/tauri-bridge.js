/**
 * FaderDeck Tauri v2 Bridge Adapter
 * Bridges window.faderDeck and WebMIDI to native Rust backend via window.__TAURI__.
 */
(function initTauriBridge(window) {
  function getInvokeFn() {
    if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
      return window.__TAURI__.core.invoke;
    }
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      return (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args || {});
    }
    if (window.__TAURI__ && typeof window.__TAURI__.invoke === 'function') {
      return window.__TAURI__.invoke;
    }
    return null;
  }

  function invoke(cmd, args) {
    const fn = getInvokeFn();
    if (fn) {
      return fn(cmd, args || {});
    }

    // If Tauri is still initializing, retry briefly
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        const resolved = getInvokeFn();
        if (resolved) {
          clearInterval(interval);
          resolve(resolved(cmd, args || {}));
        } else if (attempts > 50) {
          clearInterval(interval);
          console.warn(`[TauriBridge] Tauri runtime not ready for command: ${cmd}`);
          reject(new Error(`Tauri runtime not ready for command: ${cmd}`));
        }
      }, 40);
    });
  }

  function listen(eventName, callback) {
    let unlistenFn = null;
    let isDisposed = false;

    function attach() {
      if (isDisposed) return;

      if (window.__TAURI__ && window.__TAURI__.event && typeof window.__TAURI__.event.listen === 'function') {
        window.__TAURI__.event
          .listen(eventName, (event) => {
            if (!isDisposed) {
              callback(event.payload);
            }
          })
          .then((unlisten) => {
            if (isDisposed) {
              unlisten();
            } else {
              unlistenFn = unlisten;
            }
          })
          .catch((err) => {
            console.warn(`[TauriBridge] Failed to listen to ${eventName}:`, err);
          });
        return;
      }

      if (
        window.__TAURI_INTERNALS__ &&
        typeof window.__TAURI_INTERNALS__.invoke === 'function' &&
        typeof window.__TAURI_INTERNALS__.transformCallback === 'function'
      ) {
        const handlerId = window.__TAURI_INTERNALS__.transformCallback((event) => {
          if (!isDisposed) {
            callback(event.payload);
          }
        });
        window.__TAURI_INTERNALS__
          .invoke('plugin:event|listen', {
            event: eventName,
            target: { kind: 'Any' },
            handler: handlerId
          })
          .then(() => {
            unlistenFn = () => {
              window.__TAURI_INTERNALS__.invoke('plugin:event|unlisten', {
                event: eventName,
                eventId: handlerId
              }).catch(() => {});
              if (typeof window.__TAURI_INTERNALS__.unregisterCallback === 'function') {
                window.__TAURI_INTERNALS__.unregisterCallback(handlerId);
              }
            };
          })
          .catch((err) => {
            console.warn(`[TauriBridge] Internals failed to listen to ${eventName}:`, err);
          });
        return;
      }

      setTimeout(attach, 40);
    }

    attach();

    return () => {
      isDisposed = true;
      if (typeof unlistenFn === 'function') {
        unlistenFn();
      }
    };
  }

  // ─── 44 IPC Methods ──────────────────────────────────────────────────────────
  const faderDeckApi = {
    get_audio_applications: () => invoke('get_audio_applications'),
    list_running_applications: () => invoke('list_running_applications'),
    get_audio_states: (processNames) =>
      invoke('get_audio_states', { processNames: processNames || [] }),
    set_app_volume: (processName, volume) =>
      invoke('set_app_volume', { processName, volume: Number(volume) }),
    set_app_volume_batch: (volumeMap) =>
      invoke('set_app_volume_batch', { volumeMap: volumeMap || {} }),
    toggle_app_mute: (processName) =>
      invoke('toggle_app_mute', { processName }),
    set_app_mute: (processName, muted) =>
      invoke('set_app_mute', { processName, muted: Boolean(muted) }),
    send_key: (key, targetHint) =>
      invoke('send_key', { key, targetHint: targetHint || null }),
    list_audio_devices: (flow) =>
      invoke('list_audio_devices', { flow: flow || 'all' }),
    set_audio_device_volume: (deviceId, volume, flow) =>
      invoke('set_audio_device_volume', {
        deviceId,
        volume: Number(volume),
        flow: flow || null
      }),
    set_audio_device_mute: (deviceId, muted, flow) =>
      invoke('set_audio_device_mute', {
        deviceId,
        muted: Boolean(muted),
        flow: flow || null
      }),
    set_default_audio_device: (deviceId, flow) =>
      invoke('set_default_audio_device', { deviceId, flow: flow || null }),
    get_focused_application: () => invoke('get_focused_application'),
    launch_app: (filePath) => invoke('launch_app', { filePath }),
    run_user_script: (filePath) => invoke('run_user_script', { filePath }),
    set_process_window_visibility: (processName, visible, executablePath) =>
      invoke('set_process_window_visibility', {
        processName,
        visible: typeof visible === 'boolean' ? visible : null,
        executablePath: executablePath || null
      }),
    set_media_option: (command, enabled, targetAppId) =>
      invoke('set_media_option', {
        command,
        enabled: typeof enabled === 'boolean' ? enabled : null,
        targetAppId: targetAppId || null
      }),
    send_media_transport: (command, targetAppId) =>
      invoke('send_media_transport', { command, targetAppId: targetAppId || null }),
    list_media_sessions: () => invoke('list_media_sessions'),
    get_media_session_state: (targetAppId) =>
      invoke('get_media_session_state', { targetAppId: targetAppId || null }),
    set_media_repeat_mode: (mode, targetAppId) =>
      invoke('set_media_repeat_mode', { mode: mode || null, targetAppId: targetAppId || null }),
    save_profile: (name, data) => invoke('save_profile', { name, data }),
    load_profile: (name) => invoke('load_profile', { name }),
    list_profiles: () => invoke('list_profiles'),
    delete_profile: (name) => invoke('delete_profile', { name }),
    rename_profile: (fromName, toName) =>
      invoke('rename_profile', { fromName, toName }),
    import_profile: (filePath, options) =>
      invoke('import_profile', { filePath, options: options || null }),
    get_profile_template: (options) =>
      invoke('get_profile_template', { options: options || null }),
    get_profiles_directory: () => invoke('get_profiles_directory'),
    get_application_icons: (applicationPaths) =>
      invoke('get_application_icons', { applicationPaths: applicationPaths || [] }),
    get_app_info: () => invoke('get_app_info'),
    check_for_updates: (options) =>
      invoke('check_for_updates', { options: options || null }),
    open_profiles_folder: () => invoke('open_profiles_folder'),
    show_profile_in_folder: (profilePath) =>
      invoke('show_profile_in_folder', { profilePath }),
    pick_profile_file: () => invoke('pick_profile_file'),
    pick_action_file: (mode) => invoke('pick_action_file', { mode: mode || 'app' }),
    open_external_url: (targetUrl) =>
      invoke('open_external_url', { targetUrl }),
    show_volume_hud: (payload) =>
      invoke('show_volume_hud', { payload }),
    toggle_devtools: () => invoke('toggle_devtools'),
    toggle_debug_panel: () => invoke('toggle_debug_panel'),
    notify_developer_mode_changed: () =>
      invoke('notify_developer_mode_changed'),
    set_close_to_tray_enabled: (enabled) =>
      invoke('set_close_to_tray_enabled', { enabled: Boolean(enabled) }),
    exit_app: () => invoke('exit_app'),
    windowControl: (action) => invoke('window_control', { action }),

    // Event listeners
    onAppFocusStateChanged: (listener) => listen('app:focus-state', listener)
  };

  // Expose globally
  window.faderDeck = Object.freeze(faderDeckApi);
  window.pywebview = Object.freeze({ api: window.faderDeck });

  // ─── WebMIDI Polyfill for WebView2 ───────────────────────────────────────────
  function setupWebMidiShim() {
    let activeInputPortId = null;

    class MidiPortShim extends EventTarget {
      constructor(id, name, type) {
        super();
        this.id = id;
        this.name = name;
        this.type = type;
        this.state = 'connected';
        this.connection = 'open';
        this.manufacturer = 'Hardware';
        this.onmidimessage = null;
        this.onstatechange = null;
      }

      open() {
        return Promise.resolve(this);
      }

      close() {
        return Promise.resolve(this);
      }

      send(bytes) {
        if (this.type === 'output') {
          invoke('midi_send_output', { bytes: Array.from(bytes) }).catch(() => {});
        }
      }
    }

    class MidiAccessShim extends EventTarget {
      constructor() {
        super();
        this.inputs = new Map();
        this.outputs = new Map();
        this.sysexEnabled = true;
        this.onstatechange = null;
      }
    }

    let globalMidiAccess = null;

    function syncPortSelection(inputId) {
      const cleanId = String(inputId || '').trim();
      if (!cleanId || cleanId === '__disabled__' || cleanId === activeInputPortId) {
        return;
      }
      activeInputPortId = cleanId;
      invoke('midi_select_input', { portId: cleanId }).catch(() => {});
      invoke('midi_select_output', { portId: cleanId }).catch(() => {});
    }

    // 1. Initial sync from localStorage
    try {
      const savedId = localStorage.getItem('faderdeck_selected_midi_input_id');
      if (savedId) {
        syncPortSelection(savedId);
      }
    } catch (_) {}

    // 2. Continuous sync via app state subscription
    function hookAppStateSubscription() {
      if (typeof window.subscribeAppState === 'function') {
        window.subscribeAppState((nextState) => {
          const selectedId = nextState?.midi?.selectedInputId;
          if (typeof selectedId === 'string') {
            syncPortSelection(selectedId);
          }
        });
      } else {
        setTimeout(hookAppStateSubscription, 50);
      }
    }
    hookAppStateSubscription();

    // 3. Storage interceptor fallback
    try {
      const origSetItem = window.localStorage.setItem.bind(window.localStorage);
      window.localStorage.setItem = function (key, value) {
        origSetItem(key, value);
        if (key === 'faderdeck_selected_midi_input_id') {
          syncPortSelection(value);
        }
      };
    } catch (_) {}

    async function requestMIDIAccess() {
      if (globalMidiAccess) {
        return globalMidiAccess;
      }

      const access = new MidiAccessShim();
      globalMidiAccess = access;

      // Scan ports from backend
      try {
        const ports = await invoke('midi_list_ports');
        if (ports && Array.isArray(ports.inputs)) {
          ports.inputs.forEach((p) => {
            const port = new MidiPortShim(p.id, p.name, 'input');
            access.inputs.set(p.id, port);
          });
        }
        if (ports && Array.isArray(ports.outputs)) {
          ports.outputs.forEach((p) => {
            const port = new MidiPortShim(p.id, p.name, 'output');
            access.outputs.set(p.id, port);
          });
        }
      } catch (err) {
        console.warn('[WebMIDI Shim] Failed to list MIDI ports:', err);
      }

      // Listen for incoming MIDI messages from Rust background thread
      listen('midi:message', (payload) => {
        if (!payload || !payload.raw) return;
        const data = new Uint8Array(payload.raw);

        const dispatchToPort = (port) => {
          if (typeof port?.onmidimessage === 'function') {
            try {
              const midiEvent = {
                data,
                receivedTime: performance.now(),
                target: port,
                currentTarget: port
              };
              port.onmidimessage(midiEvent);
            } catch (e) {
              console.error('[WebMIDI Shim] onmidimessage error:', e);
            }
          }
        };

        const targetPort = payload.portId
          ? access.inputs.get(payload.portId)
          : (activeInputPortId ? access.inputs.get(activeInputPortId) : null);

        if (targetPort) {
          dispatchToPort(targetPort);
        } else {
          access.inputs.forEach((port) => {
            dispatchToPort(port);
          });
        }
      });

      return access;
    }

    // Polyfill navigator.requestMIDIAccess
    if (typeof navigator !== 'undefined') {
      try {
        Object.defineProperty(navigator, 'requestMIDIAccess', {
          value: requestMIDIAccess,
          configurable: true,
          writable: true
        });
      } catch (e) {
        navigator.requestMIDIAccess = requestMIDIAccess;
      }
    }
  }

  setupWebMidiShim();
})(window);
