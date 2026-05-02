(function initChannelButtonRuntimeModule(window) {
  const CHANNEL_BUTTON_PRESS_MS = 180;
  const CHANNEL_BUTTON_RUNTIME_REFRESH_MS = 45;
  const CHANNEL_BUTTON_RUNTIME_BACKGROUND_REFRESH_MS = 180;

  // Runtime-only channel-button state. This stays outside persisted renderer
  // state and is owned by the dedicated runtime layer instead of buttons.js.
  const channelButtonRuntimeState = {
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

  function getChannelButtonRuntimeRefreshIntervalMs() {
    return isRendererUiVisible()
      ? CHANNEL_BUTTON_RUNTIME_REFRESH_MS
      : CHANNEL_BUTTON_RUNTIME_BACKGROUND_REFRESH_MS;
  }

  function getChannelButtonActionTypes() {
    return (
      window.CHANNEL_BUTTON_ACTION_TYPES || {
        none: 'none',
        mute: 'mute',
        solo: 'solo',
        setVolume: 'set-volume',
        sendKey: 'send-key'
      }
    );
  }

  function getChannelButtonIndicatorTypes() {
    return (
      window.CHANNEL_BUTTON_INDICATOR_TYPES || {
        toggle: 'toggle',
        meter: 'meter',
        press: 'press'
      }
    );
  }

  function getChannelButtonIndicatorBehaviors() {
    return (
      window.CHANNEL_BUTTON_INDICATOR_BEHAVIORS || {
        actionState: 'action-state',
        peakMeter: 'peak-meter',
        targetActivity: 'target-activity'
      }
    );
  }

  function getChannelButtonInteractionModes() {
    return (
      window.CHANNEL_BUTTON_INTERACTION_MODES || {
        push: 'push',
        toggle: 'toggle',
        trigger: 'trigger'
      }
    );
  }

  function normalizeChannelButton(button = {}) {
    return typeof window.cloneChannelButtonEntity === 'function'
      ? window.cloneChannelButtonEntity(button)
      : { ...button };
  }

  function getChannelButtonRuntimeKey(channelId, buttonId) {
    return `${channelId}:${buttonId}`;
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
      indicatorBehavior: getChannelButtonIndicatorBehaviors().actionState,
      indicatorThreshold:
        Number(window.DEFAULT_CHANNEL_BUTTON_INDICATOR_THRESHOLD ?? -20) || -20,
      buttonIndicatorType: getChannelButtonIndicatorTypes().press
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
    const interactionModes = getChannelButtonInteractionModes();
    const explicitMode = String(
      button?.indicatorMode || fallbackState?.indicatorMode || ''
    ).trim();

    if (Object.values(interactionModes).includes(explicitMode)) {
      return explicitMode;
    }

    const legacyIndicatorType = String(
      button?.indicatorType ||
        fallbackState?.buttonIndicatorType ||
        getChannelButtonIndicatorTypes().press
    ).trim();

    if (legacyIndicatorType === getChannelButtonIndicatorTypes().toggle) {
      return interactionModes.toggle;
    }

    if (legacyIndicatorType === getChannelButtonIndicatorTypes().meter) {
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
    const indicatorBehaviors = getChannelButtonIndicatorBehaviors();
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
          getChannelButtonIndicatorTypes().press
      ).trim() === getChannelButtonIndicatorTypes().meter
    ) {
      return indicatorBehaviors.peakMeter;
    }

    return indicatorBehaviors.actionState;
  }

  function getIndicatorVisualState({
    indicatorEnabled = true,
    indicatorBehavior = getChannelButtonIndicatorBehaviors().actionState,
    indicatorThreshold = 0,
    indicatorMode = getChannelButtonInteractionModes().trigger,
    actionActive = false,
    pressed = false,
    latched = false,
    meterLevel = 0,
    hasTargets = false
  } = {}) {
    if (!indicatorEnabled) {
      return false;
    }

    const indicatorBehaviors = getChannelButtonIndicatorBehaviors();

    if (indicatorBehavior === indicatorBehaviors.actionState) {
      return Boolean(actionActive);
    }

    if (indicatorBehavior === indicatorBehaviors.peakMeter) {
      return Math.max(0, Math.min(1, Number(meterLevel) || 0)) > 0.01;
    }

    if (indicatorBehavior === indicatorBehaviors.targetActivity) {
      return Boolean(hasTargets);
    }

    if (indicatorMode === getChannelButtonInteractionModes().toggle) {
      return Boolean(latched);
    }

    if (indicatorMode === getChannelButtonInteractionModes().push) {
      return Boolean(pressed);
    }

    if (indicatorMode === getChannelButtonInteractionModes().trigger) {
      return Boolean(pressed);
    }

    return Math.max(0, Math.min(1, Number(meterLevel) || 0)) > 0.01;
  }

  function getChannelButtonStateByKey(buttonKey) {
    return (
      channelButtonRuntimeState.byKey.get(buttonKey) ||
      createDefaultRuntimeState()
    );
  }

  function getChannelButtonState(channelId, buttonId) {
    return getChannelButtonStateByKey(
      getChannelButtonRuntimeKey(channelId, buttonId)
    );
  }

  function subscribeChannelButtonRuntime(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    channelButtonRuntimeState.listeners.add(listener);
    return () => {
      channelButtonRuntimeState.listeners.delete(listener);
    };
  }

  function getButtonTargetProcesses(channel = {}, button = {}) {
    if (typeof window.channelActions?.getButtonTargetProcesses === 'function') {
      return window.channelActions.getButtonTargetProcesses(channel, button);
    }

    const explicitTargets = Array.isArray(channel?.targets)
      ? channel.targets
          .map((target) => String(target?.process || '').trim())
          .filter(Boolean)
      : [];

    if (explicitTargets.length > 0) {
      return [...new Set(explicitTargets)];
    }

    const fallbackProcess = String(channel?.app || '').trim();
    return fallbackProcess ? [fallbackProcess] : [];
  }

  async function resolveButtonTargetBinding(
    channel = {},
    button = {},
    options = {}
  ) {
    if (
      typeof window.channelActions?.resolveActionTargetBinding === 'function'
    ) {
      return window.channelActions.resolveActionTargetBinding(
        channel,
        button,
        options
      );
    }

    if (window.channelTargeting?.resolveChannelTargetBinding) {
      return window.channelTargeting.resolveChannelTargetBinding(
        channel,
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
      typeof getApi === 'function'
        ? getApi()
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

  function refreshChannelButtonRuntimeDom() {
    if (!isRendererUiVisible()) {
      return;
    }

    document
      .querySelectorAll('[data-channel-button-runtime-key]')
      .forEach((element) => {
        const runtimeKey = String(
          element.dataset.channelButtonRuntimeKey || ''
        ).trim();
        const state = getChannelButtonStateByKey(runtimeKey);
        const buttonRoot = element.closest('.channel-side-button');

        if (buttonRoot) {
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
        }
      });
  }

  function emitChannelButtonRuntimeChange(meta = {}) {
    refreshChannelButtonRuntimeDom();
    window.midiService?.syncChannelButtonIndicators?.({
      reason: 'channel-button-runtime',
      ...meta
    });
    channelButtonRuntimeState.listeners.forEach((listener) => listener(meta));
  }

  function areChannelButtonStatesEqual(nextState = {}, previousState = {}) {
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

  function setChannelButtonPressedState(channelId, buttonId, isPressed) {
    const runtimeKey = getChannelButtonRuntimeKey(channelId, buttonId);
    const previousState = getChannelButtonStateByKey(runtimeKey);
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

    channelButtonRuntimeState.byKey.set(runtimeKey, nextState);
    emitChannelButtonRuntimeChange({
      type: 'channel-button-runtime/press',
      channelId,
      buttonId
    });
  }

  function triggerChannelButtonPressRuntime(channelId, buttonId) {
    const runtimeKey = getChannelButtonRuntimeKey(channelId, buttonId);
    const existingTimerId =
      channelButtonRuntimeState.pressTimers.get(runtimeKey);

    if (existingTimerId) {
      clearTimeout(existingTimerId);
    }

    setChannelButtonPressedState(channelId, buttonId, true);

    const timerId = window.setTimeout(() => {
      channelButtonRuntimeState.pressTimers.delete(runtimeKey);
      setChannelButtonPressedState(channelId, buttonId, false);
    }, CHANNEL_BUTTON_PRESS_MS);

    channelButtonRuntimeState.pressTimers.set(runtimeKey, timerId);
  }

  function toggleChannelButtonLatchRuntime(
    channelId,
    buttonId,
    indicatorTypeHint = null
  ) {
    const runtimeKey = getChannelButtonRuntimeKey(channelId, buttonId);
    const previousState = getChannelButtonStateByKey(runtimeKey);
    const interactionModes = getChannelButtonInteractionModes();
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

    channelButtonRuntimeState.byKey.set(runtimeKey, nextState);
    emitChannelButtonRuntimeChange({
      type: 'channel-button-runtime/latch',
      channelId,
      buttonId
    });
    return nextState;
  }

  function setChannelButtonFlashState(channelId, buttonId, isActive) {
    const runtimeKey = getChannelButtonRuntimeKey(channelId, buttonId);
    const previousState = getChannelButtonStateByKey(runtimeKey);
    const nextState = {
      ...previousState,
      flashActive: Boolean(isActive)
    };
    channelButtonRuntimeState.byKey.set(runtimeKey, nextState);
    emitChannelButtonRuntimeChange({
      type: 'channel-button-runtime/flash',
      channelId,
      buttonId
    });
  }

  function flashChannelButtonBindingRuntime(channelId, buttonId) {
    const sequence = [0, 120, 240, 360];
    sequence.forEach((delay, index) => {
      window.setTimeout(() => {
        setChannelButtonFlashState(channelId, buttonId, index % 2 === 0);
      }, delay);
    });

    window.setTimeout(() => {
      setChannelButtonFlashState(channelId, buttonId, false);
    }, 460);
  }

  function activateSoloChannelButtonRuntime(buttonKey, snapshot = []) {
    channelButtonRuntimeState.activeSoloKey =
      String(buttonKey || '').trim() || null;
    channelButtonRuntimeState.soloSnapshot = Array.isArray(snapshot)
      ? snapshot
      : [];
  }

  function restoreSoloChannelButtonRuntime() {
    const snapshot = Array.isArray(channelButtonRuntimeState.soloSnapshot)
      ? channelButtonRuntimeState.soloSnapshot.slice()
      : [];

    channelButtonRuntimeState.activeSoloKey = null;
    channelButtonRuntimeState.soloSnapshot = null;

    if (!snapshot.length) {
      return Promise.resolve();
    }

    return window.channelTargeting?.restoreBindingSnapshot
      ? window.channelTargeting.restoreBindingSnapshot(snapshot)
      : Promise.resolve();
  }

  function getActiveSoloChannelButtonKeyRuntime() {
    return channelButtonRuntimeState.activeSoloKey;
  }

  function refreshChannelButtonRuntime(force = false) {
    if (channelButtonRuntimeState.refreshInFlight) {
      if (force) {
        channelButtonRuntimeState.refreshQueued = true;
      }
      return channelButtonRuntimeState.refreshInFlight;
    }

    channelButtonRuntimeState.refreshInFlight = (async () => {
      const channels =
        typeof getChannelsState === 'function' ? getChannelsState() : [];
      const buttonEntries = channels.flatMap((channel) =>
        (Array.isArray(channel?.buttons) ? channel.buttons : []).map(
          (button) => ({
            channel,
            button: normalizeChannelButton(button)
          })
        )
      );

      if (!buttonEntries.length) {
        if (channelButtonRuntimeState.byKey.size) {
          channelButtonRuntimeState.byKey.clear();
          emitChannelButtonRuntimeChange({
            type: 'channel-button-runtime/cleared'
          });
        }
        return;
      }

      const resolvedBindings = await Promise.all(
        buttonEntries.map(async ({ channel, button }) => ({
          channel,
          button,
          binding: await resolveButtonTargetBinding(channel, button, {
            force: false
          })
        }))
      );
      const sharedStateMaps = await getSharedBindingStateMaps(
        resolvedBindings,
        { force, live: true }
      );
      const nextStates = new Map();

      for (const { channel, button, binding } of resolvedBindings) {
        const runtimeKey = getChannelButtonRuntimeKey(channel.id, button.id);
        const aggregateState = await aggregateBindingState(binding, {
          force,
          appStateMap: sharedStateMaps.appStateMap,
          deviceStateMap: sharedStateMaps.deviceStateMap
        });
        const previousState = getChannelButtonStateByKey(runtimeKey);
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
          button.actionType === getChannelButtonActionTypes().none
        ) {
          actionActive = false;
        } else if (button.actionType === getChannelButtonActionTypes().solo) {
          actionActive = channelButtonRuntimeState.activeSoloKey === runtimeKey;
        } else if (
          button.actionType === getChannelButtonActionTypes().setVolume
        ) {
          actionActive =
            aggregateState.hasTargets &&
            !aggregateState.muted &&
            Math.abs(
              (aggregateState.volume || 0) - (Number(button.actionValue) || 0)
            ) <= 1;
        } else if (button.actionType === getChannelButtonActionTypes().mute) {
          actionActive = aggregateState.hasTargets && aggregateState.muted;
        }
        const effectiveMeterLevel =
          indicatorBehavior === getChannelButtonIndicatorBehaviors().peakMeter
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

      let hasChanged = nextStates.size !== channelButtonRuntimeState.byKey.size;

      if (!hasChanged) {
        nextStates.forEach((nextState, runtimeKey) => {
          if (
            !areChannelButtonStatesEqual(
              nextState,
              channelButtonRuntimeState.byKey.get(runtimeKey)
            )
          ) {
            hasChanged = true;
          }
        });
      }

      channelButtonRuntimeState.byKey = nextStates;

      if (hasChanged) {
        emitChannelButtonRuntimeChange({
          type: 'channel-button-runtime/updated'
        });
      } else {
        refreshChannelButtonRuntimeDom();
      }
    })();

    return channelButtonRuntimeState.refreshInFlight.finally(() => {
      channelButtonRuntimeState.refreshInFlight = null;

      if (channelButtonRuntimeState.refreshQueued) {
        channelButtonRuntimeState.refreshQueued = false;
        refreshChannelButtonRuntime(true);
      }
    });
  }

  function requestChannelButtonRuntimeRefresh(options = {}) {
    return refreshChannelButtonRuntime(Boolean(options?.force));
  }

  function setChannelButtonPressedRuntime(channelId, buttonId, isPressed) {
    setChannelButtonPressedState(channelId, buttonId, isPressed);
  }

  function syncChannelButtonRuntimePolling() {
    const hasChannelButtons = (
      typeof getChannelsState === 'function' ? getChannelsState() : []
    ).some(
      (channel) => Array.isArray(channel?.buttons) && channel.buttons.length > 0
    );
    const nextPollIntervalMs = getChannelButtonRuntimeRefreshIntervalMs();

    if (!hasChannelButtons) {
      if (channelButtonRuntimeState.pollTimerId) {
        clearInterval(channelButtonRuntimeState.pollTimerId);
        channelButtonRuntimeState.pollTimerId = null;
        channelButtonRuntimeState.pollIntervalMs = 0;
      }
      return;
    }

    if (
      channelButtonRuntimeState.pollTimerId &&
      channelButtonRuntimeState.pollIntervalMs === nextPollIntervalMs
    ) {
      return;
    }

    if (channelButtonRuntimeState.pollTimerId) {
      clearInterval(channelButtonRuntimeState.pollTimerId);
      channelButtonRuntimeState.pollTimerId = null;
    }

    channelButtonRuntimeState.pollTimerId = window.setInterval(() => {
      requestChannelButtonRuntimeRefresh();
    }, nextPollIntervalMs);
    channelButtonRuntimeState.pollIntervalMs = nextPollIntervalMs;
  }

  function initChannelButtonsRuntime() {
    if (channelButtonRuntimeState.initialized) {
      return;
    }

    if (typeof subscribeAppState === 'function') {
      subscribeAppState((nextState, previousState, meta = {}) => {
        if (nextState.channels === previousState.channels) {
          return;
        }

        if (
          meta?.type === 'channels/set-volume' ||
          meta?.type === 'channels/rename' ||
          meta?.type === 'channels/set-title-icon' ||
          meta?.type === 'channels/set-fader-mapping' ||
          meta?.type === 'channels/set-button-placement'
        ) {
          return;
        }

        if (
          meta?.type &&
          ![
            'renderer/hydrate',
            'channels/remove',
            'channels/set-app',
            'channels/clear-app',
            'channels/add-app-target',
            'channels/remove-app-target',
            'channels/button-add',
            'channels/button-remove',
            'channels/button-update'
          ].includes(meta.type)
        ) {
          return;
        }

        syncChannelButtonRuntimePolling();
        requestChannelButtonRuntimeRefresh({ force: true });
      });
    }

    window.addEventListener('focus', () => {
      requestChannelButtonRuntimeRefresh({ force: true });
    });

    document.addEventListener('visibilitychange', () => {
      syncChannelButtonRuntimePolling();

      if (document.visibilityState === 'visible') {
        refreshChannelButtonRuntimeDom();
        requestChannelButtonRuntimeRefresh({ force: true });
      }
    });

    syncChannelButtonRuntimePolling();
    requestChannelButtonRuntimeRefresh({ force: true });
    channelButtonRuntimeState.initialized = true;
  }

  window.channelButtonRuntime = {
    init: initChannelButtonsRuntime,
    subscribe: subscribeChannelButtonRuntime,
    getRuntimeKey: getChannelButtonRuntimeKey,
    getStateByKey: getChannelButtonStateByKey,
    getState: getChannelButtonState,
    requestRefresh: requestChannelButtonRuntimeRefresh,
    setPressed: setChannelButtonPressedRuntime,
    triggerPress: triggerChannelButtonPressRuntime,
    toggleLatch: toggleChannelButtonLatchRuntime,
    flashBinding: flashChannelButtonBindingRuntime,
    activateSolo: activateSoloChannelButtonRuntime,
    restoreSolo: restoreSoloChannelButtonRuntime,
    getActiveSoloKey: getActiveSoloChannelButtonKeyRuntime
  };

  // Compatibility bridge: keep the existing globals while moving ownership
  // out of buttons.js and into this runtime module.
  window.requestChannelButtonRuntimeRefresh =
    requestChannelButtonRuntimeRefresh;
  window.getChannelButtonState = getChannelButtonState;
  window.setChannelButtonPressedRuntime = setChannelButtonPressedRuntime;
  window.triggerChannelButtonPressRuntime = triggerChannelButtonPressRuntime;
  window.toggleChannelButtonLatchRuntime = toggleChannelButtonLatchRuntime;
  window.flashChannelButtonBindingRuntime = flashChannelButtonBindingRuntime;
  window.activateSoloChannelButtonRuntime = activateSoloChannelButtonRuntime;
  window.restoreSoloChannelButtonRuntime = restoreSoloChannelButtonRuntime;
  window.getActiveSoloChannelButtonKeyRuntime =
    getActiveSoloChannelButtonKeyRuntime;
  window.initChannelButtonsRuntime = initChannelButtonsRuntime;
})(window);
