(function initProfileService(window) {
  function getProfileApi() {
    return typeof window.getApi === 'function'
      ? window.getApi()
      : window.pywebview?.api ?? null;
  }

  function captureProfileSnapshot(profileName = '') {
    return typeof window.serializeRendererState === 'function'
      ? window.serializeRendererState(profileName)
      : {
        meta: {
          name: profileName
        },
        channels: [],
        standaloneButtons: [],
        settings: {}
      };
  }

  function applyProfileData(profileName, profileData) {
    window.hydrateRendererState?.(profileData, {
      source: 'profile-service',
      type: 'profile/load',
      profileName
    });
    window.saveProfileToLocal?.();
    window.setCurrentProfileNameRuntime?.(profileName, {
      source: 'profile-service',
      type: 'profile/set-current'
    });
    window.scheduleContentMetricsUpdate?.();
    return profileData;
  }

  function normalizeProfilesResponse(profiles) {
    return Array.isArray(profiles)
      ? profiles.map((profile) => ({
        name: profile.name,
        path: profile.path,
        modified: profile.modified || 0,
        meta: profile.meta || {}
      }))
      : [];
  }

  async function refreshProfilesData() {
    const api = getProfileApi();

    if (!api?.list_profiles) {
      return [];
    }

    const response = await api.list_profiles();

    if (!response?.success) {
      throw new Error(response?.error || 'list_profiles_failed');
    }

    const normalizedProfiles = normalizeProfilesResponse(response.profiles);
    const syncedPreferences = window.syncProfilePreferenceState?.(
      normalizedProfiles.map((profile) => profile.name),
      { source: 'profile-service' }
    ) || window.getProfilePreferencesState?.();
    const sortedProfiles = window.sortProfilesByPreferences?.(
      normalizedProfiles,
      syncedPreferences
    ) || normalizedProfiles;

    window.setProfilesListState?.(sortedProfiles, {
      source: 'profile-service',
      type: 'profiles/refresh'
    });

    const currentProfileName = window.getCurrentProfileNameRuntime?.() || '';

    if (
      currentProfileName
      && !sortedProfiles.some((profile) => profile.name === currentProfileName)
    ) {
      window.setCurrentProfileNameRuntime?.('', {
        source: 'profile-service',
        type: 'profiles/clear-missing-current'
      });
    }

    return sortedProfiles;
  }

  async function loadProfileByName(profileName) {
    const api = getProfileApi();

    if (!api?.load_profile || !profileName) {
      return null;
    }

    const response = await api.load_profile(profileName);

    if (!response?.success) {
      throw new Error(response?.error || 'load_profile_failed');
    }

    applyProfileData(profileName, response.data);
    return response.data;
  }

  async function saveProfile(profileName) {
    const api = getProfileApi();

    if (!api?.save_profile || !profileName) {
      return null;
    }

    const response = await api.save_profile(profileName, captureProfileSnapshot(profileName));

    if (!response?.success) {
      throw new Error(response?.error || 'save_profile_failed');
    }

    const resolvedName = response.name || profileName;
    window.ensureProfileOrderState?.(resolvedName, {
      prepend: true,
      visibleInToolbar: true
    }, {
      source: 'profile-service'
    });
    await refreshProfilesData();
    window.setCurrentProfileNameRuntime?.(resolvedName, {
      source: 'profile-service',
      type: 'profile/set-current'
    });
    return {
      name: resolvedName
    };
  }

  async function renameProfile(oldName, newName) {
    const api = getProfileApi();

    if (!api?.rename_profile || !oldName || !newName) {
      return null;
    }

    const response = await api.rename_profile(oldName, newName);

    if (!response?.success) {
      throw new Error(response?.error || 'rename_profile_failed');
    }

    const resolvedName = response.name || newName;
    window.renameProfilePreferencesState?.(oldName, resolvedName, {
      source: 'profile-service'
    });

    if ((window.getCurrentProfileNameRuntime?.() || '') === oldName) {
      window.setCurrentProfileNameRuntime?.(resolvedName, {
        source: 'profile-service',
        type: 'profile/set-current'
      });
    }

    await refreshProfilesData();
    return {
      name: resolvedName
    };
  }

  async function deleteProfile(profileName) {
    const api = getProfileApi();

    if (!api?.delete_profile || !profileName) {
      return null;
    }

    const response = await api.delete_profile(profileName);

    if (!response?.success) {
      throw new Error(response?.error || 'delete_profile_failed');
    }

    window.removeProfilePreferencesState?.(profileName, {
      source: 'profile-service'
    });

    if ((window.getCurrentProfileNameRuntime?.() || '') === profileName) {
      window.setCurrentProfileNameRuntime?.('', {
        source: 'profile-service',
        type: 'profile/set-current'
      });
    }

    await refreshProfilesData();
    return {
      name: profileName
    };
  }

  async function revealProfileInFolder(profileName) {
    const api = getProfileApi();
    const profile = window.getProfileByNameState?.(profileName);

    if (!api?.show_profile_in_folder || !profile?.path) {
      return null;
    }

    await api.show_profile_in_folder(profile.path);
    return profile;
  }

  async function openProfilesFolder() {
    const api = getProfileApi();

    if (!api?.open_profiles_folder) {
      return null;
    }

    await api.open_profiles_folder();
    return true;
  }

  async function importProfileFromFile() {
    const api = getProfileApi();

    if (!api?.pick_profile_file || !api?.import_profile) {
      return { canceled: true };
    }

    const selection = await api.pick_profile_file();

    if (selection?.canceled || !selection?.filePath) {
      return { canceled: true };
    }

    const response = await api.import_profile(selection.filePath);

    if (!response?.success) {
      throw new Error(response?.error || 'import_profile_failed');
    }

    window.ensureProfileOrderState?.(response.name, {
      prepend: true,
      visibleInToolbar: true
    }, {
      source: 'profile-service'
    });
    await refreshProfilesData();
    return {
      canceled: false,
      name: response.name
    };
  }

  async function initProfileRuntime() {
    window.initProfileStore?.();
    return refreshProfilesData();
  }

  window.profileService = {
    init: initProfileRuntime,
    refreshProfilesData,
    loadProfileByName,
    saveProfile,
    renameProfile,
    deleteProfile,
    revealProfileInFolder,
    openProfilesFolder,
    importProfileFromFile,
    captureProfileSnapshot,
    applyProfileData
  };
})(window);
