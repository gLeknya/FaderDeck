(function initProfileStore(window) {
  const PROFILE_NAME_SANITIZE_PATTERN = /[<>:"/\\|?*\u0000-\u001F]/g;
  const PROFILE_STORAGE_KEYS = Object.freeze({
    currentProfile: 'faderdeck_current_profile',
    preferences: 'faderdeck_profile_preferences'
  });

  let profileStoreInitialized = false;

  function createDefaultProfilePreferences() {
    return {
      order: [],
      toolbarVisible: {}
    };
  }

  function normalizeProfilePreferences(preferences = {}) {
    return {
      order: Array.isArray(preferences.order) ? [...preferences.order] : [],
      toolbarVisible: preferences.toolbarVisible && typeof preferences.toolbarVisible === 'object'
        ? { ...preferences.toolbarVisible }
        : {}
    };
  }

  function normalizeProfileEntity(profile = {}) {
    return {
      name: profile.name || '',
      path: profile.path || '',
      modified: profile.modified || 0,
      meta: profile.meta || {}
    };
  }

  function normalizeProfilesList(profiles) {
    return Array.isArray(profiles) ? profiles.map(normalizeProfileEntity) : [];
  }

  function readStoredProfilePreferences() {
    try {
      return normalizeProfilePreferences(
        JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEYS.preferences) || '{}')
      );
    } catch (error) {
      console.error('readStoredProfilePreferences error', error);
      return createDefaultProfilePreferences();
    }
  }

  function persistProfilePreferences(preferences) {
    localStorage.setItem(
      PROFILE_STORAGE_KEYS.preferences,
      JSON.stringify(normalizeProfilePreferences(preferences))
    );
  }

  function readStoredCurrentProfileName() {
    return localStorage.getItem(PROFILE_STORAGE_KEYS.currentProfile) || '';
  }

  function persistCurrentProfileName(profileName) {
    if (profileName) {
      localStorage.setItem(PROFILE_STORAGE_KEYS.currentProfile, profileName);
    } else {
      localStorage.removeItem(PROFILE_STORAGE_KEYS.currentProfile);
    }
  }

  // This slice is renderer session/local app state for profile UX and should
  // not be confused with the persisted renderer profile payload.
  function getProfileSlice() {
    return window.getAppState?.().profile || {
      currentName: '',
      list: [],
      preferences: createDefaultProfilePreferences()
    };
  }

  function getProfileSessionState() {
    return getProfileSlice();
  }

  function getCurrentProfileNameRuntime() {
    return window.getCurrentProfileState?.() || getProfileSlice().currentName || '';
  }

  function setCurrentProfileNameRuntime(profileName, meta = {}) {
    const nextProfileName = profileName || '';
    persistCurrentProfileName(nextProfileName);
    return window.setCurrentProfileState?.(nextProfileName, {
      source: 'profile-store',
      ...meta
    }) || nextProfileName;
  }

  function getProfilesListState() {
    return normalizeProfilesList(getProfileSlice().list);
  }

  function getProfilePreferencesState() {
    return normalizeProfilePreferences(getProfileSlice().preferences);
  }

  function updateProfileSlice(updater, meta = {}) {
    let nextProfileSlice = null;

    window.setAppState?.((previousState) => {
      const currentProfileSlice = {
        currentName: previousState.profile?.currentName || '',
        list: normalizeProfilesList(previousState.profile?.list),
        preferences: normalizeProfilePreferences(previousState.profile?.preferences)
      };
      nextProfileSlice = typeof updater === 'function'
        ? updater(currentProfileSlice) || currentProfileSlice
        : {
          ...currentProfileSlice,
          ...(updater || {})
        };

      return {
        ...previousState,
        profile: {
          ...previousState.profile,
          ...nextProfileSlice
        }
      };
    }, meta);

    return nextProfileSlice;
  }

  function setProfilesListState(profiles, meta = {}) {
    const nextProfiles = normalizeProfilesList(profiles);
    updateProfileSlice((profile) => ({
      ...profile,
      list: nextProfiles
    }), {
      type: 'profiles/set-list',
      source: 'profile-store',
      ...meta
    });
    return nextProfiles;
  }

  function setProfilePreferencesState(preferences, meta = {}) {
    const nextPreferences = normalizeProfilePreferences(preferences);
    persistProfilePreferences(nextPreferences);
    updateProfileSlice((profile) => ({
      ...profile,
      preferences: nextPreferences
    }), {
      type: 'profiles/set-preferences',
      source: 'profile-store',
      ...meta
    });
    return nextPreferences;
  }

  function isProfileVisibleInToolbarState(profileName) {
    return getProfilePreferencesState().toolbarVisible[profileName] !== false;
  }

  function getProfileByNameState(profileName) {
    return getProfilesListState().find((profile) => profile.name === profileName) || null;
  }

  function sortProfilesByPreferences(profiles, preferences = getProfilePreferencesState()) {
    const orderIndex = new Map(preferences.order.map((name, index) => [name, index]));

    return normalizeProfilesList(profiles).sort((left, right) => {
      const leftIndex = orderIndex.has(left.name) ? orderIndex.get(left.name) : Number.MAX_SAFE_INTEGER;
      const rightIndex = orderIndex.has(right.name) ? orderIndex.get(right.name) : Number.MAX_SAFE_INTEGER;

      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }

      return (right.modified || 0) - (left.modified || 0) || left.name.localeCompare(right.name);
    });
  }

  function syncProfilePreferenceState(profileNames, meta = {}) {
    const existingNames = new Set(profileNames);
    const currentPreferences = getProfilePreferencesState();
    const nextPreferences = {
      order: [
        ...currentPreferences.order.filter((name) => existingNames.has(name)),
        ...profileNames.filter((name) => !currentPreferences.order.includes(name))
      ],
      toolbarVisible: { ...currentPreferences.toolbarVisible }
    };

    Object.keys(nextPreferences.toolbarVisible).forEach((name) => {
      if (!existingNames.has(name)) {
        delete nextPreferences.toolbarVisible[name];
      }
    });

    profileNames.forEach((name) => {
      if (!(name in nextPreferences.toolbarVisible)) {
        nextPreferences.toolbarVisible[name] = true;
      }
    });

    return setProfilePreferencesState(nextPreferences, {
      type: 'profiles/sync-preferences',
      ...meta
    });
  }

  function ensureProfileOrderState(profileName, options = {}, meta = {}) {
    const currentPreferences = getProfilePreferencesState();
    const nextPreferences = {
      order: currentPreferences.order.filter((name) => name !== profileName),
      toolbarVisible: {
        ...currentPreferences.toolbarVisible,
        [profileName]: options.visibleInToolbar ?? true
      }
    };

    if (options.prepend) {
      nextPreferences.order.unshift(profileName);
    } else {
      nextPreferences.order.push(profileName);
    }

    return setProfilePreferencesState(nextPreferences, {
      type: 'profiles/ensure-order',
      profileName,
      ...meta
    });
  }

  function renameProfilePreferencesState(oldName, newName, meta = {}) {
    const currentPreferences = getProfilePreferencesState();
    const nextPreferences = {
      order: currentPreferences.order.map((name) => (name === oldName ? newName : name)),
      toolbarVisible: { ...currentPreferences.toolbarVisible }
    };

    if (oldName in nextPreferences.toolbarVisible) {
      nextPreferences.toolbarVisible[newName] = nextPreferences.toolbarVisible[oldName];
      delete nextPreferences.toolbarVisible[oldName];
    } else if (!(newName in nextPreferences.toolbarVisible)) {
      nextPreferences.toolbarVisible[newName] = true;
    }

    return setProfilePreferencesState(nextPreferences, {
      type: 'profiles/rename-preferences',
      oldName,
      newName,
      ...meta
    });
  }

  function removeProfilePreferencesState(profileName, meta = {}) {
    const currentPreferences = getProfilePreferencesState();
    const nextPreferences = {
      order: currentPreferences.order.filter((name) => name !== profileName),
      toolbarVisible: { ...currentPreferences.toolbarVisible }
    };

    delete nextPreferences.toolbarVisible[profileName];

    return setProfilePreferencesState(nextPreferences, {
      type: 'profiles/remove-preferences',
      profileName,
      ...meta
    });
  }

  function toggleProfileToolbarVisibilityState(profileName, visible, meta = {}) {
    const currentPreferences = getProfilePreferencesState();
    return setProfilePreferencesState({
      ...currentPreferences,
      toolbarVisible: {
        ...currentPreferences.toolbarVisible,
        [profileName]: Boolean(visible)
      }
    }, {
      type: 'profiles/toggle-toolbar-visibility',
      profileName,
      ...meta
    });
  }

  function reorderProfilesState(draggedName, targetName, meta = {}) {
    if (!draggedName || !targetName || draggedName === targetName) {
      return getProfilesListState();
    }

    const currentPreferences = getProfilePreferencesState();
    const nextOrder = currentPreferences.order.filter((name) => name !== draggedName);
    const targetIndex = nextOrder.indexOf(targetName);

    if (targetIndex === -1) {
      nextOrder.push(draggedName);
    } else {
      nextOrder.splice(targetIndex, 0, draggedName);
    }

    const nextPreferences = setProfilePreferencesState({
      ...currentPreferences,
      order: nextOrder
    }, {
      type: 'profiles/reorder',
      draggedName,
      targetName,
      ...meta
    });
    const sortedProfiles = sortProfilesByPreferences(getProfilesListState(), nextPreferences);
    setProfilesListState(sortedProfiles, {
      type: 'profiles/reorder-list',
      draggedName,
      targetName,
      ...meta
    });
    return sortedProfiles;
  }

  function sanitizeProfileNameState(name = '') {
    return String(name)
      .replace(PROFILE_NAME_SANITIZE_PATTERN, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getUniqueProfileDraftNameState(baseLabel, extraTaken = []) {
    const takenNames = new Set([
      ...getProfilesListState().map((profile) => profile.name),
      ...extraTaken.filter(Boolean)
    ]);
    const safeBase = sanitizeProfileNameState(baseLabel) || 'Profile';

    if (!takenNames.has(safeBase)) {
      return safeBase;
    }

    let index = 2;

    while (takenNames.has(`${safeBase} ${index}`)) {
      index += 1;
    }

    return `${safeBase} ${index}`;
  }

  function subscribeProfileState(listener) {
    if (typeof listener !== 'function' || typeof window.subscribeAppState !== 'function') {
      return () => {};
    }

    return window.subscribeAppState((nextState, previousState, meta = {}) => {
      if (nextState.profile === previousState.profile) {
        return;
      }

      listener(nextState.profile, previousState.profile, meta);
    });
  }

  function initProfileStore() {
    if (profileStoreInitialized) {
      return getProfileSlice();
    }

    const storedPreferences = readStoredProfilePreferences();
    const storedCurrentProfile = readStoredCurrentProfileName();

    function hasMeaningfulPreferences(preferences = {}) {
      return Boolean(
        Array.isArray(preferences.order) && preferences.order.length
      ) || Boolean(
        preferences.toolbarVisible && Object.keys(preferences.toolbarVisible).length
      );
    }

    updateProfileSlice((profile) => ({
      ...profile,
      currentName: profile.currentName || storedCurrentProfile,
      list: normalizeProfilesList(profile.list),
      preferences: normalizeProfilePreferences(
        hasMeaningfulPreferences(profile.preferences) ? profile.preferences : storedPreferences
      )
    }), {
      type: 'profiles/init',
      source: 'profile-store'
    });

    profileStoreInitialized = true;
    return getProfileSlice();
  }

  window.getProfilesListState = getProfilesListState;
  window.getProfilePreferencesState = getProfilePreferencesState;
  window.getProfileSessionState = getProfileSessionState;
  window.getCurrentProfileNameRuntime = getCurrentProfileNameRuntime;
  window.setCurrentProfileNameRuntime = setCurrentProfileNameRuntime;
  window.setProfilesListState = setProfilesListState;
  window.setProfilePreferencesState = setProfilePreferencesState;
  window.isProfileVisibleInToolbarState = isProfileVisibleInToolbarState;
  window.getProfileByNameState = getProfileByNameState;
  window.sortProfilesByPreferences = sortProfilesByPreferences;
  window.syncProfilePreferenceState = syncProfilePreferenceState;
  window.ensureProfileOrderState = ensureProfileOrderState;
  window.renameProfilePreferencesState = renameProfilePreferencesState;
  window.removeProfilePreferencesState = removeProfilePreferencesState;
  window.toggleProfileToolbarVisibilityState = toggleProfileToolbarVisibilityState;
  window.reorderProfilesState = reorderProfilesState;
  window.sanitizeProfileNameState = sanitizeProfileNameState;
  window.getUniqueProfileDraftNameState = getUniqueProfileDraftNameState;
  window.subscribeProfileState = subscribeProfileState;
  window.initProfileStore = initProfileStore;
})(window);
