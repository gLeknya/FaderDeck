(function initStandaloneButtonActions(window) {
  const STANDALONE_BUTTON_UI_PUSH_RELEASE_MS = 180;
  const STANDALONE_BUTTON_PUSH_SEND_KEY_REPEAT_DELAY_MS = 240;
  const STANDALONE_BUTTON_PUSH_SEND_KEY_REPEAT_MS = 92;
  const MEDIA_ACTION_COOLDOWN_MS = 170;
  const pushActionRuntimeState = new Map();
  const pushReleaseTimerIds = new Map();
  const pushSendKeyRepeatState = new Map();

  function getButtonById(buttonId) {
    return typeof window.findStandaloneButtonState === 'function'
      ? window.findStandaloneButtonState(buttonId)
      : null;
  }

  function getButtons() {
    return typeof window.getStandaloneButtonsState === 'function'
      ? window.getStandaloneButtonsState()
      : [];
  }

  function getApi() {
    return typeof window.getApi === 'function'
      ? window.getApi()
      : (window.getNativeApi?.() ?? null);
  }

  function getTargeting() {
    return window.channelTargeting || null;
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

  function getActionTypes() {
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

  function getInteractionModes() {
    return window.CHANNEL_BUTTON_INTERACTION_MODES || {
      push: 'push',
      toggle: 'toggle',
      trigger: 'trigger'
    };
  }

  function getChannelTargetProcesses(channel = {}) {
    if (getTargeting()?.getChannelTargetMode?.(channel) === window.CHANNEL_TARGET_MODES?.devices) {
      return [];
    }

    if (getTargeting()?.getChannelTargetMode?.(channel) === window.CHANNEL_TARGET_MODES?.focus) {
      return [];
    }

    const explicitTargets = Array.isArray(channel?.targets)
      ? channel.targets
          .map((target) => String(target?.process || '').trim())
          .filter(Boolean)
      : [];

    if (explicitTargets.length > 0) {
      return [...new Set(explicitTargets)];
    }

    const fallbackProcess = String(channel?.app || '').trim();
    return fallbackProcess ? [fallbackProcess] : [];
  }

  function getPrimaryChannelTargetName(channel = {}) {
    const explicitTargetName = Array.isArray(channel?.targets)
      ? channel.targets
          .map((target) => String(target?.name || '').trim())
          .find(Boolean)
      : '';

    return explicitTargetName || String(channel?.appName || '').trim();
  }

  function getLinkedChannel(button = {}) {
    const linkedChannelId = Number(button?.linkedChannelId);

    if (!Number.isFinite(linkedChannelId)) {
      return null;
    }

    return typeof window.findChannelState === 'function'
      ? window.findChannelState(linkedChannelId)
      : null;
  }

  function isStandaloneButtonChannelAction(actionType = '') {
    const actionTypes = getActionTypes();
    return [
      actionTypes.mute,
      actionTypes.solo,
      actionTypes.setVolume,
      actionTypes.toggleAppVisibility
    ].includes(String(actionType || '').trim());
  }

  function isStandaloneButtonMediaAction(actionType = '') {
    const actionTypes = getActionTypes();
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

  function isStandaloneButtonMediaOptionAction(actionType = '') {
    const actionTypes = getActionTypes();
    return [
      actionTypes.mediaRepeat,
      actionTypes.mediaShuffle
    ].includes(String(actionType || '').trim());
  }

  function getMediaTransportCommandForActionType(actionType = '') {
    const actionTypes = getActionTypes();

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
    const actionTypes = getActionTypes();

    if (actionType === actionTypes.mediaRepeat) {
      return 'repeat';
    }

    if (actionType === actionTypes.mediaShuffle) {
      return 'shuffle';
    }

    return '';
  }

  function createButtonTarget(process = '', name = '') {
    const normalizedProcess = String(process || '').trim();

    if (!normalizedProcess) {
      return null;
    }

    return {
      process: normalizedProcess,
      name: String(name || normalizedProcess).trim() || normalizedProcess
    };
  }

  function getButtonRuntimeKey(buttonId) {
    return `standalone:${buttonId}`;
  }

  function getLegacyButtonTargetProcesses(button = {}) {
    const explicitTargets = Array.isArray(button?.targets)
      ? button.targets
          .map((target) => String(target?.process || '').trim())
          .filter(Boolean)
      : [];

    if (explicitTargets.length > 0) {
      return [...new Set(explicitTargets)];
    }

    const fallbackProcess = String(button?.app || '').trim();
    return fallbackProcess ? [fallbackProcess] : [];
  }

  function getButtonTargetProcesses(button = {}) {
    const linkedChannel = getLinkedChannel(button);

    if (linkedChannel) {
      const linkedProcesses = getChannelTargetProcesses(linkedChannel);

      if (linkedProcesses.length > 0) {
        return linkedProcesses;
      }
    }

    return getLegacyButtonTargetProcesses(button);
  }

  async function resolveButtonTargetBinding(button = {}, options = {}) {
    const linkedChannel = getLinkedChannel(button);

    if (linkedChannel && getTargeting()?.resolveChannelTargetBinding) {
      return getTargeting().resolveChannelTargetBinding(linkedChannel, options);
    }

    const appTargets = getLegacyButtonTargetProcesses(button)
      .map((processName) => getTargeting()?.createAppTarget?.({ process: processName, name: processName }) || { process: processName, name: processName });

    return {
      mode: 'apps',
      appTargets,
      deviceTargets: [],
      deviceFlow: 'output',
      focusTarget: null,
      focusExclusions: [],
      hasTargets: appTargets.length > 0
    };
  }

  function getButtonExecutablePath(button = {}) {
    const targetProcesses = getButtonTargetProcesses(button);

    if (!targetProcesses.length) {
      return '';
    }

    const availableApps = typeof window.getAvailableAudioApps === 'function'
      ? window.getAvailableAudioApps()
      : [];
    const matchedApplication = availableApps.find((application) => (
      targetProcesses.includes(String(application?.process || '').trim())
      && String(application?.path || '').trim()
    ));

    return String(matchedApplication?.path || '').trim();
  }

  function getDefaultAudioFlowForActionType(actionType = '') {
    const actionTypes = getActionTypes();

    if (actionType === actionTypes.setDefaultOutputDevice) {
      return 'output';
    }

    if (actionType === actionTypes.setDefaultInputDevice) {
      return 'input';
    }

    return 'all';
  }

  function resolveToggleOptionEnabledState(button = {}, phase = 'press') {
    const interactionModes = getInteractionModes();

    if (button?.actionMode === interactionModes.push) {
      return phase !== 'release';
    }

    const runtimeState = typeof window.getStandaloneButtonState === 'function'
      ? window.getStandaloneButtonState(button?.id)
      : null;

    return !Boolean(runtimeState?.latched);
  }

  function getAllProfileTargetProcesses() {
    const channelProcesses = (window.getChannelsState?.() || []).flatMap((channel) => {
      return getChannelTargetProcesses(channel);
    });

    const standaloneProcesses = getButtons().flatMap((button) => getButtonTargetProcesses(button));
    return [...new Set([...channelProcesses, ...standaloneProcesses])];
  }

  function getPrimaryButtonTargetName(button = {}) {
    const linkedChannel = getLinkedChannel(button);

    if (linkedChannel) {
      return getPrimaryChannelTargetName(linkedChannel);
    }

    const explicitTargetName = Array.isArray(button?.targets)
      ? button.targets
          .map((target) => String(target?.name || '').trim())
          .find(Boolean)
      : '';

    return explicitTargetName || String(button?.appName || '').trim();
  }

  function syncLegacyButtonTargetFields(button = {}) {
    const explicitTargets = Array.isArray(button.targets)
      ? button.targets
          .map((target) => createButtonTarget(target?.process, target?.name))
          .filter(Boolean)
      : [];

    button.targets = explicitTargets;
    button.app = explicitTargets[0]?.process || '';
    button.appName = explicitTargets[0]?.name || '';
    return button;
  }

  function persistProfile() {
    return window.profileActions?.saveRendererProfileToLocal?.() || null;
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
      normalizedSnapshot.map((entry) => api.set_app_mute(entry.process, Boolean(entry.muted)))
    );
  }

  function setPushActionRuntime(buttonId, snapshot = null) {
    pushActionRuntimeState.set(getButtonRuntimeKey(buttonId), snapshot || null);
  }

  function getPushActionRuntime(buttonId) {
    return pushActionRuntimeState.get(getButtonRuntimeKey(buttonId)) || null;
  }

  function clearPushActionRuntime(buttonId) {
    pushActionRuntimeState.delete(getButtonRuntimeKey(buttonId));
  }

  function clearUiPushReleaseTimer(buttonId) {
    const runtimeKey = getButtonRuntimeKey(buttonId);
    const timerId = pushReleaseTimerIds.get(runtimeKey);

    if (!timerId) {
      return;
    }

    window.clearTimeout(timerId);
    pushReleaseTimerIds.delete(runtimeKey);
  }

  function scheduleUiPushRelease(buttonId, meta = {}) {
    const runtimeKey = getButtonRuntimeKey(buttonId);
    clearUiPushReleaseTimer(buttonId);

    const timerId = window.setTimeout(() => {
      pushReleaseTimerIds.delete(runtimeKey);
      executeStandaloneButton(buttonId, {
        ...meta,
        source: 'ui-push-release',
        phase: 'release'
      });
    }, STANDALONE_BUTTON_UI_PUSH_RELEASE_MS);

    pushReleaseTimerIds.set(runtimeKey, timerId);
  }

  function clearPushSendKeyRepeat(buttonId) {
    const runtimeKey = getButtonRuntimeKey(buttonId);
    const repeatState = pushSendKeyRepeatState.get(runtimeKey);

    if (!repeatState) {
      return;
    }

    if (repeatState.delayTimerId) {
      window.clearTimeout(repeatState.delayTimerId);
    }

    if (repeatState.intervalId) {
      window.clearInterval(repeatState.intervalId);
    }

    pushSendKeyRepeatState.delete(runtimeKey);
  }

  function startPushSendKeyRepeat(button) {
    const runtimeKey = getButtonRuntimeKey(button.id);
    clearPushSendKeyRepeat(button.id);

    const repeatState = {
      delayTimerId: null,
      intervalId: null
    };

    repeatState.delayTimerId = window.setTimeout(() => {
      repeatState.delayTimerId = null;
      repeatState.intervalId = window.setInterval(() => {
        executeSendKeyStandaloneButton(button);
      }, STANDALONE_BUTTON_PUSH_SEND_KEY_REPEAT_MS);
    }, STANDALONE_BUTTON_PUSH_SEND_KEY_REPEAT_DELAY_MS);

    pushSendKeyRepeatState.set(runtimeKey, repeatState);
  }

  function updateStandaloneButton(buttonId, updater, meta = {}) {
    const updatedButton = window.updateStandaloneButtonState?.(buttonId, updater, {
      source: 'standalone-button-actions',
      ...meta
    }) || null;

    if (!updatedButton) {
      return null;
    }

    persistProfile();
    window.requestStandaloneButtonRuntimeRefresh?.({
      reason: 'standalone-button-updated',
      force: true
    });
    return updatedButton;
  }

  function removeStandaloneButton(buttonId, meta = {}) {
    const activeSoloKey = window.getActiveStandaloneSoloButtonRuntimeKey?.() || '';
    const removedButton = window.removeStandaloneButtonState?.(buttonId, {
      source: 'standalone-button-actions',
      ...meta
    }) || null;

    if (!removedButton) {
      return null;
    }

    clearUiPushReleaseTimer(buttonId);
    clearPushSendKeyRepeat(buttonId);
    clearPushActionRuntime(buttonId);

    if (activeSoloKey === getButtonRuntimeKey(buttonId)) {
      window.restoreStandaloneSoloRuntime?.();
    }

    persistProfile();
    window.requestStandaloneButtonRuntimeRefresh?.({
      reason: 'standalone-button-removed',
      force: true
    });
    return removedButton;
  }

  function addStandaloneButtonTarget(buttonId, appProcess, appName = '', meta = {}) {
    return updateStandaloneButton(buttonId, (button) => {
      const nextTarget = createButtonTarget(appProcess, appName);

      if (!nextTarget) {
        return button;
      }

      const nextTargets = Array.isArray(button.targets)
        ? button.targets
            .map((target) => createButtonTarget(target?.process, target?.name))
            .filter(Boolean)
        : [];

      if (!nextTargets.some((target) => target.process === nextTarget.process)) {
        nextTargets.push(nextTarget);
      }

      button.targets = nextTargets;
      return syncLegacyButtonTargetFields(button);
    }, {
      type: 'standalone-buttons/update',
      appProcess,
      ...meta
    });
  }

  function removeStandaloneButtonTarget(buttonId, appProcess, meta = {}) {
    return updateStandaloneButton(buttonId, (button) => {
      button.targets = Array.isArray(button.targets)
        ? button.targets.filter((target) => String(target?.process || '').trim() !== String(appProcess || '').trim())
        : [];
      return syncLegacyButtonTargetFields(button);
    }, {
      type: 'standalone-buttons/update',
      appProcess,
      ...meta
    });
  }

  async function setProcessesMuted(processes = [], muted) {
    const api = getApi();
    const normalizedProcesses = [...new Set(
      (Array.isArray(processes) ? processes : [])
        .map((processName) => String(processName || '').trim())
        .filter(Boolean)
    )];

    if (!normalizedProcesses.length || !api?.set_app_mute) {
      return [];
    }

    return Promise.all(
      normalizedProcesses.map((processName) => api.set_app_mute(processName, Boolean(muted)))
    );
  }

  async function setProcessesVolume(processes = [], volume) {
    const api = getApi();
    const normalizedProcesses = [...new Set(
      (Array.isArray(processes) ? processes : [])
        .map((processName) => String(processName || '').trim())
        .filter(Boolean)
    )];
    const nextVolume = Math.max(0, Math.min(100, Number(volume) || 0));

    if (!normalizedProcesses.length || !api?.set_app_volume) {
      return [];
    }

    return Promise.all(
      normalizedProcesses.map((processName) => api.set_app_volume(processName, nextVolume))
    );
  }

  async function executeMuteStandaloneButton(button) {
    const binding = await resolveButtonTargetBinding(button, { force: true });
    const bindingState = await readBindingState(binding, { force: true });
    const allMuted = Boolean(binding.hasTargets) && Boolean(bindingState.muted);

    await setBindingMuted(binding, !allMuted);
    return !allMuted;
  }

  async function executeSoloStandaloneButton(button) {
    const buttonKey = getButtonRuntimeKey(button.id);
    const targetBinding = await resolveButtonTargetBinding(button, { force: true });
    const channels = window.getChannelsState?.() || [];
    const resolvedChannelBindings = await Promise.all(
      channels.map((channel) => getTargeting()?.resolveChannelTargetBinding?.(channel, { force: true }) || null)
    );
    const resolvedStandaloneBindings = await Promise.all(
      getButtons().map((entry) => resolveButtonTargetBinding(entry, { force: true }))
    );
    const activeSoloKey = window.getActiveStandaloneSoloButtonRuntimeKey?.() || null;

    if (activeSoloKey === buttonKey) {
      await window.restoreStandaloneSoloRuntime?.();
      return false;
    }

    const snapshot = (
      await Promise.all(
        [...resolvedChannelBindings, ...resolvedStandaloneBindings]
          .filter(Boolean)
          .map(async (binding) => {
            const state = await readBindingState(binding, { force: true });
            return createBindingSnapshot(binding, state);
          })
      )
    ).flat();
    const otherAppTargets = [...resolvedChannelBindings, ...resolvedStandaloneBindings]
      .filter(Boolean)
      .flatMap((binding) => Array.isArray(binding?.appTargets) ? binding.appTargets : [])
      .filter((target) => !targetBinding.appTargets.some((selectedTarget) => selectedTarget.process === target.process));
    const otherDeviceTargets = [...resolvedChannelBindings, ...resolvedStandaloneBindings]
      .filter(Boolean)
      .flatMap((binding) => Array.isArray(binding?.deviceTargets) ? binding.deviceTargets.map((target) => ({
        ...target,
        flow: target?.flow || binding.deviceFlow
      })) : [])
      .filter((target) => !targetBinding.deviceTargets.some((selectedTarget) => selectedTarget.id === target.id && (selectedTarget.flow || targetBinding.deviceFlow) === target.flow));

    await window.restoreSoloChannelButtonRuntime?.();
    await window.restoreStandaloneSoloRuntime?.();
    await setBindingMuted({
      appTargets: otherAppTargets,
      deviceTargets: otherDeviceTargets,
      deviceFlow: targetBinding.deviceFlow
    }, true);
    await setBindingMuted(targetBinding, false);
    window.activateStandaloneSoloRuntime?.(button.id, snapshot);
    return true;
  }

  async function executeSetVolumeStandaloneButton(button) {
    const binding = await resolveButtonTargetBinding(button, { force: true });
    const nextVolume = Math.max(0, Math.min(100, Number(button?.actionValue) || 0));

    await setBindingVolume(binding, nextVolume);
    return true;
  }

  async function executeSendKeyStandaloneButton(button) {
    const api = getApi();
    const normalizedKey = String(button?.key || '').trim();

    if (!normalizedKey) {
      window.showToast?.('warn', window.t?.('editor.buttonKeyRequired'));
      return false;
    }

    if (!api?.send_key) {
      return false;
    }

    await api.send_key(normalizedKey, getPrimaryButtonTargetName(button));
    return true;
  }

  async function executeToggleAppVisibilityStandaloneButton(button) {
    const api = getApi();
    const binding = await resolveButtonTargetBinding(button, { force: true });
    const primaryProcess = binding.appTargets?.[0]?.process || '';
    const executablePath = getBindingExecutablePath(binding) || getButtonExecutablePath(button);

    if (!primaryProcess && !executablePath) {
      const toastKey = Number.isFinite(Number(button?.linkedChannelId))
        ? 'editor.noTargetAssigned'
        : 'editor.buttonChannelRequired';
      window.showToast?.('warn', window.t?.(toastKey) || 'Choose a fader first.');
      return false;
    }

    if (!api?.set_process_window_visibility) {
      return false;
    }

    const response = await api.set_process_window_visibility(primaryProcess, null, executablePath);
    return Boolean(response?.success);
  }

  async function executeRunUserScriptStandaloneButton(button) {
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

  async function executeLaunchAppStandaloneButton(button) {
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

  async function executeSetDefaultAudioDeviceStandaloneButton(button) {
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

  async function executeMediaStandaloneButton(button, meta = {}) {
    const api = getApi();
    const mediaOptionCommand = getMediaOptionCommandForActionType(button?.actionType);
    const acquireMediaActionLock = getAcquireMediaActionLock();

    if (mediaOptionCommand) {
      if (!api?.set_media_option) {
        return false;
      }

      if (!acquireMediaActionLock(`standalone-option:${mediaOptionCommand}`, meta)) {
        return false;
      }

      const enabled = resolveToggleOptionEnabledState(
        button,
        meta?.phase === 'release' ? 'release' : 'press'
      );
      const response = await api.set_media_option(mediaOptionCommand, enabled, getMediaControllerTargetAppId());
      return Boolean(response?.success);
    }

    const mediaTransportCommand = getMediaTransportCommandForActionType(button?.actionType);

    if (!mediaTransportCommand || !api?.send_media_transport) {
      return false;
    }

    if (!acquireMediaActionLock(`standalone-transport:${mediaTransportCommand}`, meta)) {
      return false;
    }

    const response = await api.send_media_transport(mediaTransportCommand, getMediaControllerTargetAppId());
    return Boolean(response?.success);
  }

  async function activatePushStandaloneButton(button) {
    const targetBinding = await resolveButtonTargetBinding(button, { force: true });
    const actionTypes = getActionTypes();

    if (button.actionType === actionTypes.solo) {
      await executeSoloStandaloneButton(button);
      return true;
    }

    if (button.actionType === actionTypes.sendKey) {
      clearPushActionRuntime(button.id);
      startPushSendKeyRepeat(button);
      return executeSendKeyStandaloneButton(button);
    }

    if (isStandaloneButtonMediaAction(button.actionType)) {
      clearPushActionRuntime(button.id);
      return executeMediaStandaloneButton(button, { phase: 'press' });
    }

    if (
      button.actionType === actionTypes.toggleAppVisibility
      || button.actionType === actionTypes.runUserScript
      || button.actionType === actionTypes.launchApp
      || button.actionType === actionTypes.setDefaultOutputDevice
      || button.actionType === actionTypes.setDefaultInputDevice
    ) {
      clearPushActionRuntime(button.id);

      if (button.actionType === actionTypes.toggleAppVisibility) {
        return executeToggleAppVisibilityStandaloneButton(button);
      }

      if (button.actionType === actionTypes.runUserScript) {
        return executeRunUserScriptStandaloneButton(button);
      }

      if (button.actionType === actionTypes.launchApp) {
        return executeLaunchAppStandaloneButton(button);
      }

      return executeSetDefaultAudioDeviceStandaloneButton(button);
    }

    const bindingState = await readBindingState(targetBinding, { force: true });

    if (button.actionType === actionTypes.setVolume) {
      setPushActionRuntime(button.id, {
        kind: 'binding-state',
        entries: createBindingSnapshot(targetBinding, bindingState)
      });
      await setBindingVolume(targetBinding, Math.max(0, Math.min(100, Number(button?.actionValue) || 0)));
      return true;
    }

    setPushActionRuntime(button.id, {
      kind: 'binding-state',
      entries: createBindingSnapshot(targetBinding, bindingState)
    });
    await setBindingMuted(targetBinding, true);
    return true;
  }

  async function releasePushStandaloneButton(button) {
    const actionTypes = getActionTypes();

    if (button.actionType === actionTypes.solo) {
      clearPushActionRuntime(button.id);
      await window.restoreStandaloneSoloRuntime?.();
      return false;
    }

    if (button.actionType === actionTypes.sendKey) {
      clearPushSendKeyRepeat(button.id);
      clearPushActionRuntime(button.id);
      return false;
    }

    if (isStandaloneButtonMediaAction(button.actionType)) {
      clearPushActionRuntime(button.id);

      if (isStandaloneButtonMediaOptionAction(button.actionType)) {
        await executeMediaStandaloneButton(button, { phase: 'release' });
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
      clearPushActionRuntime(button.id);
      return false;
    }

    const snapshot = getPushActionRuntime(button.id);
    clearPushActionRuntime(button.id);

    if (!snapshot?.entries?.length) {
      return false;
    }

    await restoreBindingSnapshot(snapshot.entries);
    return false;
  }

  async function executeStandaloneButton(buttonId, meta = {}) {
    const button = getButtonById(buttonId);
    const actionTypes = getActionTypes();
    const interactionModes = getInteractionModes();
    const actionMode = Object.values(interactionModes).includes(button?.actionMode)
      ? button.actionMode
      : interactionModes.trigger;
    const indicatorMode = Object.values(interactionModes).includes(button?.indicatorMode)
      ? button.indicatorMode
      : interactionModes.trigger;
    const indicatorEnabled = button?.indicatorEnabled !== false;
    const actionEnabled = Boolean(button?.actionEnabled);
    const phase = meta?.phase === 'release' ? 'release' : 'press';

    if (!button) {
      return null;
    }

    if (phase === 'release') {
      clearUiPushReleaseTimer(buttonId);
    }

    const actionTargetBinding = actionEnabled
      ? await resolveButtonTargetBinding(button, { force: true })
      : null;

    if (
      actionEnabled
      && isStandaloneButtonChannelAction(button.actionType)
      && !actionTargetBinding?.hasTargets
    ) {
      const toastKey = Number.isFinite(Number(button?.linkedChannelId))
        ? 'editor.noTargetAssigned'
        : 'editor.buttonChannelRequired';
      window.showToast?.('warn', window.t?.(toastKey));
      return button;
    }

    if (phase === 'press') {
      if (indicatorEnabled && indicatorMode === interactionModes.push) {
        window.setStandaloneButtonPressedRuntime?.(buttonId, true);
      } else if (indicatorEnabled && indicatorMode === interactionModes.trigger) {
        window.triggerStandaloneButtonPressRuntime?.(buttonId);
      }

      if (
        meta?.source !== 'midi-runtime'
        && (
          indicatorMode === interactionModes.push
          || actionMode === interactionModes.push
        )
      ) {
        scheduleUiPushRelease(buttonId, meta);
      }
    } else if (phase === 'release' && indicatorEnabled && indicatorMode === interactionModes.push) {
      window.setStandaloneButtonPressedRuntime?.(buttonId, false);
    }

    if (window.mediaControllerUi?.isControllerButton?.(button)) {
      if (phase === 'press') {
        try {
          await window.mediaControllerUi.executeControllerButton(button, {
            ...meta,
            phase
          });
        } catch (error) {
          console.error('executeMediaControllerButton error', error);
        }
      }

      window.requestStandaloneButtonRuntimeRefresh?.({
        reason: 'standalone-button-media-controller',
        force: true,
        source: 'standalone-button-actions',
        ...meta
      });
      return getButtonById(buttonId) || button;
    }

    if (!actionEnabled || button.actionType === actionTypes.none) {
      if (phase === 'press' && indicatorEnabled && indicatorMode === interactionModes.toggle) {
        window.toggleStandaloneButtonLatchRuntime?.(buttonId, indicatorMode);
      }

      window.requestStandaloneButtonRuntimeRefresh?.({
        reason: 'standalone-button-action',
        force: true,
        source: 'standalone-button-actions',
        ...meta
      });
      return button;
    }

    try {
      if (phase === 'release') {
        if (actionMode === interactionModes.push) {
          await releasePushStandaloneButton(button);
        }
      } else if (actionMode === interactionModes.push) {
        await activatePushStandaloneButton(button);
      } else if (isStandaloneButtonMediaAction(button.actionType)) {
        await executeMediaStandaloneButton(button, { phase: 'press' });
      } else if (button.actionType === actionTypes.sendKey) {
        await executeSendKeyStandaloneButton(button);
      } else if (button.actionType === actionTypes.solo) {
        await executeSoloStandaloneButton(button);
      } else if (button.actionType === actionTypes.setVolume) {
        await executeSetVolumeStandaloneButton(button);
      } else if (button.actionType === actionTypes.toggleAppVisibility) {
        await executeToggleAppVisibilityStandaloneButton(button);
      } else if (button.actionType === actionTypes.runUserScript) {
        await executeRunUserScriptStandaloneButton(button);
      } else if (button.actionType === actionTypes.launchApp) {
        await executeLaunchAppStandaloneButton(button);
      } else if (
        button.actionType === actionTypes.setDefaultOutputDevice
        || button.actionType === actionTypes.setDefaultInputDevice
      ) {
        await executeSetDefaultAudioDeviceStandaloneButton(button);
      } else {
        await executeMuteStandaloneButton(button);
      }

      if (phase === 'press' && indicatorEnabled && indicatorMode === interactionModes.toggle) {
        window.toggleStandaloneButtonLatchRuntime?.(buttonId, indicatorMode);
      }
    } catch (error) {
      console.error('executeStandaloneButton error', error);
    }

    window.requestStandaloneButtonRuntimeRefresh?.({
      reason: 'standalone-button-action',
      force: true,
      source: 'standalone-button-actions',
      ...meta
    });

    return getButtonById(buttonId) || button;
  }

  window.standaloneButtonActions = {
    updateStandaloneButton,
    removeStandaloneButton,
    addTarget: addStandaloneButtonTarget,
    removeTarget: removeStandaloneButtonTarget,
    executeStandaloneButton,
    getTargetProcesses: getButtonTargetProcesses,
    resolveTargetBinding: resolveButtonTargetBinding,
    getLinkedChannel,
    isChannelActionType: isStandaloneButtonChannelAction,
    isMediaActionType: isStandaloneButtonMediaAction
  };
})(window);
