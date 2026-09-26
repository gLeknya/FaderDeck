(function initCompositionRoot(window) {
  function safeInitializeApplication() {
    const appShell = window.appShell;

    if (!appShell || typeof appShell.initialize !== 'function') {
      return;
    }

    try {
      if (appShell.getApi?.()) {
        appShell.initialize();
        return;
      }
    } catch (error) {
      console.error(error);
    }

    window.setTimeout(safeInitializeApplication, 200);
  }

  window.compositionRoot = Object.freeze({
    start: safeInitializeApplication
  });

  window.setTimeout(safeInitializeApplication, 300);
})(window);
