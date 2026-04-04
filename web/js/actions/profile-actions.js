(function initProfileActions(window) {
  const LOCAL_PROFILE_STORAGE_KEY = 'mixer_profile';

  function createFallbackRendererProfile() {
    const midiState = window.getMidiSelectionState?.() || {
      selectedInputId: '',
      selectedInputName: ''
    };

    return {
      channels: [],
      standaloneButtons: [],
      settings: {
        midiInputId: midiState.selectedInputId || null,
        midiInputName: midiState.selectedInputName || ''
      }
    };
  }

  function saveRendererProfileToLocal() {
    const profile = typeof window.serializeRendererState === 'function'
      ? window.serializeRendererState()
      : createFallbackRendererProfile();

    localStorage.setItem(LOCAL_PROFILE_STORAGE_KEY, JSON.stringify(profile));
    return profile;
  }

  function loadRendererProfileFromLocal() {
    const savedProfile = localStorage.getItem(LOCAL_PROFILE_STORAGE_KEY);

    if (!savedProfile) {
      const fallbackProfile = createFallbackRendererProfile();
      window.hydrateRendererState?.(fallbackProfile, { source: 'local-storage' });
      return fallbackProfile;
    }

    try {
      const profile = JSON.parse(savedProfile);
      window.hydrateRendererState?.(profile, { source: 'local-storage' });
      return profile;
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
