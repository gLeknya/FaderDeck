(function initChannelState(window) {
  const CHANNEL_BUTTON_ACTION_TYPES = Object.freeze({
    none: 'none',
    mute: 'mute',
    solo: 'solo',
    setVolume: 'set-volume'
  });

  const CHANNEL_BUTTON_INDICATOR_TYPES = Object.freeze({
    toggle: 'toggle',
    meter: 'meter',
    press: 'press'
  });

  const CHANNEL_BUTTON_CONTENT_MODES = Object.freeze({
    iconTitle: 'icon-title',
    iconOnly: 'icon-only',
    titleOnly: 'title-only'
  });

  const CHANNEL_BUTTON_META_MODES = Object.freeze({
    actionIndicator: 'action-indicator',
    actionOnly: 'action-only',
    indicatorOnly: 'indicator-only'
  });

  const CHANNEL_BUTTON_ICON_KEYS = Object.freeze([
    'square',
    'spark',
    'speaker',
    'mute',
    'layers',
    'target',
    'flash',
    'play',
    'pause',
    'circle',
    'diamond',
    'triangle',
    'wave',
    'bolt',
    'ring'
  ]);

  const DEFAULT_CHANNEL_BUTTON_ACTION_VALUE = 50;

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
    const normalizedText = String(
      button.text ?? button.title ?? ''
    ).trim();
    const icon = CHANNEL_BUTTON_ICON_KEYS.includes(button.icon)
      ? button.icon
      : CHANNEL_BUTTON_ICON_KEYS[0];
    const actionType = Object.values(CHANNEL_BUTTON_ACTION_TYPES).includes(button.actionType)
      ? button.actionType
      : CHANNEL_BUTTON_ACTION_TYPES.none;
    const indicatorType = Object.values(CHANNEL_BUTTON_INDICATOR_TYPES).includes(button.indicatorType)
      ? button.indicatorType
      : CHANNEL_BUTTON_INDICATOR_TYPES.toggle;
    const contentDisplay = Object.values(CHANNEL_BUTTON_CONTENT_MODES).includes(button.contentDisplay)
      ? button.contentDisplay
      : CHANNEL_BUTTON_CONTENT_MODES.iconTitle;
    const metaDisplay = Object.values(CHANNEL_BUTTON_META_MODES).includes(button.metaDisplay)
      ? button.metaDisplay
      : CHANNEL_BUTTON_META_MODES.actionIndicator;
    const midiMapping = button.midiMapping && typeof button.midiMapping === 'object'
      ? {
        type: button.midiMapping.type === 'control_change' ? 'control_change' : 'note',
        channel: Number(button.midiMapping.channel) || 0,
        note: Number.isInteger(Number(button.midiMapping.note)) ? Number(button.midiMapping.note) : null,
        control: Number.isInteger(Number(button.midiMapping.control)) ? Number(button.midiMapping.control) : null
      }
      : (Number.isInteger(Number(button.note))
        ? {
          type: 'note',
          channel: 0,
          note: Number(button.note),
          control: null
        }
        : null);
    const actionValue = Math.max(
      0,
      Math.min(
        100,
        Number.isFinite(Number(button.actionValue))
          ? Number(button.actionValue)
          : DEFAULT_CHANNEL_BUTTON_ACTION_VALUE
      )
    );

    return {
      ...button,
      id: button.id ?? (Date.now() + Math.floor(Math.random() * 1000)),
      text: normalizedText,
      icon,
      actionType,
      actionValue,
      indicatorType,
      contentDisplay,
      metaDisplay,
      midiMapping,
      note: Number.isFinite(Number(button.note)) ? Number(button.note) : 70,
      key: button.key || null,
      active: Boolean(button.active)
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

  function normalizeChannelConfiguredFlag(channel = {}) {
    if (typeof channel.hasBeenConfigured === 'boolean') {
      return channel.hasBeenConfigured;
    }

    // Compatibility: legacy saved channels predate the onboarding CTA,
    // so we keep them treated as already configured by default.
    return true;
  }

  function normalizeChannelTitleIconState(channel = {}, targets = normalizeChannelTargets(channel)) {
    const enabled = Boolean(channel.showTargetIconInTitle);
    const requestedProcess = String(channel.titleIconTargetProcess || '').trim();
    const resolvedProcess = (
      targets.find((target) => target.process === requestedProcess)?.process
      || targets[0]?.process
      || ''
    );

    return {
      showTargetIconInTitle: enabled && Boolean(resolvedProcess),
      titleIconTargetProcess: resolvedProcess
    };
  }

  function normalizeChannelButtonPlacement(channel = {}) {
    return channel.buttonPlacement === 'side' ? 'side' : 'bottom';
  }

  function cloneChannelEntity(channel = {}) {
    const targets = normalizeChannelTargets(channel);
    const primaryTarget = targets[0] || null;
    const titleIconState = normalizeChannelTitleIconState(channel, targets);

    return {
      ...channel,
      app: primaryTarget?.process || '',
      appName: primaryTarget?.name || '',
      targets,
      hasBeenConfigured: normalizeChannelConfiguredFlag(channel),
      showTargetIconInTitle: titleIconState.showTargetIconInTitle,
      titleIconTargetProcess: titleIconState.titleIconTargetProcess,
      buttonPlacement: normalizeChannelButtonPlacement(channel),
      customSettingsEnabled: Boolean(channel.customSettingsEnabled),
      customSettings: cloneChannelCustomSettings(channel.customSettings),
      buttons: Array.isArray(channel.buttons)
        ? channel.buttons.map(cloneButtonEntity)
        : []
    };
  }

  function clampChannelVolume(value) {
    const clampedValue = Math.max(0, Math.min(100, Number(value) || 0));

    if (typeof window.normalizeVolumeValue === 'function') {
      return window.normalizeVolumeValue(clampedValue);
    }

    return Math.round(clampedValue * 1000) / 1000;
  }

  function syncLegacyChannelTargetFields(channel) {
    const primaryTarget = Array.isArray(channel.targets) ? channel.targets[0] : null;
    channel.app = primaryTarget?.process || '';
    channel.appName = primaryTarget?.name || '';
    return channel;
  }

  function createChannelStateModel(index, overrides = {}) {
    return {
      id: Date.now() + Math.floor(Math.random() * 1000),
      app: '',
      appName: '',
      targets: [],
      title: window.t('channels.defaultTitle', { index }),
      faderCC: null,
      faderMapping: null,
      volume: 100,
      buttons: [],
      hasBeenConfigured: false,
      showTargetIconInTitle: false,
      titleIconTargetProcess: '',
      buttonPlacement: 'bottom',
      skipBinding: false,
      showBindHint: true,
      flashOnCreate: true,
      customSettingsEnabled: false,
      customSettings: createDefaultChannelCustomSettings(),
      ...overrides
    };
  }

  function updateChannelState(channelId, updater, meta = {}) {
    let updatedChannel = null;

    window.setAppState((previousState) => {
      const channelIndex = previousState.channels.findIndex((channel) => channel.id === channelId);

      if (channelIndex === -1) {
        return previousState;
      }

      const currentChannel = previousState.channels[channelIndex];
      const draftChannel = cloneChannelEntity(currentChannel);
      const nextChannel = typeof updater === 'function'
        ? updater(draftChannel) || draftChannel
        : {
          ...draftChannel,
          ...(updater || {})
        };

      updatedChannel = cloneChannelEntity(nextChannel);

      const nextChannels = previousState.channels.slice();
      nextChannels[channelIndex] = updatedChannel;

      return {
        ...previousState,
        channels: nextChannels
      };
    }, {
      type: 'channels/update',
      channelId,
      ...meta
    });

    return updatedChannel;
  }

  function createChannelState(overrides = {}, meta = {}) {
    const nextChannel = createChannelStateModel(window.getChannelsState().length + 1, overrides);

    window.setAppState((previousState) => ({
      ...previousState,
      channels: [...previousState.channels, nextChannel]
    }), {
      type: 'channels/add',
      channelId: nextChannel.id,
      ...meta
    });

    return nextChannel;
  }

  function removeChannelState(channelId, meta = {}) {
    let removedChannel = null;

    window.setAppState((previousState) => {
      const nextChannels = previousState.channels.filter((channel) => {
        const isTargetChannel = channel.id === channelId;

        if (isTargetChannel) {
          removedChannel = channel;
        }

        return !isTargetChannel;
      });

      if (!removedChannel) {
        return previousState;
      }

      return {
        ...previousState,
        channels: nextChannels
      };
    }, {
      type: 'channels/remove',
      channelId,
      ...meta
    });

    return removedChannel;
  }

  function renameChannelState(channelId, nextTitle, fallbackTitle = '', meta = {}) {
    const normalizedTitle = String(nextTitle || '').trim() || fallbackTitle;

    return updateChannelState(channelId, (channel) => {
      channel.title = normalizedTitle;
      return channel;
    }, {
      type: 'channels/rename',
      ...meta
    });
  }

  function assignChannelAppState(channelId, appProcess, appName, meta = {}) {
    return updateChannelState(channelId, (channel) => {
      const nextTarget = createChannelTarget(appProcess, appName);
      channel.targets = nextTarget ? [nextTarget] : [];
      syncLegacyChannelTargetFields(channel);

      if (!channel.title) {
        channel.title = channel.appName;
      }

      return channel;
    }, {
      type: 'channels/set-app',
      appProcess,
      ...meta
    });
  }

  function clearChannelAppTargetState(channelId, meta = {}) {
    return updateChannelState(channelId, (channel) => {
      channel.targets = [];
      syncLegacyChannelTargetFields(channel);
      return channel;
    }, {
      type: 'channels/clear-app',
      ...meta
    });
  }

  function addChannelAppTargetState(channelId, appProcess, appName, meta = {}) {
    return updateChannelState(channelId, (channel) => {
      const nextTarget = createChannelTarget(appProcess, appName);

      if (!nextTarget) {
        return channel;
      }

      const hasTarget = channel.targets.some((target) => target.process === nextTarget.process);

      if (!hasTarget) {
        channel.targets = [...channel.targets, nextTarget];
      }

      syncLegacyChannelTargetFields(channel);
      return channel;
    }, {
      type: 'channels/add-app-target',
      appProcess,
      ...meta
    });
  }

  function removeChannelAppTargetState(channelId, appProcess, meta = {}) {
    return updateChannelState(channelId, (channel) => {
      channel.targets = channel.targets.filter((target) => target.process !== appProcess);
      syncLegacyChannelTargetFields(channel);
      return channel;
    }, {
      type: 'channels/remove-app-target',
      appProcess,
      ...meta
    });
  }

  function setChannelVolumeState(channelId, volume, meta = {}) {
    return updateChannelState(channelId, (channel) => {
      channel.volume = clampChannelVolume(volume);
      return channel;
    }, {
      type: 'channels/set-volume',
      ...meta
    });
  }

  function dismissChannelBindHintState(channelId, meta = {}) {
    return updateChannelState(channelId, (channel) => {
      channel.showBindHint = false;
      channel.skipBinding = true;
      return channel;
    }, {
      type: 'channels/dismiss-bind-hint',
      ...meta
    });
  }

  function setChannelFaderMappingState(channelId, mapping, meta = {}) {
    return updateChannelState(channelId, (channel) => {
      channel.faderMapping = mapping || null;
      channel.faderCC = mapping?.control ?? null;
      channel.showBindHint = false;
      channel.skipBinding = false;
      return channel;
    }, {
      type: 'channels/set-fader-mapping',
      ...meta
    });
  }

  function setChannelCustomSettingsEnabledState(channelId, enabled, meta = {}) {
    return updateChannelState(channelId, (channel) => {
      channel.customSettingsEnabled = Boolean(enabled);
      channel.customSettings = cloneChannelCustomSettings(channel.customSettings);
      return channel;
    }, {
      type: 'channels/set-custom-settings-enabled',
      ...meta
    });
  }

  function setChannelConfiguredState(channelId, configured, meta = {}) {
    return updateChannelState(channelId, (channel) => {
      channel.hasBeenConfigured = Boolean(configured);
      return channel;
    }, {
      type: 'channels/set-configured',
      ...meta
    });
  }

  function setChannelTitleIconState(channelId, enabled, targetProcess = '', meta = {}) {
    return updateChannelState(channelId, (channel) => {
      const normalizedTargetProcess = String(targetProcess || '').trim();
      const fallbackProcess = channel.targets[0]?.process || '';
      const resolvedProcess = normalizedTargetProcess || fallbackProcess;
      channel.showTargetIconInTitle = Boolean(enabled) && Boolean(resolvedProcess);
      channel.titleIconTargetProcess = channel.showTargetIconInTitle ? resolvedProcess : '';
      return channel;
    }, {
      type: 'channels/set-title-icon',
      targetProcess,
      ...meta
    });
  }

  function setChannelButtonPlacementState(channelId, placement, meta = {}) {
    return updateChannelState(channelId, (channel) => {
      channel.buttonPlacement = placement === 'side' ? 'side' : 'bottom';
      return channel;
    }, {
      type: 'channels/set-button-placement',
      placement,
      ...meta
    });
  }

  function updateChannelCustomSettingsState(channelId, updater, meta = {}) {
    return updateChannelState(channelId, (channel) => {
      const draftSettings = cloneChannelCustomSettings(channel.customSettings);
      const nextSettings = typeof updater === 'function'
        ? updater(draftSettings) || draftSettings
        : {
          ...draftSettings,
          ...(updater || {})
        };

      channel.customSettings = cloneChannelCustomSettings(nextSettings);
      return channel;
    }, {
      type: 'channels/update-custom-settings',
      ...meta
    });
  }

  function clearChannelFlashState(channelId, meta = {}) {
    return updateChannelState(channelId, (channel) => {
      channel.flashOnCreate = false;
      return channel;
    }, {
      type: 'channels/clear-flash',
      ...meta
    });
  }

  function addChannelButtonState(channelId, button, meta = {}) {
    const nextButton = cloneButtonEntity(button);

    updateChannelState(channelId, (channel) => {
      channel.buttons = [...channel.buttons, nextButton];
      return channel;
    }, {
      type: 'channels/button-add',
      buttonId: nextButton.id,
      ...meta
    });

    return nextButton;
  }

  function updateChannelButtonState(channelId, buttonId, updater, meta = {}) {
    let updatedButton = null;

    updateChannelState(channelId, (channel) => {
      const nextButtons = channel.buttons.map((button) => {
        if (button.id !== buttonId) {
          return cloneButtonEntity(button);
        }

        const draftButton = cloneButtonEntity(button);
        const nextButton = typeof updater === 'function'
          ? updater(draftButton) || draftButton
          : {
            ...draftButton,
            ...(updater || {})
          };

        updatedButton = cloneButtonEntity(nextButton);
        return updatedButton;
      });

      channel.buttons = nextButtons;
      return channel;
    }, {
      type: 'channels/button-update',
      buttonId,
      ...meta
    });

    return updatedButton;
  }

  function removeChannelButtonState(channelId, buttonId, meta = {}) {
    let removedButton = null;

    updateChannelState(channelId, (channel) => {
      channel.buttons = channel.buttons.filter((button) => {
        const isTargetButton = button.id === buttonId;

        if (isTargetButton) {
          removedButton = button;
        }

        return !isTargetButton;
      });
      return channel;
    }, {
      type: 'channels/button-remove',
      buttonId,
      ...meta
    });

    return removedButton;
  }

  function toggleChannelButtonState(channelId, buttonId, meta = {}) {
    return updateChannelButtonState(channelId, buttonId, (button) => {
      button.active = !button.active;
      return button;
    }, {
      type: 'channels/button-toggle',
      ...meta
    });
  }

  window.createChannelStateModel = createChannelStateModel;
  window.createDefaultChannelCustomSettingsState = createDefaultChannelCustomSettings;
  window.createChannelState = createChannelState;
  window.updateChannelState = updateChannelState;
  window.removeChannelState = removeChannelState;
  window.renameChannelState = renameChannelState;
  window.assignChannelAppState = assignChannelAppState;
  window.clearChannelAppTargetState = clearChannelAppTargetState;
  window.addChannelAppTargetState = addChannelAppTargetState;
  window.removeChannelAppTargetState = removeChannelAppTargetState;
  window.setChannelVolumeState = setChannelVolumeState;
  window.dismissChannelBindHintState = dismissChannelBindHintState;
  window.setChannelFaderMappingState = setChannelFaderMappingState;
  window.setChannelConfiguredState = setChannelConfiguredState;
  window.setChannelTitleIconState = setChannelTitleIconState;
  window.setChannelButtonPlacementState = setChannelButtonPlacementState;
  window.setChannelCustomSettingsEnabledState = setChannelCustomSettingsEnabledState;
  window.updateChannelCustomSettingsState = updateChannelCustomSettingsState;
  window.clearChannelFlashState = clearChannelFlashState;
  window.addChannelButtonState = addChannelButtonState;
  window.updateChannelButtonState = updateChannelButtonState;
  window.removeChannelButtonState = removeChannelButtonState;
  window.toggleChannelButtonState = toggleChannelButtonState;
  window.cloneChannelButtonEntity = cloneButtonEntity;
  window.CHANNEL_BUTTON_ACTION_TYPES = CHANNEL_BUTTON_ACTION_TYPES;
  window.CHANNEL_BUTTON_INDICATOR_TYPES = CHANNEL_BUTTON_INDICATOR_TYPES;
  window.CHANNEL_BUTTON_CONTENT_MODES = CHANNEL_BUTTON_CONTENT_MODES;
  window.CHANNEL_BUTTON_META_MODES = CHANNEL_BUTTON_META_MODES;
  window.CHANNEL_BUTTON_ICON_KEYS = CHANNEL_BUTTON_ICON_KEYS;
  window.DEFAULT_CHANNEL_BUTTON_ACTION_VALUE = DEFAULT_CHANNEL_BUTTON_ACTION_VALUE;
})(window);
