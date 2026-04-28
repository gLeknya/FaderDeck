(function initChannelTargeting(window) {
  const TARGET_MODES =
    window.CHANNEL_TARGET_MODES ||
    Object.freeze({
      apps: 'apps',
      devices: 'devices',
      focus: 'focus'
    });
  const DEVICE_TARGET_FLOWS =
    window.CHANNEL_DEVICE_TARGET_FLOWS ||
    Object.freeze({
      output: 'output',
      input: 'input'
    });
  const DEVICE_CACHE_TTL_MS = 30000;
  const DEVICE_LIVE_CACHE_TTL_MS = 45;
  const FOCUS_CACHE_TTL_MS = 900;
  const AUDIO_STATE_CACHE_TTL_MS = 30;
  const deviceCatalogState = {
    output: { items: [], fetchedAt: 0, inFlight: null },
    input: { items: [], fetchedAt: 0, inFlight: null }
  };
  const audioStateCache = {
    entries: new Map(),
    inFlight: null,
    inFlightProcesses: new Set()
  };
  const focusState = {
    value: null,
    fetchedAt: 0,
    inFlight: null
  };

  function getApi() {
    return typeof window.getApi === 'function'
      ? window.getApi()
      : (window.getNativeApi?.() ?? null);
  }

  function isFaderDeckWindowActive() {
    if (typeof document === 'undefined') {
      return false;
    }

    const isVisible = document.visibilityState === 'visible';
    const hasFocus =
      typeof document.hasFocus === 'function' ? document.hasFocus() : true;

    return isVisible && hasFocus;
  }

  function getAvailableApps() {
    return typeof window.getAvailableAudioApps === 'function'
      ? window.getAvailableAudioApps()
      : [];
  }

  function normalizeProcessList(processNames = []) {
    return [
      ...new Set(
        (Array.isArray(processNames) ? processNames : [])
          .map((processName) => String(processName || '').trim())
          .filter(Boolean)
          .map((processName) => processName.toLowerCase())
      )
    ];
  }

  function getCachedProcessAudioStateMap(processNames = [], options = {}) {
    const normalizedProcesses = normalizeProcessList(processNames);
    const force = Boolean(options?.force);
    const now = Date.now();

    if (!normalizedProcesses.length) {
      return {
        ready: true,
        stateMap: new Map()
      };
    }

    const missingProcesses = normalizedProcesses.filter((processName) => {
      const cachedEntry = audioStateCache.entries.get(processName);

      if (!cachedEntry) {
        return true;
      }

      if (force) {
        return true;
      }

      return now - cachedEntry.fetchedAt >= AUDIO_STATE_CACHE_TTL_MS;
    });

    const stateMap = new Map(
      normalizedProcesses
        .filter((processName) => audioStateCache.entries.has(processName))
        .map((processName) => [
          processName,
          audioStateCache.entries.get(processName).value
        ])
    );

    return {
      ready: missingProcesses.length === 0,
      missingProcesses,
      stateMap
    };
  }

  async function getProcessAudioStateMap(processNames = [], options = {}) {
    const normalizedProcesses = normalizeProcessList(processNames);
    const api = getApi();

    if (!normalizedProcesses.length || !api?.get_audio_states) {
      return new Map();
    }

    const cached = getCachedProcessAudioStateMap(normalizedProcesses, options);

    if (cached.ready) {
      return cached.stateMap;
    }

    if (
      !options?.force &&
      audioStateCache.inFlight &&
      cached.missingProcesses.every((processName) =>
        audioStateCache.inFlightProcesses.has(processName)
      )
    ) {
      await audioStateCache.inFlight;
      return getCachedProcessAudioStateMap(normalizedProcesses, {
        force: false
      }).stateMap;
    }

    const requestProcesses = normalizedProcesses.slice();
    audioStateCache.inFlightProcesses = new Set(requestProcesses);
    audioStateCache.inFlight = Promise.resolve(
      api.get_audio_states(requestProcesses)
    )
      .then((response) => {
        const nextTimestamp = Date.now();
        const applications = Array.isArray(response?.applications)
          ? response.applications
          : [];
        const responseMap = new Map(
          applications.map((entry) => [
            String(entry?.process || '')
              .trim()
              .toLowerCase(),
            entry
          ])
        );

        requestProcesses.forEach((processName) => {
          audioStateCache.entries.set(processName, {
            fetchedAt: nextTimestamp,
            value: responseMap.get(processName) || {
              process: processName,
              volume: 0,
              muted: false,
              peak: 0,
              peakLevel: 0,
              hasAudioSession: false,
              sessionCount: 0
            }
          });
        });
      })
      .catch((error) => {
        console.error('get_audio_states error', error);
      })
      .finally(() => {
        audioStateCache.inFlight = null;
        audioStateCache.inFlightProcesses = new Set();
      });

    await audioStateCache.inFlight;
    return getCachedProcessAudioStateMap(normalizedProcesses, { force: false })
      .stateMap;
  }

  function normalizeTargetMode(value) {
    const normalizedValue = String(value || '')
      .trim()
      .toLowerCase();
    return Object.values(TARGET_MODES).includes(normalizedValue)
      ? normalizedValue
      : TARGET_MODES.apps;
  }

  function normalizeDeviceTargetFlow(value) {
    const normalizedValue = String(value || '')
      .trim()
      .toLowerCase();
    return normalizedValue === DEVICE_TARGET_FLOWS.input
      ? DEVICE_TARGET_FLOWS.input
      : DEVICE_TARGET_FLOWS.output;
  }

  function createAppTarget(target = {}) {
    const process = String(target?.process || '').trim();

    if (!process) {
      return null;
    }

    const availableApp = getAvailableApps().find(
      (entry) =>
        String(entry?.process || '')
          .trim()
          .toLowerCase() === process.toLowerCase()
    );
    const resolvedPath = String(
      target?.path || availableApp?.path || ''
    ).trim();
    const cachedIconDataUrl =
      typeof window.getCachedAudioAppIconDataUrl === 'function'
        ? window.getCachedAudioAppIconDataUrl({
            process,
            path: resolvedPath
          })
        : '';

    return {
      process,
      name:
        String(target?.name || availableApp?.name || process).trim() || process,
      path: resolvedPath,
      iconDataUrl: String(
        target?.iconDataUrl ||
          availableApp?.iconDataUrl ||
          cachedIconDataUrl ||
          ''
      ).trim()
    };
  }

  function createDeviceTarget(target = {}, flow = DEVICE_TARGET_FLOWS.output) {
    const id = String(target?.id || target?.deviceId || '').trim();

    if (!id) {
      return null;
    }

    const normalizedFlow = normalizeDeviceTargetFlow(target?.flow || flow);

    return {
      id,
      name: String(target?.name || id).trim() || id,
      flow: normalizedFlow
    };
  }

  function shouldIgnoreAppTarget(target = {}) {
    const processName = String(target?.process || '')
      .trim()
      .toLowerCase();
    const displayName = String(target?.name || '')
      .trim()
      .toLowerCase();
    const applicationPath = String(target?.path || '')
      .trim()
      .toLowerCase();
    const matchesFaderDeck = [processName, displayName, applicationPath].some(
      (value) => value.includes('faderdeck')
    );
    const matchesDevElectron =
      processName === 'electron.exe' && displayName.includes('faderdeck');

    return matchesFaderDeck || matchesDevElectron;
  }

  function getChannelAppTargets(channel = {}) {
    const explicitTargets = Array.isArray(channel?.targets)
      ? channel.targets.map(createAppTarget).filter(Boolean)
      : [];

    if (explicitTargets.length > 0) {
      return explicitTargets.filter((target) => !shouldIgnoreAppTarget(target));
    }

    const fallbackTarget = createAppTarget({
      process: channel?.app,
      name: channel?.appName
    });

    return fallbackTarget && !shouldIgnoreAppTarget(fallbackTarget)
      ? [fallbackTarget]
      : [];
  }

  function getChannelTargetMode(channel = {}) {
    return normalizeTargetMode(channel?.targetMode);
  }

  function getChannelDeviceTargetFlow(channel = {}) {
    return normalizeDeviceTargetFlow(channel?.deviceTargetFlow);
  }

  function getChannelDeviceTargets(channel = {}, flow = null) {
    const rawTargets = channel?.deviceTargets;
    const requestedFlow = String(flow ?? '')
      .trim()
      .toLowerCase();

    if (!requestedFlow || requestedFlow === 'all') {
      if (Array.isArray(rawTargets)) {
        return rawTargets
          .map((target) =>
            createDeviceTarget(target, DEVICE_TARGET_FLOWS.output)
          )
          .filter(Boolean);
      }

      const outputTargets = Array.isArray(rawTargets?.output)
        ? rawTargets.output
            .map((target) =>
              createDeviceTarget(target, DEVICE_TARGET_FLOWS.output)
            )
            .filter(Boolean)
        : [];
      const inputTargets = Array.isArray(rawTargets?.input)
        ? rawTargets.input
            .map((target) =>
              createDeviceTarget(target, DEVICE_TARGET_FLOWS.input)
            )
            .filter(Boolean)
        : [];

      return [...outputTargets, ...inputTargets];
    }

    const normalizedFlow = normalizeDeviceTargetFlow(requestedFlow);
    const candidates = Array.isArray(rawTargets)
      ? rawTargets
      : rawTargets && typeof rawTargets === 'object'
        ? rawTargets[normalizedFlow]
        : [];

    return (Array.isArray(candidates) ? candidates : [])
      .map((target) => createDeviceTarget(target, normalizedFlow))
      .filter(Boolean);
  }

  function getChannelFocusExclusions(channel = {}) {
    return (
      Array.isArray(channel?.focusExcludedTargets)
        ? channel.focusExcludedTargets
        : []
    )
      .map(createAppTarget)
      .filter(Boolean);
  }

  function getStoredChannelTargetEntries(channel = {}) {
    const targetMode = getChannelTargetMode(channel);

    if (targetMode === TARGET_MODES.focus) {
      return [];
    }

    return [
      ...getChannelAppTargets(channel),
      ...getChannelDeviceTargets(channel)
    ];
  }

  function invalidateAudioDeviceCache(flow = 'all') {
    const normalizedFlow = String(flow || 'all')
      .trim()
      .toLowerCase();

    if (normalizedFlow === 'all') {
      Object.values(DEVICE_TARGET_FLOWS).forEach((entryFlow) =>
        invalidateAudioDeviceCache(entryFlow)
      );
      return;
    }

    const cacheEntry =
      deviceCatalogState[normalizeDeviceTargetFlow(normalizedFlow)];

    if (!cacheEntry) {
      return;
    }

    cacheEntry.items = [];
    cacheEntry.fetchedAt = 0;
    cacheEntry.inFlight = null;
  }

  function updateCachedAudioDeviceState(
    deviceId = '',
    flow = DEVICE_TARGET_FLOWS.output,
    patch = {}
  ) {
    const normalizedId = String(deviceId || '').trim();
    const normalizedFlow = normalizeDeviceTargetFlow(flow);
    const cacheEntry = deviceCatalogState[normalizedFlow];

    if (!normalizedId || !cacheEntry || !cacheEntry.items.length) {
      return;
    }

    let hasUpdated = false;
    cacheEntry.items = cacheEntry.items.map((device) => {
      if (String(device?.id || '').trim() !== normalizedId) {
        return device;
      }

      hasUpdated = true;
      return {
        ...device,
        ...patch
      };
    });

    if (hasUpdated) {
      cacheEntry.fetchedAt = Date.now();
    }
  }

  async function listAudioDevices(
    flow = DEVICE_TARGET_FLOWS.output,
    options = {}
  ) {
    const normalizedFlow = normalizeDeviceTargetFlow(flow);
    const force = Boolean(options?.force);
    const cacheEntry = deviceCatalogState[normalizedFlow];
    const now = Date.now();
    const cacheTtl = options?.live
      ? DEVICE_LIVE_CACHE_TTL_MS
      : DEVICE_CACHE_TTL_MS;

    if (
      !force &&
      cacheEntry.items.length &&
      now - cacheEntry.fetchedAt < cacheTtl
    ) {
      return cacheEntry.items.slice();
    }

    if (!force && cacheEntry.inFlight) {
      return cacheEntry.inFlight;
    }

    const api = getApi();

    if (!api?.list_audio_devices) {
      cacheEntry.items = [];
      cacheEntry.fetchedAt = now;
      return [];
    }

    cacheEntry.inFlight = Promise.resolve(
      api.list_audio_devices(normalizedFlow)
    )
      .then((response) => {
        cacheEntry.items = (
          Array.isArray(response?.devices) ? response.devices : []
        )
          .map((device) => ({
            id: String(device?.id || '').trim(),
            name:
              String(device?.name || device?.id || '').trim() ||
              String(device?.id || '').trim(),
            flow: normalizeDeviceTargetFlow(device?.flow || normalizedFlow),
            isDefault: Boolean(device?.isDefault),
            volume: Math.max(0, Math.min(100, Number(device?.volume) || 0)),
            muted: Boolean(device?.muted),
            peak: Math.max(0, Math.min(1, Number(device?.peak) || 0)),
            peakLevel: Math.max(
              0,
              Math.min(1, Number(device?.peakLevel ?? device?.peak) || 0)
            )
          }))
          .filter((device) => device.id);
        cacheEntry.fetchedAt = Date.now();
        return cacheEntry.items.slice();
      })
      .catch((error) => {
        console.error('list_audio_devices error', error);
        cacheEntry.items = [];
        cacheEntry.fetchedAt = Date.now();
        return [];
      })
      .finally(() => {
        cacheEntry.inFlight = null;
      });

    return cacheEntry.inFlight;
  }

  async function getAudioDeviceStateMap(
    deviceTargets = [],
    flow = DEVICE_TARGET_FLOWS.output,
    options = {}
  ) {
    const ids = new Set(
      (Array.isArray(deviceTargets) ? deviceTargets : [])
        .map((target) => String(target?.id || target || '').trim())
        .filter(Boolean)
    );

    if (!ids.size) {
      return new Map();
    }

    const devices = await listAudioDevices(flow, options);
    return new Map(
      devices
        .filter((device) => ids.has(device.id))
        .map((device) => [device.id, device])
    );
  }

  async function setAudioDeviceVolume(
    deviceId = '',
    volume = 0,
    flow = DEVICE_TARGET_FLOWS.output
  ) {
    const normalizedId = String(deviceId || '').trim();
    const api = getApi();

    if (!normalizedId || !api?.set_audio_device_volume) {
      return { success: false };
    }

    const response = await api.set_audio_device_volume(
      normalizedId,
      Math.max(0, Math.min(100, Number(volume) || 0)),
      normalizeDeviceTargetFlow(flow)
    );
    if (response?.success !== false) {
      updateCachedAudioDeviceState(normalizedId, flow, {
        volume: Math.max(
          0,
          Math.min(100, Number(response?.volume ?? volume) || 0)
        ),
        muted: Boolean(response?.muted)
      });
    }
    return response || { success: false };
  }

  async function setAudioDeviceMute(
    deviceId = '',
    muted = false,
    flow = DEVICE_TARGET_FLOWS.output
  ) {
    const normalizedId = String(deviceId || '').trim();
    const api = getApi();

    if (!normalizedId || !api?.set_audio_device_mute) {
      return { success: false };
    }

    const response = await api.set_audio_device_mute(
      normalizedId,
      Boolean(muted),
      normalizeDeviceTargetFlow(flow)
    );
    if (response?.success !== false) {
      updateCachedAudioDeviceState(normalizedId, flow, {
        muted: Boolean(response?.muted ?? muted)
      });
    }
    return response || { success: false };
  }

  async function getFocusedApplication(options = {}) {
    const force = Boolean(options?.force);
    const now = Date.now();

    if (!options?.allowWhenForeground && isFaderDeckWindowActive()) {
      focusState.value = null;
      focusState.fetchedAt = now;
      return null;
    }

    if (
      !force &&
      focusState.value &&
      now - focusState.fetchedAt < FOCUS_CACHE_TTL_MS
    ) {
      return focusState.value;
    }

    if (!force && focusState.inFlight) {
      return focusState.inFlight;
    }

    const api = getApi();

    if (!api?.get_focused_application) {
      focusState.value = null;
      focusState.fetchedAt = now;
      return null;
    }

    focusState.inFlight = Promise.resolve(api.get_focused_application())
      .then(async (response) => {
        let application = createAppTarget(response?.application || null);

        if (
          application &&
          !application.iconDataUrl &&
          typeof window.ensureAudioAppIconDataUrl === 'function'
        ) {
          const iconDataUrl = await window.ensureAudioAppIconDataUrl(
            application,
            {
              reason: 'focus-target'
            }
          );

          if (iconDataUrl) {
            application = {
              ...application,
              iconDataUrl
            };
          }
        }

        focusState.value =
          application && !shouldIgnoreAppTarget(application)
            ? application
            : null;
        focusState.fetchedAt = Date.now();
        return focusState.value;
      })
      .catch((error) => {
        console.error('get_focused_application error', error);
        focusState.value = null;
        focusState.fetchedAt = Date.now();
        return null;
      })
      .finally(() => {
        focusState.inFlight = null;
      });

    return focusState.inFlight;
  }

  async function resolveChannelTargetBinding(channel = {}, options = {}) {
    const mode = getChannelTargetMode(channel);
    const focusExclusions = getChannelFocusExclusions(channel);

    if (mode === TARGET_MODES.focus) {
      const focusTarget = await getFocusedApplication(options);
      const excludedProcesses = new Set(
        focusExclusions
          .map((target) =>
            String(target?.process || '')
              .trim()
              .toLowerCase()
          )
          .filter(Boolean)
      );
      const resolvedFocusTarget =
        focusTarget &&
        !excludedProcesses.has(
          String(focusTarget.process || '')
            .trim()
            .toLowerCase()
        )
          ? focusTarget
          : null;

      return {
        mode,
        appTargets: resolvedFocusTarget ? [resolvedFocusTarget] : [],
        deviceTargets: [],
        deviceFlow: DEVICE_TARGET_FLOWS.output,
        focusTarget: resolvedFocusTarget,
        focusExclusions,
        hasTargets: Boolean(resolvedFocusTarget)
      };
    }

    const deviceFlow = getChannelDeviceTargetFlow(channel);
    const appTargets = getChannelAppTargets(channel);
    const deviceTargets = getChannelDeviceTargets(channel);

    return {
      mode,
      appTargets,
      deviceTargets,
      deviceFlow,
      focusTarget: null,
      focusExclusions,
      hasTargets: appTargets.length > 0 || deviceTargets.length > 0
    };
  }

  async function readBindingState(binding = {}, options = {}) {
    const appTargets = Array.isArray(binding?.appTargets)
      ? binding.appTargets
      : [];
    const deviceTargets = Array.isArray(binding?.deviceTargets)
      ? binding.deviceTargets
      : [];
    const processNames = [
      ...new Set(
        appTargets
          .map((target) => String(target?.process || '').trim())
          .filter(Boolean)
      )
    ];
    const deviceTargetsByFlow = {
      output: deviceTargets.filter(
        (target) =>
          normalizeDeviceTargetFlow(target?.flow) === DEVICE_TARGET_FLOWS.output
      ),
      input: deviceTargets.filter(
        (target) =>
          normalizeDeviceTargetFlow(target?.flow) === DEVICE_TARGET_FLOWS.input
      )
    };
    const [appStateMap, deviceStateMap] = await Promise.all([
      options?.appStateMap instanceof Map
        ? Promise.resolve(options.appStateMap)
        : getProcessAudioStateMap(processNames, options),
      options?.deviceStateMap instanceof Map
        ? Promise.resolve(options.deviceStateMap)
        : deviceTargets.length
          ? Promise.all([
              deviceTargetsByFlow.output.length
                ? getAudioDeviceStateMap(
                    deviceTargetsByFlow.output,
                    DEVICE_TARGET_FLOWS.output,
                    options
                  )
                : Promise.resolve(new Map()),
              deviceTargetsByFlow.input.length
                ? getAudioDeviceStateMap(
                    deviceTargetsByFlow.input,
                    DEVICE_TARGET_FLOWS.input,
                    options
                  )
                : Promise.resolve(new Map())
            ]).then(
              ([outputMap, inputMap]) =>
                new Map([
                  ...Array.from(outputMap.entries()),
                  ...Array.from(inputMap.entries())
                ])
            )
          : Promise.resolve(new Map())
    ]);

    const resolvedStates = [
      ...appTargets
        .map((target) =>
          appStateMap.get(
            String(target?.process || '')
              .trim()
              .toLowerCase()
          )
        )
        .filter(Boolean)
        .map((state) => ({
          kind: 'app',
          key: String(state?.process || '').trim(),
          volume: Math.max(0, Math.min(100, Number(state?.volume) || 0)),
          muted: Boolean(state?.muted),
          peakLevel: Boolean(state?.muted)
            ? 0
            : Math.max(
                0,
                Math.min(
                  1,
                  Math.max(
                    0,
                    Math.min(1, Number(state?.peakLevel ?? state?.peak) || 0)
                  ) *
                    (Math.max(0, Math.min(100, Number(state?.volume) || 0)) /
                      100)
                )
              )
        })),
      ...deviceTargets
        .map((target) => deviceStateMap.get(String(target?.id || '').trim()))
        .filter(Boolean)
        .map((state) => ({
          kind: 'device',
          key: String(state?.id || '').trim(),
          volume: Math.max(0, Math.min(100, Number(state?.volume) || 0)),
          muted: Boolean(state?.muted),
          peakLevel: Boolean(state?.muted)
            ? 0
            : Math.max(
                0,
                Math.min(1, Number(state?.peakLevel ?? state?.peak) || 0)
              )
        }))
    ];

    if (!resolvedStates.length) {
      return {
        hasTargets: Boolean(binding?.hasTargets),
        volume: 0,
        muted: false,
        peakLevel: 0,
        appStateMap,
        deviceStateMap
      };
    }

    const volume =
      resolvedStates.reduce(
        (sum, entry) => sum + (Number(entry.volume) || 0),
        0
      ) / resolvedStates.length;
    const muted = resolvedStates.every((entry) => Boolean(entry.muted));
    const appPeakLevels = resolvedStates
      .filter((entry) => entry.kind === 'app' || entry.kind === 'device')
      .map((entry) => Math.max(0, Math.min(1, Number(entry.peakLevel) || 0)));
    const peakLevel = appPeakLevels.length ? Math.max(...appPeakLevels) : 0;

    return {
      hasTargets: true,
      volume,
      muted,
      peakLevel,
      appStateMap,
      deviceStateMap
    };
  }

  async function setBindingVolume(binding = {}, volume = 0) {
    const api = getApi();
    const normalizedVolume = Math.max(0, Math.min(100, Number(volume) || 0));
    const appTargets = Array.isArray(binding?.appTargets)
      ? binding.appTargets
      : [];
    const deviceTargets = Array.isArray(binding?.deviceTargets)
      ? binding.deviceTargets
      : [];
    const processNames = [
      ...new Set(
        appTargets
          .map((target) => String(target?.process || '').trim())
          .filter(Boolean)
      )
    ];
    const tasks = [];

    if (api?.set_app_volume) {
      processNames.forEach((processName) => {
        tasks.push(api.set_app_volume(processName, normalizedVolume));
      });
    }

    deviceTargets.forEach((target) => {
      tasks.push(
        setAudioDeviceVolume(
          target.id,
          normalizedVolume,
          target?.flow || binding?.deviceFlow
        )
      );
    });

    return Promise.all(tasks);
  }

  async function setBindingMuted(binding = {}, muted = false) {
    const api = getApi();
    const appTargets = Array.isArray(binding?.appTargets)
      ? binding.appTargets
      : [];
    const deviceTargets = Array.isArray(binding?.deviceTargets)
      ? binding.deviceTargets
      : [];
    const processNames = [
      ...new Set(
        appTargets
          .map((target) => String(target?.process || '').trim())
          .filter(Boolean)
      )
    ];
    const tasks = [];

    if (api?.set_app_mute) {
      processNames.forEach((processName) => {
        tasks.push(api.set_app_mute(processName, Boolean(muted)));
      });
    }

    deviceTargets.forEach((target) => {
      tasks.push(
        setAudioDeviceMute(
          target.id,
          Boolean(muted),
          target?.flow || binding?.deviceFlow
        )
      );
    });

    return Promise.all(tasks);
  }

  function createBindingSnapshot(binding = {}, state = {}) {
    const appStateMap =
      state?.appStateMap instanceof Map ? state.appStateMap : new Map();
    const deviceStateMap =
      state?.deviceStateMap instanceof Map ? state.deviceStateMap : new Map();
    const snapshot = [];

    (Array.isArray(binding?.appTargets) ? binding.appTargets : []).forEach(
      (target) => {
        const entry = appStateMap.get(
          String(target?.process || '')
            .trim()
            .toLowerCase()
        );

        if (!entry) {
          return;
        }

        snapshot.push({
          kind: 'app',
          process: String(entry?.process || target?.process || '').trim(),
          volume: Math.max(0, Math.min(100, Number(entry?.volume) || 0)),
          muted: Boolean(entry?.muted)
        });
      }
    );

    (Array.isArray(binding?.deviceTargets)
      ? binding.deviceTargets
      : []
    ).forEach((target) => {
      const entry = deviceStateMap.get(String(target?.id || '').trim());

      if (!entry) {
        return;
      }

      snapshot.push({
        kind: 'device',
        id: String(entry?.id || target?.id || '').trim(),
        flow: normalizeDeviceTargetFlow(entry?.flow || binding?.deviceFlow),
        volume: Math.max(0, Math.min(100, Number(entry?.volume) || 0)),
        muted: Boolean(entry?.muted)
      });
    });

    return snapshot;
  }

  async function restoreBindingSnapshot(snapshot = []) {
    const entries = Array.isArray(snapshot) ? snapshot : [];
    const api = getApi();
    const tasks = [];

    entries.forEach((entry) => {
      if (entry?.kind === 'device') {
        const flow = normalizeDeviceTargetFlow(entry?.flow);
        const id = String(entry?.id || '').trim();

        if (!id) {
          return;
        }

        tasks.push(setAudioDeviceVolume(id, entry?.volume, flow));
        tasks.push(setAudioDeviceMute(id, entry?.muted, flow));
        return;
      }

      const processName = String(entry?.process || '').trim();

      if (!processName || !api?.set_app_volume || !api?.set_app_mute) {
        return;
      }

      tasks.push(
        api.set_app_volume(
          processName,
          Math.max(0, Math.min(100, Number(entry?.volume) || 0))
        )
      );
      tasks.push(api.set_app_mute(processName, Boolean(entry?.muted)));
    });

    return Promise.all(tasks);
  }

  function getBindingPrimaryLabel(binding = {}) {
    if (Array.isArray(binding?.deviceTargets) && binding.deviceTargets.length) {
      return binding.deviceTargets.length === 1
        ? binding.deviceTargets[0].name
        : `${binding.deviceTargets[0].name} +${binding.deviceTargets.length - 1}`;
    }

    if (binding?.focusTarget) {
      return binding.focusTarget.name;
    }

    if (Array.isArray(binding?.appTargets) && binding.appTargets.length) {
      return binding.appTargets.length === 1
        ? binding.appTargets[0].name
        : `${binding.appTargets[0].name} +${binding.appTargets.length - 1}`;
    }

    return '';
  }

  function getBindingExecutablePath(binding = {}) {
    const firstAppTarget = Array.isArray(binding?.appTargets)
      ? binding.appTargets[0]
      : null;

    if (!firstAppTarget) {
      return '';
    }

    return String(firstAppTarget?.path || '').trim();
  }

  window.CHANNEL_TARGET_MODES = TARGET_MODES;
  window.CHANNEL_DEVICE_TARGET_FLOWS = DEVICE_TARGET_FLOWS;
  window.channelTargeting = Object.freeze({
    TARGET_MODES,
    DEVICE_TARGET_FLOWS,
    normalizeTargetMode,
    normalizeDeviceTargetFlow,
    createAppTarget,
    createDeviceTarget,
    shouldIgnoreAppTarget,
    getChannelTargetMode,
    getChannelAppTargets,
    getChannelDeviceTargetFlow,
    getChannelDeviceTargets,
    getChannelFocusExclusions,
    getStoredChannelTargetEntries,
    invalidateAudioDeviceCache,
    listAudioDevices,
    getAudioDeviceStateMap,
    getProcessAudioStateMap,
    setAudioDeviceVolume,
    setAudioDeviceMute,
    getFocusedApplication,
    resolveChannelTargetBinding,
    readBindingState,
    setBindingVolume,
    setBindingMuted,
    createBindingSnapshot,
    restoreBindingSnapshot,
    getBindingPrimaryLabel,
    getBindingExecutablePath
  });
})(window);
