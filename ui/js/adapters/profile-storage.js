(function initProfileStorage(window) {
  const PROFILE_STORAGE_KEYS = Object.freeze({
    rendererProfile: 'mixer_profile',
    currentProfile: 'faderdeck_current_profile',
    preferences: 'faderdeck_profile_preferences'
  });
  const storage = window.localStorageAdapter;

  function loadRendererProfileSnapshot(fallback = null) {
    return (
      storage?.getJson(PROFILE_STORAGE_KEYS.rendererProfile, fallback) ??
      fallback
    );
  }

  function saveRendererProfileSnapshot(profile) {
    storage?.setJson(PROFILE_STORAGE_KEYS.rendererProfile, profile);
    return profile;
  }

  function readCurrentProfileName(fallback = '') {
    return (
      storage?.getItem(PROFILE_STORAGE_KEYS.currentProfile, fallback) ||
      fallback
    );
  }

  function writeCurrentProfileName(profileName = '') {
    if (profileName) {
      storage?.setItem(PROFILE_STORAGE_KEYS.currentProfile, profileName);
    } else {
      storage?.removeItem(PROFILE_STORAGE_KEYS.currentProfile);
    }

    return profileName || '';
  }

  function readProfilePreferences(fallback = {}) {
    return (
      storage?.getJson(PROFILE_STORAGE_KEYS.preferences, fallback) ?? fallback
    );
  }

  function writeProfilePreferences(preferences = {}) {
    storage?.setJson(PROFILE_STORAGE_KEYS.preferences, preferences);
    return preferences;
  }

  window.profileStorage = Object.freeze({
    keys: PROFILE_STORAGE_KEYS,
    loadRendererProfileSnapshot,
    saveRendererProfileSnapshot,
    readCurrentProfileName,
    writeCurrentProfileName,
    readProfilePreferences,
    writeProfilePreferences
  });
})(window);
