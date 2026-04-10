(function initMidiService(window) {
  const MIDI_FADER_LEARN_TIMEOUT_MS = 8000;
  const MIDI_HIGH_RES_COMBINE_DELAY_MS = 12;
  const MIDI_CONTROL_LSB_OFFSET = 32;
  const MIDI_HEALTH_REFRESH_MS = 15000;
  const MIDI_DISABLED_OPTION_VALUE = '__disabled__';
  const MIDI_SELECTION_STORAGE_KEYS = Object.freeze({
    id: 'faderdeck_selected_midi_input_id',
    name: 'faderdeck_selected_midi_input_name'
  });

  const MIDI_STATUS = Object.freeze({
    noteOff: 0x80,
    noteOn: 0x90,
    controlChange: 0xB0,
    pitchBend: 0xE0
  });

  const MIDI_CC = Object.freeze({
    dataEntryMsb: 6,
    dataEntryLsb: 38,
    nrpnMsb: 99,
    nrpnLsb: 98,
    rpnMsb: 101,
    rpnLsb: 100
  });

  let midiAccess = null;
  let midiScanPromise = null;
  let midiStoreSyncInitialized = false;
  let midiRuntimeResetSyncInitialized = false;
  let midiWakeRefreshInitialized = false;
  let midiButtonIndicatorSyncInitialized = false;
  let midiHealthRefreshTimerId = null;
  let midiButtonIndicatorSyncFrameId = null;

  // Runtime-only parser/soft-takeover state. This never belongs in renderer
  // profile serialization and lives entirely inside the MIDI service layer.
  const midiParserStates = new Map();
  const pickupRuntimeState = new Map();
  const buttonTriggerRuntimeState = new Map();
  const runtimeListeners = new Set();
  const messageListeners = new Set();
  // Live WebMIDI availability/discovery state is runtime-only as well.
  const runtimeState = {
    supported: typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function',
    scanning: false,
    accessReady: false,
    inputs: [],
    error: null
  };

  function cloneRuntimeState() {
    return {
      ...runtimeState,
      inputs: runtimeState.inputs.map((input) => ({ ...input }))
    };
  }

  function emitRuntimeChange(meta = {}) {
    const snapshot = cloneRuntimeState();
    runtimeListeners.forEach((listener) => {
      listener(snapshot, meta);
    });
    return snapshot;
  }

  function getMidiServiceState() {
    return cloneRuntimeState();
  }

  function subscribeMidiService(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    runtimeListeners.add(listener);
    return () => {
      runtimeListeners.delete(listener);
    };
  }

  function addMidiMessageListener(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    messageListeners.add(listener);
    return () => {
      messageListeners.delete(listener);
    };
  }

  function getSelectedMidiState() {
    return typeof window.getMidiSelectionState === 'function'
      ? window.getMidiSelectionState()
      : { selectedInputId: '', selectedInputName: '' };
  }

  function getSelectedMidiInputId() {
    return getSelectedMidiState().selectedInputId || '';
  }

  function getSelectedMidiInputName() {
    return getSelectedMidiState().selectedInputName || '';
  }

  function getSoftTakeoverEnabled() {
    return typeof window.getSoftTakeoverEnabledState === 'function'
      ? window.getSoftTakeoverEnabledState()
      : false;
  }

  function getSoftTakeoverThreshold() {
    const rawThreshold = typeof window.getSoftTakeoverThresholdState === 'function'
      ? window.getSoftTakeoverThresholdState()
      : 0;

    return Math.max(0, Math.min(15, Number(rawThreshold) || 0));
  }

  function getChannelSoftTakeoverSettings(channel) {
    const resolvedSettings = typeof window.resolveChannelFaderSettings === 'function'
      ? window.resolveChannelFaderSettings(channel)
      : null;

    return {
      enabled: resolvedSettings?.softTakeoverEnabled ?? getSoftTakeoverEnabled(),
      threshold: Math.max(
        0,
        Math.min(
          15,
          Number(resolvedSettings?.softTakeoverThreshold ?? getSoftTakeoverThreshold()) || 0
        )
      )
    };
  }

  function clampRuntimeVolume(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  function isMidiDisabledSelection() {
    return getSelectedMidiInputId() === MIDI_DISABLED_OPTION_VALUE;
  }

  function persistMidiSelection(midiState = getSelectedMidiState()) {
    if (midiState.selectedInputId) {
      localStorage.setItem(MIDI_SELECTION_STORAGE_KEYS.id, midiState.selectedInputId);
    } else {
      localStorage.removeItem(MIDI_SELECTION_STORAGE_KEYS.id);
    }

    if (midiState.selectedInputName) {
      localStorage.setItem(MIDI_SELECTION_STORAGE_KEYS.name, midiState.selectedInputName);
    } else {
      localStorage.removeItem(MIDI_SELECTION_STORAGE_KEYS.name);
    }
  }

  function selectMidiInput(nextId = '', nextName = '', meta = {}) {
    const currentMidiState = getSelectedMidiState();
    const nextInputId = nextId || '';
    const nextInputName = (
      nextInputId
      && nextInputId !== MIDI_DISABLED_OPTION_VALUE
    ) ? (nextName || currentMidiState.selectedInputName || nextInputId) : '';
    const nextMidiState = typeof window.setMidiSelectionState === 'function'
      ? window.setMidiSelectionState({
        selectedInputId: nextInputId,
        selectedInputName: nextInputName
      }, {
        source: 'midi-service',
        ...meta
      })
      : {
        selectedInputId: nextInputId,
        selectedInputName: nextInputName
      };

    persistMidiSelection(nextMidiState);
    scheduleChannelButtonIndicatorSync({
      type: 'midi-output-selection-change',
      ...meta
    });
    return nextMidiState;
  }

  function normalizeInput(port) {
    return {
      id: port.id,
      name: port.name || port.id,
      state: port.state || '',
      manufacturer: port.manufacturer || ''
    };
  }

  function getMidiInputs() {
    return runtimeState.inputs.map((input) => ({ ...input }));
  }

  function getMidiOutputs() {
    return midiAccess
      ? Array.from(midiAccess.outputs.values())
      : [];
  }

  function openMidiPort(port) {
    if (!port) {
      return;
    }

    try {
      const openResult = port.open?.();

      if (openResult && typeof openResult.catch === 'function') {
        openResult.catch(() => {});
      }
    } catch (error) {
      // noop
    }
  }

  function getSelectedMidiInputPort() {
    if (!midiAccess) {
      return null;
    }

    const selectedInputId = getSelectedMidiInputId();
    const selectedInputName = getSelectedMidiInputName();
    return Array.from(midiAccess.inputs.values()).find((input) => input.id === selectedInputId)
      || Array.from(midiAccess.inputs.values()).find((input) => input.name === selectedInputName)
      || null;
  }

  function getSelectedMidiOutputPort() {
    if (!midiAccess || isMidiDisabledSelection()) {
      return null;
    }

    const outputs = getMidiOutputs();

    if (!outputs.length) {
      return null;
    }

    const selectedInput = getSelectedMidiInputPort();
    const selectedInputName = selectedInput?.name || getSelectedMidiInputName();
    const selectedManufacturer = selectedInput?.manufacturer || '';

    return outputs.find((output) => (
      output.name === selectedInputName
      && (!selectedManufacturer || output.manufacturer === selectedManufacturer)
    )) || outputs.find((output) => output.name === selectedInputName)
      || outputs[0]
      || null;
  }

  function clampMidiOutputValue(value) {
    return Math.max(0, Math.min(127, Math.round(Number(value) || 0)));
  }

  function sendMidiOutputMessage(bytes = []) {
    const output = getSelectedMidiOutputPort();

    if (!output || !Array.isArray(bytes) || !bytes.length) {
      return false;
    }

    openMidiPort(output);

    try {
      output.send(bytes.map((value, index) => (
        index === 0
          ? (Number(value) || 0)
          : clampMidiOutputValue(value)
      )));
      return true;
    } catch (error) {
      return false;
    }
  }

  function sendChannelButtonOutputValue(button = {}, value = 0) {
    const mapping = button?.midiMapping;

    if (!mapping) {
      return false;
    }

    const channelNumber = Math.max(0, Math.min(15, Number(mapping.channel) || 0));
    const midiValue = clampMidiOutputValue(value);

    if (mapping.type === 'control_change' && Number.isInteger(Number(mapping.control))) {
      return sendMidiOutputMessage([
        MIDI_STATUS.controlChange | channelNumber,
        Number(mapping.control),
        midiValue
      ]);
    }

    if (mapping.type === 'note' && Number.isInteger(Number(mapping.note))) {
      return sendMidiOutputMessage([
        MIDI_STATUS.noteOn | channelNumber,
        Number(mapping.note),
        midiValue
      ]);
    }

    return false;
  }

  function getChannelButtonEntries() {
    return (window.getChannelsState?.() || []).flatMap((channel) => (
      Array.isArray(channel?.buttons)
        ? channel.buttons.map((button) => ({ channel, button }))
        : []
    ));
  }

  function getChannelButtonIndicatorMidiValue(button = {}, state = {}) {
    const indicatorType = String(button?.indicatorType || '');

    if (indicatorType === (window.CHANNEL_BUTTON_INDICATOR_TYPES?.meter || 'meter')) {
      return clampMidiOutputValue((Number(state?.meterLevel) || 0) * 127);
    }

    if (indicatorType === (window.CHANNEL_BUTTON_INDICATOR_TYPES?.press || 'press')) {
      return Boolean(state?.pressed) ? 127 : 0;
    }

    return (Boolean(state?.indicatorActive) || Boolean(state?.visualActive)) ? 127 : 0;
  }

  function syncChannelButtonIndicators(meta = {}) {
    if (!runtimeState.supported || !runtimeState.accessReady || !midiAccess || isMidiDisabledSelection()) {
      return false;
    }

    const output = getSelectedMidiOutputPort();

    if (!output) {
      return false;
    }

    openMidiPort(output);

    getChannelButtonEntries().forEach(({ channel, button }) => {
      const mapping = button?.midiMapping;

      if (!mapping || typeof window.getChannelButtonState !== 'function') {
        return;
      }

      const state = window.getChannelButtonState(channel.id, button.id);
      const value = getChannelButtonIndicatorMidiValue(button, state);
      sendChannelButtonOutputValue(button, value);
    });

    return true;
  }

  function flashChannelButtonBindingFeedback(channelId, buttonId, meta = {}) {
    const channel = (window.getChannelsState?.() || []).find((item) => item.id === channelId);
    const button = channel?.buttons?.find((item) => item.id === buttonId) || null;

    window.flashChannelButtonBindingRuntime?.(channelId, buttonId);

    if (!button?.midiMapping) {
      return false;
    }

    [0, 120, 240, 360].forEach((delay, index) => {
      window.setTimeout(() => {
        sendChannelButtonOutputValue(button, index % 2 === 0 ? 127 : 0);
      }, delay);
    });

    window.setTimeout(() => {
      syncChannelButtonIndicators({
        reason: 'button-bind-flash-finish',
        channelId,
        buttonId,
        ...meta
      });
    }, 460);

    return true;
  }

  function scheduleChannelButtonIndicatorSync(meta = {}) {
    if (midiButtonIndicatorSyncFrameId) {
      return;
    }

    midiButtonIndicatorSyncFrameId = window.requestAnimationFrame(() => {
      midiButtonIndicatorSyncFrameId = null;
      syncChannelButtonIndicators(meta);
    });
  }

  function bindMidiInput(port) {
    if (port?.type === 'input') {
      try {
        const openResult = port.open?.();

        if (openResult && typeof openResult.catch === 'function') {
          openResult.catch(() => {});
        }
      } catch (error) {
        // noop
      }

      port.onmidimessage = onWebMidiMessage;
    }
  }

  function reconcileSelectedInput(inputs) {
    const selectedInputId = getSelectedMidiInputId();
    const selectedInputName = getSelectedMidiInputName();
    const matchedInput = inputs.find((input) => input.id === selectedInputId);

    if (matchedInput && !isMidiDisabledSelection() && matchedInput.name !== selectedInputName) {
      selectMidiInput(selectedInputId, matchedInput.name, { source: 'midi-input-reconcile' });
      return;
    }

    if (
      !matchedInput
      && selectedInputName
      && !isMidiDisabledSelection()
      && runtimeState.accessReady
    ) {
      const matchedByName = inputs.find((input) => input.name === selectedInputName);

      if (matchedByName) {
        selectMidiInput(matchedByName.id, matchedByName.name, {
          source: 'midi-input-reconcile',
          reason: 'name-match'
        });
      }

      return;
    }

    if (
      selectedInputId
      && !isMidiDisabledSelection()
      && !matchedInput
      && runtimeState.accessReady
    ) {
      // Keep remembered selection while the device is temporarily unavailable.
      // This allows automatic recovery when the controller is reconnected later.
      persistMidiSelection({
        selectedInputId,
        selectedInputName
      });
    }
  }

  function syncMidiInputsFromAccess(meta = {}) {
    if (midiAccess) {
      midiAccess.inputs.forEach((input) => {
        bindMidiInput(input);
      });
    }

    runtimeState.inputs = midiAccess
      ? Array.from(midiAccess.inputs.values()).map(normalizeInput)
      : [];
    reconcileSelectedInput(runtimeState.inputs);
    scheduleChannelButtonIndicatorSync({
      type: 'inputs-change',
      ...meta
    });
    emitRuntimeChange({
      type: 'inputs-change',
      ...meta
    });
    return getMidiInputs();
  }

  async function requestMidiAccess() {
    try {
      return await navigator.requestMIDIAccess({ sysex: true });
    } catch (error) {
      console.warn('WebMIDI sysex access unavailable, fallback to standard mode', error);
      return navigator.requestMIDIAccess();
    }
  }

  async function ensureMidiAccess() {
    if (!runtimeState.supported) {
      const error = new Error('midi_unsupported');
      error.code = 'midi_unsupported';
      throw error;
    }

    if (midiAccess) {
      syncMidiInputsFromAccess({ source: 'ensure-access-existing' });
      return midiAccess;
    }

    midiAccess = await requestMidiAccess();
    runtimeState.accessReady = true;
    runtimeState.error = null;
    midiAccess.onstatechange = (event) => {
      if (event.port?.type === 'input' && event.port.state === 'connected') {
        bindMidiInput(event.port);
      } else if (event.port?.type === 'input' && event.port.state === 'disconnected') {
        try {
          event.port.onmidimessage = null;
        } catch (error) {
          // noop
        }
      }

      syncMidiInputsFromAccess({ source: 'statechange' });
    };

    midiAccess.inputs.forEach((input) => {
      bindMidiInput(input);
    });

    syncMidiInputsFromAccess({ source: 'ensure-access' });
    emitRuntimeChange({ type: 'access-ready' });
    return midiAccess;
  }

  async function scanMidiInputs() {
    if (!runtimeState.supported) {
      const error = new Error('midi_unsupported');
      error.code = 'midi_unsupported';
      throw error;
    }

    if (midiScanPromise) {
      return midiScanPromise;
    }

    runtimeState.scanning = true;
    runtimeState.error = null;
    emitRuntimeChange({ type: 'scan-start' });

    midiScanPromise = (async () => {
      try {
        await ensureMidiAccess();
        return syncMidiInputsFromAccess({ source: 'scan-complete' });
      } catch (error) {
        runtimeState.error = error;
        emitRuntimeChange({ type: 'scan-error', error });
        throw error;
      } finally {
        runtimeState.scanning = false;
        emitRuntimeChange({ type: 'scan-end' });
        midiScanPromise = null;
      }
    })();

    return midiScanPromise;
  }

  function initMidiStoreSync() {
    if (midiStoreSyncInitialized || typeof window.subscribeAppState !== 'function') {
      return;
    }

    window.subscribeAppState((nextState, previousState) => {
      if (nextState.midi === previousState.midi) {
        return;
      }

      persistMidiSelection(nextState.midi);
      reconcileSelectedInput(runtimeState.inputs);
      scheduleChannelButtonIndicatorSync({ type: 'selection-change' });
      emitRuntimeChange({ type: 'selection-change' });
    });

    midiStoreSyncInitialized = true;
  }

  function resetPickupRuntime(channelId = null) {
    if (channelId === null || channelId === undefined) {
      pickupRuntimeState.clear();
      return;
    }

    pickupRuntimeState.delete(channelId);
  }

  function getChannelPickupRuntime(channelId) {
    if (!pickupRuntimeState.has(channelId)) {
      pickupRuntimeState.set(channelId, {
        engaged: false,
        lastPhysicalValue: null
      });
    }

    return pickupRuntimeState.get(channelId);
  }

  function emitPickupEvent(channelId, message) {
    window.dispatchEvent?.(new CustomEvent('midi:pickup', {
      detail: {
        channelId,
        inputId: message?.inputId || '',
        timestamp: Date.now()
      }
    }));
  }

  function shouldPickupChannel(runtime, channelValue, incomingValue, threshold) {
    if (Math.abs(incomingValue - channelValue) <= threshold) {
      return true;
    }

    if (!Number.isFinite(runtime.lastPhysicalValue)) {
      return false;
    }

    const minValue = Math.min(runtime.lastPhysicalValue, incomingValue);
    const maxValue = Math.max(runtime.lastPhysicalValue, incomingValue);
    return channelValue >= minValue && channelValue <= maxValue;
  }

  function resolveMidiVolumeForChannel(channel, message) {
    const incomingValue = clampRuntimeVolume((message.normalizedValue || 0) * 100);
    const channelSoftTakeover = getChannelSoftTakeoverSettings(channel);

    if (!channelSoftTakeover.enabled) {
      resetPickupRuntime(channel.id);
      return {
        shouldApply: true,
        volume: incomingValue
      };
    }

    const runtime = getChannelPickupRuntime(channel.id);

    if (runtime.engaged) {
      runtime.lastPhysicalValue = incomingValue;
      return {
        shouldApply: true,
        volume: incomingValue
      };
    }

    const channelValue = clampRuntimeVolume(channel.volume);
    const shouldPickup = shouldPickupChannel(
      runtime,
      channelValue,
      incomingValue,
      channelSoftTakeover.threshold
    );

    runtime.lastPhysicalValue = incomingValue;

    if (!shouldPickup) {
      return {
        shouldApply: false,
        volume: channelValue
      };
    }

    runtime.engaged = true;
    emitPickupEvent(channel.id, message);

    return {
      shouldApply: false,
      volume: channelValue
    };
  }

  function initMidiRuntimeResetSync() {
    if (midiRuntimeResetSyncInitialized || typeof window.subscribeAppState !== 'function') {
      return;
    }

    window.subscribeAppState((nextState, previousState, meta = {}) => {
      if (nextState.ui !== previousState.ui) {
        const nextSettings = nextState.ui?.settings || {};
        const previousSettings = previousState.ui?.settings || {};

        if (
          nextSettings.softTakeoverEnabled !== previousSettings.softTakeoverEnabled
          || nextSettings.softTakeoverThreshold !== previousSettings.softTakeoverThreshold
        ) {
          resetPickupRuntime();
        }
      }

      if (nextState.midi !== previousState.midi) {
        resetPickupRuntime();
      }

      if (nextState.profile !== previousState.profile) {
        if ((nextState.profile?.currentName || '') !== (previousState.profile?.currentName || '')) {
          resetPickupRuntime();
        }
      }

      if (nextState.channels === previousState.channels) {
        return;
      }

      if (meta.type === 'renderer/hydrate') {
        resetPickupRuntime();
        return;
      }

      if (meta.type === 'channels/remove') {
        resetPickupRuntime(meta.channelId);
        return;
      }

      if (meta.type === 'channels/set-fader-mapping') {
        resetPickupRuntime(meta.channelId);
        return;
      }

      if (meta.type === 'channels/set-volume') {
        if (meta.source !== 'midi-runtime') {
          resetPickupRuntime(meta.channelId);
        }
        return;
      }

      resetPickupRuntime();
    });

    midiRuntimeResetSyncInitialized = true;
  }

  function refreshMidiInputsOnWake(meta = {}) {
    if (!runtimeState.supported) {
      return Promise.resolve([]);
    }

    return scanMidiInputs({
      source: 'midi-wake-refresh',
      ...meta
    }).catch(() => []);
  }

  function initMidiWakeRefresh() {
    if (midiWakeRefreshInitialized) {
      return;
    }

    window.addEventListener('focus', () => {
      refreshMidiInputsOnWake({ reason: 'window-focus' });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      refreshMidiInputsOnWake({ reason: 'document-visible' });
    });

    midiHealthRefreshTimerId = window.setInterval(() => {
      refreshMidiInputsOnWake({ reason: 'periodic-health-refresh' });
    }, MIDI_HEALTH_REFRESH_MS);

    midiWakeRefreshInitialized = true;
  }

  function initMidiButtonIndicatorSync() {
    if (midiButtonIndicatorSyncInitialized || typeof window.subscribeAppState !== 'function') {
      return;
    }

    window.subscribeAppState((nextState, previousState) => {
      if (nextState.channels !== previousState.channels || nextState.midi !== previousState.midi) {
        scheduleChannelButtonIndicatorSync({ type: 'channel-button-indicator-sync' });
      }
    });

    midiButtonIndicatorSyncInitialized = true;
  }

  function initMidiService() {
    initMidiStoreSync();
    initMidiRuntimeResetSync();
    initMidiWakeRefresh();
    initMidiButtonIndicatorSync();
    emitRuntimeChange({ type: 'init' });

    if (runtimeState.supported) {
      refreshMidiInputsOnWake({ reason: 'init' });
    }

    return getMidiServiceState();
  }

  function createMidiParserState() {
    return {
      ccMsbValues: new Array(32).fill(null),
      ccLsbValues: new Array(32).fill(null),
      pendingCcTimers: new Map(),
      rpn: {
        parameterMsb: null,
        parameterLsb: null,
        valueMsb: null,
        valueLsb: null,
        pendingTimerId: null
      },
      nrpn: {
        parameterMsb: null,
        parameterLsb: null,
        valueMsb: null,
        valueLsb: null,
        pendingTimerId: null
      },
      activeParameterType: null
    };
  }

  function getMidiParserState(inputId, channel) {
    const key = `${inputId}:${channel}`;

    if (!midiParserStates.has(key)) {
      midiParserStates.set(key, createMidiParserState());
    }

    return midiParserStates.get(key);
  }

  function clampMidiNormalizedValue(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function normalizeHighResolutionValue(value) {
    return clampMidiNormalizedValue(value);
  }

  function buildBaseMidiMessage(event) {
    const [status = 0, data1 = 0, data2 = 0] = Array.from(event.data || []);

    return {
      status,
      data1,
      data2,
      channel: status & 0x0F,
      inputId: event.currentTarget?.id || event.target?.id || 'unknown',
      inputName: event.currentTarget?.name || event.target?.name || '',
      timestamp: Date.now(),
      bytes: Array.from(event.data || [])
    };
  }

  function buildControlChangeMessage(baseMessage, control, value) {
    return {
      ...baseMessage,
      type: 'control_change',
      control,
      value,
      resolution: 7,
      normalizedValue: normalizeHighResolutionValue(value / 127)
    };
  }

  function buildControlChange14BitMessage(baseMessage, control, msbValue, lsbValue) {
    const rawValue = ((msbValue & 0x7F) << 7) | (lsbValue & 0x7F);

    return {
      ...baseMessage,
      type: 'control_change_14bit',
      control,
      controlLsb: control + MIDI_CONTROL_LSB_OFFSET,
      msbValue,
      lsbValue,
      value: rawValue,
      resolution: 14,
      normalizedValue: normalizeHighResolutionValue(rawValue / 16383)
    };
  }

  function buildPitchBendMessage(baseMessage) {
    const rawValue = ((baseMessage.data2 & 0x7F) << 7) | (baseMessage.data1 & 0x7F);

    return {
      ...baseMessage,
      type: 'pitch_bend',
      value: rawValue,
      resolution: 14,
      normalizedValue: normalizeHighResolutionValue(rawValue / 16383)
    };
  }

  function buildParameterMessage(baseMessage, parameterType, parameterState) {
    const hasLsb = Number.isInteger(parameterState.valueLsb);
    const rawValue = hasLsb
      ? ((parameterState.valueMsb & 0x7F) << 7) | (parameterState.valueLsb & 0x7F)
      : (parameterState.valueMsb & 0x7F);
    const maxValue = hasLsb ? 16383 : 127;

    return {
      ...baseMessage,
      type: parameterType,
      parameterMsb: parameterState.parameterMsb,
      parameterLsb: parameterState.parameterLsb,
      msbValue: parameterState.valueMsb,
      lsbValue: hasLsb ? parameterState.valueLsb : null,
      value: rawValue,
      resolution: hasLsb ? 14 : 7,
      normalizedValue: normalizeHighResolutionValue(rawValue / maxValue)
    };
  }

  function clearPendingCcTimer(state, control) {
    const timerId = state.pendingCcTimers.get(control);

    if (timerId) {
      clearTimeout(timerId);
      state.pendingCcTimers.delete(control);
    }
  }

  function emitMidiMessage(message) {
    if (!message) {
      return;
    }

    applyMidiMessageToStore(message);

    messageListeners.forEach((listener) => {
      listener(message);
    });
  }

  function scheduleControlChangeMessage(state, baseMessage, control) {
    clearPendingCcTimer(state, control);

    const timerId = setTimeout(() => {
      state.pendingCcTimers.delete(control);

      const msbValue = state.ccMsbValues[control];

      if (!Number.isInteger(msbValue)) {
        return;
      }

      if (Number.isInteger(state.ccLsbValues[control])) {
        emitMidiMessage(
          buildControlChange14BitMessage(baseMessage, control, msbValue, state.ccLsbValues[control])
        );
        return;
      }

      emitMidiMessage(buildControlChangeMessage(baseMessage, control, msbValue));
    }, MIDI_HIGH_RES_COMBINE_DELAY_MS);

    state.pendingCcTimers.set(control, timerId);
  }

  function clearPendingParameterTimer(parameterState) {
    if (parameterState.pendingTimerId) {
      clearTimeout(parameterState.pendingTimerId);
      parameterState.pendingTimerId = null;
    }
  }

  function hasActiveParameterSelection(parameterState) {
    return Number.isInteger(parameterState.parameterMsb)
      && Number.isInteger(parameterState.parameterLsb)
      && !(parameterState.parameterMsb === 127 && parameterState.parameterLsb === 127);
  }

  function syncParameterSelection(state, parameterType) {
    const parameterState = state[parameterType];

    if (hasActiveParameterSelection(parameterState)) {
      state.activeParameterType = parameterType;
      return;
    }

    if (state.activeParameterType === parameterType) {
      state.activeParameterType = null;
    }
  }

  function updateParameterSelection(state, parameterType, key, value) {
    state[parameterType][key] = value;
    syncParameterSelection(state, parameterType);
  }

  function getSelectedParameterState(state) {
    if (!state.activeParameterType) {
      return null;
    }

    const parameterState = state[state.activeParameterType];
    return hasActiveParameterSelection(parameterState)
      ? parameterState
      : null;
  }

  function handleParameterDataEntry(state, baseMessage, control, value) {
    const parameterState = getSelectedParameterState(state);

    if (!parameterState) {
      return null;
    }

    if (control === MIDI_CC.dataEntryMsb) {
      parameterState.valueMsb = value;
      clearPendingParameterTimer(parameterState);

      parameterState.pendingTimerId = setTimeout(() => {
        parameterState.pendingTimerId = null;

        if (!Number.isInteger(parameterState.valueMsb)) {
          return;
        }

        emitMidiMessage(
          buildParameterMessage(baseMessage, state.activeParameterType, parameterState)
        );
      }, MIDI_HIGH_RES_COMBINE_DELAY_MS);

      return [];
    }

    if (control === MIDI_CC.dataEntryLsb) {
      parameterState.valueLsb = value;
      clearPendingParameterTimer(parameterState);

      if (!Number.isInteger(parameterState.valueMsb)) {
        return [];
      }

      return [buildParameterMessage(baseMessage, state.activeParameterType, parameterState)];
    }

    return null;
  }

  function handleControlChangeMessage(baseMessage, control, value) {
    const state = getMidiParserState(baseMessage.inputId, baseMessage.channel);

    if (control === MIDI_CC.nrpnMsb) {
      updateParameterSelection(state, 'nrpn', 'parameterMsb', value);
      return [];
    }

    if (control === MIDI_CC.nrpnLsb) {
      updateParameterSelection(state, 'nrpn', 'parameterLsb', value);
      return [];
    }

    if (control === MIDI_CC.rpnMsb) {
      updateParameterSelection(state, 'rpn', 'parameterMsb', value);
      return [];
    }

    if (control === MIDI_CC.rpnLsb) {
      updateParameterSelection(state, 'rpn', 'parameterLsb', value);
      return [];
    }

    if (control === MIDI_CC.dataEntryMsb || control === MIDI_CC.dataEntryLsb) {
      const parameterMessages = handleParameterDataEntry(state, baseMessage, control, value);

      if (parameterMessages) {
        return parameterMessages;
      }
    }

    if (control >= 0 && control < MIDI_CONTROL_LSB_OFFSET) {
      state.ccMsbValues[control] = value;
      scheduleControlChangeMessage(state, baseMessage, control);
      return [];
    }

    if (control >= MIDI_CONTROL_LSB_OFFSET && control < MIDI_CONTROL_LSB_OFFSET * 2) {
      const baseControl = control - MIDI_CONTROL_LSB_OFFSET;
      state.ccLsbValues[baseControl] = value;
      clearPendingCcTimer(state, baseControl);

      if (!Number.isInteger(state.ccMsbValues[baseControl])) {
        return [];
      }

      return [
        buildControlChange14BitMessage(
          baseMessage,
          baseControl,
          state.ccMsbValues[baseControl],
          value
        )
      ];
    }

    return [buildControlChangeMessage(baseMessage, control, value)];
  }

  function createMidiMessages(event) {
    const baseMessage = buildBaseMidiMessage(event);
    const typeNibble = baseMessage.status & 0xF0;

    if (typeNibble === MIDI_STATUS.noteOn) {
      if (baseMessage.data2 === 0) {
        return [{
          ...baseMessage,
          type: 'note_off',
          note: baseMessage.data1,
          velocity: 0
        }];
      }

      return [{
        ...baseMessage,
        type: 'note_on',
        note: baseMessage.data1,
        velocity: baseMessage.data2
      }];
    }

    if (typeNibble === MIDI_STATUS.noteOff) {
      return [{
        ...baseMessage,
        type: 'note_off',
        note: baseMessage.data1,
        velocity: baseMessage.data2
      }];
    }

    if (typeNibble === MIDI_STATUS.controlChange) {
      return handleControlChangeMessage(baseMessage, baseMessage.data1, baseMessage.data2);
    }

    if (typeNibble === MIDI_STATUS.pitchBend) {
      return [buildPitchBendMessage(baseMessage)];
    }

    return [];
  }

  function onWebMidiMessage(event) {
    const messages = createMidiMessages(event);
    messages.forEach(emitMidiMessage);
  }

  function normalizeMappingType(type) {
    return type === 'pitchwheel' ? 'pitch_bend' : type;
  }

  function isFaderMidiMessage(message) {
    return [
      'control_change',
      'control_change_14bit',
      'pitch_bend',
      'nrpn',
      'rpn'
    ].includes(message.type);
  }

  function isButtonMidiMessage(message) {
    return [
      'note_on',
      'note_off',
      'control_change',
      'control_change_14bit'
    ].includes(message?.type);
  }

  function isMidiMappingMatch(mapping, message) {
    if (!mapping || !message) {
      return false;
    }

    const mappingType = normalizeMappingType(mapping.type);
    const messageType = normalizeMappingType(message.type);

    if ((mapping.channel ?? 0) !== (message.channel ?? 0)) {
      return false;
    }

    if (mappingType === 'control_change') {
      return (messageType === 'control_change' || messageType === 'control_change_14bit')
        && mapping.control === message.control;
    }

    if (mappingType === 'control_change_14bit' && messageType === 'control_change_14bit') {
      return mapping.control === message.control
        && (mapping.controlLsb ?? (mapping.control + MIDI_CONTROL_LSB_OFFSET)) === message.controlLsb;
    }

    if (mappingType === 'control_change_14bit' && messageType === 'control_change') {
      return mapping.control === message.control;
    }

    if ((mappingType === 'nrpn' || mappingType === 'rpn') && mappingType === messageType) {
      return mapping.parameterMsb === message.parameterMsb
        && mapping.parameterLsb === message.parameterLsb;
    }

    return mappingType === messageType;
  }

  function buildFaderMapping(message) {
    if (!message || !isFaderMidiMessage(message)) {
      return null;
    }

    const baseMapping = {
      type: message.type,
      channel: message.channel ?? 0
    };

    if (message.type === 'control_change') {
      return {
        ...baseMapping,
        control: message.control
      };
    }

    if (message.type === 'control_change_14bit') {
      return {
        ...baseMapping,
        control: message.control,
        controlLsb: message.controlLsb
      };
    }

    if (message.type === 'nrpn' || message.type === 'rpn') {
      return {
        ...baseMapping,
        parameterMsb: message.parameterMsb,
        parameterLsb: message.parameterLsb
      };
    }

    return baseMapping;
  }

  function isSameFaderMapping(left, right) {
    if (!left || !right) {
      return false;
    }

    const leftType = normalizeMappingType(left.type);
    const rightType = normalizeMappingType(right.type);

    if (leftType !== rightType || (left.channel ?? 0) !== (right.channel ?? 0)) {
      return false;
    }

    if (leftType === 'control_change') {
      return left.control === right.control;
    }

    if (leftType === 'control_change_14bit') {
      return left.control === right.control
        && (left.controlLsb ?? (left.control + MIDI_CONTROL_LSB_OFFSET))
          === (right.controlLsb ?? (right.control + MIDI_CONTROL_LSB_OFFSET));
    }

    if (leftType === 'nrpn' || leftType === 'rpn') {
      return left.parameterMsb === right.parameterMsb
        && left.parameterLsb === right.parameterLsb;
    }

    return true;
  }

  function buildButtonMapping(message) {
    if (!message || !isButtonMidiMessage(message)) {
      return null;
    }

    if (message.type === 'note_on' || message.type === 'note_off') {
      return {
        type: 'note',
        channel: message.channel ?? 0,
        note: Number(message.note),
        control: null
      };
    }

    return {
      type: 'control_change',
      channel: message.channel ?? 0,
      note: null,
      control: Number(message.control)
    };
  }

  function isSameButtonMapping(left, right) {
    if (!left || !right) {
      return false;
    }

    const leftType = String(left.type || '');
    const rightType = String(right.type || '');

    if (leftType !== rightType || (left.channel ?? 0) !== (right.channel ?? 0)) {
      return false;
    }

    if (leftType === 'control_change') {
      return Number(left.control) === Number(right.control);
    }

    return Number(left.note) === Number(right.note);
  }

  function isButtonMappingMatch(mapping, message) {
    if (!mapping || !message || !isButtonMidiMessage(message)) {
      return false;
    }

    if ((mapping.channel ?? 0) !== (message.channel ?? 0)) {
      return false;
    }

    if (mapping.type === 'control_change') {
      return (message.type === 'control_change' || message.type === 'control_change_14bit')
        && Number(mapping.control) === Number(message.control);
    }

    return (message.type === 'note_on' || message.type === 'note_off')
      && Number(mapping.note) === Number(message.note);
  }

  function isButtonPressMessage(message) {
    if (!message) {
      return false;
    }

    if (message.type === 'note_on') {
      return Number(message.velocity) > 0;
    }

    if (message.type === 'control_change') {
      return Number(message.value) >= 64;
    }

    if (message.type === 'control_change_14bit') {
      return Number(message.value) >= 8192;
    }

    return false;
  }

  function isButtonReleaseMessage(message) {
    if (!message) {
      return false;
    }

    if (message.type === 'note_off') {
      return true;
    }

    if (message.type === 'note_on') {
      return Number(message.velocity) <= 0;
    }

    if (message.type === 'control_change') {
      return Number(message.value) < 64;
    }

    if (message.type === 'control_change_14bit') {
      return Number(message.value) < 8192;
    }

    return false;
  }

  function getChannelButtonTriggerKey(channelId, buttonId) {
    return `${channelId}:${buttonId}`;
  }

  function getButtonMappingLabel(mapping) {
    if (!mapping) {
      return '';
    }

    const channelLabel = `Ch ${Number(mapping.channel ?? 0) + 1}`;

    if (mapping.type === 'control_change') {
      return `${channelLabel} · CC ${Number(mapping.control)}`;
    }

    return `${channelLabel} · Note ${Number(mapping.note)}`;
  }

  function handleMidiButtonMessage(message) {
    if (!isButtonMidiMessage(message)) {
      return;
    }

    getChannelButtonEntries().forEach(({ channel, button }) => {
      if (!isButtonMappingMatch(button?.midiMapping, message)) {
        return;
      }

      const triggerKey = getChannelButtonTriggerKey(channel.id, button.id);
      const wasPressed = Boolean(buttonTriggerRuntimeState.get(triggerKey));

      if (isButtonPressMessage(message)) {
        if (wasPressed) {
          return;
        }

        buttonTriggerRuntimeState.set(triggerKey, true);
        window.channelActions?.executeChannelButton?.(channel.id, button.id, {
          source: 'midi-runtime',
          type: 'channels/button-toggle'
        });
        return;
      }

      if (isButtonReleaseMessage(message)) {
        buttonTriggerRuntimeState.set(triggerKey, false);
      }
    });
  }

  function isSelectedMidiMessage(message) {
    return Boolean(getSelectedMidiInputId())
      && !isMidiDisabledSelection()
      && message?.inputId === getSelectedMidiInputId();
  }

  function applyMidiMessageToStore(message) {
    if (!isSelectedMidiMessage(message)) {
      return;
    }

    if (isFaderMidiMessage(message)) {
      (window.getChannelsState?.() || []).forEach((channel) => {
        if (!isMidiMappingMatch(channel.faderMapping, message)) {
          return;
        }

        const resolvedVolume = resolveMidiVolumeForChannel(channel, message);

        if (!resolvedVolume.shouldApply) {
          return;
        }

        if (typeof window.applyChannelVolumeRuntime === 'function') {
          window.applyChannelVolumeRuntime(channel.id, resolvedVolume.volume, {
            type: 'channels/set-volume'
          });
          return;
        }

        window.setChannelVolumeState?.(channel.id, resolvedVolume.volume, {
          source: 'midi-runtime',
          type: 'channels/set-volume'
        });
      });
    }

    if (isButtonMidiMessage(message)) {
      handleMidiButtonMessage(message);
    }
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function learnFaderMapping() {
    let learnedMessage = null;
    const removeListener = addMidiMessageListener((message) => {
      if (!isFaderMidiMessage(message) || learnedMessage || !isSelectedMidiMessage(message)) {
        return;
      }

      learnedMessage = buildFaderMapping(message);
    });

    for (let attempt = 0; attempt < MIDI_FADER_LEARN_TIMEOUT_MS / 100 && !learnedMessage; attempt += 1) {
      await wait(100);
    }

    removeListener();
    return learnedMessage;
  }

  async function learnButtonMapping() {
    let learnedMessage = null;
    const removeListener = addMidiMessageListener((message) => {
      if (
        learnedMessage
        || !isSelectedMidiMessage(message)
        || !isButtonMidiMessage(message)
        || isButtonReleaseMessage(message)
      ) {
        return;
      }

      learnedMessage = buildButtonMapping(message);
    });

    for (let attempt = 0; attempt < MIDI_FADER_LEARN_TIMEOUT_MS / 100 && !learnedMessage; attempt += 1) {
      await wait(100);
    }

    removeListener();
    return learnedMessage;
  }

  function findFaderMappingConflict(channelId, mapping) {
    return (window.getChannelsState?.() || []).find((channel) => (
      channel.id !== channelId && isSameFaderMapping(channel.faderMapping, mapping)
    )) || null;
  }

  function findButtonMappingConflict(channelId, buttonId, mapping) {
    const channels = window.getChannelsState?.() || [];
    const controlConflict = mapping?.type === 'control_change'
      ? channels.find((channel) => (
        channel.id !== channelId
        && channel?.faderMapping
        && (normalizeMappingType(channel.faderMapping.type) === 'control_change'
          || normalizeMappingType(channel.faderMapping.type) === 'control_change_14bit')
        && Number(channel.faderMapping.channel ?? 0) === Number(mapping.channel ?? 0)
        && Number(channel.faderMapping.control) === Number(mapping.control)
      ))
      : null;

    if (controlConflict) {
      return controlConflict;
    }

    for (const channel of channels) {
      const buttonConflict = (Array.isArray(channel?.buttons) ? channel.buttons : []).find((button) => (
        !(channel.id === channelId && button.id === buttonId)
        && isSameButtonMapping(button?.midiMapping, mapping)
      ));

      if (buttonConflict) {
        return buttonConflict;
      }
    }

    return null;
  }

  function applyChannelFaderMapping(channelId, mapping, meta = {}) {
    resetPickupRuntime(channelId);
    return window.setChannelFaderMappingState?.(channelId, mapping, {
      source: 'midi-service',
      ...meta
    }) || null;
  }

  function applyChannelButtonMapping(channelId, buttonId, mapping, meta = {}) {
    const updatedButton = window.channelActions?.updateChannelButton?.(channelId, buttonId, {
      midiMapping: mapping ? {
        type: mapping.type === 'control_change' ? 'control_change' : 'note',
        channel: Number(mapping.channel) || 0,
        note: Number.isInteger(Number(mapping.note)) ? Number(mapping.note) : null,
        control: Number.isInteger(Number(mapping.control)) ? Number(mapping.control) : null
      } : null
    }, {
      source: 'midi-service',
      ...meta
    }) || null;

    scheduleChannelButtonIndicatorSync({ type: 'button-mapping-update' });
    return updatedButton;
  }

  window.midiService = {
    init: initMidiService,
    ensureAccess: ensureMidiAccess,
    scanInputs: scanMidiInputs,
    selectInput: selectMidiInput,
    getState: getMidiServiceState,
    getInputs: getMidiInputs,
    subscribe: subscribeMidiService,
    addMessageListener: addMidiMessageListener,
    getDisabledOptionValue() {
      return MIDI_DISABLED_OPTION_VALUE;
    },
    getSelectedInputId: getSelectedMidiInputId,
    getSelectedInputName: getSelectedMidiInputName,
    isDisabledSelection: isMidiDisabledSelection,
    isSelectedMessage: isSelectedMidiMessage,
    isFaderMessage: isFaderMidiMessage,
    isButtonMessage: isButtonMidiMessage,
    learnFaderMapping,
    learnButtonMapping,
    buildFaderMapping,
    buildButtonMapping,
    isSameFaderMapping,
    isSameButtonMapping,
    findFaderMappingConflict,
    findButtonMappingConflict,
    applyChannelFaderMapping,
    applyChannelButtonMapping,
    getButtonMappingLabel,
    syncChannelButtonIndicators,
    flashChannelButtonBindingFeedback,
    resetPickupRuntime
  };
})(window);
