(function initApiBridge(window) {
  function getApi() {
    return window.faderDeck || window.pywebview?.api || null;
  }

  window.apiBridge = Object.freeze({
    getApi,
    hasLegacyBridge() {
      return Boolean(window.pywebview?.api);
    },
    hasModernBridge() {
      return Boolean(window.faderDeck);
    }
  });

  window.getNativeApi = getApi;
})(window);
