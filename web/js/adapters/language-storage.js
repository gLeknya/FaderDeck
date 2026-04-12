(function initLanguageStorage(window) {
  const LANGUAGE_STORAGE_KEY = 'faderdeck_language';
  const storage = window.localStorageAdapter;

  function readLanguage(fallback = '') {
    return storage?.getItem(LANGUAGE_STORAGE_KEY, fallback) || fallback;
  }

  function writeLanguage(language) {
    return storage?.setItem(LANGUAGE_STORAGE_KEY, language) || false;
  }

  window.languageStorage = Object.freeze({
    key: LANGUAGE_STORAGE_KEY,
    readLanguage,
    writeLanguage
  });
})(window);
