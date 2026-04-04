(function initAudioRuntime(window) {
  const AUDIO_APPS_REFRESH_MIN_INTERVAL_MS = 1500;
  const FALLBACK_AUDIO_APPS = [
    { name: 'Chrome', process: 'chrome.exe' },
    { name: 'Spotify', process: 'spotify.exe' },
    { name: 'Discord', process: 'discord.exe' },
    { name: 'OBS Studio', process: 'obs64.exe' },
    { name: 'VLC', process: 'vlc.exe' }
  ];

  const audioAppIconCache = new Map();
  const runtimeListeners = new Set();
  const runtimeState = {
    apps: [],
    refreshing: false,
    error: null,
    lastRefreshAt: 0
  };

  let audioAppsRefreshInFlight = null;
  let audioAppsRefreshQueued = false;

  function getAudioApi() {
    return typeof window.getApi === 'function'
      ? window.getApi()
      : (window.pywebview?.api ?? null);
  }

  function cloneAudioApp(application = {}) {
    return {
      ...application
    };
  }

  function cloneAudioRuntimeState() {
    return {
      ...runtimeState,
      apps: runtimeState.apps.map(cloneAudioApp)
    };
  }

  function emitAudioRuntimeChange(meta = {}) {
    const snapshot = cloneAudioRuntimeState();
    runtimeListeners.forEach((listener) => {
      listener(snapshot, meta);
    });
    return snapshot;
  }

  function buildAudioAppsList(applications = []) {
    const localizedMaster = {
      name: window.t('audio.systemVolume'),
      process: 'master',
      iconDataUrl: ''
    };
    const externalApps = Array.isArray(applications)
      ? applications.filter((app) => app.process !== 'master').map(cloneAudioApp)
      : [];
    return [localizedMaster, ...externalApps];
  }

  function getAudioAppIconCacheKey(application = {}) {
    const pathKey = String(application?.path || '').trim().toLowerCase();

    if (pathKey) {
      return pathKey;
    }

    return String(application?.process || '').trim().toLowerCase();
  }

  function areAudioAppsEqual(nextApplications = [], previousApplications = []) {
    if (nextApplications.length !== previousApplications.length) {
      return false;
    }

    return nextApplications.every((application, index) => {
      const previousApplication = previousApplications[index] || {};
      return (
        String(application?.name || '') === String(previousApplication?.name || '')
        && String(application?.process || '') === String(previousApplication?.process || '')
        && String(application?.path || '') === String(previousApplication?.path || '')
        && String(application?.iconDataUrl || '') === String(previousApplication?.iconDataUrl || '')
      );
    });
  }

  function applyCachedAudioAppIcons(applications = []) {
    return applications.map((application) => {
      const cacheKey = getAudioAppIconCacheKey(application);

      if (!cacheKey || !audioAppIconCache.has(cacheKey)) {
        return cloneAudioApp(application);
      }

      return {
        ...application,
        iconDataUrl: audioAppIconCache.get(cacheKey)
      };
    });
  }

  async function enrichAudioAppsWithIcons(applications = []) {
    const api = getAudioApi();

    if (!api?.get_application_icons || !Array.isArray(applications) || !applications.length) {
      return applyCachedAudioAppIcons(applications);
    }

    const uncachedPaths = [];

    applications.forEach((application) => {
      const cacheKey = getAudioAppIconCacheKey(application);
      const applicationPath = String(application?.path || '').trim();

      if (!cacheKey || !applicationPath || audioAppIconCache.has(cacheKey)) {
        return;
      }

      uncachedPaths.push(applicationPath);
    });

    if (uncachedPaths.length > 0) {
      try {
        const response = await api.get_application_icons([...new Set(uncachedPaths)]);
        const iconMap = response?.success && response?.icons && typeof response.icons === 'object'
          ? response.icons
          : {};

        applications.forEach((application) => {
          const cacheKey = getAudioAppIconCacheKey(application);
          const applicationPath = String(application?.path || '').trim();
          const iconDataUrl = applicationPath ? iconMap[applicationPath] : '';

          if (cacheKey && iconDataUrl) {
            audioAppIconCache.set(cacheKey, iconDataUrl);
          }
        });
      } catch (error) {
        console.error('loadAudioAppIcons error', error);
      }
    }

    return applyCachedAudioAppIcons(applications);
  }

  function getAudioRuntimeState() {
    return cloneAudioRuntimeState();
  }

  function getAvailableAudioApps() {
    return cloneAudioRuntimeState().apps;
  }

  function subscribeAudioRuntime(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    runtimeListeners.add(listener);
    return () => {
      runtimeListeners.delete(listener);
    };
  }

  function setAudioRuntimeApps(nextApplications = [], meta = {}) {
    const normalizedApplications = Array.isArray(nextApplications)
      ? nextApplications.map(cloneAudioApp)
      : [];
    const hasChanged = !areAudioAppsEqual(normalizedApplications, runtimeState.apps);

    runtimeState.apps = normalizedApplications;

    if (meta.markRefreshed !== false) {
      runtimeState.lastRefreshAt = Date.now();
    }

    if (hasChanged) {
      emitAudioRuntimeChange({
        type: 'audio-runtime/apps-updated',
        ...meta
      });
    }

    return getAvailableAudioApps();
  }

  async function loadAudioApps(options = {}) {
    const force = Boolean(options?.force);
    const now = Date.now();

    if (audioAppsRefreshInFlight) {
      if (force) {
        audioAppsRefreshQueued = true;
      }
      return audioAppsRefreshInFlight;
    }

    if (!force && runtimeState.apps.length && (now - runtimeState.lastRefreshAt) < AUDIO_APPS_REFRESH_MIN_INTERVAL_MS) {
      return getAvailableAudioApps();
    }

    runtimeState.refreshing = true;
    runtimeState.error = null;
    emitAudioRuntimeChange({
      type: 'audio-runtime/refresh-start',
      reason: options?.reason || 'runtime'
    });

    audioAppsRefreshInFlight = (async () => {
      let nextApplications;

      try {
        const api = getAudioApi();

        if (!api) {
          console.warn('pywebview.api not ready in loadAudioApps');
          return getAvailableAudioApps();
        }

        const response = await api.get_audio_applications();
        nextApplications = buildAudioAppsList(
          response?.applications?.length ? response.applications : FALLBACK_AUDIO_APPS
        );
      } catch (error) {
        console.error(error);
        nextApplications = buildAudioAppsList(FALLBACK_AUDIO_APPS);
        runtimeState.error = error;
      }

      nextApplications = applyCachedAudioAppIcons(nextApplications);
      setAudioRuntimeApps(nextApplications, {
        source: 'audio-runtime',
        reason: options?.reason || 'runtime',
        markRefreshed: false
      });

      const enrichedApplications = await enrichAudioAppsWithIcons(nextApplications);
      setAudioRuntimeApps(enrichedApplications, {
        source: 'audio-runtime',
        reason: options?.reason || 'runtime'
      });

      return getAvailableAudioApps();
    })();

    try {
      return await audioAppsRefreshInFlight;
    } finally {
      audioAppsRefreshInFlight = null;
      runtimeState.refreshing = false;
      emitAudioRuntimeChange({
        type: 'audio-runtime/refresh-end',
        reason: options?.reason || 'runtime'
      });

      if (audioAppsRefreshQueued) {
        audioAppsRefreshQueued = false;
        requestAudioAppsRefresh('queued-refresh', { force: true });
      }
    }
  }

  function requestAudioAppsRefresh(reason = 'runtime', options = {}) {
    const force = Boolean(options?.force);

    if (!force && document.visibilityState === 'hidden') {
      return Promise.resolve(getAvailableAudioApps());
    }

    return loadAudioApps({
      ...options,
      force,
      reason
    });
  }

  function refreshAudioRuntimeLocalization(meta = {}) {
    const refreshedApplications = applyCachedAudioAppIcons(buildAudioAppsList(runtimeState.apps));
    setAudioRuntimeApps(refreshedApplications, {
      type: 'audio-runtime/localization-refresh',
      source: 'audio-runtime',
      ...meta
    });
    return getAvailableAudioApps();
  }

  function initAudioRuntime() {
    return getAudioRuntimeState();
  }

  window.audioRuntime = {
    init: initAudioRuntime,
    getState: getAudioRuntimeState,
    subscribe: subscribeAudioRuntime,
    getAvailableAudioApps,
    setAudioRuntimeApps,
    loadAudioApps,
    requestAudioAppsRefresh,
    refreshLocalization: refreshAudioRuntimeLocalization
  };

  // Compatibility exports for existing renderer code.
  window.getAudioRuntimeState = getAudioRuntimeState;
  window.subscribeAudioRuntime = subscribeAudioRuntime;
  window.getAvailableAudioApps = getAvailableAudioApps;
  window.setAudioRuntimeApps = setAudioRuntimeApps;
  window.loadAudioApps = loadAudioApps;
  window.requestAudioAppsRefresh = requestAudioAppsRefresh;
  window.refreshAudioRuntimeLocalization = refreshAudioRuntimeLocalization;
})(window);
