(function initMidiService(window) {
  const midiSelectionStorage = window.midiSelectionStorage;
  const MIDI_FADER_LEARN_TIMEOUT_MS = 8000;
  const MIDI_HIGH_RES_COMBINE_DELAY_MS = 12;
  const MIDI_CONTROL_LSB_OFFSET = 32;
  const MIDI_HEALTH_REFRESH_MS = 15000;
  const MIDI_BACKGROUND_HEALTH_REFRESH_MS = 60000;
  const MIDI_DISABLED_OPTION_VALUE = '__disabled__';
  const MIDI_STATUS = Object.freeze({
    noteOff: 0x80,
    noteOn: 0x90,
    controlChange: 0xb0,
    pitchBend: 0xe0
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
  let midiHealthRefreshIntervalMs = 0;
  let midiButtonIndicatorSyncFrameId = null;
  let midiIndicatorTestState = null;
  const midiIndicatorOutputCache = {
    outputId: '',
    values: new Map()
  };

  // Runtime-only parser/soft-takeover state. This never belongs in renderer
  // profile serialization and lives entirely inside the MIDI service layer.
  const midiParserStates = new Map();
  const pickupRuntimeState = new Map();
  const buttonTriggerRuntimeState = new Map();
  const runtimeListeners = new Set();
  const messageListeners = new Set();
  // Live WebMIDI availability/discovery state is runtime-only as well.
  const runtimeState = {
    supported:
      typeof navigator !== 'undefined' &&
      typeof navigator.requestMIDIAccess === 'function',
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
    const rawThreshold =
      typeof window.getSoftTakeoverThresholdState === 'function'
        ? window.getSoftTakeoverThresholdState()
        : 0;

    return Math.max(0, Math.min(15, Number(rawThreshold) || 0));
  }

  function getChannelSoftTakeoverSettings(channel) {
    const resolvedSettings =
      typeof window.resolveChannelFaderSettings === 'function'
        ? window.resolveChannelFaderSettings(channel)
        : null;

    return {
      enabled:
        resolvedSettings?.softTakeoverEnabled ?? getSoftTakeoverEnabled(),
      threshold: Math.max(
        0,
        Math.min(
          15,
          Number(
            resolvedSettings?.softTakeoverThreshold ??
              getSoftTakeoverThreshold()
          ) || 0
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
    midiSelectionStorage?.writeMidiSelection(midiState);
  }

  function selectMidiInput(nextId = '', nextName = '', meta = {}) {
    const currentMidiState = getSelectedMidiState();
    const nextInputId = nextId || '';
    const nextInputName =
      nextInputId && nextInputId !== MIDI_DISABLED_OPTION_VALUE
        ? nextName || currentMidiState.selectedInputName || nextInputId
        : '';
    const nextMidiState =
      typeof window.setMidiSelectionState === 'function'
        ? window.setMidiSelectionState(
            {
              selectedInputId: nextInputId,
              selectedInputName: nextInputName
            },
            {
              source: 'midi-service',
              ...meta
            }
          )
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
    return midiAccess ? Array.from(midiAccess.outputs.values()) : [];
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
    return (
      Array.from(midiAccess.inputs.values()).find(
        (input) => input.id === selectedInputId
      ) ||
      Array.from(midiAccess.inputs.values()).find(
        (input) => input.name === selectedInputName
      ) ||
      null
    );
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

    return (
      outputs.find(
        (output) =>
          output.name === selectedInputName &&
          (!selectedManufacturer ||
            output.manufacturer === selectedManufacturer)
      ) ||
      outputs.find((output) => output.name === selectedInputName) ||
      outputs[0] ||
      null
    );
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
      output.send(
        bytes.map((value, index) =>
          index === 0 ? Number(value) || 0 : clampMidiOutputValue(value)
        )
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  function sendMidiOutputMessageToPort(port, bytes = []) {
    if (!port || !Array.isArray(bytes) || !bytes.length) {
      return false;
    }

    openMidiPort(port);

    try {
      port.send(
        bytes.map((value, index) =>
          index === 0 ? Number(value) || 0 : clampMidiOutputValue(value)
        )
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  function getMidiIndicatorCacheKey(button = {}) {
    const mapping = button?.midiMapping;

    if (!mapping) {
      return '';
    }

    const channelNumber = Math.max(
      0,
      Math.min(15, Number(mapping.channel) || 0)
    );

    if (
      mapping.type === 'control_change' &&
      Number.isInteger(Number(mapping.control))
    ) {
      return `cc:${channelNumber}:${Number(mapping.control)}`;
    }

    if (mapping.type === 'note' && Number.isInteger(Number(mapping.note))) {
      return `note:${channelNumber}:${Number(mapping.note)}`;
    }

    return '';
  }

  function syncMidiIndicatorOutputCache(output = null) {
    const resolvedOutput = output || getSelectedMidiOutputPort();
    const nextOutputId = resolvedOutput?.id || '';

    if (midiIndicatorOutputCache.outputId !== nextOutputId) {
      midiIndicatorOutputCache.outputId = nextOutputId;
      midiIndicatorOutputCache.values.clear();
    }

    return resolvedOutput;
  }

  function sendMidiIndicatorValueByCacheKey(
    cacheKey = '',
    value = 0,
    output = null
  ) {
    const resolvedOutput = syncMidiIndicatorOutputCache(output);

    if (!resolvedOutput) {
      return false;
    }

    const [mappingType, channelRaw, targetRaw] = String(cacheKey || '').split(
      ':'
    );
    const channelNumber = Math.max(0, Math.min(15, Number(channelRaw) || 0));
    const targetNumber = Number(targetRaw);
    const midiValue = clampMidiOutputValue(value);

    if (!Number.isInteger(targetNumber)) {
      return false;
    }

    if (mappingType === 'cc') {
      return sendMidiOutputMessageToPort(resolvedOutput, [
        MIDI_STATUS.controlChange | channelNumber,
        targetNumber,
        midiValue
      ]);
    }

    if (mappingType === 'note') {
      return sendMidiOutputMessageToPort(resolvedOutput, [
        MIDI_STATUS.noteOn | channelNumber,
        targetNumber,
        midiValue
      ]);
    }

    return false;
  }

  function buildIndicatorTestMessages(value = 127) {
    const normalizedValue = clampMidiOutputValue(value);
    const messages = [];

    for (let channel = 0; channel < 16; channel += 1) {
      for (let control = 0; control < 128; control += 1) {
        messages.push([
          MIDI_STATUS.controlChange | channel,
          control,
          normalizedValue
        ]);
      }

      for (let note = 0; note < 128; note += 1) {
        messages.push([MIDI_STATUS.noteOn | channel, note, normalizedValue]);
      }
    }

    return messages;
  }

  function describeIndicatorTestMessage(message = []) {
    const status = Number(message[0]) || 0;
    const channel = (status & 0x0f) + 1;
    const statusType = status & 0xf0;
    const controlOrNote = Number(message[1]) || 0;
    const value = Number(message[2]) || 0;

    if (statusType === MIDI_STATUS.controlChange) {
      return `CC ch=${channel} control=${controlOrNote} value=${value}`;
    }

    if (statusType === MIDI_STATUS.noteOn) {
      return `NOTE ch=${channel} note=${controlOrNote} value=${value}`;
    }

    return `status=${status} data1=${controlOrNote} value=${value}`;
  }

  function stopIndicatorTest({ turnOff = true } = {}) {
    if (!midiIndicatorTestState) {
      return false;
    }

    const { intervalId, timeoutId, output, offMessages } =
      midiIndicatorTestState;

    if (intervalId) {
      clearInterval(intervalId);
    }

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (turnOff && output && Array.isArray(offMessages)) {
      offMessages.forEach((message) => {
        sendMidiOutputMessageToPort(output, message);
      });
    }

    midiIndicatorTestState = null;
    return true;
  }

  async function runIndicatorTest(durationSeconds = 5) {
    await ensureMidiAccess();

    const output = getSelectedMidiOutputPort();

    if (!output) {
      throw new Error('selected_midi_output_unavailable');
    }

    stopIndicatorTest({ turnOff: true });

    const durationMs = Math.max(1, Number(durationSeconds) || 0) * 1000;
    const onMessages = buildIndicatorTestMessages(127);
    const offMessages = [];
    let cursor = 0;

    const activateNextIndicator = () => {
      if (!midiIndicatorTestState || midiIndicatorTestState.output !== output) {
        return;
      }

      const message = onMessages[cursor];
      const sent = sendMidiOutputMessageToPort(output, message);

      if (sent) {
        offMessages.push([message[0], message[1], 0]);
        window.console?.info?.(
          '[indicatorstest]',
          describeIndicatorTestMessage(message)
        );
      }

      cursor = (cursor + 1) % onMessages.length;
    };

    midiIndicatorTestState = {
      output,
      offMessages,
      intervalId: null,
      timeoutId: null
    };

    activateNextIndicator();

    midiIndicatorTestState.intervalId = window.setInterval(
      activateNextIndicator,
      50
    );
    midiIndicatorTestState.timeoutId = window.setTimeout(() => {
      stopIndicatorTest({ turnOff: true });
    }, durationMs);

    return {
      success: true,
      durationMs,
      outputId: output.id || '',
      outputName: output.name || output.id || '',
      messageCount: onMessages.length
    };
  }

  function sendChannelButtonOutputValue(button = {}, value = 0, options = {}) {
    const mapping = button?.midiMapping;

    if (!mapping) {
      return false;
    }

    const output = syncMidiIndicatorOutputCache(options?.output);

    if (!output) {
      return false;
    }

    const channelNumber = Math.max(
      0,
      Math.min(15, Number(mapping.channel) || 0)
    );
    const midiValue = clampMidiOutputValue(value);
    const cacheKey = getMidiIndicatorCacheKey(button);
    let sent = false;

    if (
      mapping.type === 'control_change' &&
      Number.isInteger(Number(mapping.control))
    ) {
      sent = sendMidiOutputMessageToPort(output, [
        MIDI_STATUS.controlChange | channelNumber,
        Number(mapping.control),
        midiValue
      ]);
    }

    if (
      !sent &&
      mapping.type === 'note' &&
      Number.isInteger(Number(mapping.note))
    ) {
      sent = sendMidiOutputMessageToPort(output, [
        MIDI_STATUS.noteOn | channelNumber,
        Number(mapping.note),
        midiValue
      ]);
    }

    if (sent && options?.trackCache !== false && cacheKey) {
      midiIndicatorOutputCache.values.set(cacheKey, midiValue);
    }

    return sent;
  }

  function getChannelButtonEntries() {
    return (window.getChannelsState?.() || []).flatMap((channel) =>
      Array.isArray(channel?.buttons)
        ? channel.buttons.map((button) => ({ channel, button }))
        : []
    );
  }

  function getStandaloneButtonEntries() {
    return (window.getStandaloneButtonsState?.() || []).map((button) => ({
      button
    }));
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

  function getChannelButtonIndicatorBehaviors() {
    return (
      window.CHANNEL_BUTTON_INDICATOR_BEHAVIORS || {
        actionState: 'action-state',
        peakMeter: 'peak-meter',
        targetActivity: 'target-activity'
      }
    );
  }

  function getChannelButtonIndicatorMidiValue(button = {}, state = {}) {
    if (button?.indicatorEnabled === false) {
      return 0;
    }

    const indicatorBehaviors = getChannelButtonIndicatorBehaviors();
    const indicatorBehavior = Object.values(indicatorBehaviors).includes(
      button?.indicatorBehavior
    )
      ? button.indicatorBehavior
      : Object.values(indicatorBehaviors).includes(state?.indicatorBehavior)
        ? state.indicatorBehavior
        : indicatorBehaviors.actionState;

    if (indicatorBehavior === indicatorBehaviors.peakMeter) {
      return Math.max(
        0,
        Math.min(127, Math.round((Number(state?.meterLevel) || 0) * 127))
      );
    }

    if (
      indicatorBehavior === indicatorBehaviors.actionState ||
      indicatorBehavior === indicatorBehaviors.targetActivity
    ) {
      return Boolean(state?.indicatorActive) || Boolean(state?.visualActive)
        ? 127
        : 0;
    }

    const interactionModes = getChannelButtonInteractionModes();
    const indicatorMode = Object.values(interactionModes).includes(
      button?.indicatorMode
    )
      ? button.indicatorMode
      : interactionModes.trigger;

    if (
      indicatorMode === interactionModes.push ||
      indicatorMode === interactionModes.trigger
    ) {
      return Boolean(state?.pressed || state?.flashActive) ? 127 : 0;
    }

    return Boolean(state?.indicatorActive) || Boolean(state?.visualActive)
      ? 127
      : 0;
  }

  function syncChannelButtonIndicators(meta = {}) {
    if (
      !runtimeState.supported ||
      !runtimeState.accessReady ||
      !midiAccess ||
      isMidiDisabledSelection()
    ) {
      return false;
    }

    const output = getSelectedMidiOutputPort();

    if (!output) {
      return false;
    }

    openMidiPort(output);
    syncMidiIndicatorOutputCache(output);

    const seenKeys = new Set();
    let hasSent = false;

    getChannelButtonEntries().forEach(({ channel, button }) => {
      const mapping = button?.midiMapping;

      if (!mapping || typeof window.getChannelButtonState !== 'function') {
        return;
      }

      const state = window.getChannelButtonState(channel.id, button.id);
      const value = getChannelButtonIndicatorMidiValue(button, state);
      const cacheKey = getMidiIndicatorCacheKey(button);

      if (!cacheKey) {
        return;
      }

      seenKeys.add(cacheKey);

      if (
        midiIndicatorOutputCache.values.get(cacheKey) ===
        clampMidiOutputValue(value)
      ) {
        return;
      }

      hasSent =
        sendChannelButtonOutputValue(button, value, { output }) || hasSent;
    });

    getStandaloneButtonEntries().forEach(({ button }) => {
      const mapping = button?.midiMapping;

      if (!mapping || typeof window.getStandaloneButtonState !== 'function') {
        return;
      }

      const state = window.getStandaloneButtonState(button.id);
      const value = getChannelButtonIndicatorMidiValue(button, state);
      const cacheKey = getMidiIndicatorCacheKey(button);

      if (!cacheKey) {
        return;
      }

      seenKeys.add(cacheKey);

      if (
        midiIndicatorOutputCache.values.get(cacheKey) ===
        clampMidiOutputValue(value)
      ) {
        return;
      }

      hasSent =
        sendChannelButtonOutputValue(button, value, { output }) || hasSent;
    });

    [...midiIndicatorOutputCache.values.keys()].forEach((cacheKey) => {
      if (seenKeys.has(cacheKey)) {
        return;
      }

      if (sendMidiIndicatorValueByCacheKey(cacheKey, 0, output)) {
        hasSent = true;
      }

      midiIndicatorOutputCache.values.delete(cacheKey);
    });

    return hasSent;
  }

  function flashChannelButtonBindingFeedback(channelId, buttonId, meta = {}) {
    const channel = (window.getChannelsState?.() || []).find(
      (item) => item.id === channelId
    );
    const button =
      channel?.buttons?.find((item) => item.id === buttonId) || null;

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

  function flashStandaloneButtonBindingFeedback(buttonId, meta = {}) {
    const button =
      (window.getStandaloneButtonsState?.() || []).find(
        (item) => item.id === buttonId
      ) || null;

    window.flashStandaloneButtonBindingRuntime?.(buttonId);

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
        reason: 'standalone-button-bind-flash-finish',
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

    if (
      matchedInput &&
      !isMidiDisabledSelection() &&
      matchedInput.name !== selectedInputName
    ) {
      selectMidiInput(selectedInputId, matchedInput.name, {
        source: 'midi-input-reconcile'
      });
      return;
    }

    if (
      !matchedInput &&
      selectedInputName &&
      !isMidiDisabledSelection() &&
      runtimeState.accessReady
    ) {
      const matchedByName = inputs.find(
        (input) => input.name === selectedInputName
      );

      if (matchedByName) {
        selectMidiInput(matchedByName.id, matchedByName.name, {
          source: 'midi-input-reconcile',
          reason: 'name-match'
        });
      }

      return;
    }

    if (
      selectedInputId &&
      !isMidiDisabledSelection() &&
      !matchedInput &&
      runtimeState.accessReady
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
      console.warn(
        'WebMIDI sysex access unavailable, fallback to standard mode',
        error
      );
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
      } else if (
        event.port?.type === 'input' &&
        event.port.state === 'disconnected'
      ) {
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
    if (
      midiStoreSyncInitialized ||
      typeof window.subscribeAppState !== 'function'
    ) {
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
    window.dispatchEvent?.(
      new CustomEvent('midi:pickup', {
        detail: {
          channelId,
          inputId: message?.inputId || '',
          timestamp: Date.now()
        }
      })
    );
  }

  function shouldPickupChannel(
    runtime,
    channelValue,
    incomingValue,
    threshold
  ) {
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
    const incomingValue = clampRuntimeVolume(
      (message.normalizedValue || 0) * 100
    );
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
    if (
      midiRuntimeResetSyncInitialized ||
      typeof window.subscribeAppState !== 'function'
    ) {
      return;
    }

    window.subscribeAppState((nextState, previousState, meta = {}) => {
      if (nextState.ui !== previousState.ui) {
        const nextSettings = nextState.ui?.settings || {};
        const previousSettings = previousState.ui?.settings || {};

        if (
          nextSettings.softTakeoverEnabled !==
            previousSettings.softTakeoverEnabled ||
          nextSettings.softTakeoverThreshold !==
            previousSettings.softTakeoverThreshold
        ) {
          resetPickupRuntime();
        }
      }

      if (nextState.midi !== previousState.midi) {
        resetPickupRuntime();
      }

      if (nextState.profile !== previousState.profile) {
        if (
          (nextState.profile?.currentName || '') !==
          (previousState.profile?.currentName || '')
        ) {
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

  function getMidiHealthRefreshIntervalMs() {
    return document.visibilityState === 'visible'
      ? MIDI_HEALTH_REFRESH_MS
      : MIDI_BACKGROUND_HEALTH_REFRESH_MS;
  }

  function syncMidiHealthRefreshTimer() {
    const nextIntervalMs = getMidiHealthRefreshIntervalMs();

    if (
      midiHealthRefreshTimerId &&
      midiHealthRefreshIntervalMs === nextIntervalMs
    ) {
      return;
    }

    if (midiHealthRefreshTimerId) {
      window.clearInterval(midiHealthRefreshTimerId);
      midiHealthRefreshTimerId = null;
    }

    midiHealthRefreshTimerId = window.setInterval(() => {
      refreshMidiInputsOnWake({ reason: 'periodic-health-refresh' });
    }, nextIntervalMs);
    midiHealthRefreshIntervalMs = nextIntervalMs;
  }

  function initMidiWakeRefresh() {
    if (midiWakeRefreshInitialized) {
      return;
    }

    window.addEventListener('focus', () => {
      refreshMidiInputsOnWake({ reason: 'window-focus' });
    });

    document.addEventListener('visibilitychange', () => {
      syncMidiHealthRefreshTimer();

      if (document.visibilityState !== 'visible') {
        return;
      }

      refreshMidiInputsOnWake({ reason: 'document-visible' });
    });

    syncMidiHealthRefreshTimer();
    midiWakeRefreshInitialized = true;
  }

  function initMidiButtonIndicatorSync() {
    if (
      midiButtonIndicatorSyncInitialized ||
      typeof window.subscribeAppState !== 'function'
    ) {
      return;
    }

    window.subscribeAppState((nextState, previousState) => {
      if (
        nextState.channels !== previousState.channels ||
        nextState.standaloneButtons !== previousState.standaloneButtons ||
        nextState.midi !== previousState.midi
      ) {
        scheduleChannelButtonIndicatorSync({
          type: 'channel-button-indicator-sync'
        });
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
      channel: status & 0x0f,
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

  function buildControlChange14BitMessage(
    baseMessage,
    control,
    msbValue,
    lsbValue
  ) {
    const rawValue = ((msbValue & 0x7f) << 7) | (lsbValue & 0x7f);

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
    const rawValue =
      ((baseMessage.data2 & 0x7f) << 7) | (baseMessage.data1 & 0x7f);

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
      ? ((parameterState.valueMsb & 0x7f) << 7) |
        (parameterState.valueLsb & 0x7f)
      : parameterState.valueMsb & 0x7f;
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
          buildControlChange14BitMessage(
            baseMessage,
            control,
            msbValue,
            state.ccLsbValues[control]
          )
        );
        return;
      }

      emitMidiMessage(
        buildControlChangeMessage(baseMessage, control, msbValue)
      );
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
    return (
      Number.isInteger(parameterState.parameterMsb) &&
      Number.isInteger(parameterState.parameterLsb) &&
      !(
        parameterState.parameterMsb === 127 &&
        parameterState.parameterLsb === 127
      )
    );
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
    return hasActiveParameterSelection(parameterState) ? parameterState : null;
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
          buildParameterMessage(
            baseMessage,
            state.activeParameterType,
            parameterState
          )
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

      return [
        buildParameterMessage(
          baseMessage,
          state.activeParameterType,
          parameterState
        )
      ];
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
      const parameterMessages = handleParameterDataEntry(
        state,
        baseMessage,
        control,
        value
      );

      if (parameterMessages) {
        return parameterMessages;
      }
    }

    if (control >= 0 && control < MIDI_CONTROL_LSB_OFFSET) {
      state.ccMsbValues[control] = value;
      scheduleControlChangeMessage(state, baseMessage, control);
      return [];
    }

    if (
      control >= MIDI_CONTROL_LSB_OFFSET &&
      control < MIDI_CONTROL_LSB_OFFSET * 2
    ) {
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
    const typeNibble = baseMessage.status & 0xf0;

    if (typeNibble === MIDI_STATUS.noteOn) {
      if (baseMessage.data2 === 0) {
        return [
          {
            ...baseMessage,
            type: 'note_off',
            note: baseMessage.data1,
            velocity: 0
          }
        ];
      }

      return [
        {
          ...baseMessage,
          type: 'note_on',
          note: baseMessage.data1,
          velocity: baseMessage.data2
        }
      ];
    }

    if (typeNibble === MIDI_STATUS.noteOff) {
      return [
        {
          ...baseMessage,
          type: 'note_off',
          note: baseMessage.data1,
          velocity: baseMessage.data2
        }
      ];
    }

    if (typeNibble === MIDI_STATUS.controlChange) {
      return handleControlChangeMessage(
        baseMessage,
        baseMessage.data1,
        baseMessage.data2
      );
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
      return (
        (messageType === 'control_change' ||
          messageType === 'control_change_14bit') &&
        mapping.control === message.control
      );
    }

    if (
      mappingType === 'control_change_14bit' &&
      messageType === 'control_change_14bit'
    ) {
      return (
        mapping.control === message.control &&
        (mapping.controlLsb ?? mapping.control + MIDI_CONTROL_LSB_OFFSET) ===
          message.controlLsb
      );
    }

    if (
      mappingType === 'control_change_14bit' &&
      messageType === 'control_change'
    ) {
      return mapping.control === message.control;
    }

    if (
      (mappingType === 'nrpn' || mappingType === 'rpn') &&
      mappingType === messageType
    ) {
      return (
        mapping.parameterMsb === message.parameterMsb &&
        mapping.parameterLsb === message.parameterLsb
      );
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

    if (
      leftType !== rightType ||
      (left.channel ?? 0) !== (right.channel ?? 0)
    ) {
      return false;
    }

    if (leftType === 'control_change') {
      return left.control === right.control;
    }

    if (leftType === 'control_change_14bit') {
      return (
        left.control === right.control &&
        (left.controlLsb ?? left.control + MIDI_CONTROL_LSB_OFFSET) ===
          (right.controlLsb ?? right.control + MIDI_CONTROL_LSB_OFFSET)
      );
    }

    if (leftType === 'nrpn' || leftType === 'rpn') {
      return (
        left.parameterMsb === right.parameterMsb &&
        left.parameterLsb === right.parameterLsb
      );
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

    if (
      leftType !== rightType ||
      (left.channel ?? 0) !== (right.channel ?? 0)
    ) {
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
      return (
        (message.type === 'control_change' ||
          message.type === 'control_change_14bit') &&
        Number(mapping.control) === Number(message.control)
      );
    }

    return (
      (message.type === 'note_on' || message.type === 'note_off') &&
      Number(mapping.note) === Number(message.note)
    );
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

  function getStandaloneButtonTriggerKey(buttonId) {
    return `standalone:${buttonId}`;
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
      const interactionModes = getChannelButtonInteractionModes();
      const actionMode = Object.values(interactionModes).includes(
        button?.actionMode
      )
        ? button.actionMode
        : interactionModes.trigger;
      const indicatorMode = Object.values(interactionModes).includes(
        button?.indicatorMode
      )
        ? button.indicatorMode
        : interactionModes.trigger;

      if (isButtonPressMessage(message)) {
        if (wasPressed) {
          return;
        }

        buttonTriggerRuntimeState.set(triggerKey, true);

        if (
          button?.indicatorEnabled !== false &&
          indicatorMode === interactionModes.push
        ) {
          window.setChannelButtonPressedRuntime?.(channel.id, button.id, true);
        }

        window.channelActions?.executeChannelButton?.(channel.id, button.id, {
          source: 'midi-runtime',
          type: 'channels/button-toggle',
          phase: 'press'
        });
        return;
      }

      if (isButtonReleaseMessage(message)) {
        buttonTriggerRuntimeState.set(triggerKey, false);

        if (
          button?.indicatorEnabled !== false &&
          indicatorMode === interactionModes.push
        ) {
          window.setChannelButtonPressedRuntime?.(channel.id, button.id, false);
        }

        if (actionMode === interactionModes.push) {
          window.channelActions?.executeChannelButton?.(channel.id, button.id, {
            source: 'midi-runtime',
            type: 'channels/button-toggle',
            phase: 'release'
          });
        }
      }
    });

    getStandaloneButtonEntries().forEach(({ button }) => {
      if (!isButtonMappingMatch(button?.midiMapping, message)) {
        return;
      }

      const triggerKey = getStandaloneButtonTriggerKey(button.id);
      const wasPressed = Boolean(buttonTriggerRuntimeState.get(triggerKey));
      const interactionModes = getChannelButtonInteractionModes();
      const actionMode = Object.values(interactionModes).includes(
        button?.actionMode
      )
        ? button.actionMode
        : interactionModes.trigger;
      const indicatorMode = Object.values(interactionModes).includes(
        button?.indicatorMode
      )
        ? button.indicatorMode
        : interactionModes.trigger;

      if (isButtonPressMessage(message)) {
        if (wasPressed) {
          return;
        }

        buttonTriggerRuntimeState.set(triggerKey, true);

        if (
          button?.indicatorEnabled !== false &&
          indicatorMode === interactionModes.push
        ) {
          window.setStandaloneButtonPressedRuntime?.(button.id, true);
        }

        window.standaloneButtonActions?.executeStandaloneButton?.(button.id, {
          source: 'midi-runtime',
          type: 'standalone-buttons/toggle',
          phase: 'press'
        });
        return;
      }

      if (isButtonReleaseMessage(message)) {
        buttonTriggerRuntimeState.set(triggerKey, false);

        if (
          button?.indicatorEnabled !== false &&
          indicatorMode === interactionModes.push
        ) {
          window.setStandaloneButtonPressedRuntime?.(button.id, false);
        }

        if (actionMode === interactionModes.push) {
          window.standaloneButtonActions?.executeStandaloneButton?.(button.id, {
            source: 'midi-runtime',
            type: 'standalone-buttons/toggle',
            phase: 'release'
          });
        }
      }
    });
  }

  function isSelectedMidiMessage(message) {
    return (
      Boolean(getSelectedMidiInputId()) &&
      !isMidiDisabledSelection() &&
      message?.inputId === getSelectedMidiInputId()
    );
  }

  // MIDI fader controllers commonly stream CC at 60–500 Hz. Forwarding every
  // single message through setChannelVolume → setAppState → subscribers →
  // queueChannelVolumePush → emitChannelVolumeHud (IPC) creates noticeable jank
  // and saturates the volume HUD IPC, which can starve the HUD show timer.
  // Coalesce per-channel updates onto a single requestAnimationFrame tick so
  // the heavy work runs at most ~60 Hz while the latest volume value is always
  // preserved.
  const pendingMidiFaderVolumes = new Map();
  let pendingMidiFaderFrameId = null;

  function flushPendingMidiFaderVolumes() {
    pendingMidiFaderFrameId = null;

    if (pendingMidiFaderVolumes.size === 0) {
      return;
    }

    const entries = Array.from(pendingMidiFaderVolumes.entries());
    pendingMidiFaderVolumes.clear();

    entries.forEach(([channelId, volume]) => {
      if (typeof window.applyChannelVolumeRuntime === 'function') {
        window.applyChannelVolumeRuntime(channelId, volume, {
          source: 'midi-runtime',
          type: 'channels/set-volume'
        });
        return;
      }

      window.setChannelVolumeState?.(channelId, volume, {
        source: 'midi-runtime',
        type: 'channels/set-volume'
      });
    });
  }

  function scheduleMidiFaderFlush() {
    if (pendingMidiFaderFrameId !== null) {
      return;
    }

    if (typeof window.requestAnimationFrame === 'function') {
      pendingMidiFaderFrameId = window.requestAnimationFrame(
        flushPendingMidiFaderVolumes
      );
      return;
    }

    pendingMidiFaderFrameId = window.setTimeout(
      flushPendingMidiFaderVolumes,
      16
    );
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

        pendingMidiFaderVolumes.set(channel.id, resolvedVolume.volume);
        scheduleMidiFaderFlush();
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
      if (
        !isFaderMidiMessage(message) ||
        learnedMessage ||
        !isSelectedMidiMessage(message)
      ) {
        return;
      }

      learnedMessage = buildFaderMapping(message);
    });

    for (
      let attempt = 0;
      attempt < MIDI_FADER_LEARN_TIMEOUT_MS / 100 && !learnedMessage;
      attempt += 1
    ) {
      await wait(100);
    }

    removeListener();
    return learnedMessage;
  }

  async function learnButtonMapping() {
    let learnedMessage = null;
    const removeListener = addMidiMessageListener((message) => {
      if (
        learnedMessage ||
        !isSelectedMidiMessage(message) ||
        !isButtonMidiMessage(message) ||
        isButtonReleaseMessage(message)
      ) {
        return;
      }

      learnedMessage = buildButtonMapping(message);
    });

    for (
      let attempt = 0;
      attempt < MIDI_FADER_LEARN_TIMEOUT_MS / 100 && !learnedMessage;
      attempt += 1
    ) {
      await wait(100);
    }

    removeListener();
    return learnedMessage;
  }

  function findFaderMappingConflict(channelId, mapping) {
    return (
      (window.getChannelsState?.() || []).find(
        (channel) =>
          channel.id !== channelId &&
          isSameFaderMapping(channel.faderMapping, mapping)
      ) || null
    );
  }

  function findButtonMappingConflict(
    channelId,
    buttonId,
    mapping,
    options = {}
  ) {
    const channels = window.getChannelsState?.() || [];
    const standalone = Boolean(options?.standalone);
    const controlConflict =
      mapping?.type === 'control_change'
        ? channels.find(
            (channel) =>
              channel.id !== channelId &&
              channel?.faderMapping &&
              (normalizeMappingType(channel.faderMapping.type) ===
                'control_change' ||
                normalizeMappingType(channel.faderMapping.type) ===
                  'control_change_14bit') &&
              Number(channel.faderMapping.channel ?? 0) ===
                Number(mapping.channel ?? 0) &&
              Number(channel.faderMapping.control) === Number(mapping.control)
          )
        : null;

    if (controlConflict) {
      return controlConflict;
    }

    for (const channel of channels) {
      const buttonConflict = (
        Array.isArray(channel?.buttons) ? channel.buttons : []
      ).find(
        (button) =>
          !(channel.id === channelId && button.id === buttonId) &&
          isSameButtonMapping(button?.midiMapping, mapping)
      );

      if (buttonConflict) {
        return buttonConflict;
      }
    }

    const standaloneConflict = (
      window.getStandaloneButtonsState?.() || []
    ).find(
      (button) =>
        !(standalone && button.id === buttonId) &&
        isSameButtonMapping(button?.midiMapping, mapping)
    );

    if (standaloneConflict) {
      return standaloneConflict;
    }

    return null;
  }

  function applyChannelFaderMapping(channelId, mapping, meta = {}) {
    resetPickupRuntime(channelId);
    return (
      window.setChannelFaderMappingState?.(channelId, mapping, {
        source: 'midi-service',
        ...meta
      }) || null
    );
  }

  function applyChannelButtonMapping(channelId, buttonId, mapping, meta = {}) {
    const updatedButton =
      window.channelActions?.updateChannelButton?.(
        channelId,
        buttonId,
        {
          midiMapping: mapping
            ? {
                type:
                  mapping.type === 'control_change' ? 'control_change' : 'note',
                channel: Number(mapping.channel) || 0,
                note: Number.isInteger(Number(mapping.note))
                  ? Number(mapping.note)
                  : null,
                control: Number.isInteger(Number(mapping.control))
                  ? Number(mapping.control)
                  : null
              }
            : null
        },
        {
          source: 'midi-service',
          ...meta
        }
      ) || null;

    scheduleChannelButtonIndicatorSync({ type: 'button-mapping-update' });
    return updatedButton;
  }

  function applyStandaloneButtonMapping(buttonId, mapping, meta = {}) {
    const updatedButton =
      window.standaloneButtonActions?.updateStandaloneButton?.(
        buttonId,
        {
          midiMapping: mapping
            ? {
                type:
                  mapping.type === 'control_change' ? 'control_change' : 'note',
                channel: Number(mapping.channel) || 0,
                note: Number.isInteger(Number(mapping.note))
                  ? Number(mapping.note)
                  : null,
                control: Number.isInteger(Number(mapping.control))
                  ? Number(mapping.control)
                  : null
              }
            : null
        },
        {
          source: 'midi-service',
          ...meta
        }
      ) || null;

    scheduleChannelButtonIndicatorSync({
      type: 'standalone-button-mapping-update'
    });
    return updatedButton;
  }

  window.midiService = {
    init: initMidiService,
    ensureAccess: ensureMidiAccess,
    scanInputs: scanMidiInputs,
    selectInput: selectMidiInput,
    getState: getMidiServiceState,
    getInputs: getMidiInputs,
    getOutputs: getMidiOutputs,
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
    applyStandaloneButtonMapping,
    getButtonMappingLabel,
    syncChannelButtonIndicators,
    flashChannelButtonBindingFeedback,
    flashStandaloneButtonBindingFeedback,
    resetPickupRuntime,
    runIndicatorTest,
    stopIndicatorTest
  };

  Object.defineProperty(window, 'indicatorstest', {
    configurable: true,
    writable: false,
    enumerable: false,
    value(durationSeconds = 5) {
      return runIndicatorTest(durationSeconds);
    }
  });
})(window);
