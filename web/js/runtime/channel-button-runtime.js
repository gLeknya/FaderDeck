(function initChannelButtonRuntimeModule(window) {
  const CHANNEL_BUTTON_PRESS_MS = 180;
  const CHANNEL_BUTTON_RUNTIME_REFRESH_MS = 700;

  // Runtime-only channel-button state. This stays outside persisted renderer
  // state and is owned by the dedicated runtime layer instead of buttons.js.
  const channelButtonRuntimeState = {
    initialized: false,
    pollTimerId: null,
    refreshInFlight: null,
    refreshQueued: false,
    byKey: new Map(),
    pressTimers: new Map(),
    listeners: new Set(),
    activeSoloKey: null,
    soloSnapshot: null
  };

  function getChannelButtonActionTypes() {
    return window.CHANNEL_BUTTON_ACTION_TYPES || {
      none: 'none',
      mute: 'mute',
      solo: 'solo',
      setVolume: 'set-volume',
      sendKey: 'send-key'
    };
  }

  function getChannelButtonIndicatorTypes() {
    return window.CHANNEL_BUTTON_INDICATOR_TYPES || {
      toggle: 'toggle',
      meter: 'meter',
      press: 'press'
    };
  }

  function getChannelButtonInteractionModes() {
    return window.CHANNEL_BUTTON_INTERACTION_MODES || {
      push: 'push',
      toggle: 'toggle',
      trigger: 'trigger'
    };
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
    return {
      actionActive: false,
      visualActive: false,
      indicatorActive: false,
      meterLevel: 0,
      latched: false,
      flashActive: false,
      pressed: false,
      hasTargets: false,
      buttonIndicatorType: getChannelButtonIndicatorTypes().press
    };
  }

  function resolveIndicatorMode(button = {}, fallbackState = null) {
    const interactionModes = getChannelButtonInteractionModes();
    const explicitMode = String(button?.indicatorMode || fallbackState?.indicatorMode || '').trim();

    if (Object.values(interactionModes).includes(explicitMode)) {
      return explicitMode;
    }

    const legacyIndicatorType = String(
      button?.indicatorType || fallbackState?.buttonIndicatorType || getChannelButtonIndicatorTypes().press
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

  function getIndicatorVisualState({
    indicatorEnabled = true,
    indicatorMode = getChannelButtonInteractionModes().trigger,
    pressed = false,
    latched = false,
    meterLevel = 0
  } = {}) {
    if (!indicatorEnabled) {
      return false;
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
    return channelButtonRuntimeState.byKey.get(buttonKey) || createDefaultRuntimeState();
  }

  function getChannelButtonState(channelId, buttonId) {
    return getChannelButtonStateByKey(getChannelButtonRuntimeKey(channelId, buttonId));
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

  function getButtonTargetProcesses(channel = {}) {
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

  function readButtonAudioStateMap(processes = []) {
    const normalizedProcesses = [...new Set(
      (Array.isArray(processes) ? processes : [])
        .map((processName) => String(processName || '').trim())
        .filter(Boolean)
    )];
    const api = typeof getApi === 'function' ? getApi() : (window.getNativeApi?.() ?? null);

    if (!normalizedProcesses.length || !api?.get_audio_states) {
      return Promise.resolve(new Map());
    }

    return api.get_audio_states(normalizedProcesses)
      .then((response) => new Map(
        (Array.isArray(response?.applications) ? response.applications : []).map((application) => [
          String(application?.process || '').trim().toLowerCase(),
          application
        ])
      ))
      .catch((error) => {
        console.error('get_audio_states error', error);
        return new Map();
      });
  }

  function aggregateButtonTargetState(targetProcesses = [], audioStateMap = new Map()) {
    const states = targetProcesses
      .map((processName) => audioStateMap.get(String(processName || '').trim().toLowerCase()))
      .filter(Boolean);

    if (!states.length) {
      return {
        hasTargets: targetProcesses.length > 0,
        volume: 0,
        muted: false
      };
    }

    const volume = states.reduce((sum, state) => sum + (Number(state?.volume) || 0), 0) / states.length;
    const muted = states.every((state) => Boolean(state?.muted));

    return {
      hasTargets: true,
      volume,
      muted
    };
  }

  function refreshChannelButtonRuntimeDom() {
    document.querySelectorAll('[data-channel-button-runtime-key]').forEach((element) => {
      const runtimeKey = String(element.dataset.channelButtonRuntimeKey || '').trim();
      const state = getChannelButtonStateByKey(runtimeKey);
      const buttonRoot = element.closest('.channel-side-button');

      if (buttonRoot) {
        buttonRoot.classList.toggle('active', Boolean(state.visualActive || state.flashActive));
        buttonRoot.classList.toggle('is-pressed-indicator', Boolean(state.pressed));
        buttonRoot.classList.toggle('is-binding-flash', Boolean(state.flashActive));
        buttonRoot.style.setProperty('--button-meter-level', String(Math.max(0, Math.min(1, state.meterLevel || 0))));
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
      Boolean(nextState.actionActive) === Boolean(previousState.actionActive)
      && Boolean(nextState.visualActive) === Boolean(previousState.visualActive)
      && Boolean(nextState.indicatorActive) === Boolean(previousState.indicatorActive)
      && Boolean(nextState.latched) === Boolean(previousState.latched)
      && Boolean(nextState.flashActive) === Boolean(previousState.flashActive)
      && Boolean(nextState.pressed) === Boolean(previousState.pressed)
      && Boolean(nextState.hasTargets) === Boolean(previousState.hasTargets)
      && Math.abs((Number(nextState.meterLevel) || 0) - (Number(previousState.meterLevel) || 0)) < 0.005
    );
  }

  function setChannelButtonPressedState(channelId, buttonId, isPressed) {
    const runtimeKey = getChannelButtonRuntimeKey(channelId, buttonId);
    const previousState = getChannelButtonStateByKey(runtimeKey);
    const indicatorMode = resolveIndicatorMode({}, previousState);
    const indicatorEnabled = isIndicatorEnabled({}, previousState);
    const nextState = {
      ...previousState,
      pressed: Boolean(isPressed),
      indicatorEnabled,
      indicatorMode
    };
    const visualActive = getIndicatorVisualState({
      indicatorEnabled,
      indicatorMode,
      pressed: nextState.pressed,
      latched: nextState.latched,
      meterLevel: nextState.meterLevel
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
    const existingTimerId = channelButtonRuntimeState.pressTimers.get(runtimeKey);

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

  function toggleChannelButtonLatchRuntime(channelId, buttonId, indicatorTypeHint = null) {
    const runtimeKey = getChannelButtonRuntimeKey(channelId, buttonId);
    const previousState = getChannelButtonStateByKey(runtimeKey);
    const interactionModes = getChannelButtonInteractionModes();
    const buttonIndicatorMode = (
      indicatorTypeHint && Object.values(interactionModes).includes(indicatorTypeHint)
    )
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
      indicatorMode: buttonIndicatorMode,
      pressed: nextState.pressed,
      latched: nextLatched,
      meterLevel: nextState.meterLevel
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
    channelButtonRuntimeState.activeSoloKey = String(buttonKey || '').trim() || null;
    channelButtonRuntimeState.soloSnapshot = Array.isArray(snapshot) ? snapshot : [];
  }

  function restoreSoloChannelButtonRuntime() {
    const snapshot = Array.isArray(channelButtonRuntimeState.soloSnapshot)
      ? channelButtonRuntimeState.soloSnapshot.slice()
      : [];
    const api = typeof getApi === 'function' ? getApi() : (window.getNativeApi?.() ?? null);

    channelButtonRuntimeState.activeSoloKey = null;
    channelButtonRuntimeState.soloSnapshot = null;

    if (!snapshot.length || !api?.set_app_mute) {
      return Promise.resolve();
    }

    return Promise.all(
      snapshot.map((entry) => api.set_app_mute(entry.process, Boolean(entry.muted)))
    );
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
      const channels = typeof getChannelsState === 'function' ? getChannelsState() : [];
      const buttonEntries = channels.flatMap((channel) => (
        (Array.isArray(channel?.buttons) ? channel.buttons : []).map((button) => ({
          channel,
          button: normalizeChannelButton(button)
        }))
      ));

      if (!buttonEntries.length) {
        if (channelButtonRuntimeState.byKey.size) {
          channelButtonRuntimeState.byKey.clear();
          emitChannelButtonRuntimeChange({ type: 'channel-button-runtime/cleared' });
        }
        return;
      }

      const trackedProcesses = [...new Set(buttonEntries.flatMap(({ channel }) => getButtonTargetProcesses(channel)))];
      const audioStateMap = await readButtonAudioStateMap(trackedProcesses);
      const nextStates = new Map();

      buttonEntries.forEach(({ channel, button }) => {
        const runtimeKey = getChannelButtonRuntimeKey(channel.id, button.id);
        const aggregateState = aggregateButtonTargetState(getButtonTargetProcesses(channel), audioStateMap);
        const previousState = getChannelButtonStateByKey(runtimeKey);
        const meterLevel = aggregateState.muted
          ? 0
          : Math.max(0, Math.min(1, (aggregateState.volume || 0) / 100));
        const latched = Boolean(previousState.latched);
        const indicatorEnabled = isIndicatorEnabled(button, previousState);
        const indicatorMode = resolveIndicatorMode(button, previousState);
        let actionActive = false;

        if (!button.actionEnabled || button.actionType === getChannelButtonActionTypes().none) {
          actionActive = false;
        } else if (button.actionType === getChannelButtonActionTypes().solo) {
          actionActive = channelButtonRuntimeState.activeSoloKey === runtimeKey;
        } else if (button.actionType === getChannelButtonActionTypes().setVolume) {
          actionActive = aggregateState.hasTargets
            && !aggregateState.muted
            && Math.abs((aggregateState.volume || 0) - (Number(button.actionValue) || 0)) <= 1;
        } else if (button.actionType === getChannelButtonActionTypes().mute) {
          actionActive = aggregateState.hasTargets && aggregateState.muted;
        }
        const visualActive = getIndicatorVisualState({
          indicatorEnabled,
          indicatorMode,
          pressed: Boolean(previousState.pressed),
          latched,
          meterLevel
        });

        nextStates.set(runtimeKey, {
          actionActive,
          visualActive,
          indicatorActive: visualActive,
          meterLevel,
          latched,
          flashActive: Boolean(previousState.flashActive),
          pressed: Boolean(previousState.pressed),
          hasTargets: aggregateState.hasTargets,
          indicatorEnabled,
          indicatorMode,
          buttonIndicatorType: button.indicatorType
        });
      });

      let hasChanged = nextStates.size !== channelButtonRuntimeState.byKey.size;

      if (!hasChanged) {
        nextStates.forEach((nextState, runtimeKey) => {
          if (!areChannelButtonStatesEqual(nextState, channelButtonRuntimeState.byKey.get(runtimeKey))) {
            hasChanged = true;
          }
        });
      }

      channelButtonRuntimeState.byKey = nextStates;

      if (hasChanged) {
        emitChannelButtonRuntimeChange({ type: 'channel-button-runtime/updated' });
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
    const hasChannelButtons = (typeof getChannelsState === 'function' ? getChannelsState() : []).some((channel) => (
      Array.isArray(channel?.buttons) && channel.buttons.length > 0
    ));

    if (!hasChannelButtons) {
      if (channelButtonRuntimeState.pollTimerId) {
        clearInterval(channelButtonRuntimeState.pollTimerId);
        channelButtonRuntimeState.pollTimerId = null;
      }
      return;
    }

    if (channelButtonRuntimeState.pollTimerId) {
      return;
    }

    channelButtonRuntimeState.pollTimerId = window.setInterval(() => {
      requestChannelButtonRuntimeRefresh();
    }, CHANNEL_BUTTON_RUNTIME_REFRESH_MS);
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
          meta?.type === 'channels/set-volume'
          || meta?.type === 'channels/rename'
          || meta?.type === 'channels/set-title-icon'
          || meta?.type === 'channels/set-fader-mapping'
          || meta?.type === 'channels/set-button-placement'
        ) {
          return;
        }

        if (
          meta?.type
          && ![
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
      if (document.visibilityState === 'visible') {
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
  window.requestChannelButtonRuntimeRefresh = requestChannelButtonRuntimeRefresh;
  window.getChannelButtonState = getChannelButtonState;
  window.setChannelButtonPressedRuntime = setChannelButtonPressedRuntime;
  window.triggerChannelButtonPressRuntime = triggerChannelButtonPressRuntime;
  window.toggleChannelButtonLatchRuntime = toggleChannelButtonLatchRuntime;
  window.flashChannelButtonBindingRuntime = flashChannelButtonBindingRuntime;
  window.activateSoloChannelButtonRuntime = activateSoloChannelButtonRuntime;
  window.restoreSoloChannelButtonRuntime = restoreSoloChannelButtonRuntime;
  window.getActiveSoloChannelButtonKeyRuntime = getActiveSoloChannelButtonKeyRuntime;
  window.initChannelButtonsRuntime = initChannelButtonsRuntime;
})(window);
