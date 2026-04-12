(function initLocalStorageAdapter(window) {
  function getStorage() {
    return window.localStorage || null;
  }

  function getItem(key, fallback = null) {
    try {
      const value = getStorage()?.getItem(key);
      return value === null || value === undefined ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function setItem(key, value) {
    try {
      getStorage()?.setItem(key, String(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function removeItem(key) {
    try {
      getStorage()?.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  function getJson(key, fallback = null) {
    const rawValue = getItem(key, null);

    if (!rawValue) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(rawValue);
      return parsed ?? fallback;
    } catch (error) {
      return fallback;
    }
  }

  function setJson(key, value) {
    try {
      return setItem(key, JSON.stringify(value));
    } catch (error) {
      return false;
    }
  }

  window.localStorageAdapter = Object.freeze({
    getItem,
    setItem,
    removeItem,
    getJson,
    setJson
  });
})(window);
