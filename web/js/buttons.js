const MAX_CHANNEL_BUTTONS = 4;
const MAX_STANDALONE_BUTTONS = 24;
let standaloneButtonsUiStateSyncInitialized = false;
let buttonModalInitialized = false;
const buttonModalSessionState = {
  currentConfig: null
};

function getChannelButtonActionTypes() {
  return (
    window.CHANNEL_BUTTON_ACTION_TYPES || {
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
    }
  );
}

function getChannelButtonIndicatorTypes() {
  return (
    window.CHANNEL_BUTTON_INDICATOR_TYPES || {
      toggle: 'toggle',
      meter: 'meter',
      press: 'press'
    }
  );
}

function getChannelButtonIndicatorBehaviors() {
  return (
    window.CHANNEL_BUTTON_INDICATOR_BEHAVIORS || {
      actionState: 'action-state',
      peakMeter: 'peak-meter',
      targetActivity: 'target-activity'
    }
  );
}

function getDefaultChannelButtonIndicatorThreshold() {
  return (
    Number(window.DEFAULT_CHANNEL_BUTTON_INDICATOR_THRESHOLD ?? -20) || -20
  );
}

function getChannelButtonContentModes() {
  return (
    window.CHANNEL_BUTTON_CONTENT_MODES || {
      iconTitle: 'icon-title',
      iconOnly: 'icon-only',
      titleOnly: 'title-only'
    }
  );
}

function getChannelButtonMetaModes() {
  return (
    window.CHANNEL_BUTTON_META_MODES || {
      actionIndicator: 'action-indicator',
      actionOnly: 'action-only',
      indicatorOnly: 'indicator-only'
    }
  );
}

function normalizeChannelButton(button = {}) {
  return typeof window.cloneChannelButtonEntity === 'function'
    ? window.cloneChannelButtonEntity(button)
    : { ...button };
}

function escapeButtonMarkup(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function translateButtonLabel(key, fallback) {
  const value = t(key);
  return value === key ? fallback : value;
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

  if (normalizedButton.actionType === actionTypes.sendKey) {
    return isCompact ? 'KEY' : t('editor.buttonActionSendKey');
  }

  if (normalizedButton.actionType === actionTypes.toggleAppVisibility) {
    return isCompact
      ? 'APP'
      : translateButtonLabel(
          'editor.buttonActionToggleAppVisibility',
          'Open / hide app'
        );
  }

  if (normalizedButton.actionType === actionTypes.mediaPreviousTrack) {
    return isCompact ? 'PREV' : t('editor.buttonActionMediaPrevious');
  }

  if (normalizedButton.actionType === actionTypes.mediaNextTrack) {
    return isCompact ? 'NEXT' : t('editor.buttonActionMediaNext');
  }

  if (normalizedButton.actionType === actionTypes.mediaPlay) {
    return isCompact ? 'PLAY' : t('editor.buttonActionMediaPlay');
  }

  if (normalizedButton.actionType === actionTypes.mediaPause) {
    return isCompact ? 'PAUSE' : t('editor.buttonActionMediaPause');
  }

  if (normalizedButton.actionType === actionTypes.mediaPlayPause) {
    return isCompact ? 'PLAY/PAUSE' : t('editor.buttonActionMediaPlayPause');
  }

  if (normalizedButton.actionType === actionTypes.mediaRewind) {
    return isCompact
      ? 'REW'
      : translateButtonLabel('editor.buttonActionMediaRewind', 'Rewind');
  }

  if (normalizedButton.actionType === actionTypes.mediaFastForward) {
    return isCompact
      ? 'FWD'
      : translateButtonLabel(
          'editor.buttonActionMediaFastForward',
          'Fast forward'
        );
  }

  if (normalizedButton.actionType === actionTypes.mediaRepeat) {
    return isCompact
      ? 'REPEAT'
      : translateButtonLabel('editor.buttonActionMediaRepeat', 'Repeat');
  }

  if (normalizedButton.actionType === actionTypes.mediaShuffle) {
    return isCompact
      ? 'SHUFFLE'
      : translateButtonLabel('editor.buttonActionMediaShuffle', 'Shuffle');
  }

  if (normalizedButton.actionType === actionTypes.runUserScript) {
    return isCompact
      ? 'SCRIPT'
      : translateButtonLabel('editor.buttonActionRunUserScript', 'Run script');
  }

  if (normalizedButton.actionType === actionTypes.launchApp) {
    return isCompact
      ? 'LAUNCH'
      : translateButtonLabel('editor.buttonActionLaunchApp', 'Run app');
  }

  if (normalizedButton.actionType === actionTypes.setDefaultOutputDevice) {
    return isCompact
      ? 'OUT'
      : translateButtonLabel(
          'editor.buttonActionSetDefaultOutputDevice',
          'Set output device'
        );
  }

  if (normalizedButton.actionType === actionTypes.setDefaultInputDevice) {
    return isCompact
      ? 'IN'
      : translateButtonLabel(
          'editor.buttonActionSetDefaultInputDevice',
          'Set input device'
        );
  }

  if (normalizedButton.actionType === actionTypes.none) {
    return isCompact
      ? t('editor.buttonActionNone')
      : t('editor.buttonActionNone');
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

  if (iconKey === 'play-pause') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 7L13 12L7 17Z"></path>
        <path d="M16 7V17"></path>
        <path d="M19 7V17"></path>
      </svg>
    `;
  }

  if (iconKey === 'skip-previous') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 7V17"></path>
        <path d="M17 7L10.5 12L17 17Z"></path>
      </svg>
    `;
  }

  if (iconKey === 'skip-next') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M16 7V17"></path>
        <path d="M7 7L13.5 12L7 17Z"></path>
      </svg>
    `;
  }

  if (iconKey === 'stop') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="7" y="7" width="10" height="10" rx="2" ry="2"></rect>
      </svg>
    `;
  }

  if (iconKey === 'rewind') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M11.5 7L5 12L11.5 17Z"></path>
        <path d="M19 7L12.5 12L19 17Z"></path>
      </svg>
    `;
  }

  if (iconKey === 'fast-forward') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 7L11.5 12L5 17Z"></path>
        <path d="M12.5 7L19 12L12.5 17Z"></path>
      </svg>
    `;
  }

  if (iconKey === 'shuffle') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.5 7H6.5C8.6 7 10 7.7 11.1 8.9L19.5 17"></path>
        <path d="M16.5 7H19.5V10"></path>
        <path d="M19.5 7L14.7 11.8"></path>
        <path d="M4.5 17H6.5C8.6 17 10 16.3 11.1 15.1L12.7 13.5"></path>
        <path d="M16.5 14H19.5V17"></path>
      </svg>
    `;
  }

  if (iconKey === 'repeat') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4.5C15.9 4.5 19 7.6 19 11.5C19 15.4 15.9 18.5 12 18.5C9.1 18.5 6.6 16.8 5.5 14.3"></path>
        <path d="M9.5 4.5H12.8V7.8"></path>
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
  const runtimeKey = `${channel.id}:${normalizedButton.id}`;
  // Button runtime is owned by the runtime layer now; buttons.js only
  // consumes the current derived state for rendering.
  const runtimeState =
    typeof window.getChannelButtonState === 'function'
      ? window.getChannelButtonState(channel.id, normalizedButton.id)
      : {
          actionActive: false,
          visualActive: false,
          indicatorActive: false,
          meterLevel: 0,
          latched: false,
          flashActive: false,
          pressed: false,
          hasTargets: false,
          indicatorBehavior: getChannelButtonIndicatorBehaviors().actionState,
          buttonIndicatorType: getChannelButtonIndicatorTypes().press
        };
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
        ${
          presentation.showTitle &&
          String(presentation.button.text || '').trim()
            ? `<span class="button-label">${escapeButtonMarkup(presentation.button.text)}</span>`
            : ''
        }
      </span>
    </span>
  `;
}

function getChannelButtonClassName(channel, button) {
  const presentation = buildChannelButtonPresentation(channel, button);
  const classNames = ['channel-side-button'];
  const indicatorSuffix =
    presentation.button.indicatorBehavior ===
    getChannelButtonIndicatorBehaviors().peakMeter
      ? 'meter'
      : presentation.button.indicatorMode;

  if (presentation.isActive) {
    classNames.push('active');
  }

  if (presentation.runtimeState.pressed) {
    classNames.push('is-pressed-indicator');
  }

  if (presentation.button.contentDisplay) {
    classNames.push(
      `channel-side-button--${presentation.button.contentDisplay}`
    );
  }

  if (indicatorSuffix) {
    classNames.push(`channel-side-button--indicator-${indicatorSuffix}`);
  }

  return classNames.join(' ');
}

function buildStandaloneButtonPresentation(button) {
  const normalizedButton = normalizeChannelButton(button);
  const runtimeKey =
    typeof window.standaloneButtonRuntime?.getRuntimeKey === 'function'
      ? window.standaloneButtonRuntime.getRuntimeKey(normalizedButton.id)
      : `standalone:${normalizedButton.id}`;
  const runtimeState =
    typeof window.getStandaloneButtonState === 'function'
      ? window.getStandaloneButtonState(normalizedButton.id)
      : {
          actionActive: false,
          visualActive: false,
          indicatorActive: false,
          meterLevel: 0,
          latched: false,
          flashActive: false,
          pressed: false,
          hasTargets: false,
          indicatorBehavior: getChannelButtonIndicatorBehaviors().actionState,
          buttonIndicatorType: getChannelButtonIndicatorTypes().press
        };
  const showIcon = true;
  const showTitle = false;

  return {
    runtimeKey,
    button: normalizedButton,
    runtimeState,
    isActive: Boolean(runtimeState.visualActive || runtimeState.flashActive),
    showIcon,
    showTitle
  };
}

function renderStandaloneButtonBodyMarkup(button, options = {}) {
  const presentation = buildStandaloneButtonPresentation(button);
  const labelText =
    String(presentation.button.text || '').trim() || t('buttons.defaultLabel');
  const iconButton = options?.iconOverride
    ? {
        ...presentation.button,
        icon: options.iconOverride
      }
    : presentation.button;

  return `
    <span class="channel-button-face" data-standalone-button-runtime-key="${presentation.runtimeKey}">
      <span class="channel-button-main">
        ${presentation.showIcon ? renderChannelButtonIconMarkup(iconButton) : ''}
        ${
          presentation.showTitle
            ? `<span class="button-label">${escapeButtonMarkup(labelText)}</span>`
            : ''
        }
      </span>
    </span>
  `;
}

function getStandaloneButtonClassName(button) {
  const presentation = buildStandaloneButtonPresentation(button);
  const classNames = ['standalone-button', 'channel-side-button--icon-only'];
  const indicatorSuffix =
    presentation.button.indicatorBehavior ===
    getChannelButtonIndicatorBehaviors().peakMeter
      ? 'meter'
      : presentation.button.indicatorMode;

  if (presentation.isActive) {
    classNames.push('active');
  }

  if (presentation.runtimeState.pressed) {
    classNames.push('is-pressed-indicator');
  }

  if (presentation.button.contentDisplay) {
    classNames.push(
      `channel-side-button--${presentation.button.contentDisplay}`
    );
  }

  if (indicatorSuffix) {
    classNames.push(`channel-side-button--indicator-${indicatorSuffix}`);
  }

  return classNames.join(' ');
}

function findChannel(channelId) {
  return typeof findChannelState === 'function'
    ? findChannelState(channelId)
    : null;
}

function findStandaloneButton(buttonId) {
  return typeof findStandaloneButtonState === 'function'
    ? findStandaloneButtonState(buttonId)
    : null;
}

function isMediaControllerStandaloneButton(button = {}) {
  return String(button?.uiRole || '').trim() === 'media-controller';
}

function getRenderableStandaloneButtonsState() {
  return (getStandaloneButtonsState?.() || []).filter(
    (button) => !isMediaControllerStandaloneButton(button)
  );
}

function getStandaloneLayoutItems() {
  return typeof getLayoutItemsByZoneState === 'function'
    ? getLayoutItemsByZoneState(window.LAYOUT_ZONES?.standalone || 'standalone')
    : getRenderableStandaloneButtonsState().map((button) => ({
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
    classNames.push(
      dropPreview.position === 'before' ? 'is-drop-before' : 'is-drop-after'
    );
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

  const zone =
    layoutItem.zone || window.LAYOUT_ZONES?.standalone || 'standalone';

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
    actionEnabled: false,
    actionType: getChannelButtonActionTypes().none,
    actionMode: window.CHANNEL_BUTTON_INTERACTION_MODES?.trigger || 'trigger',
    actionValue: window.DEFAULT_CHANNEL_BUTTON_ACTION_VALUE ?? 50,
    indicatorEnabled: true,
    indicatorMode:
      window.CHANNEL_BUTTON_INTERACTION_MODES?.trigger || 'trigger',
    indicatorModeLinkedToAction: false,
    indicatorBehavior: getChannelButtonIndicatorBehaviors().actionState,
    indicatorThreshold: getDefaultChannelButtonIndicatorThreshold(),
    indicatorType: getChannelButtonIndicatorTypes().press,
    contentDisplay: getChannelButtonContentModes().iconTitle,
    metaDisplay: getChannelButtonMetaModes().actionIndicator,
    linkedChannelId: null,
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

  const button =
    window.channelActions?.addChannelButton(channelId, createDefaultButton(), {
      source: 'ui'
    }) || null;

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
  const button = await window.channelActions?.executeChannelButton?.(
    channelId,
    buttonId,
    { source: 'ui' }
  );

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
  if (getRenderableStandaloneButtonsState().length >= MAX_STANDALONE_BUTTONS) {
    showToast('warn', t('buttons.standaloneLimit'));
    return;
  }

  addStandaloneButtonState?.(createDefaultButton(), { source: 'ui' });
  window.profileActions?.saveRendererProfileToLocal?.();
}

function renderStandaloneButtons() {
  const container = document.getElementById('standaloneButtons');
  const standaloneButtonsList = getRenderableStandaloneButtonsState();
  const layoutItems = getStandaloneLayoutItems();
  const buttonsById = new Map(
    standaloneButtonsList.map((button) => [button.id, button])
  );
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
          <div class="${getStandaloneButtonClassName(button)}"
               data-button-id="${button.id}"
               onclick="toggleStandaloneButton(${button.id})"
               ondblclick="configureStandaloneButton(${button.id})">
            ${renderStandaloneButtonBodyMarkup(button)}
          </div>
          ${renderStandaloneLayoutEditOverlay(layoutItem, 'layout.itemTypes.standaloneButton')}
          ${renderStandaloneLayoutItemActions(layoutItem)}
        </div>
      `;
    })
    .join('');

  const addMarkup =
    standaloneButtonsList.length < MAX_STANDALONE_BUTTONS
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
  const button = window.standaloneButtonActions?.executeStandaloneButton?.(
    buttonId,
    { source: 'ui' }
  );

  if (!button) {
    return null;
  }

  Promise.resolve(button).then((resolvedButton) => {
    if (!resolvedButton) {
      return;
    }

    logTest('standalone_button_toggle', {
      buttonId,
      actionType: resolvedButton.actionType
    });
  });

  return button;
}

window.addChannelButton = addChannelButton;
window.addAndConfigureChannelButton = addAndConfigureChannelButton;

function configureStandaloneButton(buttonId) {
  const button = findStandaloneButton(buttonId);

  if (!button) {
    return;
  }

  window.openStandaloneButtonEditor?.(buttonId);
}

async function remapStandaloneButton(buttonId) {
  if (!Number.isFinite(Number(buttonId))) {
    return null;
  }

  return (
    window.midiActions?.learnStandaloneButtonMapping?.(Number(buttonId), {
      source: 'buttons-ui'
    }) || null
  );
}

function closeButtonModal() {
  closeModal?.('button', { source: 'buttons-ui' });
}

function readButtonFormState() {
  return {
    text:
      document.getElementById('buttonText').value.trim() ||
      t('buttons.defaultLabel'),
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
    updateStandaloneButtonState?.(
      buttonModalSessionState.currentConfig.buttonId,
      (standaloneButton) => {
        applyButtonConfig(standaloneButton, nextConfig);
        return standaloneButton;
      },
      {
        type: 'standalone-buttons/configure',
        source: 'ui'
      }
    );
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
  if (
    standaloneButtonsUiStateSyncInitialized ||
    typeof subscribeAppState !== 'function'
  ) {
    return;
  }

  subscribeAppState((nextState, previousState) => {
    if (
      nextState.standaloneButtons === previousState.standaloneButtons &&
      nextState.layout === previousState.layout &&
      (window.isLayoutEditorParked?.() ||
        nextState.layoutEditor === previousState.layoutEditor)
    ) {
      return;
    }

    renderStandaloneButtons();
  });

  standaloneButtonsUiStateSyncInitialized = true;
}

window.getChannelButtonClassName = getChannelButtonClassName;
window.renderChannelButtonBodyMarkup = renderChannelButtonBodyMarkup;
window.renderChannelButtonIconMarkup = renderChannelButtonIconMarkup;
window.renderChannelButtonIconSvg = renderChannelButtonIconSvg;
window.getChannelButtonPresentation = buildChannelButtonPresentation;
window.getStandaloneButtonClassName = getStandaloneButtonClassName;
window.renderStandaloneButtonBodyMarkup = renderStandaloneButtonBodyMarkup;
window.toggleButton = toggleButton;
window.addStandaloneButton = addStandaloneButton;
window.toggleStandaloneButton = toggleStandaloneButton;
window.isMediaControllerStandaloneButton = isMediaControllerStandaloneButton;

(function initMediaControllerUi(window) {
  const CONTROLLER_ROLE = 'media-controller';
  const BUTTON_DEFINITIONS = Object.freeze([
    {
      slot: 'shuffle',
      label: { ru: 'Перемешивание', en: 'Shuffle' },
      icon: 'shuffle',
      actionType: getChannelButtonActionTypes().mediaShuffle,
      actionMode: 'toggle',
      indicatorMode: 'toggle'
    },
    {
      slot: 'previous',
      label: { ru: 'Предыдущий трек', en: 'Previous track' },
      icon: 'skip-previous',
      actionType: getChannelButtonActionTypes().mediaPreviousTrack,
      actionMode: 'trigger',
      indicatorMode: 'trigger'
    },
    {
      slot: 'rewind',
      label: { ru: 'Перемотка назад', en: 'Rewind' },
      icon: 'rewind',
      actionType: getChannelButtonActionTypes().mediaRewind,
      actionMode: 'trigger',
      indicatorMode: 'trigger'
    },
    {
      slot: 'play-pause',
      label: { ru: 'Плей / Пауза', en: 'Play / pause' },
      icon: 'pause',
      actionType: getChannelButtonActionTypes().mediaPlayPause,
      actionMode: 'trigger',
      indicatorMode: 'trigger',
      primary: true
    },
    {
      slot: 'stop',
      label: { ru: 'Стоп', en: 'Stop' },
      icon: 'stop',
      actionType: getChannelButtonActionTypes().sendKey,
      actionMode: 'trigger',
      indicatorMode: 'trigger',
      key: 'MediaStop'
    },
    {
      slot: 'fast-forward',
      label: { ru: 'Перемотка вперед', en: 'Fast forward' },
      icon: 'fast-forward',
      actionType: getChannelButtonActionTypes().mediaFastForward,
      actionMode: 'trigger',
      indicatorMode: 'trigger'
    },
    {
      slot: 'next',
      label: { ru: 'Следующий трек', en: 'Next track' },
      icon: 'skip-next',
      actionType: getChannelButtonActionTypes().mediaNextTrack,
      actionMode: 'trigger',
      indicatorMode: 'trigger'
    },
    {
      slot: 'repeat',
      label: { ru: 'Повтор', en: 'Repeat' },
      icon: 'repeat',
      actionType: getChannelButtonActionTypes().mediaRepeat,
      actionMode: 'toggle',
      indicatorMode: 'toggle'
    }
  ]);
  const MEDIA_CONTROLLER_RENDER_SLOTS = Object.freeze([
    'shuffle',
    'rewind',
    'previous',
    'play-pause',
    'next',
    'fast-forward',
    'repeat'
  ]);
  const MEDIA_SESSION_REFRESH_MIN_MS = 260;
  const MEDIA_SESSION_SYNC_DELAY_MS = 180;
  const MEDIA_SESSION_LIST_REFRESH_MIN_MS = 6000;
  const MEDIA_ACTION_COOLDOWN_MS = 170;
  const MEDIA_CONTROLLER_SELECTION_DURATION_MS = 1600;
  const MEDIA_CONTROLLER_EDITOR_MODAL_ID = 'media-controller-editor';
  const PLAYBACK_ACTIVE_STATUSES = new Set(['playing']);
  const REPEAT_MODES = Object.freeze({
    off: 'None',
    list: 'List',
    track: 'Track'
  });

  let mediaControllerUiInitialized = false;
  let mediaControllerUiSyncInitialized = false;
  let mediaControllerRuntimeSyncInitialized = false;
  let ensuringButtons = false;
  const mediaSessionState = {
    snapshot: {
      success: true,
      hasSession: false,
      targetAppId: '',
      playbackStatus: 'Closed',
      shuffleActive: false,
      repeatMode: REPEAT_MODES.off
    },
    availableSessions: [],
    refreshPromise: null,
    sessionsPromise: null,
    scheduledRefreshTimerId: null,
    lastUpdatedAt: 0,
    sessionsLastUpdatedAt: 0
  };
  const mediaControllerEditorState = {
    selectedButtonId: null,
    selectionTimerId: null
  };
  const mediaControllerSelectionState = {
    buttonId: null,
    expiresAt: 0,
    timerId: null
  };

  function getCurrentControllerLanguage() {
    return typeof getCurrentLanguage === 'function'
      ? getCurrentLanguage()
      : 'ru';
  }

  function getControllerLabel(definition) {
    const slot = String(definition?.slot || '').trim();

    if (slot === 'play-pause') {
      return getCurrentControllerLanguage() === 'en'
        ? 'Play / pause'
        : 'Плей / пауза';
    }

    return (
      definition?.label?.[getCurrentControllerLanguage()] ||
      definition?.label?.ru ||
      definition?.slot ||
      'Button'
    );
  }

  function getMediaControllerTargetAppId() {
    return String(window.getMediaControllerTargetAppIdState?.() || '').trim();
  }

  function translateControllerText(key, fallback) {
    const translated = typeof t === 'function' ? t(key) : key;
    return translated === key ? fallback : translated;
  }

  function getRenderableControllerDefinitions() {
    const slotOrder = new Map(
      MEDIA_CONTROLLER_RENDER_SLOTS.map((slot, index) => [slot, index])
    );

    return BUTTON_DEFINITIONS.filter((definition) =>
      slotOrder.has(String(definition?.slot || '').trim())
    ).sort((left, right) => {
      return (
        slotOrder.get(String(left?.slot || '').trim()) -
        slotOrder.get(String(right?.slot || '').trim())
      );
    });
  }

  function getDefaultControllerOrder(slot = '') {
    const normalizedSlot = String(slot || '').trim();
    const fallbackIndex = MEDIA_CONTROLLER_RENDER_SLOTS.indexOf(normalizedSlot);
    return fallbackIndex >= 0
      ? fallbackIndex
      : MEDIA_CONTROLLER_RENDER_SLOTS.length + 1;
  }

  function getApi() {
    return typeof window.getApi === 'function'
      ? window.getApi()
      : (window.getNativeApi?.() ?? null);
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

  function normalizeRepeatMode(mode = '') {
    const normalized = String(mode || '')
      .trim()
      .toLowerCase();

    if (normalized === 'track') {
      return REPEAT_MODES.track;
    }

    if (
      normalized === 'list' ||
      normalized === 'playlist' ||
      normalized === 'on'
    ) {
      return REPEAT_MODES.list;
    }

    return REPEAT_MODES.off;
  }

  function normalizeMediaSessionSnapshot(snapshot = {}) {
    return {
      success: snapshot?.success !== false,
      hasSession: Boolean(snapshot?.hasSession),
      targetAppId: String(snapshot?.targetAppId || '').trim(),
      playbackStatus: String(snapshot?.playbackStatus || 'Closed'),
      shuffleActive: Boolean(snapshot?.shuffleActive),
      repeatMode: normalizeRepeatMode(snapshot?.repeatMode)
    };
  }

  function getMediaSessionSnapshot() {
    return normalizeMediaSessionSnapshot(mediaSessionState.snapshot);
  }

  function canRefreshMediaSessionState(options = {}) {
    if (options?.allowHidden === true) {
      return true;
    }

    return document.visibilityState === 'visible';
  }

  function areMediaSessionSnapshotsEqual(
    nextSnapshot = {},
    previousSnapshot = {}
  ) {
    return (
      Boolean(nextSnapshot.success) === Boolean(previousSnapshot.success) &&
      Boolean(nextSnapshot.hasSession) ===
        Boolean(previousSnapshot.hasSession) &&
      String(nextSnapshot.targetAppId || '') ===
        String(previousSnapshot.targetAppId || '') &&
      String(nextSnapshot.playbackStatus || '') ===
        String(previousSnapshot.playbackStatus || '') &&
      Boolean(nextSnapshot.shuffleActive) ===
        Boolean(previousSnapshot.shuffleActive) &&
      String(nextSnapshot.repeatMode || '') ===
        String(previousSnapshot.repeatMode || '')
    );
  }

  function isMediaSessionPlaying(snapshot = getMediaSessionSnapshot()) {
    return PLAYBACK_ACTIVE_STATUSES.has(
      String(snapshot?.playbackStatus || '')
        .trim()
        .toLowerCase()
    );
  }

  function setMediaSessionSnapshot(snapshot = {}, options = {}) {
    const nextSnapshot = normalizeMediaSessionSnapshot(snapshot);
    const previousSnapshot = getMediaSessionSnapshot();
    const changed = !areMediaSessionSnapshotsEqual(
      nextSnapshot,
      previousSnapshot
    );

    mediaSessionState.snapshot = nextSnapshot;
    mediaSessionState.lastUpdatedAt = Date.now();

    if (changed && options.render !== false) {
      renderMediaController();
    }

    return nextSnapshot;
  }

  function getNextRepeatMode(snapshot = getMediaSessionSnapshot()) {
    const currentMode = normalizeRepeatMode(snapshot?.repeatMode);

    if (currentMode === REPEAT_MODES.off) {
      return 'list';
    }

    if (currentMode === REPEAT_MODES.list) {
      return 'track';
    }

    return 'off';
  }

  async function refreshMediaSessionState(options = {}) {
    const api = getApi();
    const force = Boolean(options?.force);
    const now = Date.now();
    const targetAppId = getMediaControllerTargetAppId();

    if (!api?.get_media_session_state) {
      return getMediaSessionSnapshot();
    }

    if (mediaSessionState.refreshPromise) {
      return mediaSessionState.refreshPromise;
    }

    if (!canRefreshMediaSessionState(options)) {
      return Promise.resolve(getMediaSessionSnapshot());
    }

    if (
      !force &&
      mediaSessionState.lastUpdatedAt &&
      now - mediaSessionState.lastUpdatedAt < MEDIA_SESSION_REFRESH_MIN_MS
    ) {
      return Promise.resolve(getMediaSessionSnapshot());
    }

    mediaSessionState.refreshPromise = api
      .get_media_session_state(targetAppId)
      .then((response) => setMediaSessionSnapshot(response, options))
      .catch((error) => {
        console.error('refreshMediaSessionState error', error);
        return getMediaSessionSnapshot();
      })
      .finally(() => {
        mediaSessionState.refreshPromise = null;
      });

    return mediaSessionState.refreshPromise;
  }

  function getAvailableMediaSessions() {
    return Array.isArray(mediaSessionState.availableSessions)
      ? mediaSessionState.availableSessions.slice()
      : [];
  }

  function setAvailableMediaSessions(sessions = []) {
    mediaSessionState.availableSessions = Array.isArray(sessions)
      ? sessions
          .map((session) => ({
            appId: String(session?.appId || '').trim(),
            label: String(session?.label || session?.appId || '').trim(),
            playbackStatus: String(session?.playbackStatus || 'Closed'),
            isCurrent: Boolean(session?.isCurrent)
          }))
          .filter((session) => session.appId)
      : [];
    mediaSessionState.sessionsLastUpdatedAt = Date.now();
    renderMediaController();
    return getAvailableMediaSessions();
  }

  async function refreshAvailableMediaSessions(options = {}) {
    const api = getApi();
    const force = Boolean(options?.force);
    const now = Date.now();

    if (!api?.list_media_sessions) {
      return getAvailableMediaSessions();
    }

    if (mediaSessionState.sessionsPromise) {
      return mediaSessionState.sessionsPromise;
    }

    if (
      !force &&
      mediaSessionState.sessionsLastUpdatedAt &&
      now - mediaSessionState.sessionsLastUpdatedAt <
        MEDIA_SESSION_LIST_REFRESH_MIN_MS
    ) {
      return Promise.resolve(getAvailableMediaSessions());
    }

    mediaSessionState.sessionsPromise = api
      .list_media_sessions()
      .then((response) => setAvailableMediaSessions(response?.sessions || []))
      .catch((error) => {
        console.error('refreshAvailableMediaSessions error', error);
        return getAvailableMediaSessions();
      })
      .finally(() => {
        mediaSessionState.sessionsPromise = null;
      });

    return mediaSessionState.sessionsPromise;
  }

  function scheduleMediaSessionRefresh(meta = {}) {
    if (mediaSessionState.scheduledRefreshTimerId) {
      window.clearTimeout(mediaSessionState.scheduledRefreshTimerId);
      mediaSessionState.scheduledRefreshTimerId = null;
    }

    mediaSessionState.scheduledRefreshTimerId = window.setTimeout(() => {
      mediaSessionState.scheduledRefreshTimerId = null;
      refreshMediaSessionState({ force: true, allowHidden: true }).finally(
        () => {
          window.requestStandaloneButtonRuntimeRefresh?.({
            reason: 'media-controller/session-refresh',
            force: true,
            source: 'media-controller',
            ...meta
          });
        }
      );
    }, MEDIA_SESSION_SYNC_DELAY_MS);
  }

  function getResolvedMediaControllerIcon(
    slot = '',
    snapshot = getMediaSessionSnapshot()
  ) {
    if (String(slot || '').trim() === 'play-pause') {
      return isMediaSessionPlaying(snapshot) ? 'pause' : 'play';
    }

    return String(findMediaControllerDefinitionBySlot(slot)?.icon || 'square');
  }

  function getIndicatorTypes() {
    return (
      window.CHANNEL_BUTTON_INDICATOR_TYPES || {
        toggle: 'toggle',
        meter: 'meter',
        press: 'press'
      }
    );
  }

  function getContentModes() {
    return (
      window.CHANNEL_BUTTON_CONTENT_MODES || {
        iconTitle: 'icon-title',
        iconOnly: 'icon-only',
        titleOnly: 'title-only'
      }
    );
  }

  function getMediaControllerButtonsState() {
    return (getStandaloneButtonsState?.() || []).filter((button) =>
      isMediaControllerStandaloneButton(button)
    );
  }

  function getOrderedMediaControllerButtonsState() {
    return getMediaControllerButtonsState()
      .slice()
      .sort((left, right) => {
        const leftOrder = Number.isFinite(Number(left?.controllerOrder))
          ? Number(left.controllerOrder)
          : getDefaultControllerOrder(left?.controllerSlot);
        const rightOrder = Number.isFinite(Number(right?.controllerOrder))
          ? Number(right.controllerOrder)
          : getDefaultControllerOrder(right?.controllerSlot);

        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }

        return Number(left?.id) - Number(right?.id);
      });
  }

  function getRenderableControllerEntries() {
    return getOrderedMediaControllerButtonsState()
      .filter((button) => button?.controllerHidden !== true)
      .map((button) => ({
        button,
        definition: findMediaControllerDefinitionBySlot(button?.controllerSlot)
      }))
      .filter((entry) => entry.definition);
  }

  function findMediaControllerDefinitionBySlot(slot = '') {
    return (
      getRenderableControllerDefinitions().find(
        (definition) => String(definition?.slot || '') === String(slot || '')
      ) || null
    );
  }

  function findMediaControllerButtonBySlot(slot = '') {
    return (
      getMediaControllerButtonsState().find(
        (button) => String(button?.controllerSlot || '') === String(slot || '')
      ) || null
    );
  }

  function getMediaControllerButtonRuntimeState(
    button = {},
    previousState = {},
    snapshot = getMediaSessionSnapshot()
  ) {
    if (!isMediaControllerStandaloneButton(button)) {
      return null;
    }

    const interactionModes = window.CHANNEL_BUTTON_INTERACTION_MODES || {
      push: 'push',
      toggle: 'toggle',
      trigger: 'trigger'
    };
    const indicatorEnabled = button?.indicatorEnabled !== false;
    const slot = String(button?.controllerSlot || '').trim();
    const pressed = Boolean(previousState?.pressed);
    const flashActive = Boolean(previousState?.flashActive);
    let latched = false;
    let actionActive = false;
    let indicatorMode = String(
      button?.indicatorMode ||
        previousState?.indicatorMode ||
        interactionModes.trigger
    ).trim();

    if (!Object.values(interactionModes).includes(indicatorMode)) {
      indicatorMode = interactionModes.trigger;
    }

    if (slot === 'shuffle') {
      latched = Boolean(snapshot?.shuffleActive);
      actionActive = latched;
      indicatorMode = interactionModes.toggle;
    } else if (slot === 'repeat') {
      latched = normalizeRepeatMode(snapshot?.repeatMode) !== REPEAT_MODES.off;
      actionActive = latched;
      indicatorMode = interactionModes.toggle;
    } else if (slot === 'play-pause') {
      latched = isMediaSessionPlaying(snapshot);
      actionActive = latched;
      indicatorMode = interactionModes.toggle;
    }

    const visualActive = indicatorEnabled
      ? indicatorMode === interactionModes.toggle
        ? latched
        : pressed
      : false;

    return {
      actionActive,
      visualActive,
      indicatorActive: visualActive,
      meterLevel: 0,
      latched,
      flashActive,
      pressed,
      hasTargets: true,
      indicatorEnabled,
      indicatorMode,
      indicatorBehavior:
        button?.indicatorBehavior ||
        getChannelButtonIndicatorBehaviors().actionState,
      buttonIndicatorType: button?.indicatorType
    };
  }

  function createMediaControllerButton(definition) {
    const slot = String(definition?.slot || '').trim();
    return normalizeChannelButton({
      id:
        Date.now() +
        Math.floor(Math.random() * 100000) +
        Math.floor(Math.random() * 1000),
      text: '',
      icon: slot === 'play-pause' ? 'play' : definition.icon,
      actionEnabled: true,
      actionType: definition.actionType,
      actionMode: definition.actionMode,
      actionValue: window.DEFAULT_CHANNEL_BUTTON_ACTION_VALUE ?? 50,
      indicatorEnabled: true,
      indicatorMode:
        slot === 'play-pause' ? 'toggle' : definition.indicatorMode,
      indicatorModeLinkedToAction: true,
      indicatorBehavior: getChannelButtonIndicatorBehaviors().actionState,
      indicatorThreshold: getDefaultChannelButtonIndicatorThreshold(),
      indicatorType: getIndicatorTypes().press,
      contentDisplay: getContentModes().iconOnly,
      metaDisplay: getChannelButtonMetaModes().indicatorOnly,
      linkedChannelId: null,
      note: 70,
      key: definition.key || null,
      active: false,
      uiRole: CONTROLLER_ROLE,
      controllerSlot: definition.slot,
      controllerOrder: getDefaultControllerOrder(definition.slot),
      controllerHidden: false,
      midiMapping: null
    });
  }

  function ensureMediaControllerButtons(options = {}) {
    if (ensuringButtons) {
      return false;
    }

    ensuringButtons = true;
    let changed = false;

    try {
      getRenderableControllerDefinitions().forEach((definition) => {
        const existingButton = findMediaControllerButtonBySlot(definition.slot);
        const slot = String(definition?.slot || '').trim();
        const desiredIcon = slot === 'play-pause' ? 'play' : definition.icon;
        const desiredIndicatorMode =
          slot === 'play-pause' ? 'toggle' : definition.indicatorMode;

        if (existingButton) {
          const patch = {};

          if (existingButton.uiRole !== CONTROLLER_ROLE) {
            patch.uiRole = CONTROLLER_ROLE;
          }

          if (existingButton.controllerSlot !== definition.slot) {
            patch.controllerSlot = definition.slot;
          }

          if (existingButton.icon !== desiredIcon) {
            patch.icon = desiredIcon;
          }

          if (existingButton.actionType !== definition.actionType) {
            patch.actionType = definition.actionType;
          }

          if (existingButton.actionMode !== definition.actionMode) {
            patch.actionMode = definition.actionMode;
          }

          if (existingButton.indicatorMode !== desiredIndicatorMode) {
            patch.indicatorMode = desiredIndicatorMode;
          }

          if ((existingButton.key || null) !== (definition.key || null)) {
            patch.key = definition.key || null;
          }

          if (existingButton.contentDisplay !== getContentModes().iconOnly) {
            patch.contentDisplay = getContentModes().iconOnly;
          }

          if (!Number.isFinite(Number(existingButton.controllerOrder))) {
            patch.controllerOrder = getDefaultControllerOrder(definition.slot);
          }

          if (typeof existingButton.controllerHidden !== 'boolean') {
            patch.controllerHidden = false;
          }

          if (Object.keys(patch).length) {
            window.standaloneButtonActions?.updateStandaloneButton?.(
              existingButton.id,
              patch,
              {
                type: 'media-controller/repair',
                source: 'media-controller'
              }
            );
            changed = true;
          }

          return;
        }

        addStandaloneButtonState?.(createMediaControllerButton(definition), {
          type: 'media-controller/add',
          source: 'media-controller'
        });
        changed = true;
      });

      const allowedSlots = new Set(MEDIA_CONTROLLER_RENDER_SLOTS);
      getMediaControllerButtonsState().forEach((button) => {
        const slot = String(button?.controllerSlot || '').trim();

        if (!allowedSlots.has(slot)) {
          window.removeStandaloneButtonState?.(button.id, {
            type: 'media-controller/remove-legacy',
            source: 'media-controller'
          });
          changed = true;
        }
      });
    } finally {
      ensuringButtons = false;
    }

    if (changed && options.persist !== false) {
      window.profileActions?.saveRendererProfileToLocal?.();
    }

    return changed;
  }

  function ensureMediaControllerShell() {
    const contentShell = document.querySelector('.content-shell');

    if (!contentShell) {
      return null;
    }

    let shell = document.getElementById('mediaControllerShell');

    if (!shell) {
      shell = document.createElement('div');
      shell.id = 'mediaControllerShell';
      shell.className = 'media-controller-shell';
      shell.innerHTML =
        '<div class="media-controller" id="mediaController"></div>';
      contentShell.appendChild(shell);
    }

    return shell;
  }

  function ensureStandaloneButtonsTopRow() {
    const canvas = document.getElementById('mainContentCanvas');
    const mixerContainer = document.getElementById('mixerContainer');
    const standaloneButtons = document.getElementById('standaloneButtons');

    if (!canvas || !mixerContainer || !standaloneButtons) {
      return null;
    }

    let strip = canvas.querySelector('.standalone-buttons-strip');

    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'standalone-buttons-strip';
      canvas.insertBefore(strip, mixerContainer);
    }

    if (standaloneButtons.parentElement !== strip) {
      strip.appendChild(standaloneButtons);
    }

    return strip;
  }

  function getMediaControllerVisible() {
    return window.getMediaControllerVisibleState?.() ?? true;
  }

  async function executeControllerButton(button = {}, meta = {}) {
    if (
      !isMediaControllerStandaloneButton(button) ||
      meta?.phase === 'release'
    ) {
      return false;
    }

    const api = getApi();
    const acquireMediaActionLock = getAcquireMediaActionLock();
    const slot = String(button?.controllerSlot || '').trim();
    const snapshot = getMediaSessionSnapshot();
    const targetAppId = getMediaControllerTargetAppId();

    if (!api) {
      return false;
    }

    if (!acquireMediaActionLock(`media-controller:${slot}`, meta)) {
      return false;
    }

    try {
      if (slot === 'shuffle') {
        const enabled = !Boolean(snapshot.shuffleActive);
        const response = await api.set_media_option?.(
          'shuffle',
          enabled,
          targetAppId
        );

        if (response?.success) {
          setMediaSessionSnapshot({
            ...snapshot,
            success: true,
            hasSession: true,
            shuffleActive: enabled
          });
        }
      } else if (slot === 'repeat') {
        const nextMode = getNextRepeatMode(snapshot);
        const response = await api.set_media_repeat_mode?.(
          nextMode,
          targetAppId
        );

        if (response?.success) {
          setMediaSessionSnapshot({
            ...snapshot,
            success: true,
            hasSession: true,
            repeatMode: nextMode
          });
        }
      } else if (slot === 'play-pause') {
        const nextPlayingState = !isMediaSessionPlaying(snapshot);
        const response = await api.send_media_transport?.(
          nextPlayingState ? 'play' : 'pause',
          targetAppId
        );

        if (response?.success) {
          setMediaSessionSnapshot({
            ...snapshot,
            success: true,
            hasSession: true,
            playbackStatus: nextPlayingState ? 'Playing' : 'Paused'
          });
        }
      } else if (slot === 'previous') {
        await api.send_media_transport?.('previous', targetAppId);
      } else if (slot === 'next') {
        await api.send_media_transport?.('next', targetAppId);
      } else if (slot === 'rewind') {
        await api.send_media_transport?.('rewind', targetAppId);
      } else if (slot === 'fast-forward') {
        await api.send_media_transport?.('fast-forward', targetAppId);
      }
    } catch (error) {
      console.error('executeControllerButton error', error);
    } finally {
      window.requestStandaloneButtonRuntimeRefresh?.({
        reason: 'media-controller/action',
        force: true,
        source: 'media-controller',
        ...meta
      });
      scheduleMediaSessionRefresh(meta);
    }

    return true;
  }

  function renderMediaController() {
    const shell = ensureMediaControllerShell();
    const container = document.getElementById('mediaController');
    const sessionSnapshot = getMediaSessionSnapshot();
    const repeatMode = normalizeRepeatMode(sessionSnapshot.repeatMode);
    const hasSelection = mediaControllerSelectionState.expiresAt > Date.now();
    const selectedButtonId = hasSelection
      ? Number(mediaControllerSelectionState.buttonId)
      : null;

    ensureStandaloneButtonsTopRow();

    if (!shell || !container) {
      return;
    }

    shell.classList.toggle('hidden', !getMediaControllerVisible());
    shell.classList.toggle('is-context-selected', hasSelection);

    ensureMediaControllerButtons({ persist: false });
    const renderEntries = getRenderableControllerEntries();

    container.innerHTML = `
      <div class="media-controller__row">
        ${renderEntries
          .map(({ definition, button }) => {
            const className = [
              getStandaloneButtonClassName(button),
              'media-controller__button',
              definition.slot === 'play-pause'
                ? 'media-controller__button--play-stop'
                : '',
              definition.slot === 'shuffle' && sessionSnapshot.shuffleActive
                ? 'is-shuffle-active'
                : '',
              definition.slot === 'repeat' && repeatMode !== REPEAT_MODES.off
                ? 'is-repeat-active'
                : '',
              definition.slot === 'repeat' && repeatMode === REPEAT_MODES.list
                ? 'is-repeat-list'
                : '',
              definition.slot === 'repeat' && repeatMode === REPEAT_MODES.track
                ? 'is-repeat-track'
                : '',
              definition.slot === 'play-pause' &&
              isMediaSessionPlaying(sessionSnapshot)
                ? 'is-playing'
                : '',
              !button.midiMapping ? 'is-unbound' : '',
              Number.isFinite(selectedButtonId) &&
              Number(button.id) === selectedButtonId
                ? 'is-context-selected'
                : ''
            ]
              .filter(Boolean)
              .join(' ');
            const escapedLabel = escapeButtonMarkup(
              getControllerLabel(definition)
            );

            return `
            <button
              class="${className}"
              type="button"
              data-media-controller-slot="${definition.slot}"
              data-button-id="${button.id}"
              data-repeat-mode="${escapeButtonMarkup(repeatMode)}"
              data-playback-status="${escapeButtonMarkup(String(sessionSnapshot.playbackStatus || 'Closed'))}"
              title="${escapedLabel}"
              aria-label="${escapedLabel}">
              ${renderStandaloneButtonBodyMarkup(button, {
                iconOverride: getResolvedMediaControllerIcon(
                  definition.slot,
                  sessionSnapshot
                )
              })}
            </button>
          `;
          })
          .join('')}
      </div>
    `;
  }

  function clearMediaControllerSelectionTimer() {
    if (!mediaControllerSelectionState.timerId) {
      return;
    }

    window.clearTimeout(mediaControllerSelectionState.timerId);
    mediaControllerSelectionState.timerId = null;
  }

  function clearMediaControllerSelection() {
    clearMediaControllerSelectionTimer();
    mediaControllerSelectionState.buttonId = null;
    mediaControllerSelectionState.expiresAt = 0;
    renderMediaController();
  }

  function selectMediaController(options = {}) {
    const buttonId = Number.isFinite(Number(options?.buttonId))
      ? Number(options.buttonId)
      : null;
    clearMediaControllerSelectionTimer();
    mediaControllerSelectionState.buttonId = buttonId;
    mediaControllerSelectionState.expiresAt =
      Date.now() + MEDIA_CONTROLLER_SELECTION_DURATION_MS;
    renderMediaController();
    mediaControllerSelectionState.timerId = window.setTimeout(() => {
      clearMediaControllerSelection();
    }, MEDIA_CONTROLLER_SELECTION_DURATION_MS);
    return true;
  }

  function updateMediaControllerButton(buttonId, patch, meta = {}) {
    if (!Number.isFinite(Number(buttonId))) {
      return null;
    }

    return (
      window.standaloneButtonActions?.updateStandaloneButton?.(
        Number(buttonId),
        patch,
        {
          type: 'media-controller/update',
          source: 'media-controller',
          ...meta
        }
      ) || null
    );
  }

  function countVisibleMediaControllerButtons() {
    return getMediaControllerButtonsState().filter(
      (button) => button?.controllerHidden !== true
    ).length;
  }

  function setMediaControllerButtonHidden(buttonId, hidden = true, meta = {}) {
    const button = findStandaloneButton(Number(buttonId));

    if (!button || !isMediaControllerStandaloneButton(button)) {
      return null;
    }

    if (
      hidden &&
      button.controllerHidden !== true &&
      countVisibleMediaControllerButtons() <= 1
    ) {
      window.showToast?.(
        'warn',
        translateControllerText(
          'mediaController.keepOneVisible',
          getCurrentControllerLanguage() === 'en'
            ? 'Keep at least one media button visible.'
            : 'Оставьте хотя бы одну кнопку плеера видимой.'
        )
      );
      return null;
    }

    return updateMediaControllerButton(
      button.id,
      {
        controllerHidden: Boolean(hidden)
      },
      meta
    );
  }

  function moveMediaControllerButton(buttonId, direction = 'left', meta = {}) {
    const normalizedButtonId = Number(buttonId);
    const orderedButtons = getOrderedMediaControllerButtonsState();
    const currentIndex = orderedButtons.findIndex(
      (button) => Number(button?.id) === normalizedButtonId
    );

    if (currentIndex < 0) {
      return false;
    }

    const delta = direction === 'right' ? 1 : -1;
    const nextIndex = currentIndex + delta;

    if (nextIndex < 0 || nextIndex >= orderedButtons.length) {
      return false;
    }

    const currentButton = orderedButtons[currentIndex];
    const targetButton = orderedButtons[nextIndex];
    const currentOrder = Number.isFinite(Number(currentButton?.controllerOrder))
      ? Number(currentButton.controllerOrder)
      : getDefaultControllerOrder(currentButton?.controllerSlot);
    const targetOrder = Number.isFinite(Number(targetButton?.controllerOrder))
      ? Number(targetButton.controllerOrder)
      : getDefaultControllerOrder(targetButton?.controllerSlot);

    updateMediaControllerButton(
      currentButton.id,
      { controllerOrder: targetOrder },
      {
        ...meta,
        type: 'media-controller/reorder'
      }
    );
    updateMediaControllerButton(
      targetButton.id,
      { controllerOrder: currentOrder },
      {
        ...meta,
        type: 'media-controller/reorder'
      }
    );
    return true;
  }

  function formatMediaControllerBinding(button = {}) {
    const mapping = button?.midiMapping || null;

    if (!mapping) {
      return translateControllerText(
        'mediaController.unbound',
        getCurrentControllerLanguage() === 'en' ? 'Not bound' : 'Не привязано'
      );
    }

    const channel = Number.isFinite(Number(mapping.channel))
      ? Number(mapping.channel) + 1
      : 1;

    if (String(mapping.kind || '').trim() === 'cc') {
      return `Ch ${channel} · CC ${Number(mapping.cc) || 0}`;
    }

    return `Ch ${channel} · Note ${Number(mapping.note) || 0}`;
  }

  function buildMediaControllerTargetOptionsMarkup() {
    const currentLanguage = getCurrentControllerLanguage();
    const selectedAppId = getMediaControllerTargetAppId();
    const availableSessions = getAvailableMediaSessions();
    const hasSelectedSession = selectedAppId
      ? availableSessions.some((session) => session.appId === selectedAppId)
      : true;
    const autoLabel = currentLanguage === 'en' ? 'Auto target' : 'Автоцель';
    const unavailableLabel =
      currentLanguage === 'en' ? 'Unavailable target' : 'Недоступная цель';
    const options = [
      `<option value="">${escapeButtonMarkup(autoLabel)}</option>`
    ];

    if (selectedAppId && !hasSelectedSession) {
      options.push(
        `<option value="${escapeButtonMarkup(selectedAppId)}">${escapeButtonMarkup(unavailableLabel)}</option>`
      );
    }

    availableSessions.forEach((session) => {
      const label = session.label || session.appId;
      options.push(
        `<option value="${escapeButtonMarkup(session.appId)}">${escapeButtonMarkup(label)}</option>`
      );
    });

    return options.join('');
  }

  function resolveMediaControllerSelectionButtonId(payload = {}) {
    const explicitButtonId = Number(payload?.buttonId);

    if (Number.isFinite(explicitButtonId)) {
      return explicitButtonId;
    }

    const slot = String(payload?.slot || '').trim();
    return Number(findMediaControllerButtonBySlot(slot)?.id) || null;
  }

  function renderMediaControllerEditor(payload = {}) {
    const list = document.getElementById('mediaControllerEditorList');
    const title = document.getElementById('mediaControllerEditorTitle');
    const subtitle = document.getElementById('mediaControllerEditorSubtitle');
    const closeButton = document.querySelector(
      '#mediaControllerEditorModal [data-modal-close]'
    );

    if (!list) {
      return;
    }

    ensureMediaControllerButtons({ persist: false });

    const selectedButtonId = resolveMediaControllerSelectionButtonId(payload);
    const orderedButtons = getOrderedMediaControllerButtonsState();
    const currentLanguage = getCurrentControllerLanguage();

    mediaControllerEditorState.selectedButtonId = selectedButtonId;

    if (title) {
      title.textContent = translateControllerText(
        'mediaController.editorTitle',
        currentLanguage === 'en' ? 'Media controller' : 'Настройка плеера'
      );
    }

    if (subtitle) {
      subtitle.textContent = translateControllerText(
        'mediaController.editorSubtitle',
        currentLanguage === 'en'
          ? 'Rebind, hide and reorder media buttons.'
          : 'Перепривязка, скрытие и порядок кнопок плеера.'
      );
    }

    if (closeButton) {
      closeButton.setAttribute(
        'aria-label',
        translateControllerText(
          'editor.close',
          currentLanguage === 'en' ? 'Close' : 'Закрыть'
        )
      );
    }

    list.innerHTML = orderedButtons
      .map((button, index) => {
        const definition = findMediaControllerDefinitionBySlot(
          button?.controllerSlot
        );

        if (!definition) {
          return '';
        }

        const isHidden = button?.controllerHidden === true;
        const isSelected = Number(button?.id) === Number(selectedButtonId);
        const iconKey = getResolvedMediaControllerIcon(
          definition.slot,
          getMediaSessionSnapshot()
        );
        const canMoveLeft = index > 0;
        const canMoveRight = index < orderedButtons.length - 1;

        return `
        <div class="media-controller-editor__item ${isHidden ? 'is-hidden' : ''} ${isSelected ? 'is-selected' : ''}" data-button-id="${button.id}">
          <div class="media-controller-editor__item-main">
            <div class="media-controller-editor__preview">
              ${renderStandaloneButtonBodyMarkup(button, { iconOverride: iconKey })}
            </div>
            <div class="media-controller-editor__meta">
              <div class="media-controller-editor__title">${escapeButtonMarkup(getControllerLabel(definition))}</div>
              <div class="media-controller-editor__binding">${escapeButtonMarkup(formatMediaControllerBinding(button))}</div>
            </div>
          </div>
          <div class="media-controller-editor__actions">
            <button class="btn" type="button" data-media-controller-editor-action="bind" data-button-id="${button.id}">
              ${escapeButtonMarkup(translateControllerText('mediaController.bind', currentLanguage === 'en' ? 'Bind' : 'Привязать'))}
            </button>
            <button class="btn" type="button" data-media-controller-editor-action="toggle-visibility" data-button-id="${button.id}">
              ${escapeButtonMarkup(
                isHidden
                  ? translateControllerText(
                      'mediaController.showButton',
                      currentLanguage === 'en' ? 'Show' : 'Показать'
                    )
                  : translateControllerText(
                      'mediaController.hideButton',
                      currentLanguage === 'en' ? 'Hide' : 'Скрыть'
                    )
              )}
            </button>
            <button class="btn icon-btn" type="button" data-media-controller-editor-action="move-left" data-button-id="${button.id}" ${canMoveLeft ? '' : 'disabled'}>
              ←
            </button>
            <button class="btn icon-btn" type="button" data-media-controller-editor-action="move-right" data-button-id="${button.id}" ${canMoveRight ? '' : 'disabled'}>
              →
            </button>
          </div>
        </div>
      `;
      })
      .join('');
  }

  function ensureMediaControllerEditorModal() {
    let modal = document.getElementById('mediaControllerEditorModal');

    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'mediaControllerEditorModal';
      modal.className = 'modal modal--media-controller-editor';
      modal.setAttribute('data-modal-id', MEDIA_CONTROLLER_EDITOR_MODAL_ID);
      modal.setAttribute('aria-hidden', 'true');
      modal.innerHTML = `
        <div class="modal-content media-controller-editor" role="dialog" aria-modal="true" tabindex="-1">
          <div class="media-controller-editor__header">
            <div>
              <div class="media-controller-editor__title" id="mediaControllerEditorTitle">
                ${escapeButtonMarkup(translateControllerText('mediaController.editorTitle', getCurrentControllerLanguage() === 'en' ? 'Media controller' : 'Настройка плеера'))}
              </div>
              <div class="media-controller-editor__subtitle" id="mediaControllerEditorSubtitle">
                ${escapeButtonMarkup(translateControllerText('mediaController.editorSubtitle', getCurrentControllerLanguage() === 'en' ? 'Rebind, hide and reorder media buttons.' : 'Перепривязка, скрытие и порядок кнопок плеера.'))}
              </div>
            </div>
            <button class="entity-edit-close media-controller-editor__close" type="button" data-modal-close aria-label="${escapeButtonMarkup(translateControllerText('editor.close', getCurrentControllerLanguage() === 'en' ? 'Close' : 'Закрыть'))}">
              ×
            </button>
          </div>
          <div class="media-controller-editor__list" id="mediaControllerEditorList"></div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    if (
      !window.modalManager?.getRegisteredModal?.(
        MEDIA_CONTROLLER_EDITOR_MODAL_ID
      )
    ) {
      window.modalManager?.register?.(MEDIA_CONTROLLER_EDITOR_MODAL_ID, {
        element: modal,
        transitionDuration: 180,
        visibleClassName: 'is-visible',
        closingClassName: 'is-closing',
        onOpen: (payload) => {
          renderMediaControllerEditor(payload || {});
        }
      });
    }

    if (modal.dataset.mediaControllerEditorBound !== 'true') {
      modal.dataset.mediaControllerEditorBound = 'true';
      modal.addEventListener('click', async (event) => {
        const actionButton = event.target.closest(
          '[data-media-controller-editor-action][data-button-id]'
        );

        if (!actionButton) {
          return;
        }

        event.preventDefault();
        const action = String(
          actionButton.dataset.mediaControllerEditorAction || ''
        ).trim();
        const buttonId = Number(actionButton.dataset.buttonId);

        if (!Number.isFinite(buttonId)) {
          return;
        }

        if (action === 'bind') {
          await window.midiActions?.learnStandaloneButtonMapping?.(buttonId, {
            type: 'media-controller/rebind',
            source: 'media-controller-editor'
          });
        } else if (action === 'toggle-visibility') {
          const button = findStandaloneButton(buttonId);
          setMediaControllerButtonHidden(
            buttonId,
            button?.controllerHidden !== true,
            {
              source: 'media-controller-editor'
            }
          );
        } else if (action === 'move-left') {
          moveMediaControllerButton(buttonId, 'left', {
            source: 'media-controller-editor'
          });
        } else if (action === 'move-right') {
          moveMediaControllerButton(buttonId, 'right', {
            source: 'media-controller-editor'
          });
        }

        renderMediaControllerEditor({ buttonId });
        renderMediaController();
      });
    }

    return modal;
  }

  function openMediaControllerSettings(options = {}) {
    ensureMediaControllerButtons({ persist: true });
    ensureMediaControllerEditorModal();
    window.openModal?.(MEDIA_CONTROLLER_EDITOR_MODAL_ID, options, {
      source: 'media-controller'
    });
    return true;
  }

  async function maybeBindMediaControllerButton(button) {
    if (!button || button.midiMapping) {
      return;
    }

    const shouldBind = window.confirm?.(
      getCurrentControllerLanguage() === 'en'
        ? 'This button is not bound to the MIDI mixer yet. Bind it now?'
        : 'Эта кнопка еще не привязана к MIDI-микшеру. Привязать сейчас?'
    );

    if (!shouldBind) {
      return;
    }

    await window.midiActions?.learnStandaloneButtonMapping?.(button.id, {
      type: 'media-controller/bind',
      source: 'media-controller'
    });
  }

  async function handleMediaControllerButtonClick(buttonId) {
    const button = findStandaloneButton(buttonId);

    if (!button || !isMediaControllerStandaloneButton(button)) {
      return;
    }

    await window.standaloneButtonActions?.executeStandaloneButton?.(button.id, {
      type: 'media-controller/execute',
      source: 'media-controller'
    });
    await maybeBindMediaControllerButton(button);
  }

  function initMediaControllerUiEvents() {
    const shell = ensureMediaControllerShell();

    if (!shell || shell.dataset.mediaControllerBound === 'true') {
      return;
    }

    shell.dataset.mediaControllerBound = 'true';
    shell.addEventListener('click', (event) => {
      const buttonElement = event.target.closest(
        '[data-media-controller-slot][data-button-id]'
      );

      if (!buttonElement) {
        return;
      }

      const buttonId = Number(buttonElement.dataset.buttonId);

      if (!Number.isFinite(buttonId)) {
        return;
      }

      handleMediaControllerButtonClick(buttonId);
    });
  }

  function initMediaControllerUiSync() {
    if (
      mediaControllerUiSyncInitialized ||
      typeof subscribeAppState !== 'function'
    ) {
      return;
    }

    subscribeAppState((nextState, previousState) => {
      if (
        nextState.standaloneButtons !== previousState.standaloneButtons ||
        nextState.ui !== previousState.ui
      ) {
        renderMediaController();

        if (window.getActiveModalId?.() === MEDIA_CONTROLLER_EDITOR_MODAL_ID) {
          renderMediaControllerEditor({
            buttonId: mediaControllerEditorState.selectedButtonId
          });
        }
      }

      const nextTargetAppId = String(
        nextState?.ui?.settings?.mediaControllerTargetAppId || ''
      ).trim();
      const previousTargetAppId = String(
        previousState?.ui?.settings?.mediaControllerTargetAppId || ''
      ).trim();

      if (nextTargetAppId !== previousTargetAppId) {
        refreshMediaSessionState({ force: true });
        refreshAvailableMediaSessions({ force: true });
      }
    });

    mediaControllerUiSyncInitialized = true;
  }

  function initMediaControllerRuntimeSync() {
    if (
      mediaControllerRuntimeSyncInitialized ||
      typeof window.standaloneButtonRuntime?.subscribe !== 'function'
    ) {
      return;
    }

    window.standaloneButtonRuntime.subscribe(() => {
      renderMediaController();

      if (window.getActiveModalId?.() === MEDIA_CONTROLLER_EDITOR_MODAL_ID) {
        renderMediaControllerEditor({
          buttonId: mediaControllerEditorState.selectedButtonId
        });
      }
    });
    mediaControllerRuntimeSyncInitialized = true;
  }

  function initMediaControllerUi() {
    ensureStandaloneButtonsTopRow();
    ensureMediaControllerShell();
    ensureMediaControllerEditorModal();
    initMediaControllerUiEvents();
    initMediaControllerUiSync();
    initMediaControllerRuntimeSync();
    ensureMediaControllerButtons({ persist: true });
    renderMediaController();
    refreshAvailableMediaSessions({ force: true });
    refreshMediaSessionState({ force: true }).finally(() => {
      window.requestStandaloneButtonRuntimeRefresh?.({
        reason: 'media-controller/init',
        force: true,
        source: 'media-controller'
      });
    });
    window.addEventListener('focus', () => {
      refreshMediaSessionState({ force: true });
      refreshAvailableMediaSessions({ force: true });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshMediaSessionState({ force: true });
        refreshAvailableMediaSessions({ force: true });
      }
    });
    mediaControllerUiInitialized = true;
    return mediaControllerUiInitialized;
  }

  window.mediaControllerUi = {
    init: initMediaControllerUi,
    render: renderMediaController,
    refreshEditor: () =>
      renderMediaControllerEditor({
        buttonId: mediaControllerEditorState.selectedButtonId
      }),
    ensureButtons: ensureMediaControllerButtons,
    ensureStandaloneButtonsTopRow,
    isControllerButton: isMediaControllerStandaloneButton,
    executeControllerButton,
    openSettings: openMediaControllerSettings,
    select: selectMediaController,
    moveButton: moveMediaControllerButton,
    setButtonHidden: setMediaControllerButtonHidden,
    getButtons: getOrderedMediaControllerButtonsState,
    getAvailableSessions: getAvailableMediaSessions,
    refreshAvailableSessions: refreshAvailableMediaSessions,
    getCachedRuntimeSnapshot: getMediaSessionSnapshot,
    getRuntimeSnapshot: refreshMediaSessionState,
    getRuntimeStateForButton: getMediaControllerButtonRuntimeState
  };
})(window);
