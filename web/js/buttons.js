const MAX_CHANNEL_BUTTONS = 4;
const MAX_STANDALONE_BUTTONS = 24;
let standaloneButtonsUiStateSyncInitialized = false;
let buttonModalInitialized = false;
const buttonModalSessionState = {
  currentConfig: null
};

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
  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    text: t('buttons.defaultLabel'),
    icon: 'BTN',
    note: 70,
    key: null,
    active: false
  };
}

function addChannelButton(channelId) {
  const channel = findChannel(channelId);

  if (!channel) {
    return;
  }

  if (channel.buttons.length >= MAX_CHANNEL_BUTTONS) {
    showToast('warn', t('buttons.channelLimit'));
    return;
  }

  window.channelActions?.addChannelButton(channelId, createDefaultButton(), { source: 'ui' });
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

  openButtonEditor({ channelId, buttonId, standalone: false }, button);
}

function toggleButton(channelId, buttonId) {
  const button = window.channelActions?.toggleChannelButton(channelId, buttonId, { source: 'ui' });

  if (!button) {
    return;
  }

  logTest('button_toggle', { channelId, buttonId, active: button.active });
  sendButtonAction(button);
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

function configureStandaloneButton(buttonId) {
  const button = findStandaloneButton(buttonId);

  if (!button) {
    return;
  }

  openButtonEditor({ standalone: true, buttonId }, button);
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
  if (buttonModalInitialized) {
    return;
  }

  const buttonModal = document.getElementById('buttonModal');
  const saveButton = document.getElementById('buttonModalSaveButton');

  if (!buttonModal || !window.modalManager || !saveButton) {
    return;
  }

  registerModal('button', {
    element: buttonModal,
    initialFocusSelector: '#buttonText',
    onOpen(payload) {
      buttonModalSessionState.currentConfig = payload?.config || null;
      fillButtonModal(payload?.button || createDefaultButton());
    },
    onClose() {
      buttonModalSessionState.currentConfig = null;
    }
  });

  saveButton.addEventListener('click', saveButtonConfig);
  buttonModalInitialized = true;
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
