(function initChannelActions(window) {
  function getChannelById(channelId) {
    return typeof window.findChannelState === 'function'
      ? window.findChannelState(channelId)
      : null;
  }

  function getAvailableApps() {
    return typeof window.getAvailableAudioApps === 'function'
      ? window.getAvailableAudioApps()
      : [];
  }

  function persistProfile() {
    return window.profileActions?.saveRendererProfileToLocal?.() || null;
  }

  function createChannel(overrides = {}, meta = {}) {
    const channel = window.createChannelState?.(overrides, {
      source: 'channel-actions',
      ...meta
    }) || null;

    if (!channel) {
      return null;
    }

    persistProfile();
    window.logTest?.('createChannel', { channelId: channel.id, title: channel.title });
    return channel;
  }

  function removeChannel(channelId, meta = {}) {
    const removedChannel = window.removeChannelState?.(channelId, {
      source: 'channel-actions',
      ...meta
    }) || null;

    if (!removedChannel) {
      return null;
    }

    window.resetChannelVolumePushRuntime?.(channelId);
    persistProfile();
    return removedChannel;
  }

  function setChannelApp(channelId, appProcess, meta = {}) {
    const channel = getChannelById(channelId);

    if (!channel) {
      return null;
    }

    window.resetChannelVolumePushRuntime?.(channelId);

    if (!appProcess) {
      const clearedChannel = window.clearChannelAppTargetState?.(channelId, {
        source: 'channel-actions',
        ...meta
      }) || getChannelById(channelId);
      persistProfile();
      return clearedChannel;
    }

    const selectedApp = getAvailableApps().find((app) => app.process === appProcess);
    const updatedChannel = window.assignChannelAppState?.(
      channelId,
      appProcess,
      selectedApp?.name || appProcess,
      {
        source: 'channel-actions',
        ...meta
      }
    ) || getChannelById(channelId);

    persistProfile();
    window.queueChannelVolumePushRuntime?.(updatedChannel);
    return updatedChannel;
  }

  function addChannelTarget(channelId, appProcess, appName = '', meta = {}) {
    const updatedChannel = window.addChannelAppTargetState?.(channelId, appProcess, appName, {
      source: 'channel-actions',
      ...meta
    }) || getChannelById(channelId);

    if (!updatedChannel) {
      return null;
    }

    persistProfile();
    window.queueChannelVolumePushRuntime?.(updatedChannel);
    return updatedChannel;
  }

  function removeChannelTarget(channelId, appProcess, meta = {}) {
    const updatedChannel = window.removeChannelAppTargetState?.(channelId, appProcess, {
      source: 'channel-actions',
      ...meta
    }) || getChannelById(channelId);

    if (!updatedChannel) {
      return null;
    }

    window.resetChannelVolumePushRuntime?.(channelId);
    persistProfile();
    return updatedChannel;
  }

  function setChannelVolume(channelId, volume, meta = {}) {
    const updatedChannel = window.setChannelVolumeState?.(channelId, volume, {
      source: 'channel-actions',
      ...meta
    }) || getChannelById(channelId);

    if (!updatedChannel) {
      return null;
    }

    window.queueChannelVolumePushRuntime?.(updatedChannel);
    window.emitChannelVolumeHudRuntime?.(updatedChannel, meta);
    return updatedChannel;
  }

  function dismissChannelBindHint(channelId, meta = {}) {
    const updatedChannel = window.dismissChannelBindHintState?.(channelId, {
      source: 'channel-actions',
      ...meta
    }) || getChannelById(channelId);

    if (!updatedChannel) {
      return null;
    }

    persistProfile();
    window.showToast?.('warn', window.t?.('channels.unboundWarning'));
    return updatedChannel;
  }

  function renameChannel(channelId, title, fallbackTitle = '', meta = {}) {
    const updatedChannel = window.renameChannelState?.(channelId, title, fallbackTitle, {
      source: 'channel-actions',
      ...meta
    }) || getChannelById(channelId);

    if (!updatedChannel) {
      return null;
    }

    persistProfile();
    return updatedChannel;
  }

  function addChannelButton(channelId, button, meta = {}) {
    const addedButton = window.addChannelButtonState?.(channelId, button, {
      source: 'channel-actions',
      ...meta
    }) || null;

    if (!addedButton) {
      return null;
    }

    persistProfile();
    return addedButton;
  }

  function updateChannelButton(channelId, buttonId, updater, meta = {}) {
    const updatedButton = window.updateChannelButtonState?.(channelId, buttonId, updater, {
      source: 'channel-actions',
      ...meta
    }) || null;

    if (!updatedButton) {
      return null;
    }

    persistProfile();
    return updatedButton;
  }

  function removeChannelButton(channelId, buttonId, meta = {}) {
    const removedButton = window.removeChannelButtonState?.(channelId, buttonId, {
      source: 'channel-actions',
      ...meta
    }) || null;

    if (!removedButton) {
      return null;
    }

    persistProfile();
    return removedButton;
  }

  function toggleChannelButton(channelId, buttonId, meta = {}) {
    return window.toggleChannelButtonState?.(channelId, buttonId, {
      source: 'channel-actions',
      ...meta
    }) || null;
  }

  window.channelActions = {
    createChannel,
    removeChannel,
    setChannelApp,
    addChannelTarget,
    removeChannelTarget,
    setChannelVolume,
    dismissChannelBindHint,
    renameChannel,
    addChannelButton,
    updateChannelButton,
    removeChannelButton,
    toggleChannelButton
  };
})(window);
