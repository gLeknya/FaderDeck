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

  function getApi() {
    return typeof window.getApi === 'function'
      ? window.getApi()
      : (window.pywebview?.api ?? null);
  }

  function getChannelTargetProcesses(channel) {
    if (!channel) {
      return [];
    }

    const explicitTargets = Array.isArray(channel.targets)
      ? channel.targets
          .map((target) => String(target?.process || '').trim())
          .filter(Boolean)
      : [];

    if (explicitTargets.length > 0) {
      return [...new Set(explicitTargets)];
    }

    const fallbackProcess = String(channel.app || '').trim();
    return fallbackProcess ? [fallbackProcess] : [];
  }

  function getAllChannelTargetProcesses() {
    const channels = typeof window.getChannelsState === 'function'
      ? window.getChannelsState()
      : [];

    return [...new Set(
      channels.flatMap((channel) => getChannelTargetProcesses(channel))
    )];
  }

  async function getProcessAudioStates(processes = []) {
    const normalizedProcesses = [...new Set(
      (Array.isArray(processes) ? processes : [])
        .map((processName) => String(processName || '').trim())
        .filter(Boolean)
    )];
    const api = getApi();

    if (!normalizedProcesses.length || !api?.get_audio_states) {
      return new Map();
    }

    try {
      const response = await api.get_audio_states(normalizedProcesses);
      const applications = Array.isArray(response?.applications)
        ? response.applications
        : [];

      return new Map(applications.map((application) => [
        String(application?.process || '').trim().toLowerCase(),
        application
      ]));
    } catch (error) {
      console.error('get_audio_states error', error);
      return new Map();
    }
  }

  async function setProcessesMuted(processes = [], muted = false) {
    const normalizedProcesses = [...new Set(
      (Array.isArray(processes) ? processes : [])
        .map((processName) => String(processName || '').trim())
        .filter(Boolean)
    )];
    const api = getApi();

    if (!normalizedProcesses.length || !api?.set_app_mute) {
      return [];
    }

    return Promise.all(
      normalizedProcesses.map((processName) => api.set_app_mute(processName, Boolean(muted)))
    );
  }

  async function setProcessesVolume(processes = [], volume = 0) {
    const normalizedProcesses = [...new Set(
      (Array.isArray(processes) ? processes : [])
        .map((processName) => String(processName || '').trim())
        .filter(Boolean)
    )];
    const api = getApi();

    if (!normalizedProcesses.length || !api?.set_app_volume) {
      return [];
    }

    return Promise.all(
      normalizedProcesses.map((processName) => api.set_app_volume(processName, volume))
    );
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
    const activeSoloKey = window.getActiveSoloChannelButtonKeyRuntime?.() || '';

    const removedChannel = window.removeChannelState?.(channelId, {
      source: 'channel-actions',
      ...meta
    }) || null;

    if (!removedChannel) {
      return null;
    }

    window.resetChannelVolumePushRuntime?.(channelId);
    if (activeSoloKey.startsWith(`${channelId}:`)) {
      window.restoreSoloChannelButtonRuntime?.();
    }
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
    window.requestChannelButtonRuntimeRefresh?.({ reason: 'channel-target-changed', force: true });
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
    window.requestChannelButtonRuntimeRefresh?.({ reason: 'channel-target-added', force: true });
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
    window.requestChannelButtonRuntimeRefresh?.({ reason: 'channel-target-removed', force: true });
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

  function markChannelConfigured(channelId, meta = {}) {
    const updatedChannel = window.setChannelConfiguredState?.(channelId, true, {
      source: 'channel-actions',
      ...meta
    }) || getChannelById(channelId);

    if (!updatedChannel) {
      return null;
    }

    persistProfile();
    return updatedChannel;
  }

  function setChannelTitleIconVisible(channelId, enabled, targetProcess = '', meta = {}) {
    const updatedChannel = window.setChannelTitleIconState?.(channelId, enabled, targetProcess, {
      source: 'channel-actions',
      ...meta
    }) || getChannelById(channelId);

    if (!updatedChannel) {
      return null;
    }

    persistProfile();
    return updatedChannel;
  }

  function setChannelButtonPlacement(channelId, placement, meta = {}) {
    const updatedChannel = window.setChannelButtonPlacementState?.(channelId, placement, {
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
    window.requestChannelButtonRuntimeRefresh?.({ reason: 'channel-button-added', force: true });
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
    window.requestChannelButtonRuntimeRefresh?.({ reason: 'channel-button-updated', force: true });
    return updatedButton;
  }

  function removeChannelButton(channelId, buttonId, meta = {}) {
    const activeSoloKey = window.getActiveSoloChannelButtonKeyRuntime?.() || '';
    const removedButton = window.removeChannelButtonState?.(channelId, buttonId, {
      source: 'channel-actions',
      ...meta
    }) || null;

    if (!removedButton) {
      return null;
    }

    if (activeSoloKey === `${channelId}:${buttonId}`) {
      window.restoreSoloChannelButtonRuntime?.();
    }
    persistProfile();
    window.requestChannelButtonRuntimeRefresh?.({ reason: 'channel-button-removed', force: true });
    return removedButton;
  }

  async function executeMuteChannelButton(channel, button) {
    const targetProcesses = getChannelTargetProcesses(channel);
    const targetStateMap = await getProcessAudioStates(targetProcesses);
    const allMuted = targetProcesses.length > 0
      && targetProcesses.every((processName) => Boolean(targetStateMap.get(processName.toLowerCase())?.muted));

    await setProcessesMuted(targetProcesses, !allMuted);
    return !allMuted;
  }

  async function executeSoloChannelButton(channel, button) {
    const buttonKey = `${channel.id}:${button.id}`;
    const targetProcesses = getChannelTargetProcesses(channel);
    const allProfileProcesses = getAllChannelTargetProcesses();
    const otherProcesses = allProfileProcesses.filter((processName) => !targetProcesses.includes(processName));
    const activeSoloKey = window.getActiveSoloChannelButtonKeyRuntime?.() || null;

    if (activeSoloKey === buttonKey) {
      await window.restoreSoloChannelButtonRuntime?.();
      return false;
    }

    const processStateMap = await getProcessAudioStates(allProfileProcesses);
    const snapshot = Array.from(processStateMap.values()).map((application) => ({
      process: application.process,
      muted: Boolean(application.muted)
    }));

    await window.restoreSoloChannelButtonRuntime?.();
    await setProcessesMuted(otherProcesses, true);
    await setProcessesMuted(targetProcesses, false);
    window.activateSoloChannelButtonRuntime?.(buttonKey, snapshot);
    return true;
  }

  async function executeSetVolumeChannelButton(channel, button) {
    const targetProcesses = getChannelTargetProcesses(channel);
    const nextVolume = Math.max(0, Math.min(100, Number(button?.actionValue) || 0));

    await setProcessesVolume(targetProcesses, nextVolume);
    return true;
  }

  async function executeChannelButton(channelId, buttonId, meta = {}) {
    const channel = getChannelById(channelId);
    const button = channel?.buttons?.find((item) => item.id === buttonId) || null;
    const targetProcesses = getChannelTargetProcesses(channel);

    if (!channel || !button) {
      return null;
    }

    if (!targetProcesses.length) {
      window.showToast?.('warn', window.t?.('editor.noTargetAssigned'));
      return button;
    }

    window.triggerChannelButtonPressRuntime?.(channelId, buttonId);

    try {
      if (button.actionType === (window.CHANNEL_BUTTON_ACTION_TYPES?.none || 'none')) {
        // No-op by design: an unconfigured channel button should still be bindable
        // and previewable without triggering any audio side effects yet.
      } else if (button.actionType === (window.CHANNEL_BUTTON_ACTION_TYPES?.solo || 'solo')) {
        await executeSoloChannelButton(channel, button);
      } else if (button.actionType === (window.CHANNEL_BUTTON_ACTION_TYPES?.setVolume || 'set-volume')) {
        await executeSetVolumeChannelButton(channel, button);
      } else {
        await executeMuteChannelButton(channel, button);
      }

      if (button.indicatorType === (window.CHANNEL_BUTTON_INDICATOR_TYPES?.toggle || 'toggle')) {
        window.toggleChannelButtonLatchRuntime?.(channelId, buttonId, button.indicatorType);
      }
    } catch (error) {
      console.error('executeChannelButton error', error);
    }

    window.requestChannelButtonRuntimeRefresh?.({
      reason: 'channel-button-action',
      force: true,
      source: 'channel-actions',
      ...meta
    });

    return button;
  }

  function toggleChannelButton(channelId, buttonId, meta = {}) {
    return executeChannelButton(channelId, buttonId, meta);
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
    markChannelConfigured,
    setChannelTitleIconVisible,
    setChannelButtonPlacement,
    addChannelButton,
    updateChannelButton,
    removeChannelButton,
    toggleChannelButton,
    executeChannelButton
  };
})(window);
