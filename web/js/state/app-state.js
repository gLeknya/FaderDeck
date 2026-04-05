(function initAppState(window) {
  function createDefaultChannelCustomSettings() {
    return {
      faderInterpolationEnabled: false,
      softTakeoverEnabled: false,
      softTakeoverThreshold: 5,
      volumeCurveEnabled: false,
      volumeCurveType: 'ease-in-out',
      volumeCurveAmount: 0,
      showFractionalNumbers: false
    };
  }

  function cloneButtonEntity(button = {}) {
    return {
      ...button
    };
  }

  function createChannelTarget(process = '', name = '') {
    const normalizedProcess = String(process || '').trim();

    if (!normalizedProcess) {
      return null;
    }

    return {
      process: normalizedProcess,
      name: String(name || normalizedProcess).trim() || normalizedProcess
    };
  }

  function cloneChannelTarget(target = {}) {
    return createChannelTarget(target.process, target.name);
  }

  function normalizeChannelTargets(channel = {}) {
    const explicitTargets = Array.isArray(channel.targets)
      ? channel.targets
          .map(cloneChannelTarget)
          .filter(Boolean)
      : [];

    if (explicitTargets.length > 0) {
      return explicitTargets;
    }

    const fallbackTarget = createChannelTarget(channel.app, channel.appName);
    return fallbackTarget ? [fallbackTarget] : [];
  }

  function cloneChannelCustomSettings(customSettings = {}) {
    return {
      ...createDefaultChannelCustomSettings(),
      ...(customSettings || {})
    };
  }

  function cloneChannelEntity(channel = {}) {
    const targets = normalizeChannelTargets(channel);
    const primaryTarget = targets[0] || null;

    return {
      ...channel,
      app: primaryTarget?.process || '',
      appName: primaryTarget?.name || '',
      targets,
      customSettingsEnabled: Boolean(channel.customSettingsEnabled),
      customSettings: cloneChannelCustomSettings(channel.customSettings),
      buttons: Array.isArray(channel.buttons)
        ? channel.buttons.map(cloneButtonEntity)
        : []
    };
  }

  function normalizeChannels(channels) {
    return Array.isArray(channels) ? channels.map(cloneChannelEntity) : [];
  }

  function normalizeStandaloneButtons(buttons) {
    return Array.isArray(buttons) ? buttons.map(cloneButtonEntity) : [];
  }

  function normalizeMidiState(midiState = {}) {
    return {
      selectedInputId: midiState.selectedInputId || '',
      selectedInputName: midiState.selectedInputName || ''
    };
  }

  function readInitialMidiState() {
    try {
      return normalizeMidiState({
        selectedInputId: localStorage.getItem('faderdeck_selected_midi_input_id') || '',
        selectedInputName: localStorage.getItem('faderdeck_selected_midi_input_name') || ''
      });
    } catch (error) {
      console.warn('readInitialMidiState error', error);
      return normalizeMidiState();
    }
  }

  const DEFAULT_PERSISTED_RENDERER_SETTINGS = Object.freeze({
    midiInputId: null,
    midiInputName: ''
  });

  const DEFAULT_SESSION_PROFILE_STATE = Object.freeze({
    currentName: '',
    list: [],
    preferences: {
      order: [],
      toolbarVisible: {}
    }
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
    volumeHudShowMeter: true
  });

  const DEFAULT_SESSION_UI_STATE = Object.freeze({
    menu: {
      open: false,
      activeTab: null
    }
  });

  function normalizePersistedRendererSettings(settings = {}) {
    return {
      midiInputId: settings.midiInputId || null,
      midiInputName: settings.midiInputName || ''
    };
  }

  function createEmptyPersistedRendererPayload(profileName = '') {
    return {
      meta: {
        name: profileName
      },
      channels: [],
      standaloneButtons: [],
      settings: {
        ...DEFAULT_PERSISTED_RENDERER_SETTINGS
      }
    };
  }

  function normalizePersistedRendererPayload(payload = {}) {
    const normalizedSettings = normalizePersistedRendererSettings(payload.settings);

    return {
      meta: {
        name: String(payload?.meta?.name || '').trim()
      },
      channels: normalizeChannels(payload.channels),
      standaloneButtons: normalizeStandaloneButtons(payload.standaloneButtons),
      settings: normalizedSettings
    };
  }

  function createInitialRendererState() {
    return {
      channels: [],
      standaloneButtons: [],
      // Profile slice is session/local renderer state for profile UX metadata
      // (current name, loaded list, local preferences). It is not serialized
      // into persisted renderer profile payloads.
      profile: {
        ...DEFAULT_SESSION_PROFILE_STATE,
        preferences: {
          ...DEFAULT_SESSION_PROFILE_STATE.preferences
        }
      },
      // UI settings are persisted locally by ui-store. Transient UI state stays
      // under ui.session and must never leak into profile serialization.
      ui: {
        settings: {
          ...DEFAULT_PERSISTED_UI_SETTINGS
        },
        session: {
          menu: {
            ...DEFAULT_SESSION_UI_STATE.menu
          }
        }
      },
      // Saved MIDI selection is persisted intentionally; live MIDI discovery/runtime
      // state stays in midi-service and is never serialized here.
      midi: readInitialMidiState()
    };
  }

  const initialState = createInitialRendererState();

  const store = window.createRendererStore(initialState);

  function getAppState() {
    return store.getState();
  }

  function subscribeAppState(listener) {
    return store.subscribe(listener);
  }

  function setAppState(nextStateOrUpdater, meta = {}) {
    return store.setState(nextStateOrUpdater, meta);
  }

  function getChannelsState() {
    return getAppState().channels;
  }

  function getStandaloneButtonsState() {
    return getAppState().standaloneButtons;
  }

  function findChannelState(channelId) {
    return getChannelsState().find((channel) => channel.id === channelId) ?? null;
  }

  function findStandaloneButtonState(buttonId) {
    return getStandaloneButtonsState().find((button) => button.id === buttonId) ?? null;
  }

  function getCurrentProfileState() {
    return getAppState().profile.currentName || '';
  }

  function setCurrentProfileState(profileName, meta = {}) {
    const nextProfileName = profileName || '';

    setAppState((previousState) => {
      if (previousState.profile.currentName === nextProfileName) {
        return previousState;
      }

      return {
        ...previousState,
        profile: {
          ...previousState.profile,
          currentName: nextProfileName
        }
      };
    }, {
      type: 'profile/set-current',
      profileName: nextProfileName,
      ...meta
    });

    return nextProfileName;
  }

  function getMidiSelectionState() {
    return getAppState().midi;
  }

  function setMidiSelectionState(midiState, meta = {}) {
    const nextMidiState = normalizeMidiState(midiState);

    setAppState((previousState) => {
      if (
        previousState.midi.selectedInputId === nextMidiState.selectedInputId
        && previousState.midi.selectedInputName === nextMidiState.selectedInputName
      ) {
        return previousState;
      }

      return {
        ...previousState,
        midi: nextMidiState
      };
    }, {
      type: 'midi/set-selection',
      ...meta
    });

    return nextMidiState;
  }

  function getPersistedRendererState() {
    const state = getAppState();
    const midiState = normalizeMidiState(state.midi);

    // Only persisted renderer/profile data belongs in this payload.
    // Session UI state (ui.session, profile UX metadata, modal/editor state)
    // is intentionally excluded.
    return normalizePersistedRendererPayload({
      channels: state.channels,
      standaloneButtons: state.standaloneButtons,
      settings: {
        midiInputId: midiState.selectedInputId || null,
        midiInputName: midiState.selectedInputName || ''
      }
    });
  }

  function hydrateRendererState(payload = {}, meta = {}) {
    const persistedPayload = normalizePersistedRendererPayload(payload);
    const nextMidiState = normalizeMidiState({
      selectedInputId: persistedPayload.settings.midiInputId || '',
      selectedInputName: persistedPayload.settings.midiInputName || ''
    });

    setAppState((previousState) => ({
      ...previousState,
      channels: persistedPayload.channels,
      standaloneButtons: persistedPayload.standaloneButtons,
      midi: nextMidiState
    }), {
      type: 'renderer/hydrate',
      ...meta
    });
  }

  function serializeRendererState(profileName = '') {
    const persistedPayload = getPersistedRendererState();

    return JSON.parse(JSON.stringify({
      ...persistedPayload,
      meta: {
        name: profileName
      }
    }));
  }

  function addStandaloneButtonState(button, meta = {}) {
    const nextButton = cloneButtonEntity(button);

    setAppState((previousState) => ({
      ...previousState,
      standaloneButtons: [...previousState.standaloneButtons, nextButton]
    }), {
      type: 'standalone-buttons/add',
      buttonId: nextButton.id,
      ...meta
    });

    return nextButton;
  }

  function updateStandaloneButtonState(buttonId, updater, meta = {}) {
    let updatedButton = null;

    setAppState((previousState) => {
      const buttonIndex = previousState.standaloneButtons.findIndex((button) => button.id === buttonId);

      if (buttonIndex === -1) {
        return previousState;
      }

      const currentButton = previousState.standaloneButtons[buttonIndex];
      const draftButton = cloneButtonEntity(currentButton);
      const nextButton = typeof updater === 'function'
        ? updater(draftButton) || draftButton
        : {
          ...draftButton,
          ...(updater || {})
        };

      updatedButton = cloneButtonEntity(nextButton);

      const nextButtons = previousState.standaloneButtons.slice();
      nextButtons[buttonIndex] = updatedButton;

      return {
        ...previousState,
        standaloneButtons: nextButtons
      };
    }, {
      type: 'standalone-buttons/update',
      buttonId,
      ...meta
    });

    return updatedButton;
  }

  function removeStandaloneButtonState(buttonId, meta = {}) {
    let removedButton = null;

    setAppState((previousState) => {
      const nextButtons = previousState.standaloneButtons.filter((button) => {
        const isTargetButton = button.id === buttonId;

        if (isTargetButton) {
          removedButton = button;
        }

        return !isTargetButton;
      });

      if (!removedButton) {
        return previousState;
      }

      return {
        ...previousState,
        standaloneButtons: nextButtons
      };
    }, {
      type: 'standalone-buttons/remove',
      buttonId,
      ...meta
    });

    return removedButton;
  }

  window.appStateStore = store;
  window.getAppState = getAppState;
  window.subscribeAppState = subscribeAppState;
  window.setAppState = setAppState;
  window.getChannelsState = getChannelsState;
  window.getStandaloneButtonsState = getStandaloneButtonsState;
  window.findChannelState = findChannelState;
  window.findStandaloneButtonState = findStandaloneButtonState;
  window.getCurrentProfileState = getCurrentProfileState;
  window.setCurrentProfileState = setCurrentProfileState;
  window.getMidiSelectionState = getMidiSelectionState;
  window.setMidiSelectionState = setMidiSelectionState;
  window.getPersistedRendererState = getPersistedRendererState;
  window.normalizePersistedRendererPayload = normalizePersistedRendererPayload;
  window.createEmptyPersistedRendererPayload = createEmptyPersistedRendererPayload;
  window.hydrateRendererState = hydrateRendererState;
  window.serializeRendererState = serializeRendererState;
  window.addStandaloneButtonState = addStandaloneButtonState;
  window.updateStandaloneButtonState = updateStandaloneButtonState;
  window.removeStandaloneButtonState = removeStandaloneButtonState;
})(window);
