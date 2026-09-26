(function initVolumeHudBridge(window) {
  function getTauri() {
    return window.__TAURI__ || null;
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
            console.warn(`[VolumeHudBridge] Failed to listen to ${eventName}:`, err);
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
            console.warn(`[VolumeHudBridge] Internals failed to listen to ${eventName}:`, err);
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

  window.volumeHud = Object.freeze({
    onUpdate: (listener) => listen('volume-hud:update', listener),
    onVisibilityChange: (listener) => listen('volume-hud:visibility', listener)
  });
})(window);
