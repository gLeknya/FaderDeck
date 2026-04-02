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
    inputs.length > 0 ? t('status.devices', { count: inputs.length }) : t('status.notConnected')
  );
}

function buildMidiOptions(inputs) {
  const selectedMidiInputId = getSelectedMidiInputId();
  const selectedMidiInputName = getSelectedMidiInputName();
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

  const midiService = getMidiService();
  const serviceState = midiService?.getState?.() || {
    supported: false,
    scanning: false,
    inputs: []
  };
  const selectedMidiInputId = getSelectedMidiInputId();
  const optionItems = buildMidiOptions(serviceState.inputs);
  const disabledOptionValue = midiService?.getDisabledOptionValue?.() || '__disabled__';
  const selectedValue = isMidiDisabledSelection()
    ? disabledOptionValue
    : (optionItems.some((input) => input.id === selectedMidiInputId) ? selectedMidiInputId : '');

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
  const midiService = getMidiService();

  if (!midiService?.scanInputs) {
    return;
  }

  try {
    await midiService.scanInputs();
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
  const disabledOptionValue = midiService?.getDisabledOptionValue?.() || '__disabled__';

  if (nextValue === disabledOptionValue) {
    midiService?.selectInput?.(disabledOptionValue, '', { source: 'midi-ui' });
  } else {
    midiService?.selectInput?.(
      nextValue,
      selectedOption?.textContent?.trim() || '',
      { source: 'midi-ui' }
    );
  }

  saveProfileToLocal?.();
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

  const channel = findChannelState?.(channelId);
  const midiService = getMidiService();

  if (!channel || !midiService) {
    return;
  }

  showToast('pending', t('midi.moveFader', { name: channel.title || channel.appName }));

  if (!midiService.getSelectedInputId?.() || midiService.isDisabledSelection?.()) {
    showToast('error', t('midi.selectDeviceFirst'), { updatePending: true });
    return;
  }

  try {
    await midiService.ensureAccess?.();
  } catch (error) {
    if (error?.code === 'midi_unsupported') {
      showToast('error', t('midi.unsupported'), { updatePending: true });
      return;
    }

    showToast('error', t('midi.initFailed'), { updatePending: true });
    return;
  }

  const learned = await midiService.learnFaderMapping?.();

  if (!learned) {
    showToast('error', t('midi.failedToDetect'), { updatePending: true });
    logTest('startBindFader: NO LEARNED MESSAGE');
    return;
  }

  const conflict = midiService.findFaderMappingConflict?.(channelId, learned);

  if (conflict) {
    const conflictName = conflict.title || conflict.appName;
    const confirmed = confirm(t('midi.conflict', { name: conflictName }));

    if (!confirmed) {
      showToast('warn', t('midi.bindCancelled'), { updatePending: true });
      logTest('startBindFader: USER CANCELED ON CONFLICT');
      return;
    }
  }

  midiService.applyChannelFaderMapping?.(channelId, learned, { source: 'midi-learn' });
  saveProfileToLocal();
  showToast('success', t('midi.bindSuccess'), { updatePending: true });
}

async function remapChannelFader(channelId) {
  await startBindFader({ stopPropagation() {} }, channelId);
}
