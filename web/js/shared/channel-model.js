(function initSharedChannelModel(window) {
  const CHANNEL_BUTTON_ACTION_TYPES = Object.freeze({
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
  });

  const CHANNEL_BUTTON_INDICATOR_TYPES = Object.freeze({
    toggle: 'toggle',
    meter: 'meter',
    press: 'press'
  });

  const CHANNEL_BUTTON_INDICATOR_BEHAVIORS = Object.freeze({
    actionState: 'action-state',
    peakMeter: 'peak-meter',
    targetActivity: 'target-activity'
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

  const CHANNEL_BUTTON_INTERACTION_MODES = Object.freeze({
    push: 'push',
    toggle: 'toggle',
    trigger: 'trigger'
  });

  const CHANNEL_TARGET_MODES = Object.freeze({
    apps: 'apps',
    devices: 'devices',
    focus: 'focus'
  });

  const CHANNEL_DEVICE_TARGET_FLOWS = Object.freeze({
    output: 'output',
    input: 'input'
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
    'play-pause',
    'skip-previous',
    'skip-next',
    'stop',
    'rewind',
    'fast-forward',
    'shuffle',
    'repeat',
    'circle',
    'diamond',
    'triangle',
    'wave',
    'bolt',
    'ring'
  ]);

  const DEFAULT_CHANNEL_BUTTON_ACTION_VALUE = 50;
  const MIN_CHANNEL_BUTTON_INDICATOR_THRESHOLD = -60;
  const MAX_CHANNEL_BUTTON_INDICATOR_THRESHOLD = 0;
  const DEFAULT_CHANNEL_BUTTON_INDICATOR_THRESHOLD = -20;

  function normalizeChannelButtonKey(value = '') {
    const normalizedValue = String(value ?? '').trim();
    return normalizedValue ? normalizedValue : null;
  }

  function normalizeChannelButtonPath(value = '') {
    const normalizedValue = String(value ?? '').trim();
    return normalizedValue || '';
  }

  function normalizeChannelButtonDeviceId(value = '') {
    const normalizedValue = String(value ?? '').trim();
    return normalizedValue || '';
  }

  function convertLegacyIndicatorThresholdPercentToDb(value) {
    const normalizedPercent = Math.max(0, Math.min(100, Number(value) || 0));

    if (normalizedPercent <= 0) {
      return MIN_CHANNEL_BUTTON_INDICATOR_THRESHOLD;
    }

    if (normalizedPercent >= 100) {
      return MAX_CHANNEL_BUTTON_INDICATOR_THRESHOLD;
    }

    return Math.max(
      MIN_CHANNEL_BUTTON_INDICATOR_THRESHOLD,
      Math.min(
        MAX_CHANNEL_BUTTON_INDICATOR_THRESHOLD,
        20 * Math.log10(normalizedPercent / 100)
      )
    );
  }

  function normalizeChannelButtonIndicatorThreshold(value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return DEFAULT_CHANNEL_BUTTON_INDICATOR_THRESHOLD;
    }

    if (numericValue > 0) {
      return convertLegacyIndicatorThresholdPercentToDb(numericValue);
    }

    return Math.max(
      MIN_CHANNEL_BUTTON_INDICATOR_THRESHOLD,
      Math.min(MAX_CHANNEL_BUTTON_INDICATOR_THRESHOLD, numericValue)
    );
  }

  function normalizeChannelButtonMode(
    value,
    fallback = CHANNEL_BUTTON_INTERACTION_MODES.trigger
  ) {
    return Object.values(CHANNEL_BUTTON_INTERACTION_MODES).includes(value)
      ? value
      : fallback;
  }

  function resolveLegacyIndicatorMode(button = {}) {
    const explicitMode = normalizeChannelButtonMode(button.indicatorMode, '');

    if (explicitMode) {
      return explicitMode;
    }

    if (button.indicatorType === CHANNEL_BUTTON_INDICATOR_TYPES.toggle) {
      return CHANNEL_BUTTON_INTERACTION_MODES.toggle;
    }

    if (button.indicatorType === CHANNEL_BUTTON_INDICATOR_TYPES.meter) {
      return CHANNEL_BUTTON_INTERACTION_MODES.push;
    }

    return CHANNEL_BUTTON_INTERACTION_MODES.trigger;
  }

  function normalizeChannelButtonIndicatorBehavior(
    value,
    fallback = CHANNEL_BUTTON_INDICATOR_BEHAVIORS.actionState
  ) {
    return Object.values(CHANNEL_BUTTON_INDICATOR_BEHAVIORS).includes(value)
      ? value
      : fallback;
  }

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
    const normalizedText = String(button.text ?? button.title ?? '').trim();
    const icon = CHANNEL_BUTTON_ICON_KEYS.includes(button.icon)
      ? button.icon
      : CHANNEL_BUTTON_ICON_KEYS[0];
    const actionType = Object.values(CHANNEL_BUTTON_ACTION_TYPES).includes(
      button.actionType
    )
      ? button.actionType
      : CHANNEL_BUTTON_ACTION_TYPES.none;
    const actionEnabled =
      typeof button.actionEnabled === 'boolean'
        ? button.actionEnabled
        : actionType !== CHANNEL_BUTTON_ACTION_TYPES.none;
    const actionMode = normalizeChannelButtonMode(button.actionMode);
    const indicatorMode = resolveLegacyIndicatorMode(button);
    const indicatorBehavior = normalizeChannelButtonIndicatorBehavior(
      button.indicatorBehavior,
      button.indicatorType === CHANNEL_BUTTON_INDICATOR_TYPES.meter
        ? CHANNEL_BUTTON_INDICATOR_BEHAVIORS.peakMeter
        : CHANNEL_BUTTON_INDICATOR_BEHAVIORS.actionState
    );
    const indicatorEnabled =
      typeof button.indicatorEnabled === 'boolean'
        ? button.indicatorEnabled
        : true;
    const indicatorModeLinkedToAction =
      typeof button.indicatorModeLinkedToAction === 'boolean'
        ? button.indicatorModeLinkedToAction
        : false;
    const indicatorType = Object.values(
      CHANNEL_BUTTON_INDICATOR_TYPES
    ).includes(button.indicatorType)
      ? button.indicatorType
      : indicatorBehavior === CHANNEL_BUTTON_INDICATOR_BEHAVIORS.peakMeter
        ? CHANNEL_BUTTON_INDICATOR_TYPES.meter
        : indicatorMode === CHANNEL_BUTTON_INTERACTION_MODES.toggle
          ? CHANNEL_BUTTON_INDICATOR_TYPES.toggle
          : CHANNEL_BUTTON_INDICATOR_TYPES.press;
    const contentDisplay = Object.values(CHANNEL_BUTTON_CONTENT_MODES).includes(
      button.contentDisplay
    )
      ? button.contentDisplay
      : CHANNEL_BUTTON_CONTENT_MODES.iconTitle;
    const metaDisplay = Object.values(CHANNEL_BUTTON_META_MODES).includes(
      button.metaDisplay
    )
      ? button.metaDisplay
      : CHANNEL_BUTTON_META_MODES.actionIndicator;
    const midiMapping =
      button.midiMapping && typeof button.midiMapping === 'object'
        ? {
            type:
              button.midiMapping.type === 'control_change'
                ? 'control_change'
                : 'note',
            channel: Number(button.midiMapping.channel) || 0,
            note: Number.isInteger(Number(button.midiMapping.note))
              ? Number(button.midiMapping.note)
              : null,
            control: Number.isInteger(Number(button.midiMapping.control))
              ? Number(button.midiMapping.control)
              : null
          }
        : Number.isInteger(Number(button.note))
          ? {
              type: 'note',
              channel: 0,
              note: Number(button.note),
              control: null
            }
          : null;
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
      id: button.id ?? Date.now() + Math.floor(Math.random() * 1000),
      text: normalizedText,
      icon,
      linkedChannelId: Number.isFinite(Number(button.linkedChannelId))
        ? Number(button.linkedChannelId)
        : null,
      actionEnabled,
      actionType,
      actionMode,
      actionValue,
      scriptPath: normalizeChannelButtonPath(button.scriptPath),
      launchPath: normalizeChannelButtonPath(button.launchPath),
      deviceId: normalizeChannelButtonDeviceId(button.deviceId),
      indicatorEnabled,
      indicatorMode,
      indicatorBehavior,
      indicatorThreshold: normalizeChannelButtonIndicatorThreshold(
        button.indicatorThreshold
      ),
      indicatorModeLinkedToAction,
      indicatorType,
      contentDisplay,
      metaDisplay,
      midiMapping,
      note: Number.isFinite(Number(button.note)) ? Number(button.note) : 70,
      key: normalizeChannelButtonKey(button.key),
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

  function createChannelDeviceTarget(
    deviceId = '',
    name = '',
    flow = CHANNEL_DEVICE_TARGET_FLOWS.output
  ) {
    const normalizedDeviceId = String(deviceId || '').trim();

    if (!normalizedDeviceId) {
      return null;
    }

    const normalizedFlow =
      flow === CHANNEL_DEVICE_TARGET_FLOWS.input
        ? CHANNEL_DEVICE_TARGET_FLOWS.input
        : CHANNEL_DEVICE_TARGET_FLOWS.output;

    return {
      id: normalizedDeviceId,
      name: String(name || normalizedDeviceId).trim() || normalizedDeviceId,
      flow: normalizedFlow
    };
  }

  function cloneChannelTarget(target = {}) {
    return createChannelTarget(target.process, target.name);
  }

  function cloneChannelDeviceTarget(
    target = {},
    fallbackFlow = CHANNEL_DEVICE_TARGET_FLOWS.output
  ) {
    return createChannelDeviceTarget(
      target.id || target.deviceId,
      target.name,
      target.flow || fallbackFlow
    );
  }

  function normalizeChannelTargets(channel = {}) {
    const explicitTargets = Array.isArray(channel.targets)
      ? channel.targets.map(cloneChannelTarget).filter(Boolean)
      : [];

    if (explicitTargets.length > 0) {
      return explicitTargets;
    }

    const fallbackTarget = createChannelTarget(channel.app, channel.appName);
    return fallbackTarget ? [fallbackTarget] : [];
  }

  function normalizeChannelTargetMode(channel = {}) {
    return Object.values(CHANNEL_TARGET_MODES).includes(channel?.targetMode)
      ? channel.targetMode
      : CHANNEL_TARGET_MODES.apps;
  }

  function normalizeChannelDeviceTargetFlow(channel = {}) {
    return channel?.deviceTargetFlow === CHANNEL_DEVICE_TARGET_FLOWS.input
      ? CHANNEL_DEVICE_TARGET_FLOWS.input
      : CHANNEL_DEVICE_TARGET_FLOWS.output;
  }

  function normalizeChannelDeviceTargets(channel = {}) {
    const normalizedFlow = normalizeChannelDeviceTargetFlow(channel);
    const rawTargets = channel?.deviceTargets;
    const outputTargets = (
      Array.isArray(rawTargets)
        ? rawTargets
        : Array.isArray(rawTargets?.output)
          ? rawTargets.output
          : []
    )
      .map((target) =>
        cloneChannelDeviceTarget(target, CHANNEL_DEVICE_TARGET_FLOWS.output)
      )
      .filter(Boolean);
    const inputTargets = (
      Array.isArray(rawTargets?.input) ? rawTargets.input : []
    )
      .map((target) =>
        cloneChannelDeviceTarget(target, CHANNEL_DEVICE_TARGET_FLOWS.input)
      )
      .filter(Boolean);

    return {
      deviceTargetFlow: normalizedFlow,
      deviceTargets: {
        output: outputTargets,
        input: inputTargets
      }
    };
  }

  function normalizeChannelFocusExclusions(channel = {}) {
    return (
      Array.isArray(channel?.focusExcludedTargets)
        ? channel.focusExcludedTargets
        : []
    )
      .map(cloneChannelTarget)
      .filter(Boolean);
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

    return true;
  }

  function normalizeChannelTitleIconState(
    channel = {},
    targets = normalizeChannelTargets(channel)
  ) {
    if (normalizeChannelTargetMode(channel) === CHANNEL_TARGET_MODES.focus) {
      return {
        showTargetIconInTitle: false,
        titleIconTargetProcess: ''
      };
    }

    const enabled = Boolean(channel.showTargetIconInTitle);
    const requestedProcess = String(
      channel.titleIconTargetProcess || ''
    ).trim();
    const resolvedProcess =
      targets.find((target) => target.process === requestedProcess)?.process ||
      targets[0]?.process ||
      '';

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
    const targetMode = normalizeChannelTargetMode(channel);
    const deviceTargetState = normalizeChannelDeviceTargets(channel);
    const focusExcludedTargets = normalizeChannelFocusExclusions(channel);
    const titleIconState = normalizeChannelTitleIconState(channel, targets);

    return {
      ...channel,
      icon: CHANNEL_BUTTON_ICON_KEYS.includes(channel?.icon)
        ? channel.icon
        : '',
      targetMode,
      app: primaryTarget?.process || '',
      appName: primaryTarget?.name || '',
      targets,
      deviceTargetFlow: deviceTargetState.deviceTargetFlow,
      deviceTargets: deviceTargetState.deviceTargets,
      focusExcludedTargets,
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

  window.channelModel = Object.freeze({
    CHANNEL_BUTTON_ACTION_TYPES,
    CHANNEL_BUTTON_INDICATOR_TYPES,
    CHANNEL_BUTTON_INDICATOR_BEHAVIORS,
    CHANNEL_BUTTON_CONTENT_MODES,
    CHANNEL_BUTTON_META_MODES,
    CHANNEL_BUTTON_INTERACTION_MODES,
    CHANNEL_TARGET_MODES,
    CHANNEL_DEVICE_TARGET_FLOWS,
    CHANNEL_BUTTON_ICON_KEYS,
    DEFAULT_CHANNEL_BUTTON_ACTION_VALUE,
    MIN_CHANNEL_BUTTON_INDICATOR_THRESHOLD,
    MAX_CHANNEL_BUTTON_INDICATOR_THRESHOLD,
    DEFAULT_CHANNEL_BUTTON_INDICATOR_THRESHOLD,
    normalizeChannelButtonKey,
    normalizeChannelButtonPath,
    normalizeChannelButtonDeviceId,
    normalizeChannelButtonIndicatorThreshold,
    normalizeChannelButtonMode,
    normalizeChannelButtonIndicatorBehavior,
    resolveLegacyIndicatorMode,
    createDefaultChannelCustomSettings,
    cloneButtonEntity,
    createChannelTarget,
    createChannelDeviceTarget,
    cloneChannelTarget,
    cloneChannelDeviceTarget,
    normalizeChannelTargets,
    normalizeChannelTargetMode,
    normalizeChannelDeviceTargetFlow,
    normalizeChannelDeviceTargets,
    normalizeChannelFocusExclusions,
    cloneChannelCustomSettings,
    normalizeChannelConfiguredFlag,
    normalizeChannelTitleIconState,
    normalizeChannelButtonPlacement,
    cloneChannelEntity
  });
})(window);
