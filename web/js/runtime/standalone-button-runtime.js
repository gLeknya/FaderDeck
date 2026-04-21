(function initStandaloneButtonRuntimeModule(window) {
  const STANDALONE_BUTTON_PRESS_MS = 180;
  const STANDALONE_BUTTON_RUNTIME_REFRESH_MS = 700;

  const standaloneButtonRuntimeState = {
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

  function getStandaloneButtons() {
    return typeof window.getStandaloneButtonsState === 'function'
      ? window.getStandaloneButtonsState()
      : [];
  }

  function getActionTypes() {
    return window.CHANNEL_BUTTON_ACTION_TYPES || {
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
    };
  }

  function getIndicatorTypes() {
    return window.CHANNEL_BUTTON_INDICATOR_TYPES || {
      toggle: 'toggle',
      meter: 'meter',
      press: 'press'
    };
  }

  function getInteractionModes() {
    return window.CHANNEL_BUTTON_INTERACTION_MODES || {
      push: 'push',
      toggle: 'toggle',
      trigger: 'trigger'
    };
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
    return {
      actionActive: false,
      visualActive: false,
      indicatorActive: false,
      meterLevel: 0,
      latched: false,
      flashActive: false,
      pressed: false,
      hasTargets: false,
      buttonIndicatorType: getIndicatorTypes().press
    };
  }

  function resolveIndicatorMode(button = {}, fallbackState = null) {
    const interactionModes = getInteractionModes();
    const explicitMode = String(button?.indicatorMode || fallbackState?.indicatorMode || '').trim();

    if (Object.values(interactionModes).includes(explicitMode)) {
      return explicitMode;
    }

    const legacyIndicatorType = String(
      button?.indicatorType || fallbackState?.buttonIndicatorType || getIndicatorTypes().press
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

  function getIndicatorVisualState({
    indicatorEnabled = true,
    indicatorMode = getInteractionModes().trigger,
    pressed = false,
    latched = false,
    meterLevel = 0
  } = {}) {
    if (!indicatorEnabled) {
      return false;
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
    return standaloneButtonRuntimeState.byKey.get(runtimeKey) || createDefaultRuntimeState();
  }

  function getStandaloneButtonState(buttonId) {
    return getStandaloneButtonStateByKey(getStandaloneButtonRuntimeKey(buttonId));
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
    if (typeof window.standaloneButtonActions?.getTargetProcesses === 'function') {
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

  function readButtonAudioStateMap(processes = []) {
    const normalizedProcesses = [...new Set(
      (Array.isArray(processes) ? processes : [])
        .map((processName) => String(processName || '').trim())
        .filter(Boolean)
    )];
    const api = typeof window.getApi === 'function'
      ? window.getApi()
      : (window.getNativeApi?.() ?? null);

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

  function refreshStandaloneButtonRuntimeDom() {
    document.querySelectorAll('[data-standalone-button-runtime-key]').forEach((element) => {
      const runtimeKey = String(element.dataset.standaloneButtonRuntimeKey || '').trim();
      const state = getStandaloneButtonStateByKey(runtimeKey);
      const buttonRoot = element.closest('.standalone-button');

      if (!buttonRoot) {
        return;
      }

      buttonRoot.classList.toggle('active', Boolean(state.visualActive || state.flashActive));
      buttonRoot.classList.toggle('is-pressed-indicator', Boolean(state.pressed));
      buttonRoot.classList.toggle('is-binding-flash', Boolean(state.flashActive));
      buttonRoot.style.setProperty('--button-meter-level', String(Math.max(0, Math.min(1, state.meterLevel || 0))));
    });
  }

  function emitStandaloneButtonRuntimeChange(meta = {}) {
    refreshStandaloneButtonRuntimeDom();
    window.midiService?.syncChannelButtonIndicators?.({
      reason: 'standalone-button-runtime',
      ...meta
    });
    standaloneButtonRuntimeState.listeners.forEach((listener) => listener(meta));
  }

  function areStandaloneButtonStatesEqual(nextState = {}, previousState = {}) {
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

  function setStandaloneButtonPressedState(buttonId, isPressed) {
    const runtimeKey = getStandaloneButtonRuntimeKey(buttonId);
    const previousState = getStandaloneButtonStateByKey(runtimeKey);
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

    standaloneButtonRuntimeState.byKey.set(runtimeKey, nextState);
    emitStandaloneButtonRuntimeChange({
      type: 'standalone-button-runtime/press',
      buttonId
    });
  }

  function triggerStandaloneButtonPressRuntime(buttonId) {
    const runtimeKey = getStandaloneButtonRuntimeKey(buttonId);
    const existingTimerId = standaloneButtonRuntimeState.pressTimers.get(runtimeKey);

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

  function toggleStandaloneButtonLatchRuntime(buttonId, indicatorTypeHint = null) {
    const runtimeKey = getStandaloneButtonRuntimeKey(buttonId);
    const previousState = getStandaloneButtonStateByKey(runtimeKey);
    const interactionModes = getInteractionModes();
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
    standaloneButtonRuntimeState.activeSoloKey = getStandaloneButtonRuntimeKey(buttonId);
    standaloneButtonRuntimeState.soloSnapshot = Array.isArray(snapshot) ? snapshot : [];
  }

  function restoreStandaloneSoloRuntime() {
    const snapshot = Array.isArray(standaloneButtonRuntimeState.soloSnapshot)
      ? standaloneButtonRuntimeState.soloSnapshot.slice()
      : [];
    const api = typeof window.getApi === 'function'
      ? window.getApi()
      : (window.getNativeApi?.() ?? null);

    standaloneButtonRuntimeState.activeSoloKey = null;
    standaloneButtonRuntimeState.soloSnapshot = null;

    if (!snapshot.length || !api?.set_app_mute) {
      return Promise.resolve();
    }

    return Promise.all(
      snapshot.map((entry) => api.set_app_mute(entry.process, Boolean(entry.muted)))
    );
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
      const buttons = getStandaloneButtons().map((button) => normalizeButton(button));
      const mediaControllerSnapshot = typeof window.mediaControllerUi?.getRuntimeSnapshot === 'function'
        ? await window.mediaControllerUi.getRuntimeSnapshot()
        : null;

      if (!buttons.length) {
        if (standaloneButtonRuntimeState.byKey.size) {
          standaloneButtonRuntimeState.byKey.clear();
          emitStandaloneButtonRuntimeChange({ type: 'standalone-button-runtime/cleared' });
        }
        return;
      }

      const trackedProcesses = [...new Set(buttons.flatMap((button) => getButtonTargetProcesses(button)))];
      const audioStateMap = await readButtonAudioStateMap(trackedProcesses);
      const nextStates = new Map();

      buttons.forEach((button) => {
        const runtimeKey = getStandaloneButtonRuntimeKey(button.id);
        const previousState = getStandaloneButtonStateByKey(runtimeKey);
        const customRuntimeState = typeof window.mediaControllerUi?.getRuntimeStateForButton === 'function'
          ? window.mediaControllerUi.getRuntimeStateForButton(button, previousState, mediaControllerSnapshot)
          : null;

        if (customRuntimeState) {
          nextStates.set(runtimeKey, {
            ...createDefaultRuntimeState(),
            ...customRuntimeState
          });
          return;
        }

        const aggregateState = aggregateButtonTargetState(getButtonTargetProcesses(button), audioStateMap);
        const meterLevel = aggregateState.muted
          ? 0
          : Math.max(0, Math.min(1, (aggregateState.volume || 0) / 100));
        const latched = Boolean(previousState.latched);
        const indicatorEnabled = isIndicatorEnabled(button, previousState);
        const indicatorMode = resolveIndicatorMode(button, previousState);
        let actionActive = false;

        if (!button.actionEnabled || button.actionType === getActionTypes().none) {
          actionActive = false;
        } else if (button.actionType === getActionTypes().solo) {
          actionActive = standaloneButtonRuntimeState.activeSoloKey === runtimeKey;
        } else if (button.actionType === getActionTypes().setVolume) {
          actionActive = aggregateState.hasTargets
            && !aggregateState.muted
            && Math.abs((aggregateState.volume || 0) - (Number(button.actionValue) || 0)) <= 1;
        } else if (button.actionType === getActionTypes().mute) {
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

      let hasChanged = nextStates.size !== standaloneButtonRuntimeState.byKey.size;

      if (!hasChanged) {
        nextStates.forEach((nextState, runtimeKey) => {
          if (!areStandaloneButtonStatesEqual(nextState, standaloneButtonRuntimeState.byKey.get(runtimeKey))) {
            hasChanged = true;
          }
        });
      }

      standaloneButtonRuntimeState.byKey = nextStates;

      if (hasChanged) {
        emitStandaloneButtonRuntimeChange({ type: 'standalone-button-runtime/updated' });
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

    if (!hasStandaloneButtons) {
      if (standaloneButtonRuntimeState.pollTimerId) {
        clearInterval(standaloneButtonRuntimeState.pollTimerId);
        standaloneButtonRuntimeState.pollTimerId = null;
      }
      return;
    }

    if (standaloneButtonRuntimeState.pollTimerId) {
      return;
    }

    standaloneButtonRuntimeState.pollTimerId = window.setInterval(() => {
      requestStandaloneButtonRuntimeRefresh();
    }, STANDALONE_BUTTON_RUNTIME_REFRESH_MS);
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
          meta?.type
          && ![
            'renderer/hydrate',
            'standalone-buttons/add',
            'standalone-buttons/update',
            'standalone-buttons/remove'
          ].includes(meta.type)
          && !String(meta.type).startsWith('standalone-buttons/')
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
      if (document.visibilityState === 'visible') {
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
    getActiveSoloKey: getActiveStandaloneSoloButtonRuntimeKey
  };

  window.requestStandaloneButtonRuntimeRefresh = requestStandaloneButtonRuntimeRefresh;
  window.getStandaloneButtonState = getStandaloneButtonState;
  window.setStandaloneButtonPressedRuntime = (buttonId, isPressed) => {
    setStandaloneButtonPressedState(buttonId, isPressed);
  };
  window.triggerStandaloneButtonPressRuntime = triggerStandaloneButtonPressRuntime;
  window.toggleStandaloneButtonLatchRuntime = toggleStandaloneButtonLatchRuntime;
  window.flashStandaloneButtonBindingRuntime = flashStandaloneButtonBindingRuntime;
  window.activateStandaloneSoloRuntime = activateStandaloneSoloRuntime;
  window.restoreStandaloneSoloRuntime = restoreStandaloneSoloRuntime;
  window.getActiveStandaloneSoloButtonRuntimeKey = getActiveStandaloneSoloButtonRuntimeKey;
  window.initStandaloneButtonsRuntime = initStandaloneButtonsRuntime;
})(window);
