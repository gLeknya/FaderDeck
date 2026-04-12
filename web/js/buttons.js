const MAX_CHANNEL_BUTTONS = 4;
const MAX_STANDALONE_BUTTONS = 24;
let standaloneButtonsUiStateSyncInitialized = false;
let buttonModalInitialized = false;
const buttonModalSessionState = {
  currentConfig: null
};

function getChannelButtonActionTypes() {
  return window.CHANNEL_BUTTON_ACTION_TYPES || {
    none: 'none',
    mute: 'mute',
    solo: 'solo',
    setVolume: 'set-volume',
    sendKey: 'send-key'
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

function escapeButtonMarkup(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    return isCompact
      ? 'KEY'
      : t('editor.buttonActionSendKey');
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
  const runtimeState = typeof window.getChannelButtonState === 'function'
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

  if (presentation.button.indicatorMode) {
    classNames.push(`channel-side-button--indicator-${presentation.button.indicatorMode}`);
  }

  return classNames.join(' ');
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
    actionEnabled: true,
    actionType: getChannelButtonActionTypes().none,
    actionMode: window.CHANNEL_BUTTON_INTERACTION_MODES?.trigger || 'trigger',
    actionValue: window.DEFAULT_CHANNEL_BUTTON_ACTION_VALUE ?? 50,
    indicatorEnabled: true,
    indicatorMode: window.CHANNEL_BUTTON_INTERACTION_MODES?.trigger || 'trigger',
    indicatorModeLinkedToAction: false,
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

window.getChannelButtonClassName = getChannelButtonClassName;
window.renderChannelButtonBodyMarkup = renderChannelButtonBodyMarkup;
window.renderChannelButtonIconMarkup = renderChannelButtonIconMarkup;
window.getChannelButtonPresentation = buildChannelButtonPresentation;
window.toggleButton = toggleButton;
window.addStandaloneButton = addStandaloneButton;
window.toggleStandaloneButton = toggleStandaloneButton;
