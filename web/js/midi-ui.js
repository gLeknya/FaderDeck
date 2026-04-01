let midiAccess = null;
let midiInputCount = 0;
let midiScanPromise = null;
let selectedMidiInputId = localStorage.getItem('faderdeck_selected_midi_input_id') || '';
let selectedMidiInputName = localStorage.getItem('faderdeck_selected_midi_input_name') || '';

const MIDI_FADER_LEARN_TIMEOUT_MS = 8000;
const MIDI_HIGH_RES_COMBINE_DELAY_MS = 12;
const MIDI_CONTROL_LSB_OFFSET = 32;
const MIDI_MESSAGE_LISTENERS = new Set();
const midiParserStates = new Map();
const MIDI_DISABLED_OPTION_VALUE = '__disabled__';

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

function updateMidiStatus(isConnected, text) {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  statusDot?.classList.toggle('connected', isConnected);

  if (statusText) {
    statusText.textContent = text;
  }
}

function getMidiSelect() {
  return document.getElementById('midiInput');
}

function isMidiDisabledSelection() {
  return selectedMidiInputId === MIDI_DISABLED_OPTION_VALUE;
}

function persistMidiSelection() {
  if (selectedMidiInputId) {
    localStorage.setItem('faderdeck_selected_midi_input_id', selectedMidiInputId);
  } else {
    localStorage.removeItem('faderdeck_selected_midi_input_id');
  }

  if (selectedMidiInputName) {
    localStorage.setItem('faderdeck_selected_midi_input_name', selectedMidiInputName);
  } else {
    localStorage.removeItem('faderdeck_selected_midi_input_name');
  }
}

function getCurrentMidiSelectionSettings() {
  return {
    midiInputId: selectedMidiInputId || null,
    midiInputName: selectedMidiInputName || ''
  };
}

function setMidiSelection(nextId = '', nextName = '') {
  selectedMidiInputId = nextId || '';
  selectedMidiInputName = (
    selectedMidiInputId
    && selectedMidiInputId !== MIDI_DISABLED_OPTION_VALUE
  ) ? (nextName || selectedMidiInputName || selectedMidiInputId) : '';
  persistMidiSelection();
}

function applySavedMidiInputSelection(nextId = '', nextName = '') {
  setMidiSelection(nextId, nextName);
  populateMidiInputs();
}

function setMidiSelectLoadingState(isLoading) {
  const select = getMidiSelect();

  if (!select) {
    return;
  }

  if (isLoading) {
    select.dataset.dropdownStatusLabel = t('toolbar.scanningMidi');
    select.dataset.dropdownLoading = 'true';
  } else {
    delete select.dataset.dropdownStatusLabel;
    delete select.dataset.dropdownLoading;
  }

  enhanceCustomSelects?.(select);
}

function updateMidiStatusText(inputs = []) {
  if (isMidiDisabledSelection()) {
    updateMidiStatus(false, t('status.disabled'));
    return;
  }

  updateMidiStatus(
    inputs.length > 0,
    inputs.length > 0 ? t('status.devices', { count: inputs.length }) : t('status.notConnected')
  );
}

function buildMidiOptions(inputs) {
  const items = Array.isArray(inputs)
    ? inputs.map((input) => ({ id: input.id, name: input.name || input.id }))
    : [];

  if (
    selectedMidiInputId
    && !isMidiDisabledSelection()
    && selectedMidiInputName
    && !items.some((input) => input.id === selectedMidiInputId)
  ) {
    items.unshift({
      id: selectedMidiInputId,
      name: selectedMidiInputName
    });
  }

  return items;
}

function populateMidiInputs() {
  const select = getMidiSelect();

  if (!select) {
    return;
  }

  const inputs = midiAccess ? Array.from(midiAccess.inputs.values()) : [];
  const optionItems = buildMidiOptions(inputs);
  const matchedSelectedInput = optionItems.find((input) => input.id === selectedMidiInputId);
  midiInputCount = inputs.length;

  if (matchedSelectedInput && !isMidiDisabledSelection()) {
    selectedMidiInputName = matchedSelectedInput.name;
    persistMidiSelection();
  }

  if (
    selectedMidiInputId
    && !isMidiDisabledSelection()
    && !matchedSelectedInput
    && midiAccess
  ) {
    setMidiSelection('', '');
  }

  const selectedValue = isMidiDisabledSelection()
    ? MIDI_DISABLED_OPTION_VALUE
    : (optionItems.some((input) => input.id === selectedMidiInputId) ? selectedMidiInputId : '');

  select.innerHTML = `
    <option value="">${t('toolbar.selectMidi')}</option>
    <option value="${MIDI_DISABLED_OPTION_VALUE}" data-style-variant="danger">${t('toolbar.disableMidi')}</option>
    ${optionItems.map((input) => `<option value="${input.id}">${input.name}</option>`).join('')}
  `;
  select.value = selectedValue;
  enhanceCustomSelects?.(select);
  updateMidiStatusText(inputs);
}

function refreshMidiUiLanguage() {
  populateMidiInputs();

  if (getMidiSelect()?.dataset.dropdownLoading === 'true') {
    setMidiSelectLoadingState(true);
  }
}

function bindMidiInput(port) {
  if (port?.type === 'input') {
    port.onmidimessage = onWebMidiMessage;
  }
}

async function requestMidiAccess() {
  try {
    return await navigator.requestMIDIAccess({ sysex: true });
  } catch (error) {
    console.warn('WebMIDI sysex access unavailable, fallback to standard mode', error);
    return navigator.requestMIDIAccess();
  }
}

async function scanMidiInputs() {
  if (!navigator.requestMIDIAccess) {
    updateMidiStatus(false, t('status.unsupported'));
    showToast('error', t('midi.unsupported'));
    return;
  }

  if (midiScanPromise) {
    return midiScanPromise;
  }

  setMidiSelectLoadingState(true);
  midiScanPromise = (async () => {
    try {
      if (!midiAccess) {
        midiAccess = await requestMidiAccess();
        midiAccess.onstatechange = (event) => {
          if (event.port.type === 'input' && event.port.state === 'connected') {
            bindMidiInput(event.port);
          }

          populateMidiInputs();
        };
      }

      midiAccess.inputs.forEach((input) => {
        bindMidiInput(input);
      });
      populateMidiInputs();
    } catch (error) {
      console.error('WebMIDI error', error);
      updateMidiStatus(false, t('status.connectionFailed'));
      showToast('error', t('midi.initFailed'));
    } finally {
      setMidiSelectLoadingState(false);
      midiScanPromise = null;
    }
  })();

  return midiScanPromise;
}

function handleMidiSelectOpen() {
  scanMidiInputs();
}

function handleMidiSelectChange(event) {
  const nextValue = event.target.value || '';
  const selectedOption = event.target.options[event.target.selectedIndex];

  if (nextValue === MIDI_DISABLED_OPTION_VALUE) {
    setMidiSelection(MIDI_DISABLED_OPTION_VALUE, '');
  } else {
    setMidiSelection(nextValue, selectedOption?.textContent?.trim() || '');
  }

  populateMidiInputs();
  saveProfileToLocal?.();
}

function isSelectedMidiMessage(message) {
  return Boolean(selectedMidiInputId)
    && !isMidiDisabledSelection()
    && message?.inputId === selectedMidiInputId;
}

function initWebMIDI() {
  if (!navigator.requestMIDIAccess) {
    updateMidiStatus(false, t('status.unsupported'));
    getMidiSelect()?.setAttribute('disabled', 'true');
    populateMidiInputs();
    return;
  }

  const select = getMidiSelect();
  populateMidiInputs();
  select?.addEventListener('custom-select:will-open', handleMidiSelectOpen);
  select?.addEventListener('change', handleMidiSelectChange);
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

function addMidiMessageListener(listener) {
  MIDI_MESSAGE_LISTENERS.add(listener);

  return () => {
    MIDI_MESSAGE_LISTENERS.delete(listener);
  };
}

function emitMidiMessage(message) {
  if (!message) {
    return;
  }

  if (typeof window.__onMidiFromPython === 'function') {
    window.__onMidiFromPython(message);
  }

  MIDI_MESSAGE_LISTENERS.forEach((listener) => {
    listener(message);
  });
}

function clearPendingCcTimer(state, control) {
  const timerId = state.pendingCcTimers.get(control);

  if (timerId) {
    clearTimeout(timerId);
    state.pendingCcTimers.delete(control);
  }
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

window.__onMidiFromPython = function handleMidiMessage(message) {
  if (!isFaderMidiMessage(message) || !isSelectedMidiMessage(message)) {
    return;
  }

  channels.forEach((channel) => {
    if (!isMidiMappingMatch(channel.faderMapping, message)) {
      return;
    }

    applyVolumeToChannel(channel.id, (message.normalizedValue || 0) * 100);
  });
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function learnFaderMessage() {
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

async function startBindFader(event, channelId) {
  event.stopPropagation();

  const channel = findChannel(channelId);

  if (!channel) {
    return;
  }

  showToast('pending', t('midi.moveFader', { name: channel.title || channel.appName }));

  if (!selectedMidiInputId || isMidiDisabledSelection()) {
    showToast('error', t('midi.selectDeviceFirst'), { updatePending: true });
    return;
  }

  if (!midiAccess) {
    await scanMidiInputs();
  }

  if (!midiAccess) {
    showToast('error', t('midi.initFailed'), { updatePending: true });
    return;
  }

  const learned = await learnFaderMessage();

  if (!learned) {
    showToast('error', t('midi.failedToDetect'), { updatePending: true });
    logTest('startBindFader: NO LEARNED MESSAGE');
    return;
  }

  const conflict = channels.find((item) => (
    item.id !== channelId && isSameFaderMapping(item.faderMapping, learned)
  ));

  if (conflict) {
    const conflictName = conflict.title || conflict.appName;
    const confirmed = confirm(t('midi.conflict', { name: conflictName }));

    if (!confirmed) {
      showToast('warn', t('midi.bindCancelled'), { updatePending: true });
      logTest('startBindFader: USER CANCELED ON CONFLICT');
      return;
    }
  }

  channel.faderMapping = learned;
  channel.faderCC = learned.control ?? null;
  channel.showBindHint = false;
  channel.skipBinding = false;

  saveProfileToLocal();
  renderMixer();
  showToast('success', t('midi.bindSuccess'), { updatePending: true });
}

async function remapChannelFader(channelId) {
  await startBindFader({ stopPropagation() {} }, channelId);
}
