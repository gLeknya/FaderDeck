(function initChannelActions(window) {
  const CHANNEL_BUTTON_UI_PUSH_RELEASE_MS = 180;
  const CHANNEL_BUTTON_PUSH_SEND_KEY_REPEAT_DELAY_MS = 240;
  const CHANNEL_BUTTON_PUSH_SEND_KEY_REPEAT_MS = 92;
  const pushActionRuntimeState = new Map();
  const pushReleaseTimerIds = new Map();
  const pushSendKeyRepeatState = new Map();

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
      : (window.getNativeApi?.() ?? null);
  }

  function getChannelButtonInteractionModes() {
    return window.CHANNEL_BUTTON_INTERACTION_MODES || {
      push: 'push',
      toggle: 'toggle',
      trigger: 'trigger'
    };
  }

  function getChannelButtonRuntimeKey(channelId, buttonId) {
    return `${channelId}:${buttonId}`;
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

  function getPrimaryChannelTargetName(channel) {
    const explicitTargetName = Array.isArray(channel?.targets)
      ? channel.targets
          .map((target) => String(target?.name || '').trim())
          .find(Boolean)
      : '';

    return explicitTargetName || String(channel?.appName || '').trim();
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

  function createProcessStateSnapshot(processStateMap = new Map()) {
    return Array.from(processStateMap.values()).map((application) => ({
      process: String(application?.process || '').trim(),
      volume: Number(application?.volume) || 0,
      muted: Boolean(application?.muted)
    })).filter((entry) => entry.process);
  }

  function createMuteStateSnapshot(processStateMap = new Map()) {
    return Array.from(processStateMap.values()).map((application) => ({
      process: String(application?.process || '').trim(),
      muted: Boolean(application?.muted)
    })).filter((entry) => entry.process);
  }

  async function restoreProcessStateSnapshot(snapshot = []) {
    const normalizedSnapshot = (Array.isArray(snapshot) ? snapshot : [])
      .map((entry) => ({
        process: String(entry?.process || '').trim(),
        volume: Math.max(0, Math.min(100, Number(entry?.volume) || 0)),
        muted: Boolean(entry?.muted)
      }))
      .filter((entry) => entry.process);
    const api = getApi();

    if (!normalizedSnapshot.length || !api?.set_app_volume || !api?.set_app_mute) {
      return [];
    }

    return Promise.all(
      normalizedSnapshot.map(async (entry) => {
        await api.set_app_volume(entry.process, entry.volume);
        await api.set_app_mute(entry.process, entry.muted);
      })
    );
  }

  async function restoreMuteStateSnapshot(snapshot = []) {
    const normalizedSnapshot = (Array.isArray(snapshot) ? snapshot : [])
      .map((entry) => ({
        process: String(entry?.process || '').trim(),
        muted: Boolean(entry?.muted)
      }))
      .filter((entry) => entry.process);
    const api = getApi();

    if (!normalizedSnapshot.length || !api?.set_app_mute) {
      return [];
    }

    return Promise.all(
      normalizedSnapshot.map((entry) => api.set_app_mute(entry.process, entry.muted))
    );
  }

  function setPushActionRuntime(channelId, buttonId, snapshot = null) {
    pushActionRuntimeState.set(
      getChannelButtonRuntimeKey(channelId, buttonId),
      snapshot || null
    );
  }

  function getPushActionRuntime(channelId, buttonId) {
    return pushActionRuntimeState.get(getChannelButtonRuntimeKey(channelId, buttonId)) || null;
  }

  function clearPushActionRuntime(channelId, buttonId) {
    pushActionRuntimeState.delete(getChannelButtonRuntimeKey(channelId, buttonId));
  }

  function clearUiPushReleaseTimer(channelId, buttonId) {
    const runtimeKey = getChannelButtonRuntimeKey(channelId, buttonId);
    const timerId = pushReleaseTimerIds.get(runtimeKey);

    if (!timerId) {
      return;
    }

    clearTimeout(timerId);
    pushReleaseTimerIds.delete(runtimeKey);
  }

  function clearPushSendKeyRepeat(channelId, buttonId) {
    const runtimeKey = getChannelButtonRuntimeKey(channelId, buttonId);
    const repeatState = pushSendKeyRepeatState.get(runtimeKey);

    if (!repeatState) {
      return;
    }

    if (repeatState.timeoutId) {
      clearTimeout(repeatState.timeoutId);
    }

    if (repeatState.intervalId) {
      clearInterval(repeatState.intervalId);
    }

    pushSendKeyRepeatState.delete(runtimeKey);
  }

  function startPushSendKeyRepeat(channel, button) {
    if (!channel?.id || !button?.id) {
      return;
    }

    const runtimeKey = getChannelButtonRuntimeKey(channel.id, button.id);
    clearPushSendKeyRepeat(channel.id, button.id);

    const repeatState = {
      timeoutId: null,
      intervalId: null,
      inFlight: false
    };

    const fire = () => {
      if (repeatState.inFlight) {
        return;
      }

      repeatState.inFlight = true;
      executeSendKeyChannelButton(channel, button)
        .catch((error) => {
          console.error('push send key repeat error', error);
        })
        .finally(() => {
          repeatState.inFlight = false;
        });
    };

    repeatState.timeoutId = window.setTimeout(() => {
      fire();
      repeatState.intervalId = window.setInterval(fire, CHANNEL_BUTTON_PUSH_SEND_KEY_REPEAT_MS);
    }, CHANNEL_BUTTON_PUSH_SEND_KEY_REPEAT_DELAY_MS);

    pushSendKeyRepeatState.set(runtimeKey, repeatState);
  }

  function scheduleUiPushRelease(channelId, buttonId, meta = {}) {
    const runtimeKey = getChannelButtonRuntimeKey(channelId, buttonId);
    clearUiPushReleaseTimer(channelId, buttonId);

    const timerId = window.setTimeout(() => {
      pushReleaseTimerIds.delete(runtimeKey);
      executeChannelButton(channelId, buttonId, {
        ...meta,
        source: 'ui-push-release',
        phase: 'release'
      });
    }, CHANNEL_BUTTON_UI_PUSH_RELEASE_MS);

    pushReleaseTimerIds.set(runtimeKey, timerId);
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

    (Array.isArray(removedChannel.buttons) ? removedChannel.buttons : []).forEach((button) => {
      clearUiPushReleaseTimer(channelId, button.id);
      clearPushSendKeyRepeat(channelId, button.id);
      clearPushActionRuntime(channelId, button.id);
    });

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

    clearUiPushReleaseTimer(channelId, buttonId);
    clearPushSendKeyRepeat(channelId, buttonId);
    clearPushActionRuntime(channelId, buttonId);

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

  async function executeSendKeyChannelButton(channel, button) {
    const api = getApi();
    const normalizedKey = String(button?.key || '').trim();

    if (!normalizedKey) {
      window.showToast?.('warn', window.t?.('editor.buttonKeyRequired'));
      return false;
    }

    if (!api?.send_key) {
      return false;
    }

    await api.send_key(normalizedKey, getPrimaryChannelTargetName(channel));
    return true;
  }

  async function activatePushChannelButton(channel, button) {
    const targetProcesses = getChannelTargetProcesses(channel);

    if (button.actionType === (window.CHANNEL_BUTTON_ACTION_TYPES?.solo || 'solo')) {
      await executeSoloChannelButton(channel, button);
      return true;
    }

    if (button.actionType === (window.CHANNEL_BUTTON_ACTION_TYPES?.sendKey || 'send-key')) {
      clearPushActionRuntime(channel.id, button.id);
      startPushSendKeyRepeat(channel, button);
      return executeSendKeyChannelButton(channel, button);
    }

    const processStateMap = await getProcessAudioStates(targetProcesses);

    if (button.actionType === (window.CHANNEL_BUTTON_ACTION_TYPES?.setVolume || 'set-volume')) {
      setPushActionRuntime(channel.id, button.id, {
        kind: 'process-state',
        entries: createProcessStateSnapshot(processStateMap)
      });
      await setProcessesVolume(targetProcesses, Math.max(0, Math.min(100, Number(button?.actionValue) || 0)));
      return true;
    }

    setPushActionRuntime(channel.id, button.id, {
      kind: 'mute-state',
      entries: createMuteStateSnapshot(processStateMap)
    });
    await setProcessesMuted(targetProcesses, true);
    return true;
  }

  async function releasePushChannelButton(channel, button) {
    if (button.actionType === (window.CHANNEL_BUTTON_ACTION_TYPES?.solo || 'solo')) {
      clearPushActionRuntime(channel.id, button.id);
      await window.restoreSoloChannelButtonRuntime?.();
      return false;
    }

    if (button.actionType === (window.CHANNEL_BUTTON_ACTION_TYPES?.sendKey || 'send-key')) {
      clearPushSendKeyRepeat(channel.id, button.id);
      clearPushActionRuntime(channel.id, button.id);
      return false;
    }

    const snapshot = getPushActionRuntime(channel.id, button.id);
    clearPushActionRuntime(channel.id, button.id);

    if (!snapshot?.entries?.length) {
      return false;
    }

    if (snapshot.kind === 'mute-state') {
      await restoreMuteStateSnapshot(snapshot.entries);
      return false;
    }

    await restoreProcessStateSnapshot(snapshot.entries);
    return false;
  }

  async function executeChannelButton(channelId, buttonId, meta = {}) {
    const channel = getChannelById(channelId);
    const button = channel?.buttons?.find((item) => item.id === buttonId) || null;
    const targetProcesses = getChannelTargetProcesses(channel);
    const actionTypes = window.CHANNEL_BUTTON_ACTION_TYPES || {
      none: 'none',
      mute: 'mute',
      solo: 'solo',
      setVolume: 'set-volume',
      sendKey: 'send-key'
    };
    const interactionModes = getChannelButtonInteractionModes();
    const actionMode = Object.values(interactionModes).includes(button?.actionMode)
      ? button.actionMode
      : interactionModes.trigger;
    const indicatorMode = Object.values(interactionModes).includes(button?.indicatorMode)
      ? button.indicatorMode
      : interactionModes.trigger;
    const indicatorEnabled = button?.indicatorEnabled !== false;
    const actionEnabled = Boolean(button?.actionEnabled);
    const phase = meta?.phase === 'release' ? 'release' : 'press';

    if (!channel || !button) {
      return null;
    }

    if (phase === 'release') {
      clearUiPushReleaseTimer(channelId, buttonId);
    }

    if (
      actionEnabled
      && button.actionType !== actionTypes.none
      && button.actionType !== actionTypes.sendKey
      && !targetProcesses.length
    ) {
      window.showToast?.('warn', window.t?.('editor.noTargetAssigned'));
      return button;
    }

    if (phase === 'press') {
      if (indicatorEnabled && indicatorMode === interactionModes.push) {
        window.setChannelButtonPressedRuntime?.(channelId, buttonId, true);
      } else if (indicatorEnabled && indicatorMode === interactionModes.trigger) {
        window.triggerChannelButtonPressRuntime?.(channelId, buttonId);
      }

      if (
        meta?.source !== 'midi-runtime'
        && (
          indicatorMode === interactionModes.push
          || actionMode === interactionModes.push
        )
      ) {
        scheduleUiPushRelease(channelId, buttonId, meta);
      }
    } else if (phase === 'release' && indicatorEnabled && indicatorMode === interactionModes.push) {
      window.setChannelButtonPressedRuntime?.(channelId, buttonId, false);
    }

    if (!actionEnabled || button.actionType === actionTypes.none) {
      if (phase === 'press' && indicatorEnabled && indicatorMode === interactionModes.toggle) {
        window.toggleChannelButtonLatchRuntime?.(channelId, buttonId, indicatorMode);
      }

      window.requestChannelButtonRuntimeRefresh?.({
        reason: 'channel-button-action',
        force: true,
        source: 'channel-actions',
        ...meta
      });
      return button;
    }

    try {
      if (phase === 'release') {
        if (actionMode === interactionModes.push) {
          await releasePushChannelButton(channel, button);
        }
      } else if (actionMode === interactionModes.push) {
        await activatePushChannelButton(channel, button);
      } else if (button.actionType === actionTypes.sendKey) {
        await executeSendKeyChannelButton(channel, button);
      } else if (button.actionType === actionTypes.solo) {
        await executeSoloChannelButton(channel, button);
      } else if (button.actionType === actionTypes.setVolume) {
        await executeSetVolumeChannelButton(channel, button);
      } else {
        await executeMuteChannelButton(channel, button);
      }

      if (phase === 'press' && indicatorEnabled && indicatorMode === interactionModes.toggle) {
        window.toggleChannelButtonLatchRuntime?.(channelId, buttonId, indicatorMode);
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
