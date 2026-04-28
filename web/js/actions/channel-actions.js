(function initChannelActions(window) {
  const CHANNEL_BUTTON_UI_PUSH_RELEASE_MS = 180;
  const CHANNEL_BUTTON_PUSH_SEND_KEY_REPEAT_DELAY_MS = 240;
  const CHANNEL_BUTTON_PUSH_SEND_KEY_REPEAT_MS = 92;
  const MEDIA_ACTION_COOLDOWN_MS = 170;
  const pushActionRuntimeState = new Map();
  const pushReleaseTimerIds = new Map();
  const pushSendKeyRepeatState = new Map();

  function getChannelById(channelId) {
    return typeof window.findChannelState === 'function'
      ? window.findChannelState(channelId)
      : null;
  }

  function normalizeChannelVolumeValue(value) {
    const normalizedValue = Math.max(0, Math.min(100, Number(value) || 0));

    if (typeof window.normalizeVolumeValue === 'function') {
      return window.normalizeVolumeValue(normalizedValue);
    }

    return Math.round(normalizedValue * 1000) / 1000;
  }

  function getAvailableApps() {
    return typeof window.getAvailableAudioApps === 'function'
      ? window.getAvailableAudioApps()
      : [];
  }

  function getTargeting() {
    return window.channelTargeting || null;
  }

  function getApi() {
    return typeof window.getApi === 'function'
      ? window.getApi()
      : (window.getNativeApi?.() ?? null);
  }

  function getMediaControllerTargetAppId() {
    return String(window.getMediaControllerTargetAppIdState?.() || '').trim();
  }

  function getAcquireMediaActionLock() {
    if (typeof window.acquireMediaActionLock === 'function') {
      return window.acquireMediaActionLock;
    }

    window.acquireMediaActionLock = (actionKey = '', meta = {}) => {
      const phase = meta?.phase === 'release' ? 'release' : 'press';

      if (phase === 'release') {
        return true;
      }

      if (!window.__faderDeckMediaActionLockState) {
        window.__faderDeckMediaActionLockState = {
          lockedUntil: 0,
          actionKey: ''
        };
      }

      const state = window.__faderDeckMediaActionLockState;
      const now = Date.now();

      if (now < (Number(state.lockedUntil) || 0)) {
        return false;
      }

      state.lockedUntil = now + MEDIA_ACTION_COOLDOWN_MS;
      state.actionKey = String(actionKey || '').trim();
      return true;
    };

    return window.acquireMediaActionLock;
  }

  function getChannelButtonInteractionModes() {
    return window.CHANNEL_BUTTON_INTERACTION_MODES || {
      push: 'push',
      toggle: 'toggle',
      trigger: 'trigger'
    };
  }

  function getChannelButtonActionTypes() {
    return window.CHANNEL_BUTTON_ACTION_TYPES || {
      none: 'none',
      mute: 'mute',
      solo: 'solo',
      setVolume: 'set-volume',
      toggleAppVisibility: 'toggle-app-visibility',
      sendKey: 'send-key',
      mediaPreviousTrack: 'media-previous-track',
      mediaNextTrack: 'media-next-track',
      mediaPlay: 'media-play',
      mediaPause: 'media-pause',
      mediaPlayPause: 'media-play-pause',
      mediaRewind: 'media-rewind',
      mediaFastForward: 'media-fast-forward',
      mediaRepeat: 'media-repeat',
      mediaShuffle: 'media-shuffle',
      runUserScript: 'run-user-script',
      launchApp: 'launch-app',
      setDefaultOutputDevice: 'set-default-output-device',
      setDefaultInputDevice: 'set-default-input-device'
    };
  }

  function isMediaChannelButtonAction(actionType = '') {
    const actionTypes = getChannelButtonActionTypes();
    return [
      actionTypes.mediaPreviousTrack,
      actionTypes.mediaNextTrack,
      actionTypes.mediaPlay,
      actionTypes.mediaPause,
      actionTypes.mediaPlayPause,
      actionTypes.mediaRewind,
      actionTypes.mediaFastForward,
      actionTypes.mediaRepeat,
      actionTypes.mediaShuffle
    ].includes(String(actionType || '').trim());
  }

  function isMediaOptionChannelButtonAction(actionType = '') {
    const actionTypes = getChannelButtonActionTypes();
    return [
      actionTypes.mediaRepeat,
      actionTypes.mediaShuffle
    ].includes(String(actionType || '').trim());
  }

  function getMediaTransportCommandForActionType(actionType = '') {
    const actionTypes = getChannelButtonActionTypes();

    if (actionType === actionTypes.mediaPreviousTrack) {
      return 'previous';
    }

    if (actionType === actionTypes.mediaNextTrack) {
      return 'next';
    }

    if (actionType === actionTypes.mediaPlay) {
      return 'play';
    }

    if (actionType === actionTypes.mediaPause) {
      return 'pause';
    }

    if (actionType === actionTypes.mediaPlayPause) {
      return 'toggle';
    }

    if (actionType === actionTypes.mediaRewind) {
      return 'rewind';
    }

    if (actionType === actionTypes.mediaFastForward) {
      return 'fast-forward';
    }

    return '';
  }

  function getMediaOptionCommandForActionType(actionType = '') {
    const actionTypes = getChannelButtonActionTypes();

    if (actionType === actionTypes.mediaRepeat) {
      return 'repeat';
    }

    if (actionType === actionTypes.mediaShuffle) {
      return 'shuffle';
    }

    return '';
  }

  function getChannelButtonRuntimeKey(channelId, buttonId) {
    return `${channelId}:${buttonId}`;
  }

  function getChannelTargetProcesses(channel) {
    if (getTargeting()?.getChannelTargetMode?.(channel) === window.CHANNEL_TARGET_MODES?.focus) {
      return [];
    }

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

  function getActionTargetChannel(channel, button = {}) {
    if (isFaderTargetChannelButtonAction(button?.actionType)) {
      return channel || null;
    }

    const linkedChannelId = Number(button?.linkedChannelId);

    if (!Number.isFinite(linkedChannelId)) {
      return channel || null;
    }

    return getChannelById(linkedChannelId) || channel || null;
  }

  async function resolveActionTargetBinding(channel, button = {}, options = {}) {
    const actionTargetChannel = getActionTargetChannel(channel, button);
    const targeting = getTargeting();

    if (!actionTargetChannel || !targeting?.resolveChannelTargetBinding) {
      return {
        mode: 'apps',
        appTargets: [],
        deviceTargets: [],
        deviceFlow: 'output',
        focusTarget: null,
        focusExclusions: [],
        hasTargets: false
      };
    }

    return targeting.resolveChannelTargetBinding(actionTargetChannel, options);
  }

  function getButtonTargetProcesses(channel, button = {}) {
    return getChannelTargetProcesses(getActionTargetChannel(channel, button));
  }

  function getPrimaryButtonTargetName(channel, button = {}) {
    const targeting = getTargeting();
    const actionTargetChannel = getActionTargetChannel(channel, button);

    if (targeting?.getBindingPrimaryLabel) {
      const binding = {
        appTargets: targeting.getChannelAppTargets?.(actionTargetChannel) || [],
        deviceTargets: targeting.getChannelDeviceTargets(actionTargetChannel),
        deviceFlow: targeting.getChannelDeviceTargetFlow(actionTargetChannel)
      };
      const label = targeting.getBindingPrimaryLabel(binding) || '';

      if (label) {
        return label;
      }
    }

    return getPrimaryChannelTargetName(actionTargetChannel);
  }

  function getButtonExecutablePath(channel, button = {}) {
    const targetProcesses = getButtonTargetProcesses(channel, button);

    if (!targetProcesses.length) {
      return '';
    }

    const availableApps = getAvailableApps();
    const matchedApplication = availableApps.find((application) => (
      targetProcesses.includes(String(application?.process || '').trim())
      && String(application?.path || '').trim()
    ));

    return String(matchedApplication?.path || '').trim();
  }

  function isFaderTargetChannelButtonAction(actionType = '') {
    const actionTypes = getChannelButtonActionTypes();
    return [
      actionTypes.mute,
      actionTypes.solo,
      actionTypes.setVolume,
      actionTypes.toggleAppVisibility
    ].includes(String(actionType || '').trim());
  }

  function getDefaultAudioFlowForActionType(actionType = '') {
    const actionTypes = getChannelButtonActionTypes();

    if (actionType === actionTypes.setDefaultOutputDevice) {
      return 'output';
    }

    if (actionType === actionTypes.setDefaultInputDevice) {
      return 'input';
    }

    return 'all';
  }

  function resolveToggleOptionEnabledState(channelId, buttonId, actionMode, phase = 'press') {
    const interactionModes = getChannelButtonInteractionModes();

    if (actionMode === interactionModes.push) {
      return phase !== 'release';
    }

    const runtimeState = typeof window.getChannelButtonState === 'function'
      ? window.getChannelButtonState(channelId, buttonId)
      : null;

    return !Boolean(runtimeState?.latched);
  }

  function getAllChannelTargetProcesses() {
    const channels = typeof window.getChannelsState === 'function'
      ? window.getChannelsState()
      : [];
    const standaloneButtons = typeof window.getStandaloneButtonsState === 'function'
      ? window.getStandaloneButtonsState()
      : [];
    const standaloneProcesses = standaloneButtons.flatMap((button) => (
      typeof window.standaloneButtonActions?.getTargetProcesses === 'function'
        ? window.standaloneButtonActions.getTargetProcesses(button)
        : []
    ));

    return [...new Set(
      [
        ...channels.flatMap((channel) => getChannelTargetProcesses(channel)),
        ...standaloneProcesses
      ]
    )];
  }

  async function getAudioDeviceStateMap(deviceTargets = [], flow = 'output', options = {}) {
    const targeting = getTargeting();
    return targeting?.getAudioDeviceStateMap
      ? targeting.getAudioDeviceStateMap(deviceTargets, flow, options)
      : new Map();
  }

  async function readBindingState(binding = {}, options = {}) {
    const targeting = getTargeting();
    return targeting?.readBindingState
      ? targeting.readBindingState(binding, options)
      : {
        hasTargets: false,
        volume: 0,
        muted: false,
        appStateMap: new Map(),
        deviceStateMap: new Map()
      };
  }

  function createBindingSnapshot(binding = {}, state = {}) {
    const targeting = getTargeting();
    return targeting?.createBindingSnapshot
      ? targeting.createBindingSnapshot(binding, state)
      : [];
  }

  function restoreBindingSnapshot(snapshot = []) {
    const targeting = getTargeting();
    return targeting?.restoreBindingSnapshot
      ? targeting.restoreBindingSnapshot(snapshot)
      : Promise.resolve([]);
  }

  function setBindingVolume(binding = {}, volume = 0) {
    const targeting = getTargeting();
    return targeting?.setBindingVolume
      ? targeting.setBindingVolume(binding, volume)
      : Promise.resolve([]);
  }

  function setBindingMuted(binding = {}, muted = false) {
    const targeting = getTargeting();
    return targeting?.setBindingMuted
      ? targeting.setBindingMuted(binding, muted)
      : Promise.resolve([]);
  }

  function getBindingExecutablePath(binding = {}) {
    const targeting = getTargeting();
    return targeting?.getBindingExecutablePath
      ? targeting.getBindingExecutablePath(binding)
      : '';
  }

  async function getAllResolvedProfileBindings(options = {}) {
    const channels = typeof window.getChannelsState === 'function' ? window.getChannelsState() : [];
    return Promise.all(channels.map((channel) => resolveActionTargetBinding(channel, {}, options)));
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

  function setChannelTargetMode(channelId, targetMode, meta = {}) {
    const updatedChannel = window.setChannelTargetModeState?.(channelId, targetMode, {
      source: 'channel-actions',
      ...meta
    }) || getChannelById(channelId);

    if (!updatedChannel) {
      return null;
    }

    window.resetChannelVolumePushRuntime?.(channelId);
    persistProfile();
    window.requestChannelButtonRuntimeRefresh?.({ reason: 'channel-target-mode-changed', force: true });
    return updatedChannel;
  }

  function setChannelDeviceTargetFlow(channelId, flow, meta = {}) {
    const updatedChannel = window.setChannelDeviceTargetFlowState?.(channelId, flow, {
      source: 'channel-actions',
      ...meta
    }) || getChannelById(channelId);

    if (!updatedChannel) {
      return null;
    }

    window.resetChannelVolumePushRuntime?.(channelId);
    persistProfile();
    window.requestChannelButtonRuntimeRefresh?.({ reason: 'channel-device-flow-changed', force: true });
    return updatedChannel;
  }

  function addChannelDeviceTarget(channelId, deviceId, deviceName = '', flow = 'output', meta = {}) {
    const updatedChannel = window.addChannelDeviceTargetState?.(channelId, deviceId, deviceName, flow, {
      source: 'channel-actions',
      ...meta
    }) || getChannelById(channelId);

    if (!updatedChannel) {
      return null;
    }

    window.resetChannelVolumePushRuntime?.(channelId);
    persistProfile();
    window.requestChannelButtonRuntimeRefresh?.({ reason: 'channel-device-target-added', force: true });
    return updatedChannel;
  }

  function removeChannelDeviceTarget(channelId, deviceId, flow = 'output', meta = {}) {
    const updatedChannel = window.removeChannelDeviceTargetState?.(channelId, deviceId, flow, {
      source: 'channel-actions',
      ...meta
    }) || getChannelById(channelId);

    if (!updatedChannel) {
      return null;
    }

    window.resetChannelVolumePushRuntime?.(channelId);
    persistProfile();
    window.requestChannelButtonRuntimeRefresh?.({ reason: 'channel-device-target-removed', force: true });
    return updatedChannel;
  }

  function addChannelFocusExclusion(channelId, appProcess, appName = '', meta = {}) {
    const updatedChannel = window.addChannelFocusExclusionState?.(channelId, appProcess, appName, {
      source: 'channel-actions',
      ...meta
    }) || getChannelById(channelId);

    if (!updatedChannel) {
      return null;
    }

    persistProfile();
    window.requestChannelButtonRuntimeRefresh?.({ reason: 'channel-focus-exclusion-added', force: true });
    return updatedChannel;
  }

  function removeChannelFocusExclusion(channelId, appProcess, meta = {}) {
    const updatedChannel = window.removeChannelFocusExclusionState?.(channelId, appProcess, {
      source: 'channel-actions',
      ...meta
    }) || getChannelById(channelId);

    if (!updatedChannel) {
      return null;
    }

    persistProfile();
    window.requestChannelButtonRuntimeRefresh?.({ reason: 'channel-focus-exclusion-removed', force: true });
    return updatedChannel;
  }

  function setChannelVolume(channelId, volume, meta = {}) {
    const currentChannel = getChannelById(channelId);
    const normalizedVolume = normalizeChannelVolumeValue(volume);

    if (
      currentChannel
      && Math.abs((Number(currentChannel.volume) || 0) - normalizedVolume) < 0.001
    ) {
      return currentChannel;
    }

    const updatedChannel = window.setChannelVolumeState?.(channelId, normalizedVolume, {
      source: 'channel-actions',
      ...meta
    }) || getChannelById(channelId);

    if (!updatedChannel) {
      return null;
    }

    window.commitChannelAudioRuntimeVolumeRuntime?.(
      updatedChannel,
      null,
      window.getChannelOutputVolumeRuntime?.(updatedChannel) ?? normalizedVolume,
      {
        reason: meta?.interaction === 'drag' ? 'channel-volume-drag' : 'channel-volume-change',
        syncFader: false,
        localVolumeChange: true
      }
    );
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

  function setChannelIcon(channelId, iconKey = '', meta = {}) {
    const updatedChannel = window.setChannelIconState?.(channelId, iconKey, {
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
    const actionTargetChannel = getActionTargetChannel(channel, button) || channel;
    const binding = await resolveActionTargetBinding(channel, button, { force: true });
    const bindingState = await readBindingState(binding, { force: true });
    const allMuted = Boolean(binding.hasTargets) && Boolean(bindingState.muted);
    const muteHoldActive = Boolean(
      actionTargetChannel
      && window.isChannelMuteHoldActiveRuntime?.(actionTargetChannel.id)
    );

    if (allMuted) {
      if (muteHoldActive && binding.hasTargets) {
        const nextVolume = window.getChannelOutputVolumeRuntime?.(actionTargetChannel) ?? 0;

        await setBindingVolume(binding, nextVolume);
        window.setChannelCommittedOutputVolumeRuntime?.(actionTargetChannel.id, nextVolume);
        window.syncLinkedAppChannelsFromBindingVolumeRuntime?.(actionTargetChannel, binding, nextVolume);
      }

      await setBindingMuted(binding, false);
      if (actionTargetChannel) {
        window.setChannelMuteHoldRuntime?.(actionTargetChannel.id, false);
      }
    } else {
      await setBindingMuted(binding, true);
      if (actionTargetChannel && binding.hasTargets) {
        window.setChannelMuteHoldRuntime?.(actionTargetChannel.id, true);
      }
    }

    await window.emitChannelVolumeHudRuntime?.(
      actionTargetChannel,
      {
        source: 'channel-button',
        reason: 'channel-button-mute',
        forceFocusRefresh: true,
        forceStateRefresh: true
      }
    );
    return !allMuted;
  }

  async function executeSoloChannelButton(channel, button) {
    const buttonKey = `${channel.id}:${button.id}`;
    const targetBinding = await resolveActionTargetBinding(channel, button, { force: true });
    const resolvedProfileBindings = await getAllResolvedProfileBindings({ force: true });
    const activeSoloKey = window.getActiveSoloChannelButtonKeyRuntime?.() || null;
    const activeStandaloneSoloKey = window.getActiveStandaloneSoloButtonRuntimeKey?.() || null;

    if (activeSoloKey === buttonKey) {
      await window.restoreSoloChannelButtonRuntime?.();
      return false;
    }

    const snapshot = (
      await Promise.all(
        resolvedProfileBindings.map(async (binding) => {
          const bindingState = await readBindingState(binding, { force: true });
          return createBindingSnapshot(binding, bindingState);
        })
      )
    ).flat();
    const otherAppProcesses = [...new Set(
      resolvedProfileBindings
        .flatMap((binding) => Array.isArray(binding?.appTargets) ? binding.appTargets : [])
        .map((target) => String(target?.process || '').trim())
        .filter((processName) => processName && !targetBinding.appTargets.some((target) => target.process === processName))
    )];
    const otherDeviceTargets = resolvedProfileBindings
      .flatMap((binding) => Array.isArray(binding?.deviceTargets) ? binding.deviceTargets.map((target) => ({
        ...target,
        flow: binding.deviceFlow
      })) : [])
      .filter((deviceTarget) => (
        deviceTarget?.id
        && !targetBinding.deviceTargets.some((target) => target.id === deviceTarget.id && targetBinding.deviceFlow === deviceTarget.flow)
      ));

    if (activeStandaloneSoloKey) {
      await window.restoreStandaloneSoloRuntime?.();
    }

    await window.restoreSoloChannelButtonRuntime?.();
    await setBindingMuted({
      appTargets: otherAppProcesses.map((processName) => ({ process: processName })),
      deviceTargets: otherDeviceTargets,
      deviceFlow: targetBinding.deviceFlow
    }, true);
    await setBindingMuted(targetBinding, false);
    window.activateSoloChannelButtonRuntime?.(buttonKey, snapshot);
    return true;
  }

  async function executeSetVolumeChannelButton(channel, button) {
    const binding = await resolveActionTargetBinding(channel, button, { force: true });
    const nextVolume = Math.max(0, Math.min(100, Number(button?.actionValue) || 0));

    await setBindingVolume(binding, nextVolume);
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

    await api.send_key(normalizedKey, getPrimaryButtonTargetName(channel, button));
    return true;
  }

  async function executeToggleAppVisibilityChannelButton(channel, button) {
    const api = getApi();
    const binding = await resolveActionTargetBinding(channel, button, { force: true });
    const primaryProcess = binding.appTargets?.[0]?.process || '';
    const executablePath = getBindingExecutablePath(binding) || getButtonExecutablePath(channel, button);

    if (!primaryProcess && !executablePath) {
      window.showToast?.('warn', window.t?.('editor.noTargetAssigned') || 'No target assigned.');
      return false;
    }

    if (!api?.set_process_window_visibility) {
      return false;
    }

    const response = await api.set_process_window_visibility(primaryProcess, null, executablePath);
    return Boolean(response?.success);
  }

  async function executeRunUserScriptChannelButton(button) {
    const api = getApi();
    const normalizedPath = String(button?.scriptPath || '').trim();

    if (!normalizedPath) {
      window.showToast?.('warn', 'Choose a script file first.');
      return false;
    }

    if (!api?.run_user_script) {
      return false;
    }

    const response = await api.run_user_script(normalizedPath);
    return Boolean(response?.success);
  }

  async function executeLaunchAppChannelButton(button) {
    const api = getApi();
    const normalizedPath = String(button?.launchPath || '').trim();

    if (!normalizedPath) {
      window.showToast?.('warn', 'Choose an application first.');
      return false;
    }

    if (!api?.launch_app) {
      return false;
    }

    const response = await api.launch_app(normalizedPath);
    return Boolean(response?.success);
  }

  async function executeSetDefaultAudioDeviceChannelButton(button) {
    const api = getApi();
    const deviceId = String(button?.deviceId || '').trim();
    const flow = getDefaultAudioFlowForActionType(button?.actionType);

    if (!deviceId) {
      window.showToast?.('warn', 'Choose an audio device first.');
      return false;
    }

    if (!api?.set_default_audio_device) {
      return false;
    }

    const response = await api.set_default_audio_device(deviceId, flow);
    return Boolean(response?.success);
  }

  async function executeMediaChannelButton(channel, button, meta = {}) {
    const api = getApi();
    const mediaOptionCommand = getMediaOptionCommandForActionType(button?.actionType);
    const acquireMediaActionLock = getAcquireMediaActionLock();

    if (mediaOptionCommand) {
      if (!api?.set_media_option) {
        return false;
      }

      if (!acquireMediaActionLock(`channel-option:${mediaOptionCommand}`, meta)) {
        return false;
      }

      const enabled = resolveToggleOptionEnabledState(
        channel?.id,
        button?.id,
        button?.actionMode,
        meta?.phase === 'release' ? 'release' : 'press'
      );
      const response = await api.set_media_option(mediaOptionCommand, enabled, getMediaControllerTargetAppId());
      return Boolean(response?.success);
    }

    const mediaTransportCommand = getMediaTransportCommandForActionType(button?.actionType);

    if (!mediaTransportCommand || !api?.send_media_transport) {
      return false;
    }

    if (!acquireMediaActionLock(`channel-transport:${mediaTransportCommand}`, meta)) {
      return false;
    }

    const response = await api.send_media_transport(mediaTransportCommand, getMediaControllerTargetAppId());
    return Boolean(response?.success);
  }

  async function activatePushChannelButton(channel, button) {
    const targetBinding = await resolveActionTargetBinding(channel, button, { force: true });
    const actionTargetChannel = getActionTargetChannel(channel, button) || channel;
    const actionTypes = getChannelButtonActionTypes();

    if (button.actionType === actionTypes.solo) {
      await executeSoloChannelButton(channel, button);
      return true;
    }

    if (button.actionType === actionTypes.sendKey) {
      clearPushActionRuntime(channel.id, button.id);
      startPushSendKeyRepeat(channel, button);
      return executeSendKeyChannelButton(channel, button);
    }

    if (isMediaChannelButtonAction(button.actionType)) {
      clearPushActionRuntime(channel.id, button.id);
      return executeMediaChannelButton(channel, button, { phase: 'press' });
    }

    if (
      button.actionType === actionTypes.toggleAppVisibility
      || button.actionType === actionTypes.runUserScript
      || button.actionType === actionTypes.launchApp
      || button.actionType === actionTypes.setDefaultOutputDevice
      || button.actionType === actionTypes.setDefaultInputDevice
    ) {
      clearPushActionRuntime(channel.id, button.id);

      if (button.actionType === actionTypes.toggleAppVisibility) {
        return executeToggleAppVisibilityChannelButton(channel, button);
      }

      if (button.actionType === actionTypes.runUserScript) {
        return executeRunUserScriptChannelButton(button);
      }

      if (button.actionType === actionTypes.launchApp) {
        return executeLaunchAppChannelButton(button);
      }

      return executeSetDefaultAudioDeviceChannelButton(button);
    }

    const bindingState = await readBindingState(targetBinding, { force: true });

    if (button.actionType === actionTypes.setVolume) {
      setPushActionRuntime(channel.id, button.id, {
        kind: 'binding-state',
        entries: createBindingSnapshot(targetBinding, bindingState)
      });
      await setBindingVolume(targetBinding, Math.max(0, Math.min(100, Number(button?.actionValue) || 0)));
      return true;
    }

    setPushActionRuntime(channel.id, button.id, {
      kind: 'binding-state',
      entries: createBindingSnapshot(targetBinding, bindingState)
    });
    await setBindingMuted(targetBinding, true);
    if (actionTargetChannel && targetBinding.hasTargets) {
      window.setChannelMuteHoldRuntime?.(actionTargetChannel.id, true);
    }
    return true;
  }

  async function releasePushChannelButton(channel, button) {
    const actionTypes = getChannelButtonActionTypes();

    if (button.actionType === actionTypes.solo) {
      clearPushActionRuntime(channel.id, button.id);
      await window.restoreSoloChannelButtonRuntime?.();
      return false;
    }

    if (button.actionType === actionTypes.sendKey) {
      clearPushSendKeyRepeat(channel.id, button.id);
      clearPushActionRuntime(channel.id, button.id);
      return false;
    }

    if (isMediaChannelButtonAction(button.actionType)) {
      clearPushActionRuntime(channel.id, button.id);

      if (isMediaOptionChannelButtonAction(button.actionType)) {
        await executeMediaChannelButton(channel, button, { phase: 'release' });
      }

      return false;
    }

    if (
      button.actionType === actionTypes.toggleAppVisibility
      || button.actionType === actionTypes.runUserScript
      || button.actionType === actionTypes.launchApp
      || button.actionType === actionTypes.setDefaultOutputDevice
      || button.actionType === actionTypes.setDefaultInputDevice
    ) {
      clearPushActionRuntime(channel.id, button.id);
      return false;
    }

    const snapshot = getPushActionRuntime(channel.id, button.id);
    clearPushActionRuntime(channel.id, button.id);

    if (button.actionType === actionTypes.mute) {
      const actionTargetChannel = getActionTargetChannel(channel, button) || channel;
      const targetBinding = await resolveActionTargetBinding(channel, button, { force: true });
      const muteHoldActive = Boolean(
        actionTargetChannel
        && window.isChannelMuteHoldActiveRuntime?.(actionTargetChannel.id)
      );

      if (muteHoldActive && targetBinding.hasTargets) {
        const nextVolume = window.getChannelOutputVolumeRuntime?.(actionTargetChannel) ?? 0;

        await setBindingVolume(targetBinding, nextVolume);
        await setBindingMuted(targetBinding, false);
        window.setChannelCommittedOutputVolumeRuntime?.(actionTargetChannel.id, nextVolume);
        window.syncLinkedAppChannelsFromBindingVolumeRuntime?.(actionTargetChannel, targetBinding, nextVolume);
        window.setChannelMuteHoldRuntime?.(actionTargetChannel.id, false);
        return false;
      }
    }

    if (!snapshot?.entries?.length) {
      return false;
    }

    await restoreBindingSnapshot(snapshot.entries);
    return false;
  }

  async function executeChannelButton(channelId, buttonId, meta = {}) {
    const channel = getChannelById(channelId);
    const button = channel?.buttons?.find((item) => item.id === buttonId) || null;
    const actionTypes = getChannelButtonActionTypes();
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

    const actionTargetBinding = actionEnabled
      ? await resolveActionTargetBinding(channel, button, { force: true })
      : null;

    if (phase === 'release') {
      clearUiPushReleaseTimer(channelId, buttonId);
    }

    if (
      actionEnabled
      && isFaderTargetChannelButtonAction(button.actionType)
      && !actionTargetBinding?.hasTargets
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
      } else if (isMediaChannelButtonAction(button.actionType)) {
        await executeMediaChannelButton(channel, button, { phase: 'press' });
      } else if (button.actionType === actionTypes.sendKey) {
        await executeSendKeyChannelButton(channel, button);
      } else if (button.actionType === actionTypes.solo) {
        await executeSoloChannelButton(channel, button);
      } else if (button.actionType === actionTypes.setVolume) {
        await executeSetVolumeChannelButton(channel, button);
      } else if (button.actionType === actionTypes.toggleAppVisibility) {
        await executeToggleAppVisibilityChannelButton(channel, button);
      } else if (button.actionType === actionTypes.runUserScript) {
        await executeRunUserScriptChannelButton(button);
      } else if (button.actionType === actionTypes.launchApp) {
        await executeLaunchAppChannelButton(button);
      } else if (
        button.actionType === actionTypes.setDefaultOutputDevice
        || button.actionType === actionTypes.setDefaultInputDevice
      ) {
        await executeSetDefaultAudioDeviceChannelButton(button);
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
    setChannelTargetMode,
    setChannelDeviceTargetFlow,
    addChannelDeviceTarget,
    removeChannelDeviceTarget,
    addChannelFocusExclusion,
    removeChannelFocusExclusion,
    setChannelVolume,
    dismissChannelBindHint,
    renameChannel,
    markChannelConfigured,
    setChannelTitleIconVisible,
    setChannelIcon,
    setChannelButtonPlacement,
    addChannelButton,
    updateChannelButton,
    removeChannelButton,
    toggleChannelButton,
    executeChannelButton,
    getActionTargetChannel,
    getButtonTargetProcesses,
    resolveActionTargetBinding
  };
})(window);
