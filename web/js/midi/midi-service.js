(function initMidiService(window) {
  const MIDI_FADER_LEARN_TIMEOUT_MS = 8000;
  const MIDI_HIGH_RES_COMBINE_DELAY_MS = 12;
  const MIDI_CONTROL_LSB_OFFSET = 32;
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

  const midiParserStates = new Map();
  const pickupRuntimeState = new Map();
  const runtimeListeners = new Set();
  const messageListeners = new Set();
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

  function bindMidiInput(port) {
    if (port?.type === 'input') {
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
      selectedInputId
      && !isMidiDisabledSelection()
      && !matchedInput
      && runtimeState.accessReady
    ) {
      selectMidiInput('', '', { source: 'midi-input-reconcile' });
    }
  }

  function syncMidiInputsFromAccess(meta = {}) {
    runtimeState.inputs = midiAccess
      ? Array.from(midiAccess.inputs.values()).map(normalizeInput)
      : [];
    reconcileSelectedInput(runtimeState.inputs);
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
      return midiAccess;
    }

    midiAccess = await requestMidiAccess();
    runtimeState.accessReady = true;
    runtimeState.error = null;
    midiAccess.onstatechange = (event) => {
      if (event.port?.type === 'input' && event.port.state === 'connected') {
        bindMidiInput(event.port);
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

  function initMidiService() {
    initMidiStoreSync();
    initMidiRuntimeResetSync();
    emitRuntimeChange({ type: 'init' });
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

  function isSelectedMidiMessage(message) {
    return Boolean(getSelectedMidiInputId())
      && !isMidiDisabledSelection()
      && message?.inputId === getSelectedMidiInputId();
  }

  function applyMidiMessageToStore(message) {
    if (!isSelectedMidiMessage(message)) {
      return;
    }

    if (!isFaderMidiMessage(message)) {
      return;
    }

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

  function findFaderMappingConflict(channelId, mapping) {
    return (window.getChannelsState?.() || []).find((channel) => (
      channel.id !== channelId && isSameFaderMapping(channel.faderMapping, mapping)
    )) || null;
  }

  function applyChannelFaderMapping(channelId, mapping, meta = {}) {
    resetPickupRuntime(channelId);
    return window.setChannelFaderMappingState?.(channelId, mapping, {
      source: 'midi-service',
      ...meta
    }) || null;
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
    learnFaderMapping,
    buildFaderMapping,
    isSameFaderMapping,
    findFaderMappingConflict,
    applyChannelFaderMapping,
    resetPickupRuntime
  };
})(window);
