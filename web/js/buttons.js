const MAX_CHANNEL_BUTTONS = 4;
const MAX_STANDALONE_BUTTONS = 24;
let standaloneButtonsUiStateSyncInitialized = false;
let buttonModalInitialized = false;
const buttonModalSessionState = {
  currentConfig: null
};
const CHANNEL_BUTTON_PRESS_MS = 180;
const CHANNEL_BUTTON_RUNTIME_REFRESH_MS = 700;
const channelButtonRuntimeState = {
  initialized: false,
  pollTimerId: null,
  refreshInFlight: null,
  refreshQueued: false,
  byKey: new Map(),
  pressTimers: new Map(),
  listeners: new Set(),
  activeSoloKey: null,
  soloSnapshot: null
};

function getChannelButtonActionTypes() {
  return window.CHANNEL_BUTTON_ACTION_TYPES || {
    mute: 'mute',
    solo: 'solo',
    setVolume: 'set-volume'
  };
}

function getChannelButtonIndicatorTypes() {
  return window.CHANNEL_BUTTON_INDICATOR_TYPES || {
    toggle: 'toggle',
    meter: 'meter',
    press: 'press'
  };
}

function getChannelButtonContentModes() {
  return window.CHANNEL_BUTTON_CONTENT_MODES || {
    iconTitle: 'icon-title',
    iconOnly: 'icon-only',
    titleOnly: 'title-only'
  };
}

function getChannelButtonMetaModes() {
  return window.CHANNEL_BUTTON_META_MODES || {
    actionIndicator: 'action-indicator',
    actionOnly: 'action-only',
    indicatorOnly: 'indicator-only'
  };
}

function normalizeChannelButton(button = {}) {
  return typeof window.cloneChannelButtonEntity === 'function'
    ? window.cloneChannelButtonEntity(button)
    : { ...button };
}

function getChannelButtonRuntimeKey(channelId, buttonId) {
  return `${channelId}:${buttonId}`;
}

function getChannelButtonStateByKey(buttonKey) {
  return channelButtonRuntimeState.byKey.get(buttonKey) || {
    actionActive: false,
    visualActive: false,
    indicatorActive: false,
    meterLevel: 0,
    latched: false,
    flashActive: false,
    pressed: false,
    hasTargets: false,
    buttonIndicatorType: getChannelButtonIndicatorTypes().press
  };
}

function getChannelButtonState(channelId, buttonId) {
  return getChannelButtonStateByKey(getChannelButtonRuntimeKey(channelId, buttonId));
}

function escapeButtonMarkup(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getButtonTargetProcesses(channel = {}) {
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

function readButtonAudioStateMap(processes = []) {
  const normalizedProcesses = [...new Set(
    (Array.isArray(processes) ? processes : [])
      .map((processName) => String(processName || '').trim())
      .filter(Boolean)
  )];
  const api = typeof getApi === 'function' ? getApi() : (window.pywebview?.api ?? null);

  if (!normalizedProcesses.length || !api?.get_audio_states) {
    return Promise.resolve(new Map());
  }

  return api.get_audio_states(normalizedProcesses)
    .then((response) => new Map(
      (Array.isArray(response?.applications) ? response.applications : []).map((application) => [
        String(application?.process || '').trim().toLowerCase(),
        application
      ])
    ))
    .catch((error) => {
      console.error('get_audio_states error', error);
      return new Map();
    });
}

function aggregateButtonTargetState(targetProcesses = [], audioStateMap = new Map()) {
  const states = targetProcesses
    .map((processName) => audioStateMap.get(String(processName || '').trim().toLowerCase()))
    .filter(Boolean);

  if (!states.length) {
    return {
      hasTargets: targetProcesses.length > 0,
      volume: 0,
      muted: false
    };
  }

  const volume = states.reduce((sum, state) => sum + (Number(state?.volume) || 0), 0) / states.length;
  const muted = states.every((state) => Boolean(state?.muted));

  return {
    hasTargets: true,
    volume,
    muted
  };
}

function getChannelButtonActionLabel(button = {}, options = {}) {
  const normalizedButton = normalizeChannelButton(button);
  const actionTypes = getChannelButtonActionTypes();
  const isCompact = options.compact !== false;

  if (normalizedButton.actionType === actionTypes.solo) {
    return isCompact ? 'SOLO' : t('editor.buttonActionSolo');
  }

  if (normalizedButton.actionType === actionTypes.setVolume) {
    return isCompact
      ? `${Math.round(Number(normalizedButton.actionValue) || 0)}%`
      : t('editor.buttonActionSetVolume');
  }

  return isCompact ? 'MUTE' : t('editor.buttonActionMute');
}

function renderChannelButtonIconSvg(iconKey = 'square') {
  if (iconKey === 'speaker') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 10H8L13 6V18L8 14H5Z"></path>
        <path d="M16 9C17.4 10.2 17.4 13.8 16 15"></path>
      </svg>
    `;
  }

  if (iconKey === 'mute') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 10H8L13 6V18L8 14H5Z"></path>
        <path d="M16 9L20 15"></path>
        <path d="M20 9L16 15"></path>
      </svg>
    `;
  }

  if (iconKey === 'layers') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4L20 8L12 12L4 8Z"></path>
        <path d="M4 12L12 16L20 12"></path>
        <path d="M4 16L12 20L20 16"></path>
      </svg>
    `;
  }

  if (iconKey === 'target') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="7"></circle>
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M12 2V5"></path>
        <path d="M12 19V22"></path>
        <path d="M2 12H5"></path>
        <path d="M19 12H22"></path>
      </svg>
    `;
  }

  if (iconKey === 'flash') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M13 2L6 13H11L10 22L18 10H13Z"></path>
      </svg>
    `;
  }

  if (iconKey === 'play') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 6L18 12L8 18Z"></path>
      </svg>
    `;
  }

  if (iconKey === 'pause') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 6V18"></path>
        <path d="M16 6V18"></path>
      </svg>
    `;
  }

  if (iconKey === 'circle') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="6"></circle>
      </svg>
    `;
  }

  if (iconKey === 'diamond') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5L19 12L12 19L5 12Z"></path>
      </svg>
    `;
  }

  if (iconKey === 'triangle') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 6L18 18H6Z"></path>
      </svg>
    `;
  }

  if (iconKey === 'wave') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 13C5 13 5.5 9 7.5 9C9.5 9 10 15 12 15C14 15 14.5 9 16.5 9C18.5 9 19 13 21 13"></path>
      </svg>
    `;
  }

  if (iconKey === 'bolt') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M13 3L7 13H12L11 21L17 11H12Z"></path>
      </svg>
    `;
  }

  if (iconKey === 'ring') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="7"></circle>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
    `;
  }

  if (iconKey === 'square') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="6" y="6" width="12" height="12" rx="3" ry="3"></rect>
      </svg>
    `;
  }

  return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3L13.8 8.2L19 6.8L16.2 11.3L21 13.8L15.5 14.1L16.3 19.5L12 16.3L7.7 19.5L8.5 14.1L3 13.8L7.8 11.3L5 6.8L10.2 8.2Z"></path>
    </svg>
  `;
}

function renderChannelButtonIconMarkup(button = {}, className = 'button-icon') {
  return `<span class="${className} button-icon--svg">${renderChannelButtonIconSvg(normalizeChannelButton(button).icon)}</span>`;
}

function buildChannelButtonPresentation(channel, button) {
  const normalizedButton = normalizeChannelButton(button);
  const contentModes = getChannelButtonContentModes();
  const runtimeKey = getChannelButtonRuntimeKey(channel.id, normalizedButton.id);
  const runtimeState = getChannelButtonStateByKey(runtimeKey);
  const showIcon = normalizedButton.contentDisplay !== contentModes.titleOnly;
  const showTitle = normalizedButton.contentDisplay !== contentModes.iconOnly;

  return {
    runtimeKey,
    button: normalizedButton,
    runtimeState,
    isActive: Boolean(runtimeState.visualActive || runtimeState.flashActive),
    showIcon,
    showTitle
  };
}

function renderChannelButtonBodyMarkup(channel, button) {
  const presentation = buildChannelButtonPresentation(channel, button);

  return `
    <span class="channel-button-face" data-channel-button-runtime-key="${presentation.runtimeKey}">
      <span class="channel-button-main">
        ${presentation.showIcon ? renderChannelButtonIconMarkup(presentation.button) : ''}
        ${presentation.showTitle && String(presentation.button.text || '').trim()
          ? `<span class="button-label">${escapeButtonMarkup(presentation.button.text)}</span>`
          : ''}
      </span>
    </span>
  `;
}

function getChannelButtonClassName(channel, button) {
  const presentation = buildChannelButtonPresentation(channel, button);
  const classNames = ['channel-side-button'];

  if (presentation.isActive) {
    classNames.push('active');
  }

  if (presentation.runtimeState.pressed) {
    classNames.push('is-pressed-indicator');
  }

  if (presentation.button.contentDisplay) {
    classNames.push(`channel-side-button--${presentation.button.contentDisplay}`);
  }

  if (presentation.button.indicatorType) {
    classNames.push(`channel-side-button--indicator-${presentation.button.indicatorType}`);
  }

  return classNames.join(' ');
}

function getChannelButtonRuntimeState(channelId, buttonId) {
  return getChannelButtonState(channelId, buttonId);
}

function emitChannelButtonRuntimeChange(meta = {}) {
  refreshChannelButtonRuntimeDom();
  window.midiService?.syncChannelButtonIndicators?.({
    reason: 'channel-button-runtime',
    ...meta
  });
  channelButtonRuntimeState.listeners.forEach((listener) => listener(meta));
}

function areChannelButtonStatesEqual(nextState = {}, previousState = {}) {
  return (
    Boolean(nextState.actionActive) === Boolean(previousState.actionActive)
    && Boolean(nextState.visualActive) === Boolean(previousState.visualActive)
    && Boolean(nextState.indicatorActive) === Boolean(previousState.indicatorActive)
    && Boolean(nextState.latched) === Boolean(previousState.latched)
    && Boolean(nextState.flashActive) === Boolean(previousState.flashActive)
    && Boolean(nextState.pressed) === Boolean(previousState.pressed)
    && Boolean(nextState.hasTargets) === Boolean(previousState.hasTargets)
    && Math.abs((Number(nextState.meterLevel) || 0) - (Number(previousState.meterLevel) || 0)) < 0.005
  );
}

function refreshChannelButtonRuntimeDom() {
  document.querySelectorAll('[data-channel-button-runtime-key]').forEach((element) => {
    const runtimeKey = String(element.dataset.channelButtonRuntimeKey || '').trim();
    const state = getChannelButtonStateByKey(runtimeKey);
    const buttonRoot = element.closest('.channel-side-button');

    if (buttonRoot) {
      buttonRoot.classList.toggle('active', Boolean(state.visualActive || state.flashActive));
      buttonRoot.classList.toggle('is-pressed-indicator', Boolean(state.pressed));
      buttonRoot.classList.toggle('is-binding-flash', Boolean(state.flashActive));
      buttonRoot.style.setProperty('--button-meter-level', String(Math.max(0, Math.min(1, state.meterLevel || 0))));
    }
  });
}

function setChannelButtonPressedState(channelId, buttonId, isPressed) {
  const runtimeKey = getChannelButtonRuntimeKey(channelId, buttonId);
  const previousState = getChannelButtonStateByKey(runtimeKey);
  const indicatorTypes = getChannelButtonIndicatorTypes();
  const buttonIndicatorType = previousState.buttonIndicatorType || indicatorTypes.press;
  const meterVisualActive = Math.max(0, Math.min(1, previousState.meterLevel || 0)) > 0.01;
  const nextState = {
    ...previousState,
    visualActive: buttonIndicatorType === indicatorTypes.press
      ? Boolean(isPressed)
      : buttonIndicatorType === indicatorTypes.meter
        ? meterVisualActive
        : Boolean(previousState.latched),
    pressed: Boolean(isPressed),
    indicatorActive: buttonIndicatorType === indicatorTypes.press
      ? Boolean(isPressed)
      : buttonIndicatorType === indicatorTypes.meter
        ? meterVisualActive
        : Boolean(previousState.latched)
  };

  channelButtonRuntimeState.byKey.set(runtimeKey, nextState);
  emitChannelButtonRuntimeChange({
    type: 'channel-button-runtime/press',
    channelId,
    buttonId
  });
}

function triggerChannelButtonPressRuntime(channelId, buttonId) {
  const runtimeKey = getChannelButtonRuntimeKey(channelId, buttonId);
  const existingTimerId = channelButtonRuntimeState.pressTimers.get(runtimeKey);

  if (existingTimerId) {
    clearTimeout(existingTimerId);
  }

  setChannelButtonPressedState(channelId, buttonId, true);

  const timerId = window.setTimeout(() => {
    channelButtonRuntimeState.pressTimers.delete(runtimeKey);
    setChannelButtonPressedState(channelId, buttonId, false);
  }, CHANNEL_BUTTON_PRESS_MS);

  channelButtonRuntimeState.pressTimers.set(runtimeKey, timerId);
}

function toggleChannelButtonLatchRuntime(channelId, buttonId, indicatorTypeHint = null) {
  const indicatorTypes = getChannelButtonIndicatorTypes();
  const runtimeKey = getChannelButtonRuntimeKey(channelId, buttonId);
  const previousState = getChannelButtonStateByKey(runtimeKey);
  const buttonIndicatorType = indicatorTypeHint || previousState.buttonIndicatorType || indicatorTypes.press;

  if (buttonIndicatorType !== indicatorTypes.toggle) {
    return previousState;
  }

  const nextLatched = !Boolean(previousState.latched);
  const nextState = {
    ...previousState,
    latched: nextLatched,
    visualActive: nextLatched,
    indicatorActive: nextLatched,
    buttonIndicatorType
  };

  channelButtonRuntimeState.byKey.set(runtimeKey, nextState);
  emitChannelButtonRuntimeChange({
    type: 'channel-button-runtime/latch',
    channelId,
    buttonId
  });
  return nextState;
}

function setChannelButtonFlashState(channelId, buttonId, isActive) {
  const runtimeKey = getChannelButtonRuntimeKey(channelId, buttonId);
  const previousState = getChannelButtonStateByKey(runtimeKey);
  const nextState = {
    ...previousState,
    flashActive: Boolean(isActive)
  };
  channelButtonRuntimeState.byKey.set(runtimeKey, nextState);
  emitChannelButtonRuntimeChange({
    type: 'channel-button-runtime/flash',
    channelId,
    buttonId
  });
}

function flashChannelButtonBindingRuntime(channelId, buttonId) {
  const sequence = [0, 120, 240, 360];
  sequence.forEach((delay, index) => {
    window.setTimeout(() => {
      setChannelButtonFlashState(channelId, buttonId, index % 2 === 0);
    }, delay);
  });

  window.setTimeout(() => {
    setChannelButtonFlashState(channelId, buttonId, false);
  }, 460);
}

function activateSoloChannelButtonRuntime(buttonKey, snapshot = []) {
  channelButtonRuntimeState.activeSoloKey = String(buttonKey || '').trim() || null;
  channelButtonRuntimeState.soloSnapshot = Array.isArray(snapshot) ? snapshot : [];
}

function restoreSoloChannelButtonRuntime() {
  const snapshot = Array.isArray(channelButtonRuntimeState.soloSnapshot)
    ? channelButtonRuntimeState.soloSnapshot.slice()
    : [];
  const api = typeof getApi === 'function' ? getApi() : (window.pywebview?.api ?? null);

  channelButtonRuntimeState.activeSoloKey = null;
  channelButtonRuntimeState.soloSnapshot = null;

  if (!snapshot.length || !api?.set_app_mute) {
    return Promise.resolve();
  }

  return Promise.all(
    snapshot.map((entry) => api.set_app_mute(entry.process, Boolean(entry.muted)))
  );
}

function getActiveSoloChannelButtonKeyRuntime() {
  return channelButtonRuntimeState.activeSoloKey;
}

function refreshChannelButtonRuntime(force = false) {
  if (channelButtonRuntimeState.refreshInFlight) {
    if (force) {
      channelButtonRuntimeState.refreshQueued = true;
    }
    return channelButtonRuntimeState.refreshInFlight;
  }

  channelButtonRuntimeState.refreshInFlight = (async () => {
    const channels = typeof getChannelsState === 'function' ? getChannelsState() : [];
    const buttonEntries = channels.flatMap((channel) => (
      (Array.isArray(channel?.buttons) ? channel.buttons : []).map((button) => ({
        channel,
        button: normalizeChannelButton(button)
      }))
    ));

    if (!buttonEntries.length) {
      if (channelButtonRuntimeState.byKey.size) {
        channelButtonRuntimeState.byKey.clear();
        emitChannelButtonRuntimeChange({ type: 'channel-button-runtime/cleared' });
      }
      return;
    }

    const trackedProcesses = [...new Set(buttonEntries.flatMap(({ channel }) => getButtonTargetProcesses(channel)))];
    const audioStateMap = await readButtonAudioStateMap(trackedProcesses);
    const nextStates = new Map();

    buttonEntries.forEach(({ channel, button }) => {
      const runtimeKey = getChannelButtonRuntimeKey(channel.id, button.id);
      const aggregateState = aggregateButtonTargetState(getButtonTargetProcesses(channel), audioStateMap);
      const previousState = getChannelButtonStateByKey(runtimeKey);
      const indicatorTypes = getChannelButtonIndicatorTypes();
      const meterLevel = aggregateState.muted
        ? 0
        : Math.max(0, Math.min(1, (aggregateState.volume || 0) / 100));
      const latched = Boolean(previousState.latched);
      let actionActive = false;

      if (button.actionType === getChannelButtonActionTypes().solo) {
        actionActive = channelButtonRuntimeState.activeSoloKey === runtimeKey;
      } else if (button.actionType === getChannelButtonActionTypes().setVolume) {
        actionActive = aggregateState.hasTargets
          && !aggregateState.muted
          && Math.abs((aggregateState.volume || 0) - (Number(button.actionValue) || 0)) <= 1;
      } else {
        actionActive = aggregateState.hasTargets && aggregateState.muted;
      }

      const indicatorActive = button.indicatorType === indicatorTypes.press
        ? Boolean(previousState.pressed)
        : button.indicatorType === indicatorTypes.meter
          ? meterLevel > 0.01
          : latched;
      const visualActive = button.indicatorType === indicatorTypes.press
        ? Boolean(previousState.pressed)
        : button.indicatorType === indicatorTypes.meter
          ? meterLevel > 0.01
          : latched;

      nextStates.set(runtimeKey, {
        actionActive,
        visualActive,
        indicatorActive,
        meterLevel,
        latched,
        pressed: Boolean(previousState.pressed),
        hasTargets: aggregateState.hasTargets,
        buttonIndicatorType: button.indicatorType
      });
    });

    let hasChanged = nextStates.size !== channelButtonRuntimeState.byKey.size;

    if (!hasChanged) {
      nextStates.forEach((nextState, runtimeKey) => {
        if (!areChannelButtonStatesEqual(nextState, channelButtonRuntimeState.byKey.get(runtimeKey))) {
          hasChanged = true;
        }
      });
    }

    channelButtonRuntimeState.byKey = nextStates;

    if (hasChanged) {
      emitChannelButtonRuntimeChange({ type: 'channel-button-runtime/updated' });
    } else {
      refreshChannelButtonRuntimeDom();
    }
  })();

  return channelButtonRuntimeState.refreshInFlight.finally(() => {
    channelButtonRuntimeState.refreshInFlight = null;

    if (channelButtonRuntimeState.refreshQueued) {
      channelButtonRuntimeState.refreshQueued = false;
      refreshChannelButtonRuntime(true);
    }
  });
}

function requestChannelButtonRuntimeRefresh(options = {}) {
  return refreshChannelButtonRuntime(Boolean(options?.force));
}

function syncChannelButtonRuntimePolling() {
  const hasChannelButtons = (typeof getChannelsState === 'function' ? getChannelsState() : []).some((channel) => (
    Array.isArray(channel?.buttons) && channel.buttons.length > 0
  ));

  if (!hasChannelButtons) {
    if (channelButtonRuntimeState.pollTimerId) {
      clearInterval(channelButtonRuntimeState.pollTimerId);
      channelButtonRuntimeState.pollTimerId = null;
    }
    return;
  }

  if (channelButtonRuntimeState.pollTimerId) {
    return;
  }

  channelButtonRuntimeState.pollTimerId = window.setInterval(() => {
    requestChannelButtonRuntimeRefresh();
  }, CHANNEL_BUTTON_RUNTIME_REFRESH_MS);
}

function findChannel(channelId) {
  return typeof findChannelState === 'function' ? findChannelState(channelId) : null;
}

function findStandaloneButton(buttonId) {
  return typeof findStandaloneButtonState === 'function' ? findStandaloneButtonState(buttonId) : null;
}

function getStandaloneLayoutItems() {
  return typeof getLayoutItemsByZoneState === 'function'
    ? getLayoutItemsByZoneState(window.LAYOUT_ZONES?.standalone || 'standalone')
    : (getStandaloneButtonsState?.() || []).map((button) => ({
      id: `layout-standalone-button-${button.id}`,
      type: window.LAYOUT_ITEM_TYPES?.standaloneButton || 'standalone-button',
      zone: window.LAYOUT_ZONES?.standalone || 'standalone',
      entityId: button.id
    }));
}

function getStandaloneLayoutEditModeEnabled() {
  // Park marker: keep persisted layout-backed rendering active, but disable
  // editor-facing controls and interactions until future reactivation.
  if (window.isLayoutEditorParked?.()) {
    return false;
  }

  return typeof isLayoutEditModeEnabledState === 'function'
    ? isLayoutEditModeEnabledState()
    : false;
}

function getSelectedStandaloneLayoutItemId() {
  return typeof getSelectedLayoutItemIdState === 'function'
    ? getSelectedLayoutItemIdState()
    : null;
}

function getHoveredStandaloneLayoutItemId() {
  return typeof getHoveredLayoutItemIdState === 'function'
    ? getHoveredLayoutItemIdState()
    : null;
}

function getDraggedStandaloneLayoutItemId() {
  return typeof getDraggedLayoutItemIdState === 'function'
    ? getDraggedLayoutItemIdState()
    : null;
}

function getStandaloneLayoutDropPreview() {
  return typeof getLayoutDropPreviewState === 'function'
    ? getLayoutDropPreviewState()
    : null;
}

function getStandaloneLayoutItemClassName(layoutItem) {
  const classNames = ['surface-layout-item', 'surface-layout-item--standalone'];

  if (window.isLayoutEditorParked?.()) {
    if (layoutItem.type === (window.LAYOUT_ITEM_TYPES?.spacer || 'spacer')) {
      classNames.push('layout-spacer-shell');
    }

    return classNames.join(' ');
  }

  const selectedItemId = getSelectedStandaloneLayoutItemId();
  const hoveredItemId = getHoveredStandaloneLayoutItemId();
  const draggedItemId = getDraggedStandaloneLayoutItemId();
  const dropPreview = getStandaloneLayoutDropPreview();

  if (selectedItemId === layoutItem.id) {
    classNames.push('is-selected');
  }

  if (hoveredItemId === layoutItem.id) {
    classNames.push('is-hovered');
  }

  if (draggedItemId === layoutItem.id) {
    classNames.push('is-dragging-layout-item');
  }

  if (dropPreview?.itemId === layoutItem.id) {
    classNames.push(dropPreview.position === 'before' ? 'is-drop-before' : 'is-drop-after');
  }

  if (layoutItem.type === (window.LAYOUT_ITEM_TYPES?.spacer || 'spacer')) {
    classNames.push('layout-spacer-shell');
  }

  return classNames.join(' ');
}

function getStandaloneLayoutInteractionAttributes(layoutItem) {
  if (!layoutItem || !getStandaloneLayoutEditModeEnabled()) {
    return '';
  }

  const zone = layoutItem.zone || window.LAYOUT_ZONES?.standalone || 'standalone';

  return `
    draggable="true"
    ondragstart="startLayoutSurfaceDrag(event, '${layoutItem.id}')"
    ondragend="endLayoutSurfaceDrag(event)"
    ondragover="previewLayoutSurfaceDrop(event, '${zone}', '${layoutItem.id}')"
    ondrop="dropLayoutSurfaceItem(event, '${zone}', '${layoutItem.id}')"
  `;
}

function renderStandaloneLayoutEditOverlay(layoutItem, labelKey) {
  if (!layoutItem || !getStandaloneLayoutEditModeEnabled()) {
    return '';
  }

  const isSelected = getSelectedStandaloneLayoutItemId() === layoutItem.id;
  const isHovered = getHoveredStandaloneLayoutItemId() === layoutItem.id;

  return `
    <button
      class="layout-edit-overlay ${isSelected ? 'is-selected' : ''} ${isHovered ? 'is-hovered' : ''}"
      type="button"
      onclick="selectLayoutSurfaceItem('${layoutItem.id}')"
      onmouseenter="hoverLayoutSurfaceItem('${layoutItem.id}')"
      onmouseleave="clearLayoutSurfaceHover()">
      <span class="layout-edit-overlay__label">${t(labelKey)}</span>
    </button>
  `;
}

function renderStandaloneLayoutItemActions(layoutItem) {
  if (!layoutItem || !getStandaloneLayoutEditModeEnabled()) {
    return '';
  }

  if (layoutItem.type !== (window.LAYOUT_ITEM_TYPES?.spacer || 'spacer')) {
    return '';
  }

  return `
    <div class="layout-item-mini-actions">
      <button
        class="layout-item-mini-action"
        type="button"
        title="${t('layout.removeSpacer')}"
        aria-label="${t('layout.removeSpacer')}"
        onclick="removeLayoutSpacer('${layoutItem.id}')">
        &times;
      </button>
    </div>
  `;
}

function renderStandaloneLayoutInsertControl() {
  if (!getStandaloneLayoutEditModeEnabled()) {
    return '';
  }

  return `
    <button
      class="layout-zone-insert layout-zone-insert--standalone"
      type="button"
      title="${t('layout.addSpacer')}"
      aria-label="${t('layout.addSpacer')}"
      onclick="insertLayoutSpacerIntoZone('${window.LAYOUT_ZONES?.standalone || 'standalone'}')">
      <span class="layout-zone-insert__plus">+</span>
      <span class="layout-zone-insert__label">${t('layout.addSpacer')}</span>
    </button>
  `;
}

function createDefaultButton() {
  return normalizeChannelButton({
    id: Date.now() + Math.floor(Math.random() * 1000),
    text: '',
    icon: 'square',
    actionType: getChannelButtonActionTypes().none,
    actionValue: window.DEFAULT_CHANNEL_BUTTON_ACTION_VALUE ?? 50,
    indicatorType: getChannelButtonIndicatorTypes().press,
    contentDisplay: getChannelButtonContentModes().iconTitle,
    metaDisplay: getChannelButtonMetaModes().actionIndicator,
    note: 70,
    key: null,
    active: false
  });
}

function addChannelButton(channelId) {
  const channel = findChannel(channelId);

  if (!channel) {
    return null;
  }

  if (channel.buttons.length >= MAX_CHANNEL_BUTTONS) {
    showToast('warn', t('buttons.channelLimit'));
    return null;
  }

  const button = window.channelActions?.addChannelButton(channelId, createDefaultButton(), { source: 'ui' }) || null;

  if (button) {
    window.channelActions?.markChannelConfigured(channelId, { source: 'ui' });
  }

  return button;
}

function fillButtonModal(button) {
  document.getElementById('buttonText').value = button.text;
  document.getElementById('buttonIcon').value = button.icon;
  document.getElementById('buttonNote').value = button.note;
  document.getElementById('buttonKey').value = button.key || '';
}

function openButtonEditor(config, button) {
  openModal?.('button', { config, button }, { source: 'buttons-ui' });
}

function configureButton(channelId, buttonId) {
  const channel = findChannel(channelId);
  const button = channel?.buttons.find((item) => item.id === buttonId);

  if (!button) {
    return;
  }

  window.channelActions?.markChannelConfigured(channelId, { source: 'ui' });
  window.openChannelButtonEditor?.(channelId, buttonId);
}

function addAndConfigureChannelButton(channelId) {
  const button = addChannelButton(channelId);

  if (!button) {
    return null;
  }

  window.openChannelButtonEditor?.(channelId, button.id);
  return button;
}

async function toggleButton(channelId, buttonId) {
  const button = await window.channelActions?.executeChannelButton?.(channelId, buttonId, { source: 'ui' });

  if (!button) {
    return null;
  }

  logTest('button_trigger', {
    channelId,
    buttonId,
    actionType: button.actionType
  });
  return button;
}

async function remapButton() {
  showToast('warn', t('buttons.buttonLearnMissing'));
}

function addStandaloneButton() {
  if ((getStandaloneButtonsState?.() || []).length >= MAX_STANDALONE_BUTTONS) {
    showToast('warn', t('buttons.standaloneLimit'));
    return;
  }

  addStandaloneButtonState?.(createDefaultButton(), { source: 'ui' });
  window.profileActions?.saveRendererProfileToLocal?.();
}

function renderStandaloneButtons() {
  const container = document.getElementById('standaloneButtons');
  const standaloneButtonsList = getStandaloneButtonsState?.() || [];
  const layoutItems = getStandaloneLayoutItems();
  const buttonsById = new Map(standaloneButtonsList.map((button) => [button.id, button]));
  const layoutEditModeEnabled = getStandaloneLayoutEditModeEnabled();

  if (!container) {
    return;
  }

  const buttonsMarkup = layoutItems
    .map((layoutItem) => {
      if (layoutItem.type === (window.LAYOUT_ITEM_TYPES?.spacer || 'spacer')) {
        return `
          <div
            class="${getStandaloneLayoutItemClassName(layoutItem)}"
            data-layout-item-id="${layoutItem.id}"
            data-layout-item-type="${layoutItem.type}"
            data-layout-zone="${layoutItem.zone || window.LAYOUT_ZONES?.standalone || 'standalone'}"
            ${getStandaloneLayoutInteractionAttributes(layoutItem)}>
            <div class="layout-spacer layout-spacer--standalone" data-layout-spacer-size="${layoutItem.size || 1}"></div>
            ${renderStandaloneLayoutEditOverlay(layoutItem, 'layout.itemTypes.spacer')}
            ${renderStandaloneLayoutItemActions(layoutItem)}
          </div>
        `;
      }

      const button = buttonsById.get(layoutItem.entityId);

      if (!button) {
        return '';
      }

      return `
        <div
          class="${getStandaloneLayoutItemClassName(layoutItem)}"
          data-layout-item-id="${layoutItem.id}"
          data-layout-item-type="${layoutItem.type}"
          data-layout-zone="${layoutItem.zone || window.LAYOUT_ZONES?.standalone || 'standalone'}"
          ${getStandaloneLayoutInteractionAttributes(layoutItem)}>
          <div class="standalone-button ${button.active ? 'active' : ''}"
               data-button-id="${button.id}"
               onclick="toggleStandaloneButton(${button.id})"
               ondblclick="configureStandaloneButton(${button.id})">
            <div class="button-icon">${button.icon}</div>
            <div class="button-label">${button.text}</div>
          </div>
          ${renderStandaloneLayoutEditOverlay(layoutItem, 'layout.itemTypes.standaloneButton')}
          ${renderStandaloneLayoutItemActions(layoutItem)}
        </div>
      `;
    })
    .join('');

  const addMarkup = standaloneButtonsList.length < MAX_STANDALONE_BUTTONS
    ? `
      <div class="standalone-add-strip ${layoutEditModeEnabled ? 'is-disabled' : ''}" ${layoutEditModeEnabled ? '' : 'onclick="addStandaloneButton()"'} >
        <div class="add-channel-plus">+</div>
      </div>
    `
    : '';

  container.innerHTML = `${buttonsMarkup}${renderStandaloneLayoutInsertControl()}${addMarkup}`;
  scheduleContentMetricsUpdate();
}

function toggleStandaloneButton(buttonId) {
  const button = updateStandaloneButtonState?.(buttonId, (draftButton) => {
    draftButton.active = !draftButton.active;
    return draftButton;
  }, {
    type: 'standalone-buttons/toggle',
    source: 'ui'
  });

  if (!button) {
    return;
  }

  logTest('standalone_button_toggle', { buttonId, active: button.active });
  sendButtonAction(button);
}

window.addChannelButton = addChannelButton;
window.addAndConfigureChannelButton = addAndConfigureChannelButton;

function configureStandaloneButton(buttonId) {
  const button = findStandaloneButton(buttonId);

  if (!button) {
    return;
  }

  // Park marker: the legacy standalone-button modal stays in the repo for
  // future work, but standalone buttons are intentionally not edited there now.
  showToast('warn', t('buttons.standaloneEditorParked'));
}

async function remapStandaloneButton() {
  showToast('warn', t('buttons.standaloneLearnMissing'));
}

function closeButtonModal() {
  closeModal?.('button', { source: 'buttons-ui' });
}

function readButtonFormState() {
  return {
    text: document.getElementById('buttonText').value.trim() || t('buttons.defaultLabel'),
    icon: document.getElementById('buttonIcon').value.trim() || 'BTN',
    note: Number.parseInt(document.getElementById('buttonNote').value, 10) || 0,
    key: document.getElementById('buttonKey').value || null
  };
}

function applyButtonConfig(button, config) {
  button.text = config.text;
  button.icon = config.icon;
  button.note = config.note;
  button.key = config.key;
}

function saveButtonConfig() {
  if (!buttonModalSessionState.currentConfig) {
    return;
  }

  const nextConfig = readButtonFormState();

  if (buttonModalSessionState.currentConfig.standalone) {
    updateStandaloneButtonState?.(buttonModalSessionState.currentConfig.buttonId, (standaloneButton) => {
      applyButtonConfig(standaloneButton, nextConfig);
      return standaloneButton;
    }, {
      type: 'standalone-buttons/configure',
      source: 'ui'
    });
  } else {
    window.channelActions?.updateChannelButton(
      buttonModalSessionState.currentConfig.channelId,
      buttonModalSessionState.currentConfig.buttonId,
      (channelButton) => {
        applyButtonConfig(channelButton, nextConfig);
        return channelButton;
      },
      {
        type: 'channels/button-configure',
        source: 'ui'
      }
    );
  }

  window.profileActions?.saveRendererProfileToLocal?.();
  closeButtonModal();
}

function initButtonModal() {
  // Park marker: keep the legacy modal implementation around for future
  // standalone-button work, but do not initialize or expose it right now.
  return;
}

function captureKey(event) {
  event.preventDefault();
  document.getElementById('buttonKey').value = event.key.toUpperCase();
}

function sendButtonAction(button) {
  logTest('sendButtonAction', {
    note: button.note,
    active: button.active,
    text: button.text
  });
}

function initStandaloneButtonsStateSync() {
  if (standaloneButtonsUiStateSyncInitialized || typeof subscribeAppState !== 'function') {
    return;
  }

  subscribeAppState((nextState, previousState) => {
    if (
      nextState.standaloneButtons === previousState.standaloneButtons
      && nextState.layout === previousState.layout
      && (
        window.isLayoutEditorParked?.()
        || nextState.layoutEditor === previousState.layoutEditor
      )
    ) {
      return;
    }

    renderStandaloneButtons();
  });

  standaloneButtonsUiStateSyncInitialized = true;
}

function initChannelButtonsRuntime() {
  if (channelButtonRuntimeState.initialized) {
    return;
  }

  if (typeof subscribeAppState === 'function') {
    subscribeAppState((nextState, previousState, meta = {}) => {
      if (nextState.channels === previousState.channels) {
        return;
      }

      if (
        meta?.type === 'channels/set-volume'
        || meta?.type === 'channels/rename'
        || meta?.type === 'channels/set-title-icon'
        || meta?.type === 'channels/set-fader-mapping'
        || meta?.type === 'channels/set-button-placement'
      ) {
        return;
      }

      if (
        meta?.type
        && ![
          'renderer/hydrate',
          'channels/remove',
          'channels/set-app',
          'channels/clear-app',
          'channels/add-app-target',
          'channels/remove-app-target',
          'channels/button-add',
          'channels/button-remove',
          'channels/button-update'
        ].includes(meta.type)
      ) {
        return;
      }

      syncChannelButtonRuntimePolling();
      requestChannelButtonRuntimeRefresh({ force: true });
    });
  }

  window.addEventListener('focus', () => {
    requestChannelButtonRuntimeRefresh({ force: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestChannelButtonRuntimeRefresh({ force: true });
    }
  });

  syncChannelButtonRuntimePolling();
  requestChannelButtonRuntimeRefresh({ force: true });
  channelButtonRuntimeState.initialized = true;
}

window.getChannelButtonClassName = getChannelButtonClassName;
window.renderChannelButtonBodyMarkup = renderChannelButtonBodyMarkup;
window.renderChannelButtonIconMarkup = renderChannelButtonIconMarkup;
window.getChannelButtonPresentation = buildChannelButtonPresentation;
window.requestChannelButtonRuntimeRefresh = requestChannelButtonRuntimeRefresh;
window.getChannelButtonState = getChannelButtonState;
window.triggerChannelButtonPressRuntime = triggerChannelButtonPressRuntime;
window.toggleChannelButtonLatchRuntime = toggleChannelButtonLatchRuntime;
window.flashChannelButtonBindingRuntime = flashChannelButtonBindingRuntime;
window.activateSoloChannelButtonRuntime = activateSoloChannelButtonRuntime;
window.restoreSoloChannelButtonRuntime = restoreSoloChannelButtonRuntime;
window.getActiveSoloChannelButtonKeyRuntime = getActiveSoloChannelButtonKeyRuntime;
window.initChannelButtonsRuntime = initChannelButtonsRuntime;
