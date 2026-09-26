(function initRendererStateModel(window) {
  const MIDI_SELECTION_STORAGE_KEYS = Object.freeze({
    id: 'faderdeck_selected_midi_input_id',
    name: 'faderdeck_selected_midi_input_name'
  });

  const DEFAULT_PERSISTED_UI_SETTINGS = Object.freeze({
    advancedMode: false,
    developerMode: false,
    faderInterpolationEnabled: false,
    softTakeoverEnabled: false,
    softTakeoverThreshold: 5,
    showFractionalNumbers: false,
    showFractionalOnlyLow: false,
    volumeCurveEnabled: false,
    volumeCurveType: 'ease-in-out',
    volumeCurveAmount: 0,
    profileToolbarSwitcherEnabled: true,
    volumeHudEnabled: true,
    volumeHudPosition: 'bottom-center',
    volumeHudOrientation: 'horizontal',
    volumeHudShowIcon: true,
    volumeHudShowTitle: true,
    volumeHudShowSubtitle: true,
    volumeHudShowPercent: true,
    volumeHudShowMeter: true,
    mediaControllerVisible: true,
    mediaControllerTargetAppId: '',
    closeToTrayEnabled: true,
    autoUpdateEnabled: true,
    installBetaVersions: false
  });

  const DEFAULT_SESSION_UI_MENU = Object.freeze({
    open: false,
    activeTab: null
  });

  const DEFAULT_SESSION_UI_STATE = Object.freeze({
    menu: DEFAULT_SESSION_UI_MENU
  });

  function normalizeMidiSelectionState(midiState = {}) {
    return {
      selectedInputId: midiState.selectedInputId || '',
      selectedInputName: midiState.selectedInputName || ''
    };
  }

  window.rendererStateModel = Object.freeze({
    MIDI_SELECTION_STORAGE_KEYS,
    DEFAULT_PERSISTED_UI_SETTINGS,
    DEFAULT_SESSION_UI_MENU,
    DEFAULT_SESSION_UI_STATE,
    normalizeMidiSelectionState
  });
})(window);
