(function initUiPreferencesStorage(window) {
  const storage = window.localStorageAdapter;

  function readBoolean(key, fallback = false) {
    const rawValue = storage?.getItem(key, null);
    return rawValue === null ? fallback : rawValue === 'true';
  }

  function readNumber(key, fallback, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
    const rawValue = storage?.getItem(key, '');
    const parsedValue = Number.parseInt(rawValue ?? '', 10);

    if (!Number.isFinite(parsedValue)) {
      return fallback;
    }

    return Math.max(min, Math.min(max, parsedValue));
  }

  function readString(key, fallback = '') {
    return storage?.getItem(key, fallback) || fallback;
  }

  function writeBoolean(key, value) {
    return storage?.setItem(key, String(Boolean(value))) || false;
  }

  function writeNumber(key, value) {
    return storage?.setItem(key, String(value)) || false;
  }

  function writeString(key, value) {
    if (value === null || value === undefined || value === '') {
      return storage?.removeItem(key) || false;
    }

    return storage?.setItem(key, String(value)) || false;
  }

  window.uiPreferencesStorage = Object.freeze({
    readBoolean,
    readNumber,
    readString,
    writeBoolean,
    writeNumber,
    writeString
  });
})(window);
