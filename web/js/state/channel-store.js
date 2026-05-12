(function initChannelState(window) {
  const {
    CHANNEL_BUTTON_ACTION_TYPES,
    CHANNEL_BUTTON_INDICATOR_TYPES,
    CHANNEL_BUTTON_INDICATOR_BEHAVIORS,
    CHANNEL_BUTTON_CONTENT_MODES,
    CHANNEL_BUTTON_META_MODES,
    CHANNEL_BUTTON_INTERACTION_MODES,
    CHANNEL_TARGET_MODES,
    CHANNEL_DEVICE_TARGET_FLOWS,
    CHANNEL_BUTTON_ICON_KEYS,
    MIN_CHANNEL_BUTTON_INDICATOR_THRESHOLD,
    MAX_CHANNEL_BUTTON_INDICATOR_THRESHOLD,
    DEFAULT_CHANNEL_BUTTON_ACTION_VALUE,
    DEFAULT_CHANNEL_BUTTON_INDICATOR_THRESHOLD,
    createDefaultChannelCustomSettings,
    cloneButtonEntity,
    createChannelTarget,
    createChannelDeviceTarget,
    cloneChannelCustomSettings,
    normalizeChannelTitleIconState,
    cloneChannelEntity
  } = window.channelModel;

  function clampChannelVolume(value) {
    const clampedValue = Math.max(0, Math.min(100, Number(value) || 0));

    if (typeof window.normalizeVolumeValue === 'function') {
      return window.normalizeVolumeValue(clampedValue);
    }

    return Math.round(clampedValue * 1000) / 1000;
  }

  function syncLegacyChannelTargetFields(channel) {
    const primaryTarget = Array.isArray(channel.targets)
      ? channel.targets[0]
      : null;
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
      targetMode: CHANNEL_TARGET_MODES.apps,
      deviceTargetFlow: CHANNEL_DEVICE_TARGET_FLOWS.output,
      deviceTargets: {
        output: [],
        input: []
      },
      focusExcludedTargets: [],
      icon: '',
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

    window.setAppState(
      (previousState) => {
        const channelIndex = previousState.channels.findIndex(
          (channel) => channel.id === channelId
        );

        if (channelIndex === -1) {
          return previousState;
        }

        const currentChannel = previousState.channels[channelIndex];
        const draftChannel = cloneChannelEntity(currentChannel);
        const nextChannel =
          typeof updater === 'function'
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
      },
      {
        type: 'channels/update',
        channelId,
        ...meta
      }
    );

    return updatedChannel;
  }

  function createChannelState(overrides = {}, meta = {}) {
    const nextChannel = createChannelStateModel(
      window.getChannelsState().length + 1,
      overrides
    );

    window.setAppState(
      (previousState) => ({
        ...previousState,
        channels: [...previousState.channels, nextChannel]
      }),
      {
        type: 'channels/add',
        channelId: nextChannel.id,
        ...meta
      }
    );

    return nextChannel;
  }

  function removeChannelState(channelId, meta = {}) {
    let removedChannel = null;

    window.setAppState(
      (previousState) => {
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
      },
      {
        type: 'channels/remove',
        channelId,
        ...meta
      }
    );

    return removedChannel;
  }

  function renameChannelState(
    channelId,
    nextTitle,
    fallbackTitle = '',
    meta = {}
  ) {
    const normalizedTitle = String(nextTitle || '').trim() || fallbackTitle;

    return updateChannelState(
      channelId,
      (channel) => {
        channel.title = normalizedTitle;
        return channel;
      },
      {
        type: 'channels/rename',
        ...meta
      }
    );
  }

  function assignChannelAppState(channelId, appProcess, appName, meta = {}) {
    return updateChannelState(
      channelId,
      (channel) => {
        const nextTarget = createChannelTarget(appProcess, appName);
        channel.targets = nextTarget ? [nextTarget] : [];
        channel.targetMode = CHANNEL_TARGET_MODES.apps;
        syncLegacyChannelTargetFields(channel);

        if (!channel.title) {
          channel.title = channel.appName;
        }

        return channel;
      },
      {
        type: 'channels/set-app',
        appProcess,
        ...meta
      }
    );
  }

  function clearChannelAppTargetState(channelId, meta = {}) {
    return updateChannelState(
      channelId,
      (channel) => {
        channel.targets = [];
        channel.targetMode = CHANNEL_TARGET_MODES.apps;
        syncLegacyChannelTargetFields(channel);
        return channel;
      },
      {
        type: 'channels/clear-app',
        ...meta
      }
    );
  }

  function addChannelAppTargetState(channelId, appProcess, appName, meta = {}) {
    return updateChannelState(
      channelId,
      (channel) => {
        const nextTarget = createChannelTarget(appProcess, appName);

        if (!nextTarget) {
          return channel;
        }

        const hasTarget = channel.targets.some(
          (target) => target.process === nextTarget.process
        );

        if (!hasTarget) {
          channel.targets = [...channel.targets, nextTarget];
        }

        channel.targetMode = CHANNEL_TARGET_MODES.apps;
        syncLegacyChannelTargetFields(channel);
        return channel;
      },
      {
        type: 'channels/add-app-target',
        appProcess,
        ...meta
      }
    );
  }

  function removeChannelAppTargetState(channelId, appProcess, meta = {}) {
    return updateChannelState(
      channelId,
      (channel) => {
        channel.targets = channel.targets.filter(
          (target) => target.process !== appProcess
        );
        syncLegacyChannelTargetFields(channel);
        return channel;
      },
      {
        type: 'channels/remove-app-target',
        appProcess,
        ...meta
      }
    );
  }

  function setChannelTargetModeState(channelId, targetMode, meta = {}) {
    return updateChannelState(
      channelId,
      (channel) => {
        channel.targetMode = Object.values(CHANNEL_TARGET_MODES).includes(
          targetMode
        )
          ? targetMode
          : CHANNEL_TARGET_MODES.apps;

        if (channel.targetMode === CHANNEL_TARGET_MODES.focus) {
          channel.showTargetIconInTitle = false;
          channel.titleIconTargetProcess = '';
        }

        return channel;
      },
      {
        type: 'channels/set-target-mode',
        targetMode,
        ...meta
      }
    );
  }

  function setChannelDeviceTargetFlowState(channelId, flow, meta = {}) {
    return updateChannelState(
      channelId,
      (channel) => {
        channel.deviceTargetFlow =
          flow === CHANNEL_DEVICE_TARGET_FLOWS.input
            ? CHANNEL_DEVICE_TARGET_FLOWS.input
            : CHANNEL_DEVICE_TARGET_FLOWS.output;
        return channel;
      },
      {
        type: 'channels/set-device-target-flow',
        flow,
        ...meta
      }
    );
  }

  function addChannelDeviceTargetState(
    channelId,
    deviceId,
    deviceName = '',
    flow = CHANNEL_DEVICE_TARGET_FLOWS.output,
    meta = {}
  ) {
    return updateChannelState(
      channelId,
      (channel) => {
        const normalizedFlow =
          flow === CHANNEL_DEVICE_TARGET_FLOWS.input
            ? CHANNEL_DEVICE_TARGET_FLOWS.input
            : CHANNEL_DEVICE_TARGET_FLOWS.output;
        const nextTarget = createChannelDeviceTarget(
          deviceId,
          deviceName,
          normalizedFlow
        );

        if (!nextTarget) {
          return channel;
        }

        const deviceTargets = {
          output: Array.isArray(channel.deviceTargets?.output)
            ? channel.deviceTargets.output.slice()
            : [],
          input: Array.isArray(channel.deviceTargets?.input)
            ? channel.deviceTargets.input.slice()
            : []
        };

        if (
          !deviceTargets[normalizedFlow].some(
            (target) => target.id === nextTarget.id
          )
        ) {
          deviceTargets[normalizedFlow].push(nextTarget);
        }

        channel.deviceTargets = deviceTargets;
        channel.deviceTargetFlow = normalizedFlow;
        return channel;
      },
      {
        type: 'channels/add-device-target',
        deviceId,
        flow,
        ...meta
      }
    );
  }

  function removeChannelDeviceTargetState(
    channelId,
    deviceId,
    flow = CHANNEL_DEVICE_TARGET_FLOWS.output,
    meta = {}
  ) {
    return updateChannelState(
      channelId,
      (channel) => {
        const normalizedFlow =
          flow === CHANNEL_DEVICE_TARGET_FLOWS.input
            ? CHANNEL_DEVICE_TARGET_FLOWS.input
            : CHANNEL_DEVICE_TARGET_FLOWS.output;
        const deviceTargets = {
          output: Array.isArray(channel.deviceTargets?.output)
            ? channel.deviceTargets.output.slice()
            : [],
          input: Array.isArray(channel.deviceTargets?.input)
            ? channel.deviceTargets.input.slice()
            : []
        };

        deviceTargets[normalizedFlow] = deviceTargets[normalizedFlow].filter(
          (target) =>
            String(target?.id || '').trim() !== String(deviceId || '').trim()
        );
        channel.deviceTargets = deviceTargets;
        return channel;
      },
      {
        type: 'channels/remove-device-target',
        deviceId,
        flow,
        ...meta
      }
    );
  }

  function addChannelFocusExclusionState(
    channelId,
    appProcess,
    appName = '',
    meta = {}
  ) {
    return updateChannelState(
      channelId,
      (channel) => {
        const nextTarget = createChannelTarget(appProcess, appName);

        if (!nextTarget) {
          return channel;
        }

        const exclusions = Array.isArray(channel.focusExcludedTargets)
          ? channel.focusExcludedTargets.slice()
          : [];

        if (
          !exclusions.some((target) => target.process === nextTarget.process)
        ) {
          exclusions.push(nextTarget);
        }

        channel.focusExcludedTargets = exclusions;
        channel.targetMode = CHANNEL_TARGET_MODES.focus;
        channel.showTargetIconInTitle = false;
        channel.titleIconTargetProcess = '';
        return channel;
      },
      {
        type: 'channels/add-focus-exclusion',
        appProcess,
        ...meta
      }
    );
  }

  function removeChannelFocusExclusionState(channelId, appProcess, meta = {}) {
    return updateChannelState(
      channelId,
      (channel) => {
        channel.focusExcludedTargets = Array.isArray(
          channel.focusExcludedTargets
        )
          ? channel.focusExcludedTargets.filter(
              (target) =>
                String(target?.process || '').trim() !==
                String(appProcess || '').trim()
            )
          : [];
        return channel;
      },
      {
        type: 'channels/remove-focus-exclusion',
        appProcess,
        ...meta
      }
    );
  }

  function setChannelVolumeState(channelId, volume, meta = {}) {
    const nextVolume = clampChannelVolume(volume);
    let updatedChannel = null;

    window.setAppState(
      (previousState) => {
        const channelIndex = previousState.channels.findIndex(
          (channel) => channel.id === channelId
        );

        if (channelIndex === -1) {
          return previousState;
        }

        const currentChannel = previousState.channels[channelIndex];

        if (currentChannel.volume === nextVolume) {
          updatedChannel = currentChannel;
          return previousState;
        }

        const draftChannel = cloneChannelEntity(currentChannel);
        draftChannel.volume = nextVolume;
        updatedChannel = cloneChannelEntity(draftChannel);

        const nextChannels = previousState.channels.slice();
        nextChannels[channelIndex] = updatedChannel;

        return {
          ...previousState,
          channels: nextChannels
        };
      },
      {
        ...meta,
        type: 'channels/set-volume',
        channelId
      }
    );

    return updatedChannel;
  }

  function dismissChannelBindHintState(channelId, meta = {}) {
    return updateChannelState(
      channelId,
      (channel) => {
        channel.showBindHint = false;
        channel.skipBinding = true;
        return channel;
      },
      {
        type: 'channels/dismiss-bind-hint',
        ...meta
      }
    );
  }

  function setChannelFaderMappingState(channelId, mapping, meta = {}) {
    return updateChannelState(
      channelId,
      (channel) => {
        channel.faderMapping = mapping || null;
        channel.faderCC = mapping?.control ?? null;
        channel.showBindHint = false;
        channel.skipBinding = false;
        return channel;
      },
      {
        type: 'channels/set-fader-mapping',
        ...meta
      }
    );
  }

  function setChannelCustomSettingsEnabledState(channelId, enabled, meta = {}) {
    return updateChannelState(
      channelId,
      (channel) => {
        channel.customSettingsEnabled = Boolean(enabled);
        channel.customSettings = cloneChannelCustomSettings(
          channel.customSettings
        );
        return channel;
      },
      {
        type: 'channels/set-custom-settings-enabled',
        ...meta
      }
    );
  }

  function setChannelConfiguredState(channelId, configured, meta = {}) {
    return updateChannelState(
      channelId,
      (channel) => {
        channel.hasBeenConfigured = Boolean(configured);
        return channel;
      },
      {
        type: 'channels/set-configured',
        ...meta
      }
    );
  }

  function setChannelTitleIconState(
    channelId,
    enabled,
    targetProcess = '',
    meta = {}
  ) {
    return updateChannelState(
      channelId,
      (channel) => {
        const normalizedTargetProcess = String(targetProcess || '').trim();
        const fallbackProcess = channel.targets[0]?.process || '';
        const resolvedProcess = normalizedTargetProcess || fallbackProcess;
        channel.showTargetIconInTitle =
          Boolean(enabled) && Boolean(resolvedProcess);
        channel.titleIconTargetProcess = channel.showTargetIconInTitle
          ? resolvedProcess
          : '';
        return channel;
      },
      {
        type: 'channels/set-title-icon',
        targetProcess,
        ...meta
      }
    );
  }

  function setChannelIconState(channelId, iconKey = '', meta = {}) {
    return updateChannelState(
      channelId,
      (channel) => {
        channel.icon = CHANNEL_BUTTON_ICON_KEYS.includes(iconKey)
          ? iconKey
          : '';
        return channel;
      },
      {
        type: 'channels/set-icon',
        iconKey,
        ...meta
      }
    );
  }

  function setChannelButtonPlacementState(channelId, placement, meta = {}) {
    return updateChannelState(
      channelId,
      (channel) => {
        channel.buttonPlacement = placement === 'side' ? 'side' : 'bottom';
        return channel;
      },
      {
        type: 'channels/set-button-placement',
        placement,
        ...meta
      }
    );
  }

  function updateChannelCustomSettingsState(channelId, updater, meta = {}) {
    return updateChannelState(
      channelId,
      (channel) => {
        const draftSettings = cloneChannelCustomSettings(
          channel.customSettings
        );
        const nextSettings =
          typeof updater === 'function'
            ? updater(draftSettings) || draftSettings
            : {
                ...draftSettings,
                ...(updater || {})
              };

        channel.customSettings = cloneChannelCustomSettings(nextSettings);
        return channel;
      },
      {
        type: 'channels/update-custom-settings',
        ...meta
      }
    );
  }

  function clearChannelFlashState(channelId, meta = {}) {
    return updateChannelState(
      channelId,
      (channel) => {
        channel.flashOnCreate = false;
        return channel;
      },
      {
        type: 'channels/clear-flash',
        ...meta
      }
    );
  }

  function addChannelButtonState(channelId, button, meta = {}) {
    const nextButton = cloneButtonEntity(button);

    updateChannelState(
      channelId,
      (channel) => {
        channel.buttons = [...channel.buttons, nextButton];
        return channel;
      },
      {
        type: 'channels/button-add',
        buttonId: nextButton.id,
        ...meta
      }
    );

    return nextButton;
  }

  function updateChannelButtonState(channelId, buttonId, updater, meta = {}) {
    let updatedButton = null;

    updateChannelState(
      channelId,
      (channel) => {
        const nextButtons = channel.buttons.map((button) => {
          if (button.id !== buttonId) {
            return cloneButtonEntity(button);
          }

          const draftButton = cloneButtonEntity(button);
          const nextButton =
            typeof updater === 'function'
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
      },
      {
        type: 'channels/button-update',
        buttonId,
        ...meta
      }
    );

    return updatedButton;
  }

  function removeChannelButtonState(channelId, buttonId, meta = {}) {
    let removedButton = null;

    updateChannelState(
      channelId,
      (channel) => {
        channel.buttons = channel.buttons.filter((button) => {
          const isTargetButton = button.id === buttonId;

          if (isTargetButton) {
            removedButton = button;
          }

          return !isTargetButton;
        });
        return channel;
      },
      {
        type: 'channels/button-remove',
        buttonId,
        ...meta
      }
    );

    return removedButton;
  }

  function toggleChannelButtonState(channelId, buttonId, meta = {}) {
    return updateChannelButtonState(
      channelId,
      buttonId,
      (button) => {
        button.active = !button.active;
        return button;
      },
      {
        type: 'channels/button-toggle',
        ...meta
      }
    );
  }

  window.createChannelStateModel = createChannelStateModel;
  window.createDefaultChannelCustomSettingsState =
    createDefaultChannelCustomSettings;
  window.createChannelState = createChannelState;
  window.updateChannelState = updateChannelState;
  window.removeChannelState = removeChannelState;
  window.renameChannelState = renameChannelState;
  window.assignChannelAppState = assignChannelAppState;
  window.clearChannelAppTargetState = clearChannelAppTargetState;
  window.addChannelAppTargetState = addChannelAppTargetState;
  window.removeChannelAppTargetState = removeChannelAppTargetState;
  window.setChannelTargetModeState = setChannelTargetModeState;
  window.setChannelDeviceTargetFlowState = setChannelDeviceTargetFlowState;
  window.addChannelDeviceTargetState = addChannelDeviceTargetState;
  window.removeChannelDeviceTargetState = removeChannelDeviceTargetState;
  window.addChannelFocusExclusionState = addChannelFocusExclusionState;
  window.removeChannelFocusExclusionState = removeChannelFocusExclusionState;
  window.setChannelVolumeState = setChannelVolumeState;
  window.dismissChannelBindHintState = dismissChannelBindHintState;
  window.setChannelFaderMappingState = setChannelFaderMappingState;
  window.setChannelConfiguredState = setChannelConfiguredState;
  window.setChannelTitleIconState = setChannelTitleIconState;
  window.setChannelIconState = setChannelIconState;
  window.setChannelButtonPlacementState = setChannelButtonPlacementState;
  window.setChannelCustomSettingsEnabledState =
    setChannelCustomSettingsEnabledState;
  window.updateChannelCustomSettingsState = updateChannelCustomSettingsState;
  window.clearChannelFlashState = clearChannelFlashState;
  window.addChannelButtonState = addChannelButtonState;
  window.updateChannelButtonState = updateChannelButtonState;
  window.removeChannelButtonState = removeChannelButtonState;
  window.toggleChannelButtonState = toggleChannelButtonState;
  window.cloneChannelButtonEntity = cloneButtonEntity;
  window.CHANNEL_BUTTON_ACTION_TYPES = CHANNEL_BUTTON_ACTION_TYPES;
  window.CHANNEL_BUTTON_INDICATOR_TYPES = CHANNEL_BUTTON_INDICATOR_TYPES;
  window.CHANNEL_BUTTON_INDICATOR_BEHAVIORS =
    CHANNEL_BUTTON_INDICATOR_BEHAVIORS;
  window.CHANNEL_BUTTON_CONTENT_MODES = CHANNEL_BUTTON_CONTENT_MODES;
  window.CHANNEL_BUTTON_META_MODES = CHANNEL_BUTTON_META_MODES;
  window.CHANNEL_BUTTON_INTERACTION_MODES = CHANNEL_BUTTON_INTERACTION_MODES;
  window.CHANNEL_TARGET_MODES = CHANNEL_TARGET_MODES;
  window.CHANNEL_DEVICE_TARGET_FLOWS = CHANNEL_DEVICE_TARGET_FLOWS;
  window.CHANNEL_BUTTON_ICON_KEYS = CHANNEL_BUTTON_ICON_KEYS;
  window.MIN_CHANNEL_BUTTON_INDICATOR_THRESHOLD =
    MIN_CHANNEL_BUTTON_INDICATOR_THRESHOLD;
  window.MAX_CHANNEL_BUTTON_INDICATOR_THRESHOLD =
    MAX_CHANNEL_BUTTON_INDICATOR_THRESHOLD;
  window.DEFAULT_CHANNEL_BUTTON_ACTION_VALUE =
    DEFAULT_CHANNEL_BUTTON_ACTION_VALUE;
  window.DEFAULT_CHANNEL_BUTTON_INDICATOR_THRESHOLD =
    DEFAULT_CHANNEL_BUTTON_INDICATOR_THRESHOLD;
})(window);
