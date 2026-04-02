(function initChannelState(window) {
  function cloneButtonEntity(button = {}) {
    return {
      ...button
    };
  }

  function cloneChannelEntity(channel = {}) {
    return {
      ...channel,
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

  function createChannelStateModel(index, overrides = {}) {
    return {
      id: Date.now() + Math.floor(Math.random() * 1000),
      app: 'master',
      appName: window.t('audio.systemVolume'),
      title: window.t('channels.defaultTitle', { index }),
      faderCC: null,
      faderMapping: null,
      volume: 100,
      buttons: [],
      skipBinding: false,
      showBindHint: true,
      flashOnCreate: true,
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
      channel.app = appProcess;
      channel.appName = appName || appProcess;

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
  window.createChannelState = createChannelState;
  window.updateChannelState = updateChannelState;
  window.removeChannelState = removeChannelState;
  window.renameChannelState = renameChannelState;
  window.assignChannelAppState = assignChannelAppState;
  window.setChannelVolumeState = setChannelVolumeState;
  window.dismissChannelBindHintState = dismissChannelBindHintState;
  window.setChannelFaderMappingState = setChannelFaderMappingState;
  window.clearChannelFlashState = clearChannelFlashState;
  window.addChannelButtonState = addChannelButtonState;
  window.updateChannelButtonState = updateChannelButtonState;
  window.removeChannelButtonState = removeChannelButtonState;
  window.toggleChannelButtonState = toggleChannelButtonState;
})(window);
