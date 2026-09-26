(function initMidiSelectionStorage(window) {
  const storage = window.localStorageAdapter;
  const { MIDI_SELECTION_STORAGE_KEYS, normalizeMidiSelectionState } =
    window.rendererStateModel;

  function readMidiSelection() {
    return normalizeMidiSelectionState({
      selectedInputId:
        storage?.getItem(MIDI_SELECTION_STORAGE_KEYS.id, '') || '',
      selectedInputName:
        storage?.getItem(MIDI_SELECTION_STORAGE_KEYS.name, '') || ''
    });
  }

  function writeMidiSelection(midiState = {}) {
    const nextMidiState = normalizeMidiSelectionState(midiState);

    if (nextMidiState.selectedInputId) {
      storage?.setItem(
        MIDI_SELECTION_STORAGE_KEYS.id,
        nextMidiState.selectedInputId
      );
    } else {
      storage?.removeItem(MIDI_SELECTION_STORAGE_KEYS.id);
    }

    if (nextMidiState.selectedInputName) {
      storage?.setItem(
        MIDI_SELECTION_STORAGE_KEYS.name,
        nextMidiState.selectedInputName
      );
    } else {
      storage?.removeItem(MIDI_SELECTION_STORAGE_KEYS.name);
    }

    return nextMidiState;
  }

  window.midiSelectionStorage = Object.freeze({
    readMidiSelection,
    writeMidiSelection
  });
})(window);
