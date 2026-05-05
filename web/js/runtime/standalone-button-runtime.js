(function initStandaloneButtonRuntimeModule(window) {
  const STANDALONE_BUTTON_PRESS_MS = 180;
  const STANDALONE_BUTTON_RUNTIME_REFRESH_MS = 45;
  // When the main window is hidden (minimized to tray, behind another window,
  // etc.) nobody can see the peak meters or button indicators, so this poll
  // exists only to keep MIDI feedback LEDs roughly in sync with external OS
  // changes (e.g. user mutes the app from the Windows volume mixer). 1 Hz is
  // plenty for that and reduces background CPU/PowerShell load by ~5x.
  const STANDALONE_BUTTON_RUNTIME_BACKGROUND_REFRESH_MS = 1000;

  const standaloneButtonRuntimeState = {
    initialized: false,
    pollTimerId: null,
    pollIntervalMs: 0,
    refreshInFlight: null,
    refreshQueued: false,
    byKey: new Map(),
    pressTimers: new Map(),
    listeners: new Set(),
    activeSoloKey: null,
    soloSnapshot: null
  };

  function isRendererUiVisible() {
    return document.visibilityState === 'visible';
  }

  function getStandaloneButtonRuntimeRefreshIntervalMs() {
    return isRendererUiVisible()
      ? STANDALONE_BUTTON_RUNTIME_REFRESH_MS
      : STANDALONE_BUTTON_RUNTIME_BACKGROUND_REFRESH_MS;
  }

  function getStandaloneButtons() {
    return typeof window.getStandaloneButtonsState === 'function'
      ? window.getStandaloneButtonsState()
      : [];
  }

  function getActionTypes() {
    return (
      window.CHANNEL_BUTTON_ACTION_TYPES || {
        none: 'none',
        mute: 'mute',
        solo: 'solo',
        setVolume: 'set-volume',
        sendKey: 'send-key',
        mediaPreviousTrack: 'media-previous-track',
        mediaNextTrack: 'media-next-track',
        mediaPlay: 'media-play',
        mediaPause: 'media-pause',
        mediaPlayPause: 'media-play-pause'
      }
    );
  }

  function getIndicatorTypes() {
    return (
      window.CHANNEL_BUTTON_INDICATOR_TYPES || {
        toggle: 'toggle',
        meter: 'meter',
        press: 'press'
      }
    );
  }

  function getIndicatorBehaviors() {
    return (
      window.CHANNEL_BUTTON_INDICATOR_BEHAVIORS || {
        actionState: 'action-state',
        peakMeter: 'peak-meter',
        targetActivity: 'target-activity'
      }
    );
  }

  function getInteractionModes() {
    return (
      window.CHANNEL_BUTTON_INTERACTION_MODES || {
        push: 'push',
        toggle: 'toggle',
        trigger: 'trigger'
      }
    );
  }

  function normalizeButton(button = {}) {
    return typeof window.cloneChannelButtonEntity === 'function'
      ? window.cloneChannelButtonEntity(button)
      : { ...button };
  }

  function getStandaloneButtonRuntimeKey(buttonId) {
    return `standalone:${buttonId}`;
  }

  function createDefaultRuntimeState() {
    const minDb = Number(window.MIN_CHANNEL_BUTTON_INDICATOR_THRESHOLD ?? -60);
    return {
      actionActive: false,
      visualActive: false,
      indicatorActive: false,
      meterLevel: 0,
      rawMeterLevel: 0,
      rawMeterDb: minDb,
      latched: false,
      flashActive: false,
      pressed: false,
      hasTargets: false,
      indicatorBehavior: getIndicatorBehaviors().actionState,
      indicatorThreshold:
        Number(window.DEFAULT_CHANNEL_BUTTON_INDICATOR_THRESHOLD ?? -20) || -20,
      buttonIndicatorType: getIndicatorTypes().press
    };
  }

  function resolveIndicatorThreshold(button = {}, fallbackState = null) {
    const rawValue =
      button?.indicatorThreshold ?? fallbackState?.indicatorThreshold;
    const channelModel = window.channelModel || null;

    if (
      typeof channelModel?.normalizeChannelButtonIndicatorThreshold ===
      'function'
    ) {
      return channelModel.normalizeChannelButtonIndicatorThreshold(rawValue);
    }

    const minValue = Number(
      window.MIN_CHANNEL_BUTTON_INDICATOR_THRESHOLD ?? -60
    );
    const maxValue = Number(window.MAX_CHANNEL_BUTTON_INDICATOR_THRESHOLD ?? 0);
    const defaultValue = Number(
      window.DEFAULT_CHANNEL_BUTTON_INDICATOR_THRESHOLD ?? -20
    );
    const numericValue = Number(rawValue);
    return Math.max(
      minValue,
      Math.min(
        maxValue,
        Number.isFinite(numericValue) ? numericValue : defaultValue
      )
    );
  }

  function applyPeakMeterThreshold(meterLevel = 0, indicatorThreshold = 0) {
    const normalizedLevel = Math.max(0, Math.min(1, Number(meterLevel) || 0));
    const minDb = Number(window.MIN_CHANNEL_BUTTON_INDICATOR_THRESHOLD ?? -60);
    const maxDb = Number(window.MAX_CHANNEL_BUTTON_INDICATOR_THRESHOLD ?? 0);
    const thresholdDb = Math.max(
      minDb,
      Math.min(maxDb, Number(indicatorThreshold) || minDb)
    );
    const levelDb =
      normalizedLevel > 0
        ? Math.max(minDb, Math.min(maxDb, 20 * Math.log10(normalizedLevel)))
        : minDb;

    if (levelDb <= thresholdDb) {
      return 0;
    }

    if (thresholdDb >= maxDb) {
      return levelDb >= maxDb ? 1 : 0;
    }

    return Math.max(
      0,
      Math.min(1, (levelDb - thresholdDb) / (maxDb - thresholdDb))
    );
  }

  function convertMeterLevelToDb(meterLevel = 0) {
    const normalizedLevel = Math.max(0, Math.min(1, Number(meterLevel) || 0));
    const minDb = Number(window.MIN_CHANNEL_BUTTON_INDICATOR_THRESHOLD ?? -60);
    const maxDb = Number(window.MAX_CHANNEL_BUTTON_INDICATOR_THRESHOLD ?? 0);

    if (normalizedLevel <= 0) {
      return minDb;
    }

    return Math.max(minDb, Math.min(maxDb, 20 * Math.log10(normalizedLevel)));
  }

  function resolveIndicatorMode(button = {}, fallbackState = null) {
    const interactionModes = getInteractionModes();
    const explicitMode = String(
      button?.indicatorMode || fallbackState?.indicatorMode || ''
    ).trim();

    if (Object.values(interactionModes).includes(explicitMode)) {
      return explicitMode;
    }

    const legacyIndicatorType = String(
      button?.indicatorType ||
        fallbackState?.buttonIndicatorType ||
        getIndicatorTypes().press
    ).trim();

    if (legacyIndicatorType === getIndicatorTypes().toggle) {
      return interactionModes.toggle;
    }

    if (legacyIndicatorType === getIndicatorTypes().meter) {
      return interactionModes.push;
    }

    return interactionModes.trigger;
  }

  function isIndicatorEnabled(button = {}, fallbackState = null) {
    if (typeof button?.indicatorEnabled === 'boolean') {
      return button.indicatorEnabled;
    }

    if (typeof fallbackState?.indicatorEnabled === 'boolean') {
      return fallbackState.indicatorEnabled;
    }

    return true;
  }

  function resolveIndicatorBehavior(button = {}, fallbackState = null) {
    const indicatorBehaviors = getIndicatorBehaviors();
    const explicitBehavior = String(
      button?.indicatorBehavior || fallbackState?.indicatorBehavior || ''
    ).trim();

    if (Object.values(indicatorBehaviors).includes(explicitBehavior)) {
      return explicitBehavior;
    }

    if (
      String(
        button?.indicatorType ||
          fallbackState?.buttonIndicatorType ||
          getIndicatorTypes().press
      ).trim() === getIndicatorTypes().meter
    ) {
      return indicatorBehaviors.peakMeter;
    }

    return indicatorBehaviors.actionState;
  }

  function getIndicatorVisualState({
    indicatorEnabled = true,
    indicatorBehavior = getIndicatorBehaviors().actionState,
    indicatorThreshold = 0,
    indicatorMode = getInteractionModes().trigger,
    actionActive = false,
    pressed = false,
    latched = false,
    meterLevel = 0,
    hasTargets = false
  } = {}) {
    if (!indicatorEnabled) {
      return false;
    }

    const indicatorBehaviors = getIndicatorBehaviors();

    if (indicatorBehavior === indicatorBehaviors.actionState) {
      return Boolean(actionActive);
    }

    if (indicatorBehavior === indicatorBehaviors.peakMeter) {
      return Math.max(0, Math.min(1, Number(meterLevel) || 0)) > 0.01;
    }

    if (indicatorBehavior === indicatorBehaviors.targetActivity) {
      return Boolean(hasTargets);
    }

    if (indicatorMode === getInteractionModes().toggle) {
      return Boolean(latched);
    }

    if (indicatorMode === getInteractionModes().push) {
      return Boolean(pressed);
    }

    if (indicatorMode === getInteractionModes().trigger) {
      return Boolean(pressed);
    }

    return Math.max(0, Math.min(1, Number(meterLevel) || 0)) > 0.01;
  }

  function getStandaloneButtonStateByKey(runtimeKey) {
    return (
      standaloneButtonRuntimeState.byKey.get(runtimeKey) ||
      createDefaultRuntimeState()
    );
  }

  function getStandaloneButtonState(buttonId) {
    return getStandaloneButtonStateByKey(
      getStandaloneButtonRuntimeKey(buttonId)
    );
  }

  function subscribeStandaloneButtonRuntime(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    standaloneButtonRuntimeState.listeners.add(listener);
    return () => {
      standaloneButtonRuntimeState.listeners.delete(listener);
    };
  }

  function getButtonTargetProcesses(button = {}) {
    if (
      typeof window.standaloneButtonActions?.getTargetProcesses === 'function'
    ) {
      return window.standaloneButtonActions.getTargetProcesses(button);
    }

    const explicitTargets = Array.isArray(button?.targets)
      ? button.targets
          .map((target) => String(target?.process || '').trim())
          .filter(Boolean)
      : [];

    if (explicitTargets.length > 0) {
      return [...new Set(explicitTargets)];
    }

    const fallbackProcess = String(button?.app || '').trim();
    return fallbackProcess ? [fallbackProcess] : [];
  }

  async function resolveButtonTargetBinding(button = {}, options = {}) {
    if (
      typeof window.standaloneButtonActions?.resolveTargetBinding === 'function'
    ) {
      return window.standaloneButtonActions.resolveTargetBinding(
        button,
        options
      );
    }

    return {
      mode: 'apps',
      appTargets: [],
      deviceTargets: [],
      deviceFlow: 'output',
      focusTarget: null,
      focusExclusions: [],
      hasTargets: false
    };
  }

  function readButtonAudioStateMap(processes = []) {
    const normalizedProcesses = [
      ...new Set(
        (Array.isArray(processes) ? processes : [])
          .map((processName) => String(processName || '').trim())
          .filter(Boolean)
      )
    ];
    const api =
      typeof window.getApi === 'function'
        ? window.getApi()
        : (window.getNativeApi?.() ?? null);

    if (!normalizedProcesses.length || !api?.get_audio_states) {
      return Promise.resolve(new Map());
    }

    return api
      .get_audio_states(normalizedProcesses)
      .then(
        (response) =>
          new Map(
            (Array.isArray(response?.applications)
              ? response.applications
              : []
            ).map((application) => [
              String(application?.process || '')
                .trim()
                .toLowerCase(),
              application
            ])
          )
      )
      .catch((error) => {
        console.error('get_audio_states error', error);
        return new Map();
      });
  }

  function aggregateButtonTargetState(
    targetProcesses = [],
    audioStateMap = new Map()
  ) {
    const states = targetProcesses
      .map((processName) =>
        audioStateMap.get(
          String(processName || '')
            .trim()
            .toLowerCase()
        )
      )
      .filter(Boolean);

    if (!states.length) {
      return {
        hasTargets: targetProcesses.length > 0,
        volume: 0,
        muted: false
      };
    }

    const volume =
      states.reduce((sum, state) => sum + (Number(state?.volume) || 0), 0) /
      states.length;
    const muted = states.every((state) => Boolean(state?.muted));

    return {
      hasTargets: true,
      volume,
      muted
    };
  }

  async function aggregateBindingState(binding = {}, options = {}) {
    if (!window.channelTargeting?.readBindingState) {
      return {
        hasTargets: false,
        volume: 0,
        muted: false
      };
    }

    return window.channelTargeting.readBindingState(binding, options);
  }

  async function getSharedBindingStateMaps(
    resolvedBindings = [],
    options = {}
  ) {
    const targeting = window.channelTargeting || null;
    const processNames = [
      ...new Set(
        resolvedBindings
          .flatMap(({ binding }) =>
            Array.isArray(binding?.appTargets) ? binding.appTargets : []
          )
          .map((target) => String(target?.process || '').trim())
          .filter(Boolean)
      )
    ];
    const allDeviceTargets = resolvedBindings.flatMap(({ binding }) =>
      Array.isArray(binding?.deviceTargets)
        ? binding.deviceTargets.map((target) => ({
            ...target,
            flow:
              String(target?.flow || binding?.deviceFlow || 'output')
                .trim()
                .toLowerCase() === 'input'
                ? 'input'
                : 'output'
          }))
        : []
    );
    const outputTargets = allDeviceTargets.filter(
      (target) => target.flow !== 'input'
    );
    const inputTargets = allDeviceTargets.filter(
      (target) => target.flow === 'input'
    );

    const [appStateMap, outputDeviceMap, inputDeviceMap] = await Promise.all([
      typeof targeting?.getProcessAudioStateMap === 'function'
        ? targeting.getProcessAudioStateMap(processNames, options)
        : readButtonAudioStateMap(processNames),
      outputTargets.length &&
      typeof targeting?.getAudioDeviceStateMap === 'function'
        ? targeting.getAudioDeviceStateMap(outputTargets, 'output', options)
        : Promise.resolve(new Map()),
      inputTargets.length &&
      typeof targeting?.getAudioDeviceStateMap === 'function'
        ? targeting.getAudioDeviceStateMap(inputTargets, 'input', options)
        : Promise.resolve(new Map())
    ]);

    return {
      appStateMap: appStateMap instanceof Map ? appStateMap : new Map(),
      deviceStateMap: new Map([
        ...Array.from(
          outputDeviceMap instanceof Map ? outputDeviceMap.entries() : []
        ),
        ...Array.from(
          inputDeviceMap instanceof Map ? inputDeviceMap.entries() : []
        )
      ])
    };
  }

  function refreshStandaloneButtonRuntimeDom() {
    if (!isRendererUiVisible()) {
      return;
    }

    document
      .querySelectorAll('[data-standalone-button-runtime-key]')
      .forEach((element) => {
        const runtimeKey = String(
          element.dataset.standaloneButtonRuntimeKey || ''
        ).trim();
        const state = getStandaloneButtonStateByKey(runtimeKey);
        const buttonRoot = element.closest('.standalone-button');

        if (!buttonRoot) {
          return;
        }

        const meterLevel = Math.max(
          0,
          Math.min(1, Number(state.meterLevel) || 0)
        );
        buttonRoot.classList.toggle(
          'active',
          Boolean(state.visualActive || state.flashActive)
        );
        buttonRoot.classList.toggle(
          'is-pressed-indicator',
          Boolean(state.pressed)
        );
        buttonRoot.classList.toggle(
          'is-binding-flash',
          Boolean(state.flashActive)
        );
        buttonRoot.style.setProperty(
          '--button-meter-level',
          String(meterLevel)
        );
        buttonRoot.style.setProperty(
          '--button-meter-fill-opacity',
          meterLevel > 0.001
            ? String(Math.min(1, 0.24 + meterLevel * 0.76))
            : '0'
        );
        buttonRoot.style.setProperty(
          '--button-meter-glow-opacity',
          meterLevel > 0.001
            ? String(Math.min(0.92, 0.18 + meterLevel * 0.74))
            : '0'
        );
        buttonRoot.style.setProperty(
          '--button-meter-glow-scale',
          String(0.82 + meterLevel * 0.24)
        );
        buttonRoot.style.setProperty(
          '--button-meter-border-opacity',
          String(0.14 + meterLevel * 0.34)
        );
      });
  }

  function emitStandaloneButtonRuntimeChange(meta = {}) {
    refreshStandaloneButtonRuntimeDom();
    window.midiService?.syncChannelButtonIndicators?.({
      reason: 'standalone-button-runtime',
      ...meta
    });
    standaloneButtonRuntimeState.listeners.forEach((listener) =>
      listener(meta)
    );
  }

  function areStandaloneButtonStatesEqual(nextState = {}, previousState = {}) {
    return (
      Boolean(nextState.actionActive) === Boolean(previousState.actionActive) &&
      Boolean(nextState.visualActive) === Boolean(previousState.visualActive) &&
      Boolean(nextState.indicatorActive) ===
        Boolean(previousState.indicatorActive) &&
      Boolean(nextState.latched) === Boolean(previousState.latched) &&
      Boolean(nextState.flashActive) === Boolean(previousState.flashActive) &&
      Boolean(nextState.pressed) === Boolean(previousState.pressed) &&
      Boolean(nextState.hasTargets) === Boolean(previousState.hasTargets) &&
      String(nextState.indicatorBehavior || '') ===
        String(previousState.indicatorBehavior || '') &&
      Math.abs(
        (Number(nextState.indicatorThreshold) || 0) -
          (Number(previousState.indicatorThreshold) || 0)
      ) < 0.5 &&
      Math.abs(
        (Number(nextState.rawMeterLevel) || 0) -
          (Number(previousState.rawMeterLevel) || 0)
      ) < 0.005 &&
      Math.abs(
        (Number(nextState.meterLevel) || 0) -
          (Number(previousState.meterLevel) || 0)
      ) < 0.005
    );
  }

  function setStandaloneButtonPressedState(buttonId, isPressed) {
    const runtimeKey = getStandaloneButtonRuntimeKey(buttonId);
    const previousState = getStandaloneButtonStateByKey(runtimeKey);
    const indicatorMode = resolveIndicatorMode({}, previousState);
    const indicatorEnabled = isIndicatorEnabled({}, previousState);
    const indicatorBehavior = resolveIndicatorBehavior({}, previousState);
    const indicatorThreshold = resolveIndicatorThreshold({}, previousState);
    const nextState = {
      ...previousState,
      pressed: Boolean(isPressed),
      indicatorEnabled,
      indicatorMode,
      indicatorBehavior,
      indicatorThreshold,
      rawMeterLevel: Number(previousState.rawMeterLevel) || 0,
      rawMeterDb:
        Number(previousState.rawMeterDb) ||
        Number(window.MIN_CHANNEL_BUTTON_INDICATOR_THRESHOLD ?? -60)
    };
    const visualActive = getIndicatorVisualState({
      indicatorEnabled,
      indicatorBehavior,
      indicatorThreshold,
      indicatorMode,
      actionActive: nextState.actionActive,
      pressed: nextState.pressed,
      latched: nextState.latched,
      meterLevel: nextState.meterLevel,
      hasTargets: nextState.hasTargets
    });

    nextState.visualActive = visualActive;
    nextState.indicatorActive = visualActive;

    standaloneButtonRuntimeState.byKey.set(runtimeKey, nextState);
    emitStandaloneButtonRuntimeChange({
      type: 'standalone-button-runtime/press',
      buttonId
    });
  }

  function triggerStandaloneButtonPressRuntime(buttonId) {
    const runtimeKey = getStandaloneButtonRuntimeKey(buttonId);
    const existingTimerId =
      standaloneButtonRuntimeState.pressTimers.get(runtimeKey);

    if (existingTimerId) {
      clearTimeout(existingTimerId);
    }

    setStandaloneButtonPressedState(buttonId, true);

    const timerId = window.setTimeout(() => {
      standaloneButtonRuntimeState.pressTimers.delete(runtimeKey);
      setStandaloneButtonPressedState(buttonId, false);
    }, STANDALONE_BUTTON_PRESS_MS);

    standaloneButtonRuntimeState.pressTimers.set(runtimeKey, timerId);
  }

  function toggleStandaloneButtonLatchRuntime(
    buttonId,
    indicatorTypeHint = null
  ) {
    const runtimeKey = getStandaloneButtonRuntimeKey(buttonId);
    const previousState = getStandaloneButtonStateByKey(runtimeKey);
    const interactionModes = getInteractionModes();
    const buttonIndicatorMode =
      indicatorTypeHint &&
      Object.values(interactionModes).includes(indicatorTypeHint)
        ? indicatorTypeHint
        : resolveIndicatorMode({}, previousState);

    if (buttonIndicatorMode !== interactionModes.toggle) {
      return previousState;
    }

    const nextLatched = !Boolean(previousState.latched);
    const nextState = {
      ...previousState,
      latched: nextLatched,
      indicatorMode: buttonIndicatorMode
    };
    const visualActive = getIndicatorVisualState({
      indicatorEnabled: isIndicatorEnabled({}, previousState),
      indicatorBehavior: resolveIndicatorBehavior({}, previousState),
      indicatorThreshold: resolveIndicatorThreshold({}, previousState),
      indicatorMode: buttonIndicatorMode,
      actionActive: nextState.actionActive,
      pressed: nextState.pressed,
      latched: nextLatched,
      meterLevel: nextState.meterLevel,
      hasTargets: nextState.hasTargets
    });

    nextState.visualActive = visualActive;
    nextState.indicatorActive = visualActive;

    standaloneButtonRuntimeState.byKey.set(runtimeKey, nextState);
    emitStandaloneButtonRuntimeChange({
      type: 'standalone-button-runtime/latch',
      buttonId
    });
    return nextState;
  }

  function setStandaloneButtonFlashState(buttonId, isActive) {
    const runtimeKey = getStandaloneButtonRuntimeKey(buttonId);
    const previousState = getStandaloneButtonStateByKey(runtimeKey);
    const nextState = {
      ...previousState,
      flashActive: Boolean(isActive)
    };
    standaloneButtonRuntimeState.byKey.set(runtimeKey, nextState);
    emitStandaloneButtonRuntimeChange({
      type: 'standalone-button-runtime/flash',
      buttonId
    });
  }

  function flashStandaloneButtonBindingRuntime(buttonId) {
    [0, 120, 240, 360].forEach((delay, index) => {
      window.setTimeout(() => {
        setStandaloneButtonFlashState(buttonId, index % 2 === 0);
      }, delay);
    });

    window.setTimeout(() => {
      setStandaloneButtonFlashState(buttonId, false);
    }, 460);
  }

  function activateStandaloneSoloRuntime(buttonId, snapshot = []) {
    standaloneButtonRuntimeState.activeSoloKey =
      getStandaloneButtonRuntimeKey(buttonId);
    standaloneButtonRuntimeState.soloSnapshot = Array.isArray(snapshot)
      ? snapshot
      : [];
  }

  function restoreStandaloneSoloRuntime() {
    const snapshot = Array.isArray(standaloneButtonRuntimeState.soloSnapshot)
      ? standaloneButtonRuntimeState.soloSnapshot.slice()
      : [];

    standaloneButtonRuntimeState.activeSoloKey = null;
    standaloneButtonRuntimeState.soloSnapshot = null;

    if (!snapshot.length) {
      return Promise.resolve();
    }

    return window.channelTargeting?.restoreBindingSnapshot
      ? window.channelTargeting.restoreBindingSnapshot(snapshot)
      : Promise.resolve();
  }

  function getActiveStandaloneSoloButtonRuntimeKey() {
    return standaloneButtonRuntimeState.activeSoloKey;
  }

  function refreshStandaloneButtonRuntime(force = false) {
    if (standaloneButtonRuntimeState.refreshInFlight) {
      if (force) {
        standaloneButtonRuntimeState.refreshQueued = true;
      }
      return standaloneButtonRuntimeState.refreshInFlight;
    }

    standaloneButtonRuntimeState.refreshInFlight = (async () => {
      const buttons = getStandaloneButtons().map((button) =>
        normalizeButton(button)
      );
      const mediaControllerSnapshot =
        typeof window.mediaControllerUi?.getCachedRuntimeSnapshot === 'function'
          ? window.mediaControllerUi.getCachedRuntimeSnapshot()
          : null;

      if (!buttons.length) {
        if (standaloneButtonRuntimeState.byKey.size) {
          standaloneButtonRuntimeState.byKey.clear();
          emitStandaloneButtonRuntimeChange({
            type: 'standalone-button-runtime/cleared'
          });
        }
        return;
      }

      const resolvedBindings = await Promise.all(
        buttons.map(async (button) => ({
          button,
          binding: await resolveButtonTargetBinding(button, { force: false })
        }))
      );
      const sharedStateMaps = await getSharedBindingStateMaps(
        resolvedBindings,
        { force, live: true }
      );
      const nextStates = new Map();

      for (const { button, binding } of resolvedBindings) {
        const runtimeKey = getStandaloneButtonRuntimeKey(button.id);
        const previousState = getStandaloneButtonStateByKey(runtimeKey);
        const customRuntimeState =
          typeof window.mediaControllerUi?.getRuntimeStateForButton ===
          'function'
            ? window.mediaControllerUi.getRuntimeStateForButton(
                button,
                previousState,
                mediaControllerSnapshot
              )
            : null;

        if (customRuntimeState) {
          nextStates.set(runtimeKey, {
            ...createDefaultRuntimeState(),
            ...customRuntimeState
          });
          continue;
        }

        const aggregateState = await aggregateBindingState(binding, {
          force,
          appStateMap: sharedStateMaps.appStateMap,
          deviceStateMap: sharedStateMaps.deviceStateMap
        });
        const rawMeterLevel = aggregateState.muted
          ? 0
          : Number.isFinite(Number(aggregateState.peakLevel))
            ? Math.max(0, Math.min(1, Number(aggregateState.peakLevel) || 0))
            : Math.max(0, Math.min(1, (aggregateState.volume || 0) / 100));
        const rawMeterDb = convertMeterLevelToDb(rawMeterLevel);
        const latched = Boolean(previousState.latched);
        const indicatorEnabled = isIndicatorEnabled(button, previousState);
        const indicatorMode = resolveIndicatorMode(button, previousState);
        const indicatorBehavior = resolveIndicatorBehavior(
          button,
          previousState
        );
        const indicatorThreshold = resolveIndicatorThreshold(
          button,
          previousState
        );
        let actionActive = false;

        if (
          !button.actionEnabled ||
          button.actionType === getActionTypes().none
        ) {
          actionActive = false;
        } else if (button.actionType === getActionTypes().solo) {
          actionActive =
            standaloneButtonRuntimeState.activeSoloKey === runtimeKey;
        } else if (button.actionType === getActionTypes().setVolume) {
          actionActive =
            aggregateState.hasTargets &&
            !aggregateState.muted &&
            Math.abs(
              (aggregateState.volume || 0) - (Number(button.actionValue) || 0)
            ) <= 1;
        } else if (button.actionType === getActionTypes().mute) {
          actionActive = aggregateState.hasTargets && aggregateState.muted;
        }

        const effectiveMeterLevel =
          indicatorBehavior === getIndicatorBehaviors().peakMeter
            ? applyPeakMeterThreshold(rawMeterLevel, indicatorThreshold)
            : rawMeterLevel;

        const visualActive = getIndicatorVisualState({
          indicatorEnabled,
          indicatorBehavior,
          indicatorThreshold,
          indicatorMode,
          actionActive,
          pressed: Boolean(previousState.pressed),
          latched,
          meterLevel: effectiveMeterLevel,
          hasTargets: aggregateState.hasTargets
        });

        nextStates.set(runtimeKey, {
          actionActive,
          visualActive,
          indicatorActive: visualActive,
          meterLevel: effectiveMeterLevel,
          rawMeterLevel,
          rawMeterDb,
          latched,
          flashActive: Boolean(previousState.flashActive),
          pressed: Boolean(previousState.pressed),
          hasTargets: aggregateState.hasTargets,
          indicatorEnabled,
          indicatorMode,
          indicatorBehavior,
          indicatorThreshold,
          buttonIndicatorType: button.indicatorType
        });
      }

      let hasChanged =
        nextStates.size !== standaloneButtonRuntimeState.byKey.size;

      if (!hasChanged) {
        nextStates.forEach((nextState, runtimeKey) => {
          if (
            !areStandaloneButtonStatesEqual(
              nextState,
              standaloneButtonRuntimeState.byKey.get(runtimeKey)
            )
          ) {
            hasChanged = true;
          }
        });
      }

      standaloneButtonRuntimeState.byKey = nextStates;

      if (hasChanged) {
        emitStandaloneButtonRuntimeChange({
          type: 'standalone-button-runtime/updated'
        });
      } else {
        refreshStandaloneButtonRuntimeDom();
      }
    })();

    return standaloneButtonRuntimeState.refreshInFlight.finally(() => {
      standaloneButtonRuntimeState.refreshInFlight = null;

      if (standaloneButtonRuntimeState.refreshQueued) {
        standaloneButtonRuntimeState.refreshQueued = false;
        refreshStandaloneButtonRuntime(true);
      }
    });
  }

  function requestStandaloneButtonRuntimeRefresh(options = {}) {
    return refreshStandaloneButtonRuntime(Boolean(options?.force));
  }

  function syncStandaloneButtonRuntimePolling() {
    const hasStandaloneButtons = getStandaloneButtons().length > 0;
    const nextPollIntervalMs = getStandaloneButtonRuntimeRefreshIntervalMs();

    if (!hasStandaloneButtons) {
      if (standaloneButtonRuntimeState.pollTimerId) {
        clearInterval(standaloneButtonRuntimeState.pollTimerId);
        standaloneButtonRuntimeState.pollTimerId = null;
        standaloneButtonRuntimeState.pollIntervalMs = 0;
      }
      return;
    }

    if (
      standaloneButtonRuntimeState.pollTimerId &&
      standaloneButtonRuntimeState.pollIntervalMs === nextPollIntervalMs
    ) {
      return;
    }

    if (standaloneButtonRuntimeState.pollTimerId) {
      clearInterval(standaloneButtonRuntimeState.pollTimerId);
      standaloneButtonRuntimeState.pollTimerId = null;
    }

    standaloneButtonRuntimeState.pollTimerId = window.setInterval(() => {
      requestStandaloneButtonRuntimeRefresh();
    }, nextPollIntervalMs);
    standaloneButtonRuntimeState.pollIntervalMs = nextPollIntervalMs;
  }

  function initStandaloneButtonsRuntime() {
    if (standaloneButtonRuntimeState.initialized) {
      return;
    }

    if (typeof window.subscribeAppState === 'function') {
      window.subscribeAppState((nextState, previousState, meta = {}) => {
        if (nextState.standaloneButtons === previousState.standaloneButtons) {
          return;
        }

        if (
          meta?.type &&
          ![
            'renderer/hydrate',
            'standalone-buttons/add',
            'standalone-buttons/update',
            'standalone-buttons/remove'
          ].includes(meta.type) &&
          !String(meta.type).startsWith('standalone-buttons/')
        ) {
          return;
        }

        syncStandaloneButtonRuntimePolling();
        requestStandaloneButtonRuntimeRefresh({ force: true });
      });
    }

    window.addEventListener('focus', () => {
      requestStandaloneButtonRuntimeRefresh({ force: true });
    });

    document.addEventListener('visibilitychange', () => {
      syncStandaloneButtonRuntimePolling();

      if (document.visibilityState === 'visible') {
        refreshStandaloneButtonRuntimeDom();
        requestStandaloneButtonRuntimeRefresh({ force: true });
      }
    });

    syncStandaloneButtonRuntimePolling();
    requestStandaloneButtonRuntimeRefresh({ force: true });
    standaloneButtonRuntimeState.initialized = true;
  }

  window.standaloneButtonRuntime = {
    init: initStandaloneButtonsRuntime,
    subscribe: subscribeStandaloneButtonRuntime,
    getRuntimeKey: getStandaloneButtonRuntimeKey,
    getStateByKey: getStandaloneButtonStateByKey,
    getState: getStandaloneButtonState,
    requestRefresh: requestStandaloneButtonRuntimeRefresh,
    setPressed(buttonId, isPressed) {
      setStandaloneButtonPressedState(buttonId, isPressed);
    },
    triggerPress: triggerStandaloneButtonPressRuntime,
    toggleLatch: toggleStandaloneButtonLatchRuntime,
    flashBinding: flashStandaloneButtonBindingRuntime,
    activateSolo: activateStandaloneSoloRuntime,
    restoreSolo: restoreStandaloneSoloRuntime,
    getActiveSoloKey: getActiveStandaloneSoloButtonRuntimeKey,
    getPollingActive: () => standaloneButtonRuntimeState.pollTimerId !== null
  };

  window.requestStandaloneButtonRuntimeRefresh =
    requestStandaloneButtonRuntimeRefresh;
  window.getStandaloneButtonState = getStandaloneButtonState;
  window.setStandaloneButtonPressedRuntime = (buttonId, isPressed) => {
    setStandaloneButtonPressedState(buttonId, isPressed);
  };
  window.triggerStandaloneButtonPressRuntime =
    triggerStandaloneButtonPressRuntime;
  window.toggleStandaloneButtonLatchRuntime =
    toggleStandaloneButtonLatchRuntime;
  window.flashStandaloneButtonBindingRuntime =
    flashStandaloneButtonBindingRuntime;
  window.activateStandaloneSoloRuntime = activateStandaloneSoloRuntime;
  window.restoreStandaloneSoloRuntime = restoreStandaloneSoloRuntime;
  window.getActiveStandaloneSoloButtonRuntimeKey =
    getActiveStandaloneSoloButtonRuntimeKey;
  window.initStandaloneButtonsRuntime = initStandaloneButtonsRuntime;
})(window);
