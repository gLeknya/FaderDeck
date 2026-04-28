(function initAudioRuntime(window) {
  const AUDIO_APPS_REFRESH_MIN_INTERVAL_MS = 1500;
  const SYSTEM_ICON_PLACEHOLDER_PROCESSES = new Set([
    'applicationframehost.exe',
    'backgroundtaskhost.exe',
    'dllhost.exe',
    'lockapp.exe',
    'rundll32.exe',
    'searchapp.exe',
    'searchhost.exe',
    'shellexperiencehost.exe',
    'startmenuexperiencehost.exe',
    'systemsettings.exe',
    'textinputhost.exe',
    'widgetservice.exe'
  ]);
  const FALLBACK_AUDIO_APPS = [
    { name: 'Chrome', process: 'chrome.exe' },
    { name: 'Spotify', process: 'spotify.exe' },
    { name: 'Discord', process: 'discord.exe' },
    { name: 'OBS Studio', process: 'obs64.exe' },
    { name: 'VLC', process: 'vlc.exe' }
  ];

  const audioAppIconCache = new Map();
  const audioAppIconRequests = new Map();
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
      : (window.getNativeApi?.() ?? null);
  }

  function cloneAudioApp(application = {}) {
    return {
      ...application
    };
  }

  function isWindowsSystemPath(applicationPath = '') {
    const normalizedPath = String(applicationPath || '').trim().toLowerCase();
    return normalizedPath.includes('\\windows\\system32\\')
      || normalizedPath.includes('\\windows\\syswow64\\')
      || normalizedPath.includes('\\windows\\winsxs\\');
  }

  function isMeaningfulAudioAppIcon(application = {}, iconDataUrl = application?.iconDataUrl || '') {
    const normalizedDataUrl = String(iconDataUrl || '').trim();

    if (!normalizedDataUrl) {
      return false;
    }

    const processName = String(application?.process || '').trim().toLowerCase();
    const applicationPath = String(application?.path || '').trim().toLowerCase();

    if (SYSTEM_ICON_PLACEHOLDER_PROCESSES.has(processName)) {
      return false;
    }

    if (
      normalizedDataUrl.length < 900
      && (
        isWindowsSystemPath(applicationPath)
        || processName.endsWith('host.exe')
      )
    ) {
      return false;
    }

    return true;
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

  function getAudioAppIconCacheKeys(application = {}) {
    const cacheKeys = [];
    const pathKey = String(application?.path || '').trim().toLowerCase();
    const processKey = String(application?.process || '').trim().toLowerCase();

    if (pathKey) {
      cacheKeys.push(pathKey);
    }

    if (processKey && !cacheKeys.includes(processKey)) {
      cacheKeys.push(processKey);
    }

    return cacheKeys;
  }

  function getCachedAudioAppIconDataUrl(application = {}) {
    const cacheKeys = getAudioAppIconCacheKeys(application);

    for (const cacheKey of cacheKeys) {
      const cachedIconDataUrl = String(audioAppIconCache.get(cacheKey) || '').trim();

      if (isMeaningfulAudioAppIcon(application, cachedIconDataUrl)) {
        return cachedIconDataUrl;
      }
    }

    return '';
  }

  function cacheAudioAppIconDataUrl(application = {}, iconDataUrl = '') {
    const normalizedIconDataUrl = String(iconDataUrl || '').trim();
    const resolvedIconDataUrl = isMeaningfulAudioAppIcon(application, normalizedIconDataUrl)
      ? normalizedIconDataUrl
      : getCachedAudioAppIconDataUrl(application);
    const cacheKeys = getAudioAppIconCacheKeys(application);

    if (!cacheKeys.length || !resolvedIconDataUrl) {
      return '';
    }

    cacheKeys.forEach((cacheKey) => {
      audioAppIconCache.set(cacheKey, resolvedIconDataUrl);
    });

    return resolvedIconDataUrl;
  }

  function syncRuntimeAppsWithIconCache(meta = {}) {
    let hasChanged = false;
    const nextApplications = runtimeState.apps.map((application) => {
      const resolvedIconDataUrl = getCachedAudioAppIconDataUrl(application);

      if (String(application?.iconDataUrl || '') === resolvedIconDataUrl) {
        return application;
      }

      hasChanged = true;
      return {
        ...application,
        iconDataUrl: resolvedIconDataUrl
      };
    });

    if (!hasChanged) {
      return getAvailableAudioApps();
    }

    return setAudioRuntimeApps(nextApplications, {
      type: 'audio-runtime/apps-updated',
      source: 'audio-runtime',
      reason: meta?.reason || 'icon-cache-sync',
      markRefreshed: meta?.markRefreshed === true
    });
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
      const resolvedIconDataUrl = isMeaningfulAudioAppIcon(application, application?.iconDataUrl)
        ? String(application?.iconDataUrl || '').trim()
        : getCachedAudioAppIconDataUrl(application);

      return {
        ...application,
        iconDataUrl: resolvedIconDataUrl
      };
    });
  }

  async function ensureAudioAppIconDataUrl(application = {}, options = {}) {
    const resolvedApplication = cloneAudioApp(application);
    const cachedIconDataUrl = getCachedAudioAppIconDataUrl(resolvedApplication);

    if (cachedIconDataUrl) {
      return cachedIconDataUrl;
    }

    const applicationPath = String(resolvedApplication?.path || '').trim();
    const api = getAudioApi();

    if (!applicationPath || !api?.get_application_icons) {
      return '';
    }

    const requestKey = applicationPath.toLowerCase();

    if (audioAppIconRequests.has(requestKey)) {
      return audioAppIconRequests.get(requestKey);
    }

    const requestPromise = Promise.resolve(api.get_application_icons([applicationPath]))
      .then((response) => {
        const iconMap = response?.success && response?.icons && typeof response.icons === 'object'
          ? response.icons
          : {};
        const nextIconDataUrl = cacheAudioAppIconDataUrl(resolvedApplication, iconMap[applicationPath]);

        if (nextIconDataUrl && options?.syncRuntime !== false) {
          syncRuntimeAppsWithIconCache({
            reason: options?.reason || 'icon-fetch'
          });
        }

        return nextIconDataUrl;
      })
      .catch((error) => {
        console.error('ensureAudioAppIconDataUrl error', error);
        return '';
      })
      .finally(() => {
        audioAppIconRequests.delete(requestKey);
      });

    audioAppIconRequests.set(requestKey, requestPromise);
    return requestPromise;
  }

  async function enrichAudioAppsWithIcons(applications = []) {
    const api = getAudioApi();

    if (!api?.get_application_icons || !Array.isArray(applications) || !applications.length) {
      return applyCachedAudioAppIcons(applications);
    }

    const uncachedPaths = [];

    applications.forEach((application) => {
      const applicationPath = String(application?.path || '').trim();

      if (!applicationPath || getCachedAudioAppIconDataUrl(application)) {
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
          const applicationPath = String(application?.path || '').trim();
          const iconDataUrl = applicationPath ? iconMap[applicationPath] : '';

          cacheAudioAppIconDataUrl(application, iconDataUrl);
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
          console.warn('native api bridge not ready in loadAudioApps');
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
    getCachedAudioAppIconDataUrl,
    ensureAudioAppIconDataUrl,
    setAudioRuntimeApps,
    loadAudioApps,
    requestAudioAppsRefresh,
    refreshLocalization: refreshAudioRuntimeLocalization
  };

  // Compatibility exports for existing renderer code.
  window.getAudioRuntimeState = getAudioRuntimeState;
  window.subscribeAudioRuntime = subscribeAudioRuntime;
  window.getAvailableAudioApps = getAvailableAudioApps;
  window.isMeaningfulAudioAppIcon = isMeaningfulAudioAppIcon;
  window.getCachedAudioAppIconDataUrl = getCachedAudioAppIconDataUrl;
  window.ensureAudioAppIconDataUrl = ensureAudioAppIconDataUrl;
  window.setAudioRuntimeApps = setAudioRuntimeApps;
  window.loadAudioApps = loadAudioApps;
  window.requestAudioAppsRefresh = requestAudioAppsRefresh;
  window.refreshAudioRuntimeLocalization = refreshAudioRuntimeLocalization;
})(window);
