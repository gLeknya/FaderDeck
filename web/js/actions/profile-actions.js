(function initProfileActions(window) {
  const profileStorage = window.profileStorage;

  function createFallbackRendererProfile() {
    return typeof window.createEmptyPersistedRendererPayload === 'function'
      ? window.createEmptyPersistedRendererPayload()
      : {
        channels: [],
        standaloneButtons: [],
        settings: {
          midiInputId: null,
          midiInputName: ''
        }
      };
  }

  function saveRendererProfileToLocal() {
    const profile = typeof window.serializeRendererState === 'function'
      ? window.serializeRendererState()
      : createFallbackRendererProfile();

    return profileStorage?.saveRendererProfileSnapshot(profile) || profile;
  }

  function loadRendererProfileFromLocal() {
    const savedProfile = profileStorage?.loadRendererProfileSnapshot(null);

    if (!savedProfile) {
      const fallbackProfile = createFallbackRendererProfile();
      window.hydrateRendererState?.(fallbackProfile, { source: 'local-storage' });
      return fallbackProfile;
    }

    try {
      window.hydrateRendererState?.(savedProfile, { source: 'local-storage' });
      return savedProfile;
    } catch (error) {
      console.error('loadProfile error', error);
      const fallbackProfile = createFallbackRendererProfile();
      window.hydrateRendererState?.(fallbackProfile, { source: 'local-storage' });
      return fallbackProfile;
    }
  }

  window.profileActions = {
    saveRendererProfileToLocal,
    loadRendererProfileFromLocal
  };

  // Keep compatibility for existing UI/runtime code while routing through actions.
  window.saveProfileToLocal = saveRendererProfileToLocal;
  window.loadProfileFromLocal = loadRendererProfileFromLocal;
})(window);
