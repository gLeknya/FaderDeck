let midiUiStateSyncInitialized = false;

function getMidiService() {
  return window.midiService || null;
}

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

function getSelectedMidiState() {
  return typeof getMidiSelectionState === 'function'
    ? getMidiSelectionState()
    : { selectedInputId: '', selectedInputName: '' };
}

function getSelectedMidiInputId() {
  return getSelectedMidiState().selectedInputId || '';
}

function getSelectedMidiInputName() {
  return getSelectedMidiState().selectedInputName || '';
}

function isMidiDisabledSelection() {
  return getMidiService()?.isDisabledSelection?.() || false;
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

function getMidiRuntimeInputs() {
  return getMidiService()?.getInputs?.() || [];
}

function updateMidiStatusText(inputs = getMidiRuntimeInputs()) {
  if (isMidiDisabledSelection()) {
    updateMidiStatus(false, t('status.disabled'));
    return;
  }

  updateMidiStatus(
    inputs.length > 0,
    inputs.length > 0
      ? t('status.devices', { count: inputs.length })
      : t('status.notConnected')
  );
}

function buildMidiOptions(inputs) {
  const selectedMidiInputId = getSelectedMidiInputId();
  const selectedMidiInputName = getSelectedMidiInputName();
  const items = Array.isArray(inputs)
    ? inputs.map((input) => ({ id: input.id, name: input.name || input.id }))
    : [];

  if (
    selectedMidiInputId &&
    !isMidiDisabledSelection() &&
    selectedMidiInputName &&
    !items.some((input) => input.id === selectedMidiInputId)
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

  const midiService = getMidiService();
  const serviceState = midiService?.getState?.() || {
    supported: false,
    scanning: false,
    inputs: []
  };
  const selectedMidiInputId = getSelectedMidiInputId();
  const optionItems = buildMidiOptions(serviceState.inputs);
  const disabledOptionValue =
    midiService?.getDisabledOptionValue?.() || '__disabled__';
  const selectedValue = isMidiDisabledSelection()
    ? disabledOptionValue
    : optionItems.some((input) => input.id === selectedMidiInputId)
      ? selectedMidiInputId
      : '';

  select.innerHTML = `
    <option value="">${t('toolbar.selectMidi')}</option>
    <option value="${disabledOptionValue}" data-style-variant="danger">${t('toolbar.disableMidi')}</option>
    ${optionItems.map((input) => `<option value="${input.id}">${input.name}</option>`).join('')}
  `;
  select.value = selectedValue;

  if (!serviceState.supported) {
    select.setAttribute('disabled', 'true');
  } else {
    select.removeAttribute('disabled');
  }

  setMidiSelectLoadingState(Boolean(serviceState.scanning));
  updateMidiStatusText(serviceState.inputs);
}

function syncMidiUiFromService() {
  populateMidiInputs();
}

function refreshMidiUiLanguage() {
  syncMidiUiFromService();
}

async function handleMidiSelectOpen() {
  if (!window.midiActions?.scanMidiInputs) {
    return;
  }

  try {
    await window.midiActions.scanMidiInputs({ source: 'midi-ui' });
  } catch (error) {
    if (error?.code === 'midi_unsupported') {
      updateMidiStatus(false, t('status.unsupported'));
      showToast('error', t('midi.unsupported'));
      return;
    }

    console.error('WebMIDI error', error);
    updateMidiStatus(false, t('status.connectionFailed'));
    showToast('error', t('midi.initFailed'));
  }
}

function handleMidiSelectChange(event) {
  const midiService = getMidiService();
  const nextValue = event.target.value || '';
  const selectedOption = event.target.options[event.target.selectedIndex];
  const disabledOptionValue =
    midiService?.getDisabledOptionValue?.() || '__disabled__';

  if (nextValue === disabledOptionValue) {
    window.midiActions?.disableMidiInputSelection?.({ source: 'midi-ui' });
  } else {
    window.midiActions?.selectMidiInput?.(
      nextValue,
      selectedOption?.textContent?.trim() || '',
      { source: 'midi-ui' }
    );
  }

  syncMidiUiFromService();
}

function initMidiUiStateSync() {
  if (midiUiStateSyncInitialized) {
    return;
  }

  getMidiService()?.subscribe?.(() => {
    syncMidiUiFromService();
  });

  if (typeof subscribeAppState === 'function') {
    subscribeAppState((nextState, previousState) => {
      if (nextState.midi === previousState.midi) {
        return;
      }

      syncMidiUiFromService();
    });
  }

  midiUiStateSyncInitialized = true;
}

function initWebMIDI() {
  const midiService = getMidiService();

  midiService?.init?.();
  initMidiUiStateSync();
  syncMidiUiFromService();

  const select = getMidiSelect();
  select?.addEventListener('custom-select:will-open', handleMidiSelectOpen);
  select?.addEventListener('change', handleMidiSelectChange);

  if (!midiService?.getState?.().supported) {
    updateMidiStatus(false, t('status.unsupported'));
  }
}

async function startBindFader(event, channelId) {
  event.stopPropagation();
  await window.midiActions?.learnChannelFaderMapping?.(channelId, {
    source: 'midi-ui'
  });
}

async function remapChannelFader(channelId) {
  await startBindFader({ stopPropagation() {} }, channelId);
}
