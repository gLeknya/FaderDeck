(function initDebugPanelBridge(window) {
  function getTauri() {
    return window.__TAURI__ || null;
  }

  function listen(eventName, callback) {
    let unlistenFn = null;
    let isDisposed = false;

    function attach() {
      if (isDisposed) return;
      const tauri = getTauri();
      if (!tauri || !tauri.event || typeof tauri.event.listen !== 'function') {
        setTimeout(attach, 25);
        return;
      }
      tauri.event
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
          console.warn(`[DebugPanelBridge] Failed to listen to ${eventName}:`, err);
        });
    }

    attach();

    return () => {
      isDisposed = true;
      if (typeof unlistenFn === 'function') {
        unlistenFn();
      }
    };
  }

  window.debugPanel = Object.freeze({
    onUpdate: (listener) => listen('debug-panel:update', listener),
    onClose: (listener) => listen('debug-panel:close', listener),
    requestClose: () => {
      const tauri = getTauri();
      if (tauri?.core?.invoke) {
        tauri.core.invoke('toggle_debug_panel').catch(() => {});
      }
    }
  });
})(window);
