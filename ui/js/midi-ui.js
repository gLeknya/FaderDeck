let midiUiStateSyncInitialized = false;
let midiDropdown = null;

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
  if (!midiDropdown) {
    return;
  }

  if (isLoading && midiDropdown.index === -1) {
    midiDropdown.ph.textContent = t('toolbar.scanningMidi');
  }
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

function ensureMidiDropdown() {
  if (midiDropdown) {
    return midiDropdown;
  }

  const host = getMidiSelect();
  if (!host) {
    return null;
  }

  midiDropdown = new FDDropdown(host, {
    items: [],
    placeholder: t('toolbar.selectMidi'),
    direction: 'down',
    className: 'fdd-midi',
    onChange(value, detail) {
      handleMidiDropdownChange(value, detail);
    },
    onOpen() {
      handleMidiSelectOpen();
    }
  });

  host._fdd = midiDropdown;
  return midiDropdown;
}

function populateMidiInputs() {
  const dd = ensureMidiDropdown();
  if (!dd) {
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
      : null;

  const items = [
    { label: t('toolbar.disableMidi'), value: disabledOptionValue },
    ...optionItems.map((input) => ({ label: input.name, value: input.id }))
  ];

  dd.ph.textContent = t('toolbar.selectMidi');
  dd.setItems(items, {
    value: selectedValue !== null ? selectedValue : undefined,
    index: selectedValue === null ? -1 : undefined
  });

  if (!serviceState.supported) {
    dd.root.classList.add('fdd-disabled');
    dd.root.style.pointerEvents = 'none';
    dd.head.setAttribute('aria-disabled', 'true');
  } else {
    dd.root.classList.remove('fdd-disabled');
    dd.root.style.pointerEvents = '';
    dd.head.removeAttribute('aria-disabled');
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

function handleMidiDropdownChange(nextValue, detail) {
  const midiService = getMidiService();
  const disabledOptionValue =
    midiService?.getDisabledOptionValue?.() || '__disabled__';

  if (!nextValue || nextValue === disabledOptionValue) {
    window.midiActions?.disableMidiInputSelection?.({ source: 'midi-ui' });
  } else {
    window.midiActions?.selectMidiInput?.(
      nextValue,
      detail?.item?.label?.trim() || '',
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
