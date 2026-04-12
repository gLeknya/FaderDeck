(function initAppState(window) {
  const {
    cloneButtonEntity,
    cloneChannelEntity
  } = window.channelModel;
  const {
    DEFAULT_PERSISTED_UI_SETTINGS,
    DEFAULT_SESSION_UI_STATE,
    normalizeMidiSelectionState
  } = window.rendererStateModel;
  const midiSelectionStorage = window.midiSelectionStorage;

  function normalizeChannels(channels) {
    return Array.isArray(channels) ? channels.map(cloneChannelEntity) : [];
  }

  function normalizeStandaloneButtons(buttons) {
    return Array.isArray(buttons) ? buttons.map(cloneButtonEntity) : [];
  }

  function readInitialMidiState() {
    try {
      return midiSelectionStorage?.readMidiSelection?.() || normalizeMidiSelectionState();
    } catch (error) {
      console.warn('readInitialMidiState error', error);
      return normalizeMidiSelectionState();
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
      layout: typeof window.createEmptyLayoutState === 'function'
        ? window.createEmptyLayoutState()
        : { items: [] },
      settings: {
        ...DEFAULT_PERSISTED_RENDERER_SETTINGS
      }
    };
  }

  function normalizePersistedRendererPayload(payload = {}) {
    const normalizedChannels = normalizeChannels(payload.channels);
    const normalizedStandaloneButtons = normalizeStandaloneButtons(payload.standaloneButtons);
    const normalizedSettings = normalizePersistedRendererSettings(payload.settings);
    const normalizedLayout = typeof window.normalizeLayoutState === 'function'
      ? window.normalizeLayoutState(payload.layout, {
        channels: normalizedChannels,
        standaloneButtons: normalizedStandaloneButtons
      })
      : {
        items: []
      };

    return {
      meta: {
        name: String(payload?.meta?.name || '').trim()
      },
      channels: normalizedChannels,
      standaloneButtons: normalizedStandaloneButtons,
      layout: normalizedLayout,
      settings: normalizedSettings
    };
  }

  function createInitialRendererState() {
    return {
      channels: [],
      standaloneButtons: [],
      layout: typeof window.createEmptyLayoutState === 'function'
        ? window.createEmptyLayoutState()
        : { items: [] },
      layoutEditor: typeof window.createDefaultLayoutEditorSessionState === 'function'
        ? window.createDefaultLayoutEditorSessionState()
        : {
          enabled: false,
          selectedItemId: null,
          hoveredItemId: null,
          dropPreview: null
        },
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
    const nextMidiState = normalizeMidiSelectionState(midiState);

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
    const midiState = normalizeMidiSelectionState(state.midi);
    const layoutState = typeof window.normalizeLayoutState === 'function'
      ? window.normalizeLayoutState(state.layout, {
        channels: state.channels,
        standaloneButtons: state.standaloneButtons
      })
      : {
        items: []
      };

    // Only persisted renderer/profile data belongs in this payload.
    // Session UI state (ui.session, layoutEditor, profile UX metadata, modal/editor state)
    // is intentionally excluded.
    return normalizePersistedRendererPayload({
      channels: state.channels,
      standaloneButtons: state.standaloneButtons,
      layout: layoutState,
      settings: {
        midiInputId: midiState.selectedInputId || null,
        midiInputName: midiState.selectedInputName || ''
      }
    });
  }

  function hydrateRendererState(payload = {}, meta = {}) {
    const persistedPayload = normalizePersistedRendererPayload(payload);
    const nextMidiState = normalizeMidiSelectionState({
      selectedInputId: persistedPayload.settings.midiInputId || '',
      selectedInputName: persistedPayload.settings.midiInputName || ''
    });

    setAppState((previousState) => ({
      ...previousState,
      channels: persistedPayload.channels,
      standaloneButtons: persistedPayload.standaloneButtons,
      layout: persistedPayload.layout,
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
