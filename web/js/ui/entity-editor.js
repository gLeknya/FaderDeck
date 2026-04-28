  (function initEntityEditorModule(window) {
    const ENTITY_EDITOR_MODAL_ID = 'entity-edit';
    const ENTITY_EDITOR_CLOSE_MS = 240;
    const ENTITY_EDITOR_SIDE_PANEL_CLOSE_MS = 220;
    const ENTITY_EDITOR_PREVIEW_MOVE_MS = 250;
    const ENTITY_EDITOR_PREVIEW_ENTRANCE_CLASS = 'is-preview-entering';

  const dom = {};
  const editorRuntimeSync = {
    frameId: null,
    initialized: false
  };

  // Entity editor state is transient renderer session state for the active modal.
  function createDefaultEditorSessionState() {
    return {
      initialized: false,
      entityType: null,
      channelId: null,
      buttonId: null,
      standalone: false,
      sourceSelector: '',
      sidePanelOpen: false,
      sidePanelClosing: false,
      sidePanelCloseTimerId: null,
      sidePanelMode: 'targets',
      sidePanelButtonId: null,
      sidePanelButtonTitleDraft: '',
      sidePanelButtonTitleDirty: false,
      sidePanelIconPickerOpen: false,
      sidePanelIconPickerExpanded: false,
      sidePanelKeyCaptureActive: false,
      sidePanelMotionChoices: null,
      channelIconPickerOpen: false,
      titleDraft: '',
      titleDirty: false,
      editingChannelButtonId: null,
      buttonTitleDraft: '',
      latestAddedChannelButtonId: null,
      previewLayoutTransitionRequested: false,
      previewLayoutCleanupTimerId: null,
      previewTimerId: null,
      previewDrag: null,
      previewDragFrameId: null,
      sourceHidden: false,
      audioDeviceOptions: {
        output: [],
        input: []
      },
      audioDeviceLoading: {
        output: false,
        input: false
      },
      audioDeviceErrors: {
        output: '',
        input: ''
      }
    };
  }

  const editorState = createDefaultEditorSessionState();

  function resetEditorSessionState(overrides = {}) {
    Object.assign(editorState, createDefaultEditorSessionState(), {
      initialized: editorState.initialized,
      ...overrides
    });
    return editorState;
  }

  function isTargetsPanelVisible() {
    return editorState.sidePanelOpen || editorState.sidePanelClosing;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function getCurrentActiveModalId() {
    if (typeof getActiveModalId === 'function') {
      return getActiveModalId();
    }

    return window.modalManager?.getActiveModalId?.() || null;
  }

  function translateOrFallback(key, fallback) {
    const value = t(key);
    return value === key ? fallback : value;
  }

  function cacheDom() {
    dom.modal = $('entityEditModal');
    dom.shell = $('entityEditShell');
    dom.previewFrame = $('entityEditPreviewFrame');
    dom.previewMount = $('entityEditPreviewMount');
    dom.mainShell = $('entityEditMainShell');
    dom.main = $('entityEditMain');
    dom.sidePanel = $('entityEditSidePanel');
    dom.sideOptions = null;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeSelectorValue(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function getEditorChannel() {
    if (editorState.entityType !== 'fader') {
      return null;
    }

    return findChannelState?.(editorState.channelId) || null;
  }

  function getEditorChannelButton(buttonId, channel = getEditorChannel()) {
    if (!channel || !Array.isArray(channel.buttons)) {
      return null;
    }

    return channel.buttons.find((button) => button.id === buttonId) || null;
  }

  function getEditorStandaloneButton(buttonId = editorState.buttonId) {
    if (editorState.entityType !== 'button' || !editorState.standalone) {
      return null;
    }

    const resolvedButtonId = Number.parseInt(buttonId, 10);

    if (Number.isNaN(resolvedButtonId)) {
      return null;
    }

    return findStandaloneButtonState?.(resolvedButtonId) || null;
  }

  function getEditorButtonEntity(buttonId = editorState.sidePanelButtonId) {
    if (editorState.entityType === 'fader') {
      return getEditorChannelButton(buttonId);
    }

    if (editorState.entityType === 'button' && editorState.standalone) {
      return getEditorStandaloneButton(buttonId ?? editorState.buttonId);
    }

    return null;
  }

  function getEditorTargetEntity() {
    if (editorState.entityType === 'fader') {
      return getEditorChannel();
    }

    if (editorState.entityType === 'button' && editorState.standalone) {
      return getEditorStandaloneButton(editorState.buttonId);
    }

    return null;
  }

  function resetSidePanelButtonDraft(button = null) {
    editorState.sidePanelButtonTitleDraft = String(button?.text || '').trim();
    editorState.sidePanelButtonTitleDirty = false;
  }

  function isTargetsSidePanelMode() {
    return editorState.sidePanelMode !== 'channel-button';
  }

  function getEditorChannelResolvedSettings(channel) {
    return typeof resolveChannelFaderSettings === 'function'
      ? resolveChannelFaderSettings(channel)
      : {};
  }

  function getEditorCustomSettings(channel) {
    return {
      ...(typeof getDefaultChannelCustomSettings === 'function'
        ? getDefaultChannelCustomSettings()
        : {}),
      ...(channel?.customSettings || {})
    };
  }

  function getChannelTargets(channel) {
    const explicitTargets = Array.isArray(channel?.targets)
      ? channel.targets
          .map((target) => ({
            process: String(target?.process || '').trim(),
            name: String(target?.name || target?.process || '').trim()
          }))
          .filter((target) => target.process)
      : [];

    if (explicitTargets.length > 0) {
      return explicitTargets;
    }

    const fallbackProcess = String(channel?.app || '').trim();

    if (!fallbackProcess) {
      return [];
    }

    return [{
      process: fallbackProcess,
      name: String(channel?.appName || fallbackProcess).trim() || fallbackProcess
    }];
  }

  function getAvailableApps() {
    return typeof getAvailableAudioApps === 'function'
      ? getAvailableAudioApps()
      : [];
  }

  function getAvailableAppByProcess(processName = '') {
    const normalizedProcess = String(processName || '').trim();

    if (!normalizedProcess) {
      return null;
    }

    return getAvailableApps().find((application) => application.process === normalizedProcess) || null;
  }

  function getChannelTargetMode(channel = {}) {
    return window.channelTargeting?.getChannelTargetMode?.(channel)
      || window.CHANNEL_TARGET_MODES?.apps
      || 'apps';
  }

  function getChannelDeviceTargetFlow(channel = {}) {
    return window.channelTargeting?.getChannelDeviceTargetFlow?.(channel)
      || window.CHANNEL_DEVICE_TARGET_FLOWS?.output
      || 'output';
  }

  function getChannelDeviceTargets(channel = {}, flow = null) {
    return window.channelTargeting?.getChannelDeviceTargets?.(channel, flow)
      || [];
  }

  function getChannelFocusExclusions(channel = {}) {
    return window.channelTargeting?.getChannelFocusExclusions?.(channel)
      || [];
  }

  function resolveTargetDisplayEntry(target = {}) {
    const matchedApplication = getAvailableAppByProcess(target.process);
    const process = String(target.process || matchedApplication?.process || '').trim();
    const resolvedPath = String(target?.path || matchedApplication?.path || '').trim();

    return {
      process,
      name: String(matchedApplication?.name || target.name || target.process || '').trim(),
      iconDataUrl: String(
        matchedApplication?.iconDataUrl
        || window.getCachedAudioAppIconDataUrl?.({
          process,
          path: resolvedPath
        })
        || ''
      ).trim()
    };
  }

  function resolveDeviceTargetDisplayEntry(target = {}) {
    return {
      id: String(target?.id || '').trim(),
      name: String(target?.name || target?.id || '').trim(),
      flow: String(target?.flow || getChannelDeviceTargetFlow(getEditorChannel())).trim() || 'output'
    };
  }

  function renderAppIconMarkup(entry, className) {
    const hasImage = Boolean(entry?.iconDataUrl);

    if (!hasImage) {
      return '';
    }

    return `
      <span class="${className} has-image">
        <img class="entity-edit-app-icon-image" src="${escapeHtml(entry.iconDataUrl)}" alt="${escapeHtml(entry.name || entry.process || 'App')}">
      </span>
    `;
  }

  function resolveEntitySourceSelector(payload = {}) {
    if (payload.sourceSelector) {
      return payload.sourceSelector;
    }

    if (payload.entityType === 'fader' && payload.channelId) {
      return `.channel-strip[data-channel-id="${payload.channelId}"]`;
    }

    if (payload.entityType === 'button' && payload.buttonId) {
      return payload.standalone
        ? `.standalone-button[data-button-id="${payload.buttonId}"]`
        : `.channel-side-button[data-button-id="${payload.buttonId}"]`;
    }

    return '';
  }

  function resolveEntitySourceElement() {
    return editorState.sourceSelector
      ? document.querySelector(editorState.sourceSelector)
      : null;
  }

  function setSourcePreviewState(isHidden) {
    editorState.sourceHidden = Boolean(isHidden);
    const sourceElement = resolveEntitySourceElement();

    if (!sourceElement) {
      return;
    }

    sourceElement.classList.toggle('entity-edit-source-hidden', isHidden);
  }

  function setPreviewEntranceState(isActive) {
    dom.shell?.classList.toggle(ENTITY_EDITOR_PREVIEW_ENTRANCE_CLASS, Boolean(isActive));
  }

  function cleanupFloatingPreviews() {
    document.querySelectorAll('.entity-edit-floating-preview').forEach((element) => {
      element.remove();
    });
  }

  function clearPreviewTimer() {
    if (!editorState.previewTimerId) {
      return;
    }

    clearTimeout(editorState.previewTimerId);
    editorState.previewTimerId = null;
  }

  function clearPreviewDragFrame() {
    if (!editorState.previewDragFrameId) {
      return;
    }

    cancelAnimationFrame(editorState.previewDragFrameId);
    editorState.previewDragFrameId = null;
  }

  function clearSidePanelCloseTimer() {
    if (!editorState.sidePanelCloseTimerId) {
      return;
    }

    clearTimeout(editorState.sidePanelCloseTimerId);
    editorState.sidePanelCloseTimerId = null;
  }

  function requestTargetsPanelApplicationsRefresh(options = {}) {
    if (!isTargetsPanelVisible()) {
      return Promise.resolve();
    }

    if (typeof window.requestAudioAppsRefresh === 'function') {
      return window.requestAudioAppsRefresh('entity-editor-targets', options);
    }

    if (typeof loadAudioApps === 'function') {
      return loadAudioApps(options);
    }

    return Promise.resolve();
  }

  function sanitizeAnimationClone(root) {
    if (!(root instanceof HTMLElement)) {
      return root;
    }

    root.removeAttribute('id');
    root.removeAttribute('onclick');
    root.removeAttribute('ondblclick');
    root.removeAttribute('onchange');
    root.querySelectorAll('[id]').forEach((element) => {
      element.removeAttribute('id');
    });
    root.querySelectorAll('[onclick], [ondblclick], [onchange]').forEach((element) => {
      element.removeAttribute('onclick');
      element.removeAttribute('ondblclick');
      element.removeAttribute('onchange');
    });
    root.querySelectorAll('input, button, select, textarea').forEach((element) => {
      element.disabled = true;
      element.setAttribute('tabindex', '-1');
    });
    return root;
  }

  function setFloatingPreviewRect(element, rect) {
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
  }

  function createFloatingPreview(sourceElement, rect = sourceElement?.getBoundingClientRect?.()) {
    if (!(sourceElement instanceof HTMLElement) || !rect) {
      return null;
    }

    const previewNode = sanitizeAnimationClone(sourceElement.cloneNode(true));
    previewNode.classList.add('entity-edit-floating-preview');
    setFloatingPreviewRect(previewNode, rect);
    return previewNode;
  }

  function isAdvancedModeEnabled() {
    return typeof window.getAdvancedModeEnabledState === 'function'
      ? Boolean(window.getAdvancedModeEnabledState())
      : false;
  }

  function getChannelButtonInteractionModes() {
    return window.CHANNEL_BUTTON_INTERACTION_MODES || {
      push: 'push',
      toggle: 'toggle',
      trigger: 'trigger'
    };
  }

  function getPreviewMappingLabel(channel) {
    if (!isAdvancedModeEnabled() || typeof getFaderMappingLabel !== 'function') {
      return '';
    }

    return getFaderMappingLabel(channel?.faderMapping);
  }

  function renderPreviewButtonSlot(channel, button) {
    const className = typeof window.getChannelButtonClassName === 'function'
      ? window.getChannelButtonClassName(channel, button)
      : `channel-side-button ${button.active ? 'active' : ''}`;
    const bodyMarkup = typeof window.renderChannelButtonBodyMarkup === 'function'
      ? window.renderChannelButtonBodyMarkup(channel, button)
      : `
        <span class="channel-button-face">
          <span class="channel-button-main">
            <span class="button-icon">${escapeHtml(button.icon)}</span>
            <span class="button-label">${escapeHtml(button.text)}</span>
          </span>
        </span>
      `;

    return `
      <div
        class="${className} entity-edit-preview-button"
        data-channel-id="${channel.id}"
        data-button-id="${button.id}"
        data-preview-button-id="${button.id}">
        ${bodyMarkup}
      </div>
    `;
  }

  function renderPreviewButtons(channel) {
    const buttons = Array.isArray(channel?.buttons)
      ? channel.buttons
          .slice(0, 4)
          .map((button) => (
            editorState.editingChannelButtonId === button.id
              ? {
                ...button,
                text: editorState.buttonTitleDraft || button.text
              }
              : editorState.sidePanelButtonId === button.id && editorState.sidePanelButtonTitleDirty
                ? {
                  ...button,
                  text: editorState.sidePanelButtonTitleDraft || button.text
                }
                : button
          ))
      : [];

    if (!buttons.length) {
      return '';
    }

    const layoutMode = getPreviewButtonLayoutMode(channel);

    return `
      <div class="channel-buttons-grid channel-buttons-grid--${layoutMode} channel-buttons-grid--count-${buttons.length}">
        ${buttons.map((button) => renderPreviewButtonSlot(channel, button)).join('')}
      </div>
    `;
  }

  function getPreviewButtonLayoutMode(channel) {
    const buttons = Array.isArray(channel?.buttons) ? channel.buttons.slice(0, 4) : [];

    if (buttons.length >= 3) {
      return 'side';
    }

    if (buttons.length >= 1) {
      return channel?.buttonPlacement === 'side' ? 'side' : 'inline';
    }

    return 'none';
  }

  function getPreviewTitleIconTarget(channel) {
    if (!channel?.showTargetIconInTitle) {
      return null;
    }

    const targets = getChannelTargets(channel).map(resolveTargetDisplayEntry);
    const requestedProcess = String(channel?.titleIconTargetProcess || '').trim();
    return targets.find((target) => target.process === requestedProcess) || targets[0] || null;
  }

  function renderPreviewTitleMarkup(channel, title) {
    if (channel?.icon && typeof window.renderChannelButtonIconMarkup === 'function') {
      return `
        <span class="channel-title-inner has-icon">
          ${window.renderChannelButtonIconMarkup({ icon: channel.icon }, 'channel-title-icon')}
          <span class="channel-title-text">${escapeHtml(title)}</span>
        </span>
      `;
    }

  const titleIconTarget = getPreviewTitleIconTarget(channel);

  if (!titleIconTarget) {
    return `<span class="channel-title-text">${escapeHtml(title)}</span>`;
  }

  if (!titleIconTarget.iconDataUrl) {
    return `<span class="channel-title-text">${escapeHtml(title)}</span>`;
  }

  return `
    <span class="channel-title-inner has-icon">
        ${renderAppIconMarkup(titleIconTarget, 'channel-title-icon')}
        <span class="channel-title-text">${escapeHtml(title)}</span>
      </span>
    `;
  }

  function capturePreviewLayoutTransition() {
    const previewRoot = dom.previewMount?.querySelector('.entity-edit-preview-channel');
    const previewMountRect = dom.previewMount?.getBoundingClientRect();

    if (!previewRoot || !previewMountRect) {
      return null;
    }

    const rootRect = previewRoot.getBoundingClientRect();
    const buttons = new Map();
    const parts = new Map();

    previewRoot.querySelectorAll('[data-preview-button-id]').forEach((element) => {
      const buttonId = String(element.dataset.previewButtonId || '').trim();

      if (!buttonId) {
        return;
      }

      const rect = element.getBoundingClientRect();
      buttons.set(buttonId, {
        left: rect.left - previewMountRect.left,
        top: rect.top - previewMountRect.top,
        width: rect.width,
        height: rect.height,
        html: element.outerHTML
      });
    });

    previewRoot.querySelectorAll('[data-preview-layout-part]').forEach((element) => {
      const partKey = String(element.dataset.previewLayoutPart || '').trim();

      if (!partKey) {
        return;
      }

      const rect = element.getBoundingClientRect();
      parts.set(partKey, {
        left: rect.left - previewMountRect.left,
        top: rect.top - previewMountRect.top
      });
    });

    return {
      rootWidth: rootRect.width,
      rootHeight: rootRect.height,
      buttons,
      parts
    };
  }

  function cleanupPreviewLayoutTransitionStyles() {
    if (editorState.previewLayoutCleanupTimerId) {
      clearTimeout(editorState.previewLayoutCleanupTimerId);
      editorState.previewLayoutCleanupTimerId = null;
    }

    const previewRoot = dom.previewMount?.querySelector('.entity-edit-preview-channel');

    if (!previewRoot) {
      return;
    }

    previewRoot.classList.remove('is-layout-animating');
    previewRoot.style.width = '';
    previewRoot.style.height = '';
  }

  function playPreviewLayoutTransition(snapshot) {
    const previewRoot = dom.previewMount?.querySelector('.entity-edit-preview-channel');
    const previewMountRect = dom.previewMount?.getBoundingClientRect();

    if (!snapshot || !previewRoot || !previewMountRect) {
      return;
    }

    cleanupPreviewLayoutTransitionStyles();

    const nextRootRect = previewRoot.getBoundingClientRect();
    const rootWidthChanged = Math.abs(snapshot.rootWidth - nextRootRect.width) > 0.5;
    const rootHeightChanged = Math.abs(snapshot.rootHeight - nextRootRect.height) > 0.5;

    if (rootWidthChanged || rootHeightChanged) {
      previewRoot.classList.add('is-layout-animating');
      previewRoot.style.width = `${snapshot.rootWidth}px`;
      previewRoot.style.height = `${snapshot.rootHeight}px`;

      requestAnimationFrame(() => {
        previewRoot.style.width = `${nextRootRect.width}px`;
        previewRoot.style.height = `${nextRootRect.height}px`;
      });

      editorState.previewLayoutCleanupTimerId = window.setTimeout(() => {
        cleanupPreviewLayoutTransitionStyles();
      }, 280);
    }

    const nextButtons = new Map();
    previewRoot.querySelectorAll('[data-preview-button-id]').forEach((element) => {
      const buttonId = String(element.dataset.previewButtonId || '').trim();

      if (!buttonId) {
        return;
      }

      nextButtons.set(buttonId, element);
    });

    nextButtons.forEach((element, buttonId) => {
      const nextRect = element.getBoundingClientRect();
      const previousRect = snapshot.buttons.get(buttonId);

      if (!previousRect) {
        element.animate([
          { opacity: 0, transform: 'translateY(18px) scale(0.96)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' }
        ], {
          duration: 240,
          easing: 'cubic-bezier(0.22, 0.78, 0.2, 1)',
          fill: 'both'
        });
        return;
      }

      const deltaX = previousRect.left - (nextRect.left - previewMountRect.left);
      const deltaY = previousRect.top - (nextRect.top - previewMountRect.top);

      if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
        element.animate([
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: 'translate(0, 0)' }
        ], {
          duration: 260,
          easing: 'cubic-bezier(0.22, 0.78, 0.2, 1)',
          fill: 'both'
        });
      }
    });

    previewRoot.querySelectorAll('[data-preview-layout-part]').forEach((element) => {
      const partKey = String(element.dataset.previewLayoutPart || '').trim();
      const previousRect = snapshot.parts?.get(partKey);

      if (!partKey || !previousRect) {
        return;
      }

      const nextRect = element.getBoundingClientRect();
      const deltaX = previousRect.left - (nextRect.left - previewMountRect.left);
      const deltaY = previousRect.top - (nextRect.top - previewMountRect.top);

      if (Math.abs(deltaX) <= 0.5 && Math.abs(deltaY) <= 0.5) {
        return;
      }

      element.animate([
        { transform: `translate(${deltaX}px, ${deltaY}px)` },
        { transform: 'translate(0, 0)' }
      ], {
        duration: 260,
        easing: 'cubic-bezier(0.22, 0.78, 0.2, 1)',
        fill: 'both'
      });
    });

    snapshot.buttons.forEach((previousRect, buttonId) => {
      if (nextButtons.has(buttonId)) {
        return;
      }

      const ghost = document.createElement('div');
      ghost.className = 'entity-edit-preview-button-ghost';
      ghost.style.left = `${previousRect.left}px`;
      ghost.style.top = `${previousRect.top}px`;
      ghost.style.width = `${previousRect.width}px`;
      ghost.style.height = `${previousRect.height}px`;
      ghost.innerHTML = previousRect.html;
      dom.previewMount?.appendChild(ghost);

      const ghostAnimation = ghost.animate([
        { opacity: 1, transform: 'translateY(0) scale(1)' },
        { opacity: 0, transform: 'translateY(-16px) scale(0.94)' }
      ], {
        duration: 220,
        easing: 'ease',
        fill: 'both'
      });

      ghostAnimation.onfinish = () => {
        ghost.remove();
      };
    });
  }

  function syncPreviewWithLayoutTransition(channel, renderPreviewFn) {
    const snapshot = capturePreviewLayoutTransition();
    const previewRenderer = typeof renderPreviewFn === 'function'
      ? renderPreviewFn
      : () => syncPreviewFromChannel(channel);

    previewRenderer();
    playPreviewLayoutTransition(snapshot);
  }

  function renderFaderPreview(channel) {
    const title = editorState.titleDraft || channel?.title || channel?.appName || t('channels.unnamed');
    const outputVolume = typeof mapFaderPositionToVolume === 'function'
      ? mapFaderPositionToVolume(channel.volume, getEditorChannelResolvedSettings(channel))
      : channel.volume;
    const mappingLabel = getPreviewMappingLabel(channel);
    const previewButtonsMarkup = renderPreviewButtons(channel);
    const buttonLayoutMode = getPreviewButtonLayoutMode(channel);
    const valueText = formatVolumeValue(outputVolume, getEditorChannelResolvedSettings(channel));

    return `
      <div class="channel-strip channel-strip--${buttonLayoutMode} entity-edit-preview-channel" data-preview-channel-id="${channel.id}">
        <div class="channel-body">
          <div class="channel-title" title="${escapeHtml(title)}" data-preview-layout-part="title">${renderPreviewTitleMarkup(channel, title)}</div>
          ${mappingLabel ? `<div class="fader-meta">${escapeHtml(mappingLabel)}</div>` : ''}

          <div class="channel-main channel-main--${buttonLayoutMode}">
            <div class="channel-primary-column" data-preview-layout-part="primary">
              <div class="fader-column">
                <div class="fader-track entity-edit-preview-track" data-preview-track data-preview-channel-id="${channel.id}">
                  <div class="fader-rail"></div>
                  <div class="fader-fill" style="height: ${channel.volume}%"></div>
                  <div class="fader-thumb" style="bottom: calc(${channel.volume}% - 25px)"></div>
                </div>
              </div>

              ${buttonLayoutMode === 'side'
                ? ''
                : `
                  <div class="channel-inline-footer" data-preview-layout-part="footer">
                    <div class="volume-value">${valueText}</div>
                    ${buttonLayoutMode === 'inline' ? previewButtonsMarkup : ''}
                  </div>
                `}
            </div>

            ${buttonLayoutMode === 'side'
              ? `
                <div class="channel-secondary-column" data-preview-layout-part="secondary">
                  ${previewButtonsMarkup}
                  <div class="volume-value">${valueText}</div>
                </div>
              `
              : ''}
          </div>
        </div>
      </div>
    `;
  }

  function renderButtonPreview() {
    const button = getEditorStandaloneButton(editorState.buttonId);

    if (!button) {
      return '';
    }

    const resolvedButton = editorState.titleDirty
      ? {
        ...button,
        text: editorState.titleDraft
      }
      : button;
    const className = typeof window.getStandaloneButtonClassName === 'function'
      ? window.getStandaloneButtonClassName(resolvedButton)
      : `standalone-button ${resolvedButton.active ? 'active' : ''}`;
    const bodyMarkup = typeof window.renderStandaloneButtonBodyMarkup === 'function'
      ? window.renderStandaloneButtonBodyMarkup(resolvedButton)
      : `
        <span class="channel-button-face">
          <span class="channel-button-main">
            <span class="button-icon">${escapeHtml(resolvedButton.icon || 'BTN')}</span>
            <span class="button-label">${escapeHtml(resolvedButton.text || t('buttons.defaultLabel'))}</span>
          </span>
        </span>
      `;

    return `
      <div class="${className} entity-edit-preview-standalone" data-preview-standalone-button-id="${resolvedButton.id}">
        ${bodyMarkup}
      </div>
    `;
  }

  function renderPreviewContent() {
    if (!dom.previewMount) {
      return;
    }

    if (editorState.entityType === 'fader') {
      const channel = getEditorChannel();
      dom.previewMount.innerHTML = channel ? renderFaderPreview(channel) : '';
      return;
    }

    dom.previewMount.innerHTML = renderButtonPreview();
  }

  function syncPreviewFromChannel(channel = getEditorChannel()) {
    if (!channel || !dom.previewMount) {
      return;
    }

    const previewRoot = dom.previewMount.querySelector('.entity-edit-preview-channel');

    if (!previewRoot) {
      renderPreviewContent();
      return;
    }

    const title = editorState.titleDraft || channel.title || channel.appName || t('channels.unnamed');
    const titleElement = previewRoot.querySelector('.channel-title');
    const metaElement = previewRoot.querySelector('.fader-meta');
    const track = previewRoot.querySelector('[data-preview-track]');
    const thumb = track?.querySelector('.fader-thumb');
    const fill = track?.querySelector('.fader-fill');
    const value = previewRoot.querySelector('.volume-value');
    const mappingLabel = getPreviewMappingLabel(channel);
    const outputVolume = typeof mapFaderPositionToVolume === 'function'
      ? mapFaderPositionToVolume(channel.volume, getEditorChannelResolvedSettings(channel))
      : channel.volume;

    if (titleElement) {
      titleElement.innerHTML = renderPreviewTitleMarkup(channel, title);
      titleElement.setAttribute('title', title);
    }

    if (metaElement) {
      metaElement.textContent = mappingLabel || '';
    }

    if (fill) {
      fill.style.height = `${channel.volume}%`;
    }

    if (thumb) {
      thumb.style.bottom = `calc(${channel.volume}% - 25px)`;
    }

    if (value) {
      value.textContent = formatVolumeValue(outputVolume, getEditorChannelResolvedSettings(channel));
    }
  }

  function syncPreviewFromButton(button = getEditorStandaloneButton(editorState.buttonId)) {
    if (!button || !dom.previewMount) {
      return;
    }

    renderPreviewContent();
  }

  function startPreviewEntranceAnimation() {
    clearPreviewTimer();
    cleanupFloatingPreviews();
    renderPreviewContent();
    setPreviewEntranceState(true);

    const sourceElement = resolveEntitySourceElement();
    const previewElement = dom.previewMount?.firstElementChild;

    if (!dom.previewFrame || !previewElement) {
      setPreviewEntranceState(false);
      setSourcePreviewState(true);
      return;
    }

    const floatingPreview = createFloatingPreview(sourceElement);

    if (!floatingPreview) {
      dom.previewFrame.classList.add('is-ready');
      setPreviewEntranceState(false);
      setSourcePreviewState(true);
      return;
    }

    dom.previewFrame.classList.remove('is-ready');
    setSourcePreviewState(true);
    document.body.appendChild(floatingPreview);

    requestAnimationFrame(() => {
      const targetRect = previewElement.getBoundingClientRect();
      floatingPreview.classList.add('is-animating');
      setFloatingPreviewRect(floatingPreview, targetRect);
    });

    editorState.previewTimerId = setTimeout(() => {
      dom.previewFrame?.classList.add('is-ready');
      requestAnimationFrame(() => {
        cleanupFloatingPreviews();
        setPreviewEntranceState(false);
        editorState.previewTimerId = null;
      });
    }, ENTITY_EDITOR_PREVIEW_MOVE_MS);
  }

  function startPreviewExitAnimation() {
    clearPreviewTimer();
    cleanupFloatingPreviews();

    const sourceElement = resolveEntitySourceElement();
    const previewElement = dom.previewMount?.firstElementChild;

    if (!sourceElement || !previewElement) {
      setSourcePreviewState(false);
      return;
    }

    const floatingPreview = createFloatingPreview(previewElement, previewElement.getBoundingClientRect());

    if (!floatingPreview) {
      setSourcePreviewState(false);
      return;
    }

    dom.previewFrame?.classList.remove('is-ready');
    document.body.appendChild(floatingPreview);

    requestAnimationFrame(() => {
      floatingPreview.classList.add('is-animating');
      setFloatingPreviewRect(floatingPreview, sourceElement.getBoundingClientRect());
    });

    editorState.previewTimerId = setTimeout(() => {
      cleanupFloatingPreviews();
      setSourcePreviewState(false);
      editorState.previewTimerId = null;
    }, ENTITY_EDITOR_PREVIEW_MOVE_MS);
  }

  function cleanupPreviewState({ restoreSource = true } = {}) {
    clearPreviewTimer();
    clearPreviewDragFrame();
    cleanupFloatingPreviews();
    setPreviewEntranceState(false);

    if (restoreSource) {
      setSourcePreviewState(false);
    } else {
      editorState.sourceHidden = false;
    }

    dom.previewFrame?.classList.remove('is-ready');

    if (dom.previewMount) {
      dom.previewMount.innerHTML = '';
    }
  }

  function getPreviewVolumeFromPointer(track, clientY) {
    const rect = track.getBoundingClientRect();
    const offsetY = clientY - rect.top;
    const volume = ((rect.height - offsetY) / rect.height) * 100;
    return Math.max(0, Math.min(100, Number(volume) || 0));
  }

  function applyPreviewVolume(channelId, volume) {
    const channel = findChannelState?.(channelId);

    if (!channel) {
      return;
    }

    const nextVolume = normalizeVolumeValue?.(volume) ?? volume;
    syncPreviewFromChannel({
      ...channel,
      volume: nextVolume
    });

    applyChannelVolumeRuntime?.(channelId, nextVolume, {
      source: 'entity-editor-preview',
      type: 'channels/set-volume'
    });
  }

  function stopPreviewDrag() {
    if (!editorState.previewDrag) {
      return;
    }

    clearPreviewDragFrame();
    editorState.previewDrag.track?.classList.remove('is-dragging');
    editorState.previewDrag = null;
    saveProfileToLocal?.();
    window.removeEventListener('pointermove', handlePreviewDragMove);
    window.removeEventListener('pointerup', stopPreviewDrag);
    window.removeEventListener('pointercancel', stopPreviewDrag);
  }

  function handlePreviewDragMove(event) {
    if (!editorState.previewDrag) {
      return;
    }

    editorState.previewDrag.pendingClientY = event.clientY;

    if (editorState.previewDragFrameId) {
      return;
    }

    editorState.previewDragFrameId = requestAnimationFrame(() => {
      editorState.previewDragFrameId = null;

      if (!editorState.previewDrag) {
        return;
      }

      const nextVolume = getPreviewVolumeFromPointer(
        editorState.previewDrag.track,
        editorState.previewDrag.pendingClientY
      );

      applyPreviewVolume(editorState.previewDrag.channelId, nextVolume);
    });
  }

  function startPreviewDrag(event) {
    if (editorState.entityType !== 'fader') {
      return;
    }

    const track = event.target.closest('[data-preview-track]');

    if (!track) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    editorState.previewDrag = {
      channelId: Number.parseInt(track.dataset.previewChannelId, 10),
      track,
      pendingClientY: event.clientY
    };

    track.classList.add('is-dragging');

    if (typeof track.setPointerCapture === 'function') {
      try {
        track.setPointerCapture(event.pointerId);
      } catch (error) {
        // noop
      }
    }

    applyPreviewVolume(
      editorState.previewDrag.channelId,
      getPreviewVolumeFromPointer(track, event.clientY)
    );

    window.addEventListener('pointermove', handlePreviewDragMove, { passive: true });
    window.addEventListener('pointerup', stopPreviewDrag);
    window.addEventListener('pointercancel', stopPreviewDrag);
  }

  function renderEditorToggle(isEnabled, attributes = '') {
    return `
      <button class="settings-toggle ${isEnabled ? 'on' : ''}" type="button" ${attributes}>
        ${isEnabled ? t('settings.on') : t('settings.off')}
      </button>
    `;
  }

  function renderEditorTargets(channel) {
    const targetMode = getChannelTargetMode(channel);
    const activeTitleIconProcess = channel?.showTargetIconInTitle
      ? String(channel?.titleIconTargetProcess || '').trim()
      : '';

    if (targetMode === (window.CHANNEL_TARGET_MODES?.devices || 'devices')) {
      const deviceTargets = getChannelDeviceTargets(channel).map(resolveDeviceTargetDisplayEntry);

      if (!deviceTargets.length) {
        return `
          <button class="entity-edit-target-placeholder" type="button" data-editor-open-targets>
            ${t('editor.targetPlaceholder')}
          </button>
        `;
      }

      return `
        <div class="entity-edit-target-list">
          ${deviceTargets.map((target) => `
            <div class="entity-edit-target-chip" data-editor-device-target-chip="${escapeHtml(target.id)}">
              <span class="entity-edit-target-icon">${escapeHtml(target.flow === 'input' ? 'IN' : 'OUT')}</span>
              <span class="entity-edit-target-label">${escapeHtml(target.name)}</span>
              <span class="entity-edit-target-inline-meta">${escapeHtml(target.flow === 'input' ? t('editor.deviceFlowInput') : t('editor.deviceFlowOutput'))}</span>
              <button
                class="entity-edit-target-remove"
                type="button"
                data-editor-remove-device-target="${escapeHtml(target.id)}"
                data-editor-remove-device-target-flow="${escapeHtml(target.flow)}"
                aria-label="${escapeHtml(t('editor.removeTarget'))}">
                <span>&times;</span>
              </button>
            </div>
          `).join('')}
        </div>
      `;
    }

    if (targetMode === (window.CHANNEL_TARGET_MODES?.focus || 'focus')) {
      const exclusions = getChannelFocusExclusions(channel).map(resolveTargetDisplayEntry);

      return `
        <div class="entity-edit-target-list">
          <div class="entity-edit-target-chip entity-edit-target-chip--focus-summary has-icon">
            <span class="entity-edit-target-icon">F</span>
            <span class="entity-edit-target-label">${escapeHtml(t('editor.targetModeFocusCurrent'))}</span>
            <span class="entity-edit-target-inline-meta">${escapeHtml(
              exclusions.length
                ? t('editor.focusExclusionsCount', { count: exclusions.length })
                : t('editor.focusExclusionsNone')
            )}</span>
          </div>
          ${exclusions.length
            ? exclusions.map((target) => `
              <div class="entity-edit-target-chip ${target.iconDataUrl ? 'has-icon' : ''}" data-editor-focus-exclusion-chip="${escapeHtml(target.process)}">
                ${renderAppIconMarkup(target, 'entity-edit-target-icon')}
                <span class="entity-edit-target-label">${escapeHtml(target.name)}</span>
                <span class="entity-edit-target-inline-meta">${escapeHtml(t('editor.focusExcludedApp'))}</span>
                <button
                  class="entity-edit-target-remove"
                  type="button"
                  data-editor-remove-focus-exclusion="${escapeHtml(target.process)}"
                  aria-label="${escapeHtml(t('editor.removeTarget'))}">
                  <span>&times;</span>
                </button>
              </div>
            `).join('')
            : ''}
        </div>
      `;
    }

    const targets = getChannelTargets(channel).map(resolveTargetDisplayEntry);
    const deviceTargets = getChannelDeviceTargets(channel).map(resolveDeviceTargetDisplayEntry);

    if (!targets.length && !deviceTargets.length) {
      return `
        <button class="entity-edit-target-placeholder" type="button" data-editor-open-targets>
          ${t('editor.targetPlaceholder')}
        </button>
      `;
    }

    return `
      <div class="entity-edit-target-list">
        ${targets.map((target) => `
          <div class="entity-edit-target-chip ${target.iconDataUrl ? 'has-icon' : ''}" data-editor-target-chip="${escapeHtml(target.process)}">
            ${renderAppIconMarkup(target, 'entity-edit-target-icon')}
            <span class="entity-edit-target-label">${escapeHtml(target.name)}</span>
            <button
              class="entity-edit-target-action-toggle ${activeTitleIconProcess === target.process ? 'active' : ''}"
              type="button"
              data-editor-toggle-title-icon="${escapeHtml(target.process)}"
              aria-pressed="${activeTitleIconProcess === target.process ? 'true' : 'false'}">
              ${t('editor.targetTitleIcon')}
            </button>
            <button
              class="entity-edit-target-action"
              type="button"
              data-editor-use-target-name="${escapeHtml(target.process)}">
              ${t('editor.useTargetName')}
            </button>
            <button
              class="entity-edit-target-remove"
              type="button"
              data-editor-remove-target="${escapeHtml(target.process)}"
              aria-label="${escapeHtml(t('editor.removeTarget'))}">
              <span>&times;</span>
            </button>
          </div>
        `).join('')}
        ${deviceTargets.map((target) => `
          <div class="entity-edit-target-chip" data-editor-device-target-chip="${escapeHtml(target.id)}">
            <span class="entity-edit-target-label">${escapeHtml(target.name)}</span>
            <span class="entity-edit-target-inline-meta">${escapeHtml(target.flow === 'input' ? t('editor.deviceFlowInput') : t('editor.deviceFlowOutput'))}</span>
            <button
              class="entity-edit-target-remove"
              type="button"
              data-editor-remove-device-target="${escapeHtml(target.id)}"
              data-editor-remove-device-target-flow="${escapeHtml(target.flow)}"
              aria-label="${escapeHtml(t('editor.removeTarget'))}">
              <span>&times;</span>
            </button>
          </div>
        `).join('')}
      </div>
      `;
  }

  function renderStandaloneEditorTargets(button) {
    const targets = getChannelTargets(button).map(resolveTargetDisplayEntry);

    if (!targets.length) {
      return `
        <button class="entity-edit-target-placeholder" type="button" data-editor-open-targets>
          ${t('editor.targetPlaceholder')}
        </button>
      `;
    }

    return `
      <div class="entity-edit-target-list">
        ${targets.map((target) => `
          <div
            class="entity-edit-target-chip entity-edit-target-chip--standalone ${target.iconDataUrl ? 'has-icon' : ''}"
            data-editor-target-chip="${escapeHtml(target.process)}">
            ${renderAppIconMarkup(target, 'entity-edit-target-icon')}
            <span class="entity-edit-target-label">${escapeHtml(target.name)}</span>
            <button
              class="entity-edit-target-remove"
              type="button"
              data-editor-remove-target="${escapeHtml(target.process)}"
              aria-label="${escapeHtml(t('editor.removeTarget'))}">
              <span>&times;</span>
            </button>
          </div>
        `).join('')}
      </div>
    `;
  }

  function getEditorButtonActionLabel(button = {}) {
    const actionType = String(button?.actionType || '').trim();
    const labels = {
      none: t('editor.buttonActionNone'),
      mute: t('editor.buttonActionMute'),
      solo: t('editor.buttonActionSolo'),
      'set-volume': t('editor.buttonActionSetVolume'),
      'toggle-app-visibility': translateOrFallback('editor.buttonActionToggleAppVisibility', 'Open / hide app'),
      'send-key': t('editor.buttonActionSendKey'),
      'media-previous-track': t('editor.buttonActionMediaPrevious'),
      'media-next-track': t('editor.buttonActionMediaNext'),
      'media-play': t('editor.buttonActionMediaPlay'),
      'media-pause': t('editor.buttonActionMediaPause'),
      'media-play-pause': t('editor.buttonActionMediaPlayPause'),
      'media-rewind': translateOrFallback('editor.buttonActionMediaRewind', 'Rewind'),
      'media-fast-forward': translateOrFallback('editor.buttonActionMediaFastForward', 'Fast forward'),
      'media-repeat': translateOrFallback('editor.buttonActionMediaRepeat', 'Repeat'),
      'media-shuffle': translateOrFallback('editor.buttonActionMediaShuffle', 'Shuffle'),
      'run-user-script': translateOrFallback('editor.buttonActionRunUserScript', 'Run user script'),
      'launch-app': translateOrFallback('editor.buttonActionLaunchApp', 'Open / run app'),
      'set-default-output-device': translateOrFallback('editor.buttonActionSetDefaultOutputDevice', 'Set default output device'),
      'set-default-input-device': translateOrFallback('editor.buttonActionSetDefaultInputDevice', 'Set default input device')
    };

    return labels[actionType] || t('editor.buttonActionNone');
  }

  function getStandaloneButtonActionTypes() {
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

  function isStandaloneButtonChannelActionType(actionType = '') {
    return window.standaloneButtonActions?.isChannelActionType?.(actionType) || false;
  }

  function isStandaloneButtonMediaActionType(actionType = '') {
    return window.standaloneButtonActions?.isMediaActionType?.(actionType) || false;
  }

  function getStandaloneButtonLinkedChannel(button = {}) {
    return window.standaloneButtonActions?.getLinkedChannel?.(button) || null;
  }

  function getStandaloneButtonChannelOptions() {
    return (window.getChannelsState?.() || []).map((channel, index) => ({
      id: channel.id,
      label: String(
        channel.title
        || channel.appName
        || t('channels.defaultTitle', { index: index + 1 })
      ).trim()
    }));
  }

  function getButtonTargetChannelOptions(ownerChannelId = null) {
    return (window.getChannelsState?.() || []).map((channel, index) => ({
      id: channel.id,
      isOwner: Number(ownerChannelId) === Number(channel.id),
      label: String(
        channel.title
        || channel.appName
        || t('channels.defaultTitle', { index: index + 1 })
      ).trim()
    }));
  }

  function resolveDefaultButtonLinkedChannelId(button = {}, ownerChannelId = null) {
    const currentLinkedChannelId = Number(button?.linkedChannelId);
    const channelOptions = getButtonTargetChannelOptions(ownerChannelId);

    if (Number.isFinite(currentLinkedChannelId)) {
      const matchedOption = channelOptions.find((channelOption) => channelOption.id === currentLinkedChannelId);

      if (matchedOption) {
        return matchedOption.id;
      }
    }

    if (Number.isFinite(Number(ownerChannelId))) {
      return Number(ownerChannelId);
    }

    return channelOptions[0]?.id ?? null;
  }

  function getEditorButtonActionGroups() {
    return [
      { value: 'none', label: translateOrFallback('editor.buttonActionGroupNone', 'None') },
      { value: 'faders', label: translateOrFallback('editor.buttonActionGroupFaders', 'Faders') },
      { value: 'multimedia', label: translateOrFallback('editor.buttonActionGroupMedia', 'Multimedia') },
      { value: 'system', label: translateOrFallback('editor.buttonActionGroupSystem', 'System') }
    ];
  }

  function getEditorButtonActionGroup(actionType = '') {
    const actionTypes = getStandaloneButtonActionTypes();
    const normalizedActionType = String(actionType || '').trim();

    if (!normalizedActionType || normalizedActionType === actionTypes.none) {
      return 'none';
    }

    if ([
      actionTypes.mute,
      actionTypes.solo,
      actionTypes.setVolume,
      actionTypes.toggleAppVisibility
    ].includes(normalizedActionType)) {
      return 'faders';
    }

    if ([
      actionTypes.mediaPreviousTrack,
      actionTypes.mediaNextTrack,
      actionTypes.mediaPlay,
      actionTypes.mediaPause,
      actionTypes.mediaPlayPause,
      actionTypes.mediaRewind,
      actionTypes.mediaFastForward,
      actionTypes.mediaRepeat,
      actionTypes.mediaShuffle
    ].includes(normalizedActionType)) {
      return 'multimedia';
    }

    if ([
      actionTypes.runUserScript,
      actionTypes.launchApp,
      actionTypes.sendKey,
      actionTypes.setDefaultOutputDevice,
      actionTypes.setDefaultInputDevice
    ].includes(normalizedActionType)) {
      return 'system';
    }

    return 'none';
  }

  function getEditorButtonActionOptions(group = 'faders') {
    const actionTypes = getStandaloneButtonActionTypes();

    if (group === 'none') {
      return [
        { value: actionTypes.none, label: translateOrFallback('editor.buttonActionNone', 'No action') }
      ];
    }

    if (group === 'multimedia') {
      return [
        { value: actionTypes.mediaPlayPause, label: translateOrFallback('editor.buttonActionMediaPlayPause', 'Play / pause') },
        { value: actionTypes.mediaNextTrack, label: translateOrFallback('editor.buttonActionMediaNext', 'Next track') },
        { value: actionTypes.mediaPreviousTrack, label: translateOrFallback('editor.buttonActionMediaPrevious', 'Previous track') },
        { value: actionTypes.mediaRewind, label: translateOrFallback('editor.buttonActionMediaRewind', 'Rewind') },
        { value: actionTypes.mediaFastForward, label: translateOrFallback('editor.buttonActionMediaFastForward', 'Fast forward') },
        { value: actionTypes.mediaRepeat, label: translateOrFallback('editor.buttonActionMediaRepeat', 'Repeat') },
        { value: actionTypes.mediaShuffle, label: translateOrFallback('editor.buttonActionMediaShuffle', 'Shuffle') },
        { value: actionTypes.mediaPlay, label: translateOrFallback('editor.buttonActionMediaPlay', 'Play') },
        { value: actionTypes.mediaPause, label: translateOrFallback('editor.buttonActionMediaPause', 'Pause') }
      ];
    }

    if (group === 'system') {
      return [
        { value: actionTypes.runUserScript, label: translateOrFallback('editor.buttonActionRunUserScript', 'Run user script') },
        { value: actionTypes.launchApp, label: translateOrFallback('editor.buttonActionLaunchApp', 'Open / run app') },
        { value: actionTypes.sendKey, label: translateOrFallback('editor.buttonActionSendKey', 'Send key') },
        { value: actionTypes.setDefaultOutputDevice, label: translateOrFallback('editor.buttonActionSetDefaultOutputDevice', 'Set default output device') },
        { value: actionTypes.setDefaultInputDevice, label: translateOrFallback('editor.buttonActionSetDefaultInputDevice', 'Set default input device') }
      ];
    }

    return [
      { value: actionTypes.mute, label: translateOrFallback('editor.buttonActionMute', 'Mute') },
      { value: actionTypes.solo, label: translateOrFallback('editor.buttonActionSolo', 'Solo') },
      { value: actionTypes.setVolume, label: translateOrFallback('editor.buttonActionSetVolume', 'Set volume') },
      { value: actionTypes.toggleAppVisibility, label: translateOrFallback('editor.buttonActionToggleAppVisibility', 'Open / hide app') }
    ];
  }

  function getChannelButtonIndicatorBehaviors() {
    return window.CHANNEL_BUTTON_INDICATOR_BEHAVIORS || {
      actionState: 'action-state',
      peakMeter: 'peak-meter',
      targetActivity: 'target-activity'
    };
  }

  function getButtonIndicatorThresholdBounds() {
    return {
      min: Number(window.MIN_CHANNEL_BUTTON_INDICATOR_THRESHOLD ?? -60),
      max: Number(window.MAX_CHANNEL_BUTTON_INDICATOR_THRESHOLD ?? 0),
      fallback: Number(window.DEFAULT_CHANNEL_BUTTON_INDICATOR_THRESHOLD ?? -20)
    };
  }

  function clampButtonIndicatorThreshold(value) {
    const bounds = getButtonIndicatorThresholdBounds();
    const numericValue = Number(value);
    return Math.max(
      bounds.min,
      Math.min(bounds.max, Number.isFinite(numericValue) ? numericValue : bounds.fallback)
    );
  }

  function formatButtonIndicatorThreshold(value) {
    return `${Math.round(clampButtonIndicatorThreshold(value))} dB`;
  }

  function convertButtonMeterLevelToDb(meterLevel = 0) {
    const bounds = getButtonIndicatorThresholdBounds();
    const normalizedLevel = Math.max(0, Math.min(1, Number(meterLevel) || 0));

    if (normalizedLevel <= 0) {
      return bounds.min;
    }

    return Math.max(bounds.min, Math.min(bounds.max, 20 * Math.log10(normalizedLevel)));
  }

  function getEditorButtonLivePeakSnapshot(button = {}, options = {}) {
    const bounds = getButtonIndicatorThresholdBounds();
    const thresholdDb = clampButtonIndicatorThreshold(
      options?.thresholdDb ?? button?.indicatorThreshold
    );
    const channelId = Number(options?.channelId);
    const runtimeState = Number.isFinite(channelId)
      ? window.getChannelButtonState?.(channelId, button?.id)
      : window.getStandaloneButtonState?.(button?.id);
    const rawMeterLevel = Math.max(0, Math.min(1, Number(runtimeState?.rawMeterLevel) || 0));
    const rawMeterDb = Number.isFinite(Number(runtimeState?.rawMeterDb))
      ? Math.max(bounds.min, Math.min(bounds.max, Number(runtimeState.rawMeterDb)))
      : convertButtonMeterLevelToDb(rawMeterLevel);
    const levelPercent = ((rawMeterDb - bounds.min) / (bounds.max - bounds.min)) * 100;
    const thresholdPercent = ((thresholdDb - bounds.min) / (bounds.max - bounds.min)) * 100;

    return {
      rawMeterLevel,
      rawMeterDb,
      thresholdDb,
      levelPercent: Math.max(0, Math.min(100, levelPercent)),
      thresholdPercent: Math.max(0, Math.min(100, thresholdPercent))
    };
  }

  function renderButtonIndicatorLiveMeter(button = {}, options = {}) {
    const snapshot = getEditorButtonLivePeakSnapshot(button, options);
    const channelId = Number.isFinite(Number(options?.channelId)) ? Number(options.channelId) : null;
    const bounds = getButtonIndicatorThresholdBounds();

    return `
      <div
        class="entity-edit-button-live-meter"
        data-editor-button-live-meter
        data-editor-button-id="${button.id}"
        data-editor-channel-id="${channelId ?? ''}"
        data-editor-button-threshold="${snapshot.thresholdDb}">
        <div class="entity-edit-button-live-meter-track">
          <div
            class="entity-edit-button-live-meter-fill"
            data-editor-button-live-meter-fill
            style="transform: scaleX(${snapshot.levelPercent / 100});"></div>
          <div
            class="entity-edit-button-live-meter-threshold"
            data-editor-button-live-meter-threshold
            style="left: ${snapshot.thresholdPercent}%;"></div>
        </div>
        <div class="entity-edit-button-live-meter-meta">
          <span class="entity-edit-button-live-meter-scale-min">${bounds.min} dB</span>
          <span class="entity-edit-button-live-meter-value" data-editor-button-live-meter-value>${Math.round(snapshot.rawMeterDb)} dB</span>
          <span class="entity-edit-button-live-meter-scale-max">${bounds.max} dB</span>
        </div>
      </div>
    `;
  }

  function updateEntityEditorLivePeakMeters() {
    const meterRoots = dom.modal?.querySelectorAll?.('[data-editor-button-live-meter]')
      || document.querySelectorAll('[data-editor-button-live-meter]');

    meterRoots.forEach((meterRoot) => {
      const buttonId = Number.parseInt(meterRoot.dataset.editorButtonId || '', 10);
      const channelId = Number.parseInt(meterRoot.dataset.editorChannelId || '', 10);
      const thresholdDb = clampButtonIndicatorThreshold(meterRoot.dataset.editorButtonThreshold);

      if (!Number.isFinite(buttonId)) {
        return;
      }

      const snapshot = getEditorButtonLivePeakSnapshot(
        { id: buttonId, indicatorThreshold: thresholdDb },
        {
          channelId: Number.isFinite(channelId) ? channelId : null,
          thresholdDb
        }
      );
      const fill = meterRoot.querySelector('[data-editor-button-live-meter-fill]');
      const threshold = meterRoot.querySelector('[data-editor-button-live-meter-threshold]');
      const value = meterRoot.querySelector('[data-editor-button-live-meter-value]');

      if (fill) {
        fill.style.transform = `scaleX(${snapshot.levelPercent / 100})`;
        fill.style.opacity = snapshot.rawMeterLevel > 0.001 ? '1' : '0';
      }

      if (threshold) {
        threshold.style.left = `${snapshot.thresholdPercent}%`;
      }

      if (value) {
        value.textContent = `${Math.round(snapshot.rawMeterDb)} dB`;
      }
    });
  }

  function scheduleEntityEditorLivePeakMeterUpdate() {
    if (editorRuntimeSync.frameId) {
      return;
    }

    editorRuntimeSync.frameId = window.requestAnimationFrame(() => {
      editorRuntimeSync.frameId = null;

      if (getCurrentActiveModalId() !== ENTITY_EDITOR_MODAL_ID) {
        return;
      }

      updateEntityEditorLivePeakMeters();
    });
  }

  function initEntityEditorRuntimeSync() {
    if (editorRuntimeSync.initialized) {
      return;
    }

    window.channelButtonRuntime?.subscribe?.(() => {
      scheduleEntityEditorLivePeakMeterUpdate();
    });
    window.standaloneButtonRuntime?.subscribe?.(() => {
      scheduleEntityEditorLivePeakMeterUpdate();
    });

    editorRuntimeSync.initialized = true;
  }

  function getDefaultIconForButtonActionType(actionType = '', fallbackIcon = 'square') {
    const actionTypes = getStandaloneButtonActionTypes();
    const normalizedActionType = String(actionType || '').trim();

    if (normalizedActionType === actionTypes.none) {
      return 'square';
    }

    if (normalizedActionType === actionTypes.mute) {
      return 'mute';
    }

    if (normalizedActionType === actionTypes.solo) {
      return 'target';
    }

    if (normalizedActionType === actionTypes.setVolume) {
      return 'speaker';
    }

    if (normalizedActionType === actionTypes.toggleAppVisibility) {
      return 'layers';
    }

    if (normalizedActionType === actionTypes.sendKey) {
      return 'flash';
    }

    if (normalizedActionType === actionTypes.mediaPreviousTrack) {
      return 'skip-previous';
    }

    if (normalizedActionType === actionTypes.mediaNextTrack) {
      return 'skip-next';
    }

    if (normalizedActionType === actionTypes.mediaPlay) {
      return 'play';
    }

    if (normalizedActionType === actionTypes.mediaPause) {
      return 'pause';
    }

    if (normalizedActionType === actionTypes.mediaPlayPause) {
      return 'play-pause';
    }

    if (normalizedActionType === actionTypes.mediaRewind) {
      return 'rewind';
    }

    if (normalizedActionType === actionTypes.mediaFastForward) {
      return 'fast-forward';
    }

    if (normalizedActionType === actionTypes.mediaRepeat) {
      return 'repeat';
    }

    if (normalizedActionType === actionTypes.mediaShuffle) {
      return 'shuffle';
    }

    if (normalizedActionType === actionTypes.runUserScript) {
      return 'bolt';
    }

    if (normalizedActionType === actionTypes.launchApp) {
      return 'layers';
    }

    if (normalizedActionType === actionTypes.setDefaultOutputDevice) {
      return 'speaker';
    }

    if (normalizedActionType === actionTypes.setDefaultInputDevice) {
      return 'wave';
    }

    return fallbackIcon;
  }

  function renderEditorButtonSelect(label, value, options = [], attrs = '', placeholder = '') {
    const normalizedValue = String(value ?? '');
    const resolvedAttrs = String(attrs || '').trim();
    const includePlaceholder = placeholder && !options.some((option) => String(option.value) === normalizedValue);

    return `
      <label class="entity-edit-button-select-field">
        ${label
          ? `<span class="entity-edit-button-side-subsection-label">${escapeHtml(label)}</span>`
          : ''}
        <span class="entity-edit-button-select-shell">
          <select class="entity-edit-button-select app-selector" ${resolvedAttrs}>
            ${includePlaceholder
              ? `<option value="">${escapeHtml(placeholder)}</option>`
              : ''}
            ${options.map((option) => `
              <option
                value="${escapeHtml(option.value)}"
                ${String(option.value) === normalizedValue ? 'selected' : ''}>
                ${escapeHtml(option.label)}
              </option>
            `).join('')}
          </select>
        </span>
      </label>
    `;
  }

  function ensureEditorAudioDevicesLoaded(flow = 'output', options = {}) {
    const normalizedFlow = flow === 'input' ? 'input' : 'output';
    const targeting = window.channelTargeting || null;
    const api = typeof window.getApi === 'function'
      ? window.getApi()
      : (window.getNativeApi?.() ?? null);

    if (!targeting?.listAudioDevices && !api?.list_audio_devices) {
      return Promise.resolve([]);
    }

    if (
      !options.force
      && (
        editorState.audioDeviceLoading[normalizedFlow]
        || editorState.audioDeviceOptions[normalizedFlow].length
      )
    ) {
      return Promise.resolve(editorState.audioDeviceOptions[normalizedFlow]);
    }

    editorState.audioDeviceLoading[normalizedFlow] = true;
    editorState.audioDeviceErrors[normalizedFlow] = '';

    const loader = targeting?.listAudioDevices
      ? targeting.listAudioDevices(normalizedFlow, { force: Boolean(options?.force) })
      : api.list_audio_devices(normalizedFlow);

    return Promise.resolve(loader)
      .then((response) => {
        const devices = Array.isArray(response)
          ? response
          : (Array.isArray(response?.devices) ? response.devices : []);

        editorState.audioDeviceOptions[normalizedFlow] = devices;
        return editorState.audioDeviceOptions[normalizedFlow];
      })
      .catch((error) => {
        editorState.audioDeviceOptions[normalizedFlow] = [];
        editorState.audioDeviceErrors[normalizedFlow] = error?.message || 'Failed to load audio devices.';
        console.error('list_audio_devices error', error);
        return [];
      })
      .finally(() => {
        editorState.audioDeviceLoading[normalizedFlow] = false;

        if (getCurrentActiveModalId() === ENTITY_EDITOR_MODAL_ID) {
          refreshEntityEditor();
        }
      });
  }

  function renderButtonLinkedChannelField(button = {}, ownerChannelId = null) {
    const channelOptions = getButtonTargetChannelOptions(ownerChannelId);

    if (!channelOptions.length) {
      return `
        <div class="entity-edit-button-empty-state">
          ${translateOrFallback('editor.buttonLinkedFaderEmpty', 'Add a fader first to use this action.')}
        </div>
      `;
    }

    const linkedChannelId = resolveDefaultButtonLinkedChannelId(button, ownerChannelId);

    return renderEditorButtonSelect(
      translateOrFallback('editor.buttonLinkedFader', 'Fader'),
      linkedChannelId,
      channelOptions.map((option) => ({
        value: option.id,
        label: option.label
      })),
      'data-editor-button-linked-channel-select'
    );
  }

  function renderButtonFileField(label, value, fieldName, pickMode, placeholder) {
    return `
      <div class="entity-edit-button-main-subsection">
        <div class="entity-edit-button-side-subsection-label">${escapeHtml(label)}</div>
        <div class="entity-edit-button-file-row">
          <input
            class="entity-edit-button-file-input"
            type="text"
            value="${escapeHtml(String(value || ''))}"
            placeholder="${escapeHtml(placeholder)}"
            data-editor-button-path-field="${escapeHtml(fieldName)}">
          <button
            class="btn entity-edit-button-file-pick"
            type="button"
            data-editor-button-pick-file="${escapeHtml(pickMode)}"
            data-editor-button-path-target="${escapeHtml(fieldName)}">
            ${translateOrFallback('editor.chooseFile', 'Choose')}
          </button>
        </div>
      </div>
    `;
  }

  function renderButtonAudioDeviceField(button = {}, flow = 'output') {
    const normalizedFlow = flow === 'input' ? 'input' : 'output';
    const devices = Array.isArray(editorState.audioDeviceOptions[normalizedFlow])
      ? editorState.audioDeviceOptions[normalizedFlow]
      : [];
    const isLoading = Boolean(editorState.audioDeviceLoading[normalizedFlow]);
    const errorMessage = String(editorState.audioDeviceErrors[normalizedFlow] || '').trim();

    if (!devices.length && !isLoading && !errorMessage) {
      void ensureEditorAudioDevicesLoaded(normalizedFlow);
    }

    return `
      <div class="entity-edit-button-main-subsection">
        ${renderEditorButtonSelect(
          normalizedFlow === 'output'
            ? translateOrFallback('editor.buttonActionSetDefaultOutputDevice', 'Set default output device')
            : translateOrFallback('editor.buttonActionSetDefaultInputDevice', 'Set default input device'),
          button?.deviceId || '',
          devices.map((device) => ({
            value: device.id,
            label: `${device.name || device.id}${device.isDefault ? ' (default)' : ''}`
          })),
          `data-editor-button-device-select="${normalizedFlow}" ${isLoading ? `data-dropdown-loading="true" data-dropdown-status-label="${escapeHtml(translateOrFallback('editor.loading', 'Loading'))}"` : ''}`,
          isLoading
            ? 'Loading devices...'
            : (normalizedFlow === 'output' ? 'Choose output device' : 'Choose input device')
        )}
        <div class="entity-edit-button-inline-actions">
          <button
            class="btn entity-edit-button-inline-button"
            type="button"
            data-editor-button-refresh-devices="${normalizedFlow}">
            ${translateOrFallback('editor.refresh', 'Refresh')}
          </button>
          ${errorMessage
            ? `<span class="entity-edit-button-inline-note">${escapeHtml(errorMessage)}</span>`
            : ''}
        </div>
      </div>
    `;
  }

  function renderButtonActionFields(button = {}, options = {}) {
    const actionTypes = getStandaloneButtonActionTypes();
    const ownerChannelId = Number.isFinite(Number(options?.ownerChannelId))
      ? Number(options.ownerChannelId)
      : null;

    if (
      button?.actionType === actionTypes.mute
      || button?.actionType === actionTypes.solo
      || button?.actionType === actionTypes.setVolume
      || button?.actionType === actionTypes.toggleAppVisibility
    ) {
      const linkedChannelField = ownerChannelId == null
        ? renderButtonLinkedChannelField(button, ownerChannelId)
        : '';

      return `
        ${linkedChannelField}
        ${button?.actionType === actionTypes.setVolume
          ? `
            <div class="entity-edit-button-main-subsection">
              <div class="entity-edit-button-side-subsection-label">${escapeHtml(translateOrFallback('editor.buttonSetVolumeValue', 'Volume'))}</div>
              <div class="settings-range-row entity-edit-button-side-range-row">
                <input
                  class="settings-range"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value="${Number(button?.actionValue) || 0}"
                  data-editor-side-button-action-value="${button.id}">
                <div class="settings-range-value" data-editor-side-button-action-value-label>${Math.round(Number(button?.actionValue) || 0)}%</div>
              </div>
            </div>
          `
          : ''}
      `;
    }

    if (button?.actionType === actionTypes.sendKey) {
      return renderButtonKeyCapture(button);
    }

    if (button?.actionType === actionTypes.runUserScript) {
      return renderButtonFileField(
        translateOrFallback('editor.buttonActionRunUserScript', 'Run user script'),
        button?.scriptPath || '',
        'scriptPath',
        'script',
        'Path to script file'
      );
    }

    if (button?.actionType === actionTypes.launchApp) {
      return renderButtonFileField(
        translateOrFallback('editor.buttonActionLaunchApp', 'Open / run app'),
        button?.launchPath || '',
        'launchPath',
        'app',
        'Path to application'
      );
    }

    if (button?.actionType === actionTypes.setDefaultOutputDevice) {
      return renderButtonAudioDeviceField(button, 'output');
    }

    if (button?.actionType === actionTypes.setDefaultInputDevice) {
      return renderButtonAudioDeviceField(button, 'input');
    }

    if (isStandaloneButtonMediaActionType(button?.actionType)) {
      return '';
    }

    return '';
  }

  function renderButtonModeAndGroupRow(button = {}, options = {}) {
    const interactionModes = getChannelButtonInteractionModes();
    const resolvedActionMode = Object.values(interactionModes).includes(button?.actionMode)
      ? button.actionMode
      : interactionModes.trigger;
    const actionGroup = getEditorButtonActionGroup(button?.actionType);
    const layout = options?.layout === 'stacked' ? 'stacked' : 'inline';

    return `
      <div class="entity-edit-button-controls-row entity-edit-button-controls-row--${layout}">
        <div class="entity-edit-button-action-mode-shell">
          ${renderButtonChoiceRail('action-mode', resolvedActionMode, [
            { value: interactionModes.push, label: t('editor.buttonModePush') },
            { value: interactionModes.toggle, label: t('editor.buttonModeToggle') },
            { value: interactionModes.trigger, label: t('editor.buttonModeTrigger') }
          ])}
        </div>
        <div class="entity-edit-button-group-shell">
          ${renderEditorButtonSelect(
            translateOrFallback('editor.buttonActionGroup', 'Action type'),
            actionGroup,
            getEditorButtonActionGroups(),
            'data-editor-button-action-group-select'
          )}
        </div>
      </div>
    `;
  }

  function renderButtonActionCard(button = {}, options = {}) {
    const actionTypes = getStandaloneButtonActionTypes();

    if (String(button?.actionType || '').trim() === actionTypes.none) {
      return '';
    }

    const actionGroup = getEditorButtonActionGroup(button?.actionType);
    const actionOptions = getEditorButtonActionOptions(actionGroup);
    const resolvedActionType = actionOptions.some((option) => String(option.value) === String(button?.actionType || ''))
      ? String(button.actionType)
      : '';

    return `
      <div class="entity-edit-button-side-card entity-edit-button-settings-card entity-edit-button-settings-card--action">
        <div class="entity-edit-button-side-card-header">
          <div class="entity-edit-button-side-card-label">${t('editor.buttonAction')}</div>
        </div>

        <div class="entity-edit-button-side-card-body" data-editor-card-body="action">
          ${renderEditorButtonSelect(
            translateOrFallback('editor.buttonAction', 'Action'),
            resolvedActionType,
            actionOptions,
            'data-editor-button-action-type-select',
            translateOrFallback('editor.buttonActionNone', 'No action')
          )}
          ${renderButtonActionFields(button, options)}
        </div>
      </div>
    `;
  }

  function renderButtonIndicatorBehaviorCard(button = {}, options = {}) {
    const indicatorBehaviors = getChannelButtonIndicatorBehaviors();
    const resolvedIndicatorBehavior = Object.values(indicatorBehaviors).includes(button?.indicatorBehavior)
      ? button.indicatorBehavior
      : indicatorBehaviors.actionState;
    const thresholdBounds = getButtonIndicatorThresholdBounds();
    const indicatorThreshold = clampButtonIndicatorThreshold(button?.indicatorThreshold);

    return `
      <div class="entity-edit-button-side-card entity-edit-button-settings-card entity-edit-button-settings-card--indicator">
        <div class="entity-edit-button-side-card-header">
          <div class="entity-edit-button-side-card-label">${t('editor.buttonIndicator')}</div>
        </div>

        <div class="entity-edit-button-side-card-body" data-editor-card-body="indicator">
          ${renderButtonChoiceRail('indicator-behavior', resolvedIndicatorBehavior, [
            {
              value: indicatorBehaviors.actionState,
              label: translateOrFallback('editor.buttonIndicatorBehaviorActionState', 'Action state')
            },
            {
              value: indicatorBehaviors.peakMeter,
              label: translateOrFallback('editor.buttonIndicatorBehaviorPeakMeter', 'Peak meter')
            },
            {
              value: indicatorBehaviors.targetActivity,
              label: translateOrFallback('editor.buttonIndicatorBehaviorTargetActivity', 'Target activity')
            }
          ], {
            className: 'entity-edit-choice-rail--compact'
          })}
          ${resolvedIndicatorBehavior === indicatorBehaviors.peakMeter
            ? `
              <div class="entity-edit-button-main-subsection">
                <div class="entity-edit-button-side-subsection-label">${escapeHtml(
                  translateOrFallback('editor.buttonIndicatorPeakThreshold', 'Peak threshold (dB)')
                )}</div>
                <div class="settings-range-row entity-edit-button-side-range-row">
                  <input
                    class="settings-range"
                    type="range"
                    min="${thresholdBounds.min}"
                    max="${thresholdBounds.max}"
                    step="1"
                    value="${indicatorThreshold}"
                    data-editor-side-button-indicator-threshold="${button.id}">
                  <div class="settings-range-value" data-editor-side-button-indicator-threshold-label>${formatButtonIndicatorThreshold(indicatorThreshold)}</div>
                </div>
                ${renderButtonIndicatorLiveMeter(button, options)}
              </div>
            `
            : ''}
        </div>
      </div>
    `;
  }

  function renderStandaloneButtonSettingsSummary(button) {
    const midiLabel = window.midiService?.getButtonMappingLabel?.(button?.midiMapping)
      || t('editor.buttonMidiUnbound');

    return `
      <button
        class="entity-edit-target-chip entity-edit-target-chip--button-panel"
        type="button"
        data-editor-open-standalone-button-panel="${button.id}">
        ${typeof window.renderChannelButtonIconMarkup === 'function'
          ? window.renderChannelButtonIconMarkup(button, 'entity-edit-target-icon')
          : `<span class="entity-edit-target-icon">${escapeHtml(button.icon || 'BTN')}</span>`}
        <span class="entity-edit-target-label">${escapeHtml(getEditorButtonActionLabel(button))}</span>
        <span class="entity-edit-target-inline-meta">${escapeHtml(midiLabel)}</span>
        <span class="entity-edit-target-inline-arrow" aria-hidden="true">&gt;</span>
      </button>
    `;
  }

  function renderEditorChannelButtons(channel) {
    const buttons = Array.isArray(channel?.buttons) ? channel.buttons.slice(0, 4) : [];
    const editingButtonId = editorState.editingChannelButtonId;
    const addButtonRowMarkup = buttons.length < 4
      ? `
        <button
          class="entity-edit-target-placeholder entity-edit-channel-button-placeholder entity-edit-channel-button-add-row"
          data-editor-channel-button-add-row
          type="button"
          onclick="handleEditorAddChannelButton(${channel.id})">
          ${t('editor.addChannelButton')}
        </button>
      `
      : '';

    if (!buttons.length) {
      return addButtonRowMarkup;
    }

    return `
      <div class="entity-edit-target-list entity-edit-channel-button-list">
        ${buttons.map((button) => `
          <div
            class="entity-edit-target-chip entity-edit-channel-button-chip"
            data-editor-channel-button-chip="${button.id}"
            data-editor-channel-button-row="${button.id}">
            ${typeof window.renderChannelButtonIconMarkup === 'function'
              ? window.renderChannelButtonIconMarkup(button, 'entity-edit-target-icon')
              : `<span class="entity-edit-target-icon">${escapeHtml(button.icon)}</span>`}
            ${editingButtonId === button.id
              ? `
                <input
                  class="entity-edit-channel-button-title-input"
                  type="text"
                  value="${escapeHtml(editorState.buttonTitleDraft || button.text)}"
                  data-editor-button-title-input="${button.id}">
              `
              : `
                <button
                  class="entity-edit-channel-button-title"
                  type="button"
                  data-editor-open-channel-button-panel="${button.id}">
                  ${escapeHtml(getEditorButtonActionLabel(button))}
                </button>
              `}
            <div class="entity-edit-channel-button-actions">
              <button
                class="entity-edit-channel-button-remove"
                type="button"
                data-editor-remove-channel-button="${button.id}"
                aria-label="${escapeHtml(t('editor.removeChannelButton'))}">
                &times;
              </button>
              <button
                class="entity-edit-channel-button-open-panel"
                type="button"
                data-editor-open-channel-button-panel="${button.id}"
                aria-label="${escapeHtml(t('editor.openButtonPanel'))}">
                &gt;
              </button>
            </div>
          </div>
        `).join('')}
        ${addButtonRowMarkup}
      </div>
    `;
  }

  function renderEditorChannelButtonAction(channel) {
    return '';
  }

  function shouldShowEditorChannelButtonPlacement(channel) {
    const buttons = Array.isArray(channel?.buttons) ? channel.buttons.slice(0, 4) : [];
    return buttons.length >= 1 && buttons.length <= 2;
  }

  function renderEditorChannelButtonPlacementContent(channel) {
    const buttons = Array.isArray(channel?.buttons) ? channel.buttons.slice(0, 4) : [];

    if (!buttons.length) {
      return '';
    }

    const currentPlacement = channel?.buttonPlacement === 'side' ? 'side' : 'bottom';

    return `
      <span class="entity-edit-channel-button-placement-label">${t('editor.buttonPlacement')}</span>
      <div class="entity-edit-channel-button-placement-options">
        <button
          class="entity-edit-channel-button-placement-option ${currentPlacement === 'bottom' ? 'active' : ''}"
          type="button"
          data-editor-button-placement="bottom">
          ${t('editor.buttonPlacementBottom')}
        </button>
        <button
          class="entity-edit-channel-button-placement-option ${currentPlacement === 'side' ? 'active' : ''}"
          type="button"
          data-editor-button-placement="side">
          ${t('editor.buttonPlacementSide')}
        </button>
      </div>
    `;
  }

  function renderEditorChannelButtonPlacement(channel) {
    return `
      <div
        class="entity-edit-channel-button-placement ${shouldShowEditorChannelButtonPlacement(channel) ? 'is-visible' : 'is-hidden'}"
        data-editor-channel-button-placement-wrap>
        ${renderEditorChannelButtonPlacementContent(channel)}
      </div>
    `;
  }

  function renderChannelButtonOptionRow(optionName, activeValue, options = [], variant = '') {
    const rowClassName = variant ? ` entity-edit-button-option-row--${variant}` : '';
    const optionClassName = variant ? ` entity-edit-button-option--${variant}` : '';

    return `
      <div class="entity-edit-button-option-row${rowClassName}">
        ${options.map((option) => `
          <button
            class="entity-edit-button-option${optionClassName} ${String(activeValue) === String(option.value) ? 'active' : ''}"
            type="button"
            data-editor-button-option-name="${escapeHtml(optionName)}"
            data-editor-button-option-value="${escapeHtml(option.value)}">
            ${escapeHtml(option.label)}
          </button>
        `).join('')}
      </div>
    `;
  }

  function renderButtonChoiceRail(optionName, activeValue, options = [], renderOptions = {}) {
    const activeIndex = options.findIndex((option) => String(option.value) === String(activeValue));
    const hasSelection = activeIndex >= 0;
    const extraClassName = String(renderOptions?.className || '').trim();
    const isDisabled = Boolean(renderOptions?.disabled);
    return `
        <div
          class="entity-edit-choice-rail ${hasSelection ? 'has-selection' : ''} ${extraClassName}"
          data-editor-choice="${escapeHtml(optionName)}"
          style="--choice-count: ${Math.max(1, options.length)}; --choice-index: ${Math.max(0, activeIndex)};">
          <span class="entity-edit-choice-rail__highlight" aria-hidden="true"></span>
          ${options.map((option) => `
            <button
            class="entity-edit-choice-rail__option ${String(activeValue) === String(option.value) ? 'is-active' : ''}"
            type="button"
            ${isDisabled ? 'disabled aria-disabled="true" tabindex="-1"' : ''}
            data-editor-button-option-name="${escapeHtml(optionName)}"
            data-editor-button-option-value="${escapeHtml(option.value)}">
            ${escapeHtml(option.label)}
          </button>
        `).join('')}
      </div>
    `;
  }

  function renderButtonChoiceGrid(optionName, activeValue, options = [], renderOptions = {}) {
    const activeIndex = options.findIndex((option) => String(option.value) === String(activeValue));
    const hasSelection = activeIndex >= 0;
    const activeColumn = activeIndex % 2;
    const activeRow = Math.floor(activeIndex / 2);
    return `
        <div
          class="entity-edit-choice-grid ${hasSelection ? 'has-selection' : ''}"
          data-editor-choice="${escapeHtml(optionName)}"
          style="--choice-grid-column: ${Math.max(0, activeColumn)}; --choice-grid-row: ${Math.max(0, activeRow)};">
          <span class="entity-edit-choice-grid__highlight" aria-hidden="true"></span>
          ${options.map((option) => `
            <button
            class="entity-edit-choice-grid__option ${String(activeValue) === String(option.value) ? 'is-active' : ''}"
            type="button"
            data-editor-button-option-name="${escapeHtml(optionName)}"
            data-editor-button-option-value="${escapeHtml(option.value)}">
            ${escapeHtml(option.label)}
          </button>
        `).join('')}
      </div>
    `;
  }

  function getNormalizedCapturedButtonKey(event) {
    const rawKey = String(event?.key || '').trim();

    if (!rawKey) {
      return '';
    }

    if (['Shift', 'Control', 'Alt', 'Meta'].includes(rawKey)) {
      return '';
    }

    if (rawKey === ' ') {
      return 'Space';
    }

    if (rawKey.length === 1) {
      return rawKey.toUpperCase();
    }

    if (rawKey === 'Esc') {
      return 'Escape';
    }

    return rawKey;
  }

  function getButtonKeyLabel(button = {}) {
    const normalizedKey = String(button?.key || '').trim();
    return normalizedKey || t('editor.buttonKeyPlaceholder');
  }

  function renderButtonKeyCapture(button) {
    const isCapturing = Boolean(editorState.sidePanelKeyCaptureActive);

    return `
      <div class="entity-edit-button-key-block">
        <div class="entity-edit-button-side-subsection-label">${t('editor.buttonKey')}</div>
        <button
          class="entity-edit-button-key-capture ${isCapturing ? 'is-capturing' : ''}"
          type="button"
          data-editor-side-button-key-capture>
          ${escapeHtml(isCapturing ? t('buttonModal.keyPlaceholder') : getButtonKeyLabel(button))}
        </button>
      </div>
    `;
  }

  function getChannelButtonIconKeys() {
    return Array.isArray(window.CHANNEL_BUTTON_ICON_KEYS)
      ? window.CHANNEL_BUTTON_ICON_KEYS
      : ['square', 'spark', 'speaker', 'mute', 'layers', 'target', 'flash', 'play', 'pause', 'play-pause', 'skip-previous', 'skip-next', 'stop', 'rewind', 'fast-forward', 'shuffle', 'repeat', 'circle', 'diamond', 'triangle', 'wave', 'bolt', 'ring'];
  }

  function renderChannelButtonIconOptions(button, iconKeys = []) {
    const resolvedIconKeys = Array.isArray(iconKeys) && iconKeys.length
      ? iconKeys
      : getChannelButtonIconKeys();

    return `
      <div class="entity-edit-button-icon-grid">
        ${resolvedIconKeys.map((iconKey) => `
          <button
            class="entity-edit-button-icon-option ${button.icon === iconKey ? 'active' : ''}"
            type="button"
            data-editor-button-icon-option="${escapeHtml(iconKey)}"
            aria-label="${escapeHtml(iconKey)}">
            ${typeof window.renderChannelButtonIconMarkup === 'function'
              ? window.renderChannelButtonIconMarkup({ ...button, icon: iconKey }, 'entity-edit-button-icon-option-shell')
              : `<span class="entity-edit-button-icon-option-shell">${escapeHtml(iconKey)}</span>`}
          </button>
        `).join('')}
      </div>
    `;
  }

  function getChannelIconKeys() {
    return Array.isArray(window.CHANNEL_BUTTON_ICON_KEYS)
      ? window.CHANNEL_BUTTON_ICON_KEYS
      : ['square', 'spark', 'speaker', 'mute', 'layers', 'target', 'flash', 'play', 'pause', 'play-pause', 'skip-previous', 'skip-next', 'stop', 'rewind', 'fast-forward', 'shuffle', 'repeat', 'circle', 'diamond', 'triangle', 'wave', 'bolt', 'ring'];
  }

  function renderChannelIconPicker(channel = {}) {
    const pickerOpen = Boolean(editorState.channelIconPickerOpen);
    const iconKeys = getChannelIconKeys();
    const currentIcon = String(channel?.icon || '').trim();

    return `
      <div class="entity-edit-channel-icon-picker" data-editor-channel-icon-picker>
        <button
          class="entity-edit-channel-icon-trigger ${pickerOpen ? 'is-open' : ''}"
          type="button"
          data-editor-toggle-channel-icon-picker
          aria-expanded="${pickerOpen ? 'true' : 'false'}"
          aria-label="${escapeHtml(t('editor.buttonIcon'))}">
          ${currentIcon && typeof window.renderChannelButtonIconMarkup === 'function'
            ? window.renderChannelButtonIconMarkup({ icon: currentIcon }, 'entity-edit-channel-icon-trigger-shell')
            : '<span class="entity-edit-channel-icon-trigger-shell entity-edit-channel-icon-trigger-shell--empty">A</span>'}
        </button>

        ${pickerOpen
          ? `
            <div class="entity-edit-channel-icon-popover">
              <button
                class="entity-edit-channel-icon-option ${currentIcon ? '' : 'active'}"
                type="button"
                data-editor-channel-icon-option=""
                aria-label="${escapeHtml(t('editor.buttonIcon'))}">
                <span class="entity-edit-channel-icon-option-shell entity-edit-channel-icon-option-shell--empty">A</span>
              </button>
              ${iconKeys.map((iconKey) => `
                <button
                  class="entity-edit-channel-icon-option ${currentIcon === iconKey ? 'active' : ''}"
                  type="button"
                  data-editor-channel-icon-option="${escapeHtml(iconKey)}"
                  aria-label="${escapeHtml(iconKey)}">
                  ${typeof window.renderChannelButtonIconMarkup === 'function'
                    ? window.renderChannelButtonIconMarkup({ icon: iconKey }, 'entity-edit-channel-icon-option-shell')
                    : `<span class="entity-edit-channel-icon-option-shell">${escapeHtml(iconKey)}</span>`}
                </button>
              `).join('')}
            </div>
          `
          : ''}
      </div>
    `;
  }

  function renderChannelButtonIconPicker(button) {
    const iconKeys = getChannelButtonIconKeys();
    const primaryIcons = iconKeys.slice(0, 9);
    const extraIcons = iconKeys.slice(9);
    const pickerOpen = Boolean(editorState.sidePanelIconPickerOpen);
    const pickerExpanded = pickerOpen && Boolean(editorState.sidePanelIconPickerExpanded);

    return `
      <div class="entity-edit-button-icon-picker" data-editor-button-icon-picker>
        <button
          class="entity-edit-button-icon-trigger ${pickerOpen ? 'is-open' : ''}"
          type="button"
          data-editor-toggle-button-icon-picker
          aria-expanded="${pickerOpen ? 'true' : 'false'}"
          aria-label="${escapeHtml(t('editor.buttonIcon'))}">
          ${typeof window.renderChannelButtonIconMarkup === 'function'
            ? window.renderChannelButtonIconMarkup({ ...button, icon: button?.icon || 'square' }, 'entity-edit-button-icon-trigger-shell')
            : `<span class="entity-edit-button-icon-trigger-shell">${escapeHtml(button?.icon || 'square')}</span>`}
        </button>

        ${pickerOpen
          ? `
            <div class="entity-edit-button-icon-popover">
              ${renderChannelButtonIconOptions(button, primaryIcons)}
              ${extraIcons.length
                ? `
                  <button
                    class="entity-edit-button-icon-more"
                    type="button"
                    data-editor-toggle-button-icon-picker-more>
                    ${pickerExpanded ? t('editor.buttonIconLess') : t('editor.buttonIconMore')}
                  </button>
                  <div class="entity-edit-button-icon-extra ${pickerExpanded ? 'is-open' : ''}">
                    ${pickerExpanded ? renderChannelButtonIconOptions(button, extraIcons) : ''}
                  </div>
                `
                : ''}
            </div>
          `
          : ''}
      </div>
    `;
  }

  function renderChannelButtonSidePanel(channel) {
    const button = getEditorButtonEntity(editorState.sidePanelButtonId);
    const resolvedButton = button
      ? {
        ...button,
        text: editorState.sidePanelButtonTitleDirty
          ? editorState.sidePanelButtonTitleDraft
          : button.text
      }
      : null;

    if (!resolvedButton) {
      return `
        <div class="entity-edit-side-panel-inner">
          <div class="entity-edit-side-empty">${t('editor.sidePanelEmpty')}</div>
        </div>
      `;
    }

    return `
      <div class="entity-edit-side-panel-inner">
        <div class="entity-edit-side-header entity-edit-side-header--button">
          <button
            class="entity-edit-side-header-pill"
            type="button"
            data-editor-close-targets
            aria-label="${escapeHtml(t('editor.close'))}">
            <span class="entity-edit-side-header-pill-arrow" aria-hidden="true"></span>
            <span class="entity-edit-type-badge entity-edit-side-type-badge">${t('editor.buttonType')}</span>
          </button>
        </div>

        <div class="entity-edit-button-side-layout">
          <div class="entity-edit-button-side-inline">
            <div class="entity-edit-button-name-row entity-edit-button-name-row--compact">
              ${renderChannelButtonIconPicker(resolvedButton)}
              <button
                class="btn entity-edit-button-midi-bind"
                type="button"
                data-editor-bind-channel-button-midi="${resolvedButton.id}">
                ${t('editor.buttonMidiBind')}
              </button>
            </div>
          </div>

          ${renderButtonModeAndGroupRow(resolvedButton, { layout: 'stacked' })}

          <div class="entity-edit-button-card-stack">
            ${renderButtonActionCard(resolvedButton, { ownerChannelId: channel?.id })}
            ${renderButtonIndicatorBehaviorCard(resolvedButton, { channelId: channel?.id })}
          </div>
        </div>
      </div>
    `;
  }

  function renderTargetModeRail(channel) {
    return renderButtonChoiceRail('target-mode', getChannelTargetMode(channel), [
      { value: window.CHANNEL_TARGET_MODES?.apps || 'apps', label: t('editor.targetModeApps') },
      { value: window.CHANNEL_TARGET_MODES?.devices || 'devices', label: t('editor.targetModeDevices') },
      { value: window.CHANNEL_TARGET_MODES?.focus || 'focus', label: t('editor.targetModeFocus') }
    ]);
  }

  function renderDeviceFlowRail(channel) {
    return renderButtonChoiceRail('device-target-flow', getChannelDeviceTargetFlow(channel), [
      { value: window.CHANNEL_DEVICE_TARGET_FLOWS?.output || 'output', label: t('editor.deviceFlowOutput') },
      { value: window.CHANNEL_DEVICE_TARGET_FLOWS?.input || 'input', label: t('editor.deviceFlowInput') }
    ]);
  }

  function renderTargetPanelApps(channel) {
    const selectedTargets = new Set(getChannelTargets(channel).map((target) => target.process));
    const availableApps = getAvailableApps();

    if (!availableApps.length) {
      return `<div class="entity-edit-side-empty">${t('editor.sidePanelEmpty')}</div>`;
    }

    return availableApps.map((application) => `
      <button
        class="entity-edit-side-option ${application.iconDataUrl ? 'has-icon' : ''} ${selectedTargets.has(application.process) ? 'active' : ''}"
        type="button"
        data-editor-toggle-target="${escapeHtml(application.process)}">
        ${renderAppIconMarkup(application, 'entity-edit-side-option-icon')}
        <span class="entity-edit-side-option-label">${escapeHtml(application.name || application.process)}</span>
      </button>
    `).join('');
  }

  function renderTargetPanelDevices(channel) {
    const targetFlow = getChannelDeviceTargetFlow(channel);
    const selectedTargetIds = new Set(getChannelDeviceTargets(channel, targetFlow).map((target) => target.id));
    const devices = Array.isArray(editorState.audioDeviceOptions[targetFlow])
      ? editorState.audioDeviceOptions[targetFlow]
      : [];
    const isLoading = Boolean(editorState.audioDeviceLoading[targetFlow]);
    const errorMessage = String(editorState.audioDeviceErrors[targetFlow] || '').trim();

    if (errorMessage) {
      return `<div class="entity-edit-side-empty">${escapeHtml(errorMessage)}</div>`;
    }

    if (isLoading && !devices.length) {
      return `<div class="entity-edit-side-empty">${t('editor.loading')}</div>`;
    }

    if (!devices.length) {
      return `<div class="entity-edit-side-empty">${t('editor.noDevicesAvailable')}</div>`;
    }

    return devices.map((device) => `
      <button
        class="entity-edit-side-option ${selectedTargetIds.has(device.id) ? 'active' : ''}"
        type="button"
        data-editor-toggle-device-target="${escapeHtml(device.id)}"
        data-editor-toggle-device-target-flow="${escapeHtml(targetFlow)}">
        <span class="entity-edit-side-option-label">
          ${escapeHtml(device.name || device.id)}
          ${device.isDefault ? ` (${escapeHtml(t('editor.defaultDeviceLabel'))})` : ''}
        </span>
      </button>
    `).join('');
  }

  function renderTargetPanelFocus(channel) {
    const exclusions = new Set(getChannelFocusExclusions(channel).map((target) => target.process));
    const availableApps = getAvailableApps();

    if (!availableApps.length) {
      return `<div class="entity-edit-side-empty">${t('editor.sidePanelEmpty')}</div>`;
    }

    return `
      <div class="entity-edit-side-note">${escapeHtml(t('editor.focusExclusionsHint'))}</div>
      ${availableApps.map((application) => `
        <button
          class="entity-edit-side-option ${application.iconDataUrl ? 'has-icon' : ''} ${exclusions.has(application.process) ? 'active' : ''}"
          type="button"
          data-editor-toggle-focus-exclusion="${escapeHtml(application.process)}">
          ${renderAppIconMarkup(application, 'entity-edit-side-option-icon')}
          <span class="entity-edit-side-option-label">${escapeHtml(application.name || application.process)}</span>
        </button>
      `).join('')}
    `;
  }

  function renderSidePanelOptions(channel) {
    const targetMode = getChannelTargetMode(channel);

    if (targetMode === (window.CHANNEL_TARGET_MODES?.devices || 'devices')) {
      return renderTargetPanelDevices(channel);
    }

    if (targetMode === (window.CHANNEL_TARGET_MODES?.focus || 'focus')) {
      return renderTargetPanelFocus(channel);
    }

    return renderTargetPanelApps(channel);
  }

  function renderCurveModeButtons(selectedType) {
    return ['ease-in', 'ease-out', 'ease-in-out']
      .map((curveType) => `
        <button
          class="curve-mode-button ${curveType === selectedType ? 'active' : ''}"
          type="button"
          data-editor-curve-type="${curveType}"
          title="${escapeHtml(
            t(curveType === 'ease-in'
              ? 'settings.curveEaseIn'
              : curveType === 'ease-out'
                ? 'settings.curveEaseOut'
                : 'settings.curveEaseInOut')
          )}">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="${curveType === 'ease-in'
              ? 'M4 18C8 18 10 18 13 14C15.5 10.5 17 6 20 6'
              : curveType === 'ease-out'
                ? 'M4 18C7 18 8.5 13.5 11 10C14 6 16 6 20 6'
                : 'M4 18C8 18 9 14 12 12C15 10 16 6 20 6'}"></path>
          </svg>
        </button>
      `)
      .join('');
  }

  function buildEditorVolumeCurvePreviewPath(settings = {}) {
    const points = [];

    for (let step = 0; step <= 24; step += 1) {
      const progress = step / 24;
      const x = 20 + progress * 180;
      const y = 120 - (
        ((typeof mapFaderPositionToVolume === 'function'
          ? mapFaderPositionToVolume(progress * 100, settings)
          : progress * 100) / 100) * 100
      );

      points.push(`${step === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
    }

    return points.join(' ');
  }

  function renderEditorCurvePreview(settings = {}) {
    return `
      <div class="volume-curve-preview entity-edit-curve-preview">
        <svg class="volume-curve-graph entity-edit-curve-graph" viewBox="0 0 220 140" aria-hidden="true">
          <path class="volume-curve-axis" d="M20 20 V120 H200"></path>
          <path class="volume-curve-axis volume-curve-axis-soft" d="M20 70 H200"></path>
          <path class="volume-curve-axis volume-curve-axis-soft" d="M110 20 V120"></path>
          <path class="volume-curve-path" d="${buildEditorVolumeCurvePreviewPath(settings)}"></path>
        </svg>
      </div>
    `;
  }

  function renderFaderCustomSettings(channel) {
    const customSettings = getEditorCustomSettings(channel);
    const customSettingsEnabled = Boolean(channel?.customSettingsEnabled);

    return `
      <div class="entity-edit-custom-state ${customSettingsEnabled ? 'is-open' : ''}">
        <div class="entity-edit-global-hint ${customSettingsEnabled ? 'is-hidden' : ''}">
          ${t('editor.globalSettingsHint')}
        </div>

        <div
          class="entity-edit-custom-expandable ${customSettingsEnabled ? 'open' : ''}"
          aria-hidden="${customSettingsEnabled ? 'false' : 'true'}">
          <div class="entity-edit-custom-settings">
            <div class="settings-item">
              <span>${t('settings.faderInterpolation')}</span>
              ${renderEditorToggle(
                customSettings.faderInterpolationEnabled,
                'data-editor-setting-toggle="faderInterpolationEnabled"'
              )}
            </div>

            <div class="settings-group">
              <div class="settings-item">
                <span>${t('settings.softTakeover')}</span>
                ${renderEditorToggle(
                  customSettings.softTakeoverEnabled,
                  'data-editor-setting-toggle="softTakeoverEnabled"'
                )}
              </div>

              <div class="settings-expandable ${customSettings.softTakeoverEnabled ? 'open' : ''}">
                <div class="settings-item settings-item-stack settings-item-nested">
                  <div class="settings-label-group">
                    <span>${t('settings.softTakeoverThreshold')}</span>
                  </div>
                  <div class="settings-range-row">
                    <input
                      class="settings-range"
                      type="range"
                      min="0"
                      max="15"
                      step="1"
                      value="${customSettings.softTakeoverThreshold}"
                      data-editor-setting-range="softTakeoverThreshold">
                    <div class="settings-range-value">${customSettings.softTakeoverThreshold}%</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="settings-group">
              <div class="settings-item">
                <span>${t('settings.volumeCurve')}</span>
                ${renderEditorToggle(
                  customSettings.volumeCurveEnabled,
                  'data-editor-setting-toggle="volumeCurveEnabled"'
                )}
              </div>

              <div class="settings-expandable ${customSettings.volumeCurveEnabled ? 'open' : ''}">
                <div class="entity-edit-curve-controls">
                  ${renderEditorCurvePreview(customSettings)}

                  <div class="curve-mode-group entity-edit-curve-mode-group">
                    ${renderCurveModeButtons(customSettings.volumeCurveType)}
                  </div>

                  <div class="settings-range-row entity-edit-curve-range-row">
                    <input
                      class="settings-range"
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value="${customSettings.volumeCurveAmount}"
                      data-editor-setting-range="volumeCurveAmount">
                    <div class="settings-range-value">${customSettings.volumeCurveAmount}%</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="settings-item">
              <span>${t('editor.localFractionalNumbers')}</span>
              ${renderEditorToggle(
                customSettings.showFractionalNumbers,
                'data-editor-setting-toggle="showFractionalNumbers"'
              )}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderFaderEditor(channel) {
    const title = editorState.titleDraft || channel?.title || channel?.appName || t('channels.unnamed');

    return `
      <div class="entity-edit-main-layout" data-entity-type="fader">
        <div class="entity-edit-header-row">
          <div class="entity-edit-type-badge">${t('editor.faderType')}</div>
          <button
            class="entity-edit-close"
            type="button"
            data-modal-close
            aria-label="${escapeHtml(t('editor.close'))}">
            &times;
          </button>
        </div>

        <div class="entity-edit-title-row">
          ${renderChannelIconPicker(channel)}
          <input
            class="entity-edit-title-input"
            id="entityEditTitleInput"
            type="text"
            value="${escapeHtml(title)}"
            placeholder="${escapeHtml(t('editor.titlePlaceholder'))}">

          <button class="btn entity-edit-remap-button" type="button" data-editor-remap>
            ${t('editor.remap')}
          </button>
        </div>

        <section class="entity-edit-section">
          <div class="entity-edit-section-header">
            <span>${t('editor.channelButtons')}</span>
            ${renderEditorChannelButtonAction(channel)}
          </div>
          <div data-editor-channel-buttons-body>${renderEditorChannelButtons(channel)}</div>
          ${renderEditorChannelButtonPlacement(channel)}
        </section>

        <section class="entity-edit-section">
          <div class="entity-edit-section-header">
            <span>${t('editor.targets')}</span>
            <button class="entity-edit-add-action" type="button" data-editor-open-targets>+</button>
          </div>
          <div data-editor-targets-body>${renderEditorTargets(channel)}</div>
        </section>

        <section class="entity-edit-section">
          <div class="entity-edit-section-header">
            <span>${t('editor.customSettings')}</span>
            ${renderEditorToggle(
              Boolean(channel?.customSettingsEnabled),
              'data-editor-toggle-custom-settings'
            )}
          </div>
          ${renderFaderCustomSettings(channel)}
        </section>
      </div>
    `;
  }

  function renderButtonEditor() {
    const button = getEditorStandaloneButton(editorState.buttonId);

    if (!button) {
      return `
        <div class="entity-edit-main-layout" data-entity-type="button">
          <div class="entity-edit-header-row">
            <div class="entity-edit-type-badge">${t('editor.buttonType')}</div>
            <button
              class="entity-edit-close"
              type="button"
              data-modal-close
              aria-label="${escapeHtml(t('editor.close'))}">
              &times;
            </button>
          </div>
        </div>
      `;
    }

    return `
      <div class="entity-edit-main-layout" data-entity-type="button">
        <div class="entity-edit-header-row">
          <div class="entity-edit-type-badge">${t('editor.buttonType')}</div>
          <button
            class="entity-edit-close"
            type="button"
            data-modal-close
            aria-label="${escapeHtml(t('editor.close'))}">
            &times;
          </button>
        </div>

        <section class="entity-edit-section entity-edit-button-main-toolbar-section">
          <div class="entity-edit-button-main-toolbar">
            ${renderChannelButtonIconPicker(button)}
            <div class="entity-edit-button-main-bind-stack">
              <button
                class="btn entity-edit-button-midi-bind entity-edit-button-midi-bind--main"
                type="button"
                data-editor-bind-channel-button-midi="${button.id}">
                ${t('editor.buttonMidiBind')}
              </button>
            </div>
          </div>
        </section>

        ${renderButtonModeAndGroupRow(button, { layout: 'inline' })}

        <div class="entity-edit-button-main-stack">
          ${renderButtonActionCard(button)}
          ${renderButtonIndicatorBehaviorCard(button)}
        </div>
      </div>
    `;
  }

  function enhanceEntityEditorCustomSelects(root = null) {
    if (!root) {
      return;
    }

    const enhance = typeof enhanceCustomSelects === 'function'
      ? enhanceCustomSelects
      : window.enhanceCustomSelects;

    if (typeof enhance === 'function') {
      enhance(root);
    }
  }

  function captureSidePanelMotionSnapshot() {
    if (!dom.sidePanel) {
      return null;
    }

    const choiceRects = new Map();
    const bodyRects = new Map();

    dom.sidePanel.querySelectorAll('[data-editor-choice]').forEach((element) => {
      const key = String(element.dataset.editorChoice || '').trim();
      const selected = element.querySelector('.entity-edit-choice-rail__option.is-active, .entity-edit-choice-grid__option.is-active');
      const highlight = element.querySelector('.entity-edit-choice-rail__highlight, .entity-edit-choice-grid__highlight');

      if (!key || (!selected && !highlight)) {
        return;
      }

      choiceRects.set(
        key,
        (highlight?.getBoundingClientRect?.() || selected?.getBoundingClientRect?.() || null)
      );
    });

    dom.sidePanel.querySelectorAll('[data-editor-card-body]').forEach((element) => {
      const key = String(element.dataset.editorCardBody || '').trim();

      if (!key) {
        return;
      }

      bodyRects.set(key, {
        height: element.getBoundingClientRect().height,
        isDisabled: Boolean(element.closest('.entity-edit-button-settings-card.is-disabled'))
      });
    });

    return { choiceRects, bodyRects };
  }

  function animateSidePanelChoiceGhost(previousRect, nextRect, choiceRoot = null) {
    const highlight = choiceRoot?.querySelector('.entity-edit-choice-rail__highlight, .entity-edit-choice-grid__highlight');

    if (!previousRect || !nextRect || !highlight) {
      return;
    }

    if (
      Math.abs(previousRect.left - nextRect.left) < 0.5
      && Math.abs(previousRect.top - nextRect.top) < 0.5
      && Math.abs(previousRect.width - nextRect.width) < 0.5
      && Math.abs(previousRect.height - nextRect.height) < 0.5
    ) {
      return;
    }

    if (choiceRoot._choiceAnimationTimerId) {
      window.clearTimeout(choiceRoot._choiceAnimationTimerId);
      choiceRoot._choiceAnimationTimerId = null;
    }
    choiceRoot.querySelector('.entity-edit-choice-ghost')?.remove();

    const rootRect = choiceRoot.getBoundingClientRect();
    const computedHighlight = window.getComputedStyle(highlight);
    const ghost = document.createElement('span');
    ghost.className = 'entity-edit-choice-ghost';
    ghost.style.left = `${previousRect.left - rootRect.left}px`;
    ghost.style.top = `${previousRect.top - rootRect.top}px`;
    ghost.style.width = `${previousRect.width}px`;
    ghost.style.height = `${previousRect.height}px`;
    ghost.style.borderRadius = computedHighlight.borderRadius;
    ghost.style.border = computedHighlight.border;
    ghost.style.background = computedHighlight.background;
    ghost.style.boxShadow = computedHighlight.boxShadow;
    ghost.style.opacity = computedHighlight.opacity || '1';

    choiceRoot.appendChild(ghost);
    choiceRoot.classList.add('is-animating-selection');
    choiceRoot.classList.add('is-ghosting');
    ghost.getBoundingClientRect();

    ghost.style.transition = [
      'left 320ms cubic-bezier(0.16, 1, 0.3, 1)',
      'top 320ms cubic-bezier(0.16, 1, 0.3, 1)',
      'width 320ms cubic-bezier(0.16, 1, 0.3, 1)',
      'height 320ms cubic-bezier(0.16, 1, 0.3, 1)',
      'opacity 180ms ease'
    ].join(', ');

    requestAnimationFrame(() => {
      ghost.style.left = `${nextRect.left - rootRect.left}px`;
      ghost.style.top = `${nextRect.top - rootRect.top}px`;
      ghost.style.width = `${nextRect.width}px`;
      ghost.style.height = `${nextRect.height}px`;
    });

    choiceRoot._choiceAnimationTimerId = window.setTimeout(() => {
      choiceRoot.classList.remove('is-ghosting');
      ghost.remove();
      choiceRoot.classList.remove('is-animating-selection');
      choiceRoot._choiceAnimationTimerId = null;
    }, 330);
  }

  function animateSidePanelBodyTransition(element, previousState) {
    if (!element) {
      return;
    }

    const nextDisabled = Boolean(element.closest('.entity-edit-button-settings-card.is-disabled'));
    const nextHeight = nextDisabled ? 0 : element.scrollHeight;
    const previousHeight = previousState ? previousState.height : (nextDisabled ? 0 : nextHeight);
    const previousDisabled = previousState ? previousState.isDisabled : nextDisabled;

    if (previousDisabled === nextDisabled) {
      return;
    }

    if (Math.abs(previousHeight - nextHeight) < 1) {
      return;
    }

    element.style.overflow = 'hidden';
    element.style.height = `${Math.max(0, previousHeight)}px`;
    element.style.maxHeight = 'none';
    element.style.opacity = previousDisabled ? '0' : '1';
    element.style.transform = previousDisabled ? 'translateY(-8px)' : 'translateY(0)';
    element.getBoundingClientRect();

    element.style.transition = [
      'height 320ms cubic-bezier(0.16, 1, 0.3, 1)',
      'opacity 220ms ease',
      'transform 260ms cubic-bezier(0.22, 0.78, 0.2, 1)'
    ].join(', ');

    requestAnimationFrame(() => {
      element.style.height = `${Math.max(0, nextHeight)}px`;
      element.style.opacity = nextDisabled ? '0' : '1';
      element.style.transform = nextDisabled ? 'translateY(-8px)' : 'translateY(0)';
    });

    window.setTimeout(() => {
      element.style.transition = '';
      element.style.height = '';
      element.style.maxHeight = '';
      element.style.overflow = '';
      element.style.opacity = '';
      element.style.transform = '';
    }, 340);
  }

  function applySidePanelMotionSnapshot(snapshot, options = {}) {
    if (!snapshot || !dom.sidePanel) {
      return;
    }

    const allowedChoiceKeys = Array.isArray(options?.choiceKeys)
      ? new Set(options.choiceKeys.map((key) => String(key || '').trim()).filter(Boolean))
      : null;

    dom.sidePanel.querySelectorAll('[data-editor-choice]').forEach((element) => {
      const key = String(element.dataset.editorChoice || '').trim();
      const nextHighlight = element.querySelector('.entity-edit-choice-rail__highlight, .entity-edit-choice-grid__highlight');
      const previousRect = snapshot.choiceRects?.get(key);

      if (allowedChoiceKeys && !allowedChoiceKeys.has(key)) {
        return;
      }

      if (!nextHighlight || !previousRect) {
        return;
      }

      animateSidePanelChoiceGhost(previousRect, nextHighlight.getBoundingClientRect(), element);
    });

    dom.sidePanel.querySelectorAll('[data-editor-card-body]').forEach((element) => {
      const key = String(element.dataset.editorCardBody || '').trim();
      animateSidePanelBodyTransition(element, snapshot.bodyRects?.get(key));
    });
  }

  function renderSidePanel(channel) {
    if (!dom.sidePanel) {
      return;
    }

    if (editorState.entityType === 'button' && !editorState.sidePanelOpen && !editorState.sidePanelClosing) {
      dom.shell?.classList.remove('entity-edit-side-open');
      dom.shell?.classList.remove('entity-edit-side-closing');
      dom.sidePanel.classList.remove('is-open');
      dom.sidePanel.classList.remove('is-closing');
      dom.sidePanel.innerHTML = '';
      dom.sideOptions = null;
      return;
    }

    const resolvedTargetEntity = channel || getEditorTargetEntity();
    const motionSnapshot = captureSidePanelMotionSnapshot();
    const motionChoiceKeys = Array.isArray(editorState.sidePanelMotionChoices)
      ? editorState.sidePanelMotionChoices.slice()
      : [];
    const previousButtonPanelScrollTop = editorState.sidePanelMode === 'channel-button'
      ? (dom.sidePanel.querySelector('.entity-edit-button-side-layout')?.scrollTop || 0)
      : 0;

    dom.shell?.classList.toggle('entity-edit-side-open', editorState.sidePanelOpen);
    dom.shell?.classList.toggle('entity-edit-side-closing', editorState.sidePanelClosing);
    dom.sidePanel.classList.toggle('is-open', editorState.sidePanelOpen);
    dom.sidePanel.classList.toggle('is-closing', editorState.sidePanelClosing);

      if (!isTargetsSidePanelMode()) {
        dom.sidePanel.innerHTML = renderChannelButtonSidePanel(resolvedTargetEntity);
      enhanceEntityEditorCustomSelects(dom.sidePanel);
      applySidePanelMotionSnapshot(motionSnapshot, { choiceKeys: motionChoiceKeys });
      editorState.sidePanelMotionChoices = null;
      dom.sideOptions = null;
      dom.sidePanel.querySelectorAll('.settings-range').forEach((element) => {
        updateSettingsRangeFill?.(element);
      });
      scheduleEntityEditorLivePeakMeterUpdate();
      const nextLayout = dom.sidePanel.querySelector('.entity-edit-button-side-layout');

      if (nextLayout) {
        nextLayout.scrollTop = previousButtonPanelScrollTop;
        requestAnimationFrame(() => {
          nextLayout.scrollTop = previousButtonPanelScrollTop;
        });
      }
      return;
    }

    editorState.sidePanelMotionChoices = null;

    dom.sidePanel.innerHTML = `
      <div class="entity-edit-side-panel-inner">
          <div class="entity-edit-side-header">
            <button
              class="entity-edit-side-header-pill"
              type="button"
              data-editor-close-targets
              aria-label="${escapeHtml(t('editor.close'))}">
              <span class="entity-edit-side-header-pill-arrow" aria-hidden="true"></span>
              <span class="entity-edit-type-badge entity-edit-side-type-badge">${t('editor.sidePanelTitle')}</span>
            </button>
          </div>

          ${editorState.entityType === 'fader'
            ? `
              <div class="entity-edit-side-target-controls">
                ${renderTargetModeRail(resolvedTargetEntity)}
                ${getChannelTargetMode(resolvedTargetEntity) === (window.CHANNEL_TARGET_MODES?.devices || 'devices')
                  ? renderDeviceFlowRail(resolvedTargetEntity)
                  : ''}
              </div>
            `
            : ''}

          <div class="entity-edit-side-options-shell">
            <div class="entity-edit-side-options" id="entityEditSideOptions">
              ${renderSidePanelOptions(resolvedTargetEntity)}
            </div>
          </div>
        </div>
      `;

    enhanceEntityEditorCustomSelects(dom.sidePanel);
    dom.sideOptions = $('entityEditSideOptions');
  }

  function syncEditorTargetsBody(channel = getEditorTargetEntity()) {
    const targetsBody = dom.main?.querySelector('[data-editor-targets-body]');

    if (!targetsBody) {
      return;
    }

    targetsBody.innerHTML = editorState.entityType === 'button'
      ? renderStandaloneEditorTargets(channel)
      : renderEditorTargets(channel);
  }

  function getEditorChannelButtonsTransitionKey(element) {
    if (!element) {
      return '';
    }

    if (element.hasAttribute('data-editor-channel-button-add-row')) {
      return 'add-row';
    }

    const buttonRowId = String(element.dataset.editorChannelButtonRow || '').trim();
    return buttonRowId ? `button:${buttonRowId}` : '';
  }

  function captureEditorChannelButtonsSnapshot() {
    const buttonsBody = dom.main?.querySelector('[data-editor-channel-buttons-body]');

    if (!buttonsBody) {
      return null;
    }

    const bodyRect = buttonsBody.getBoundingClientRect();
    const items = new Map();

    buttonsBody
      .querySelectorAll('[data-editor-channel-button-row], [data-editor-channel-button-add-row]')
      .forEach((element) => {
        const key = getEditorChannelButtonsTransitionKey(element);

        if (!key) {
          return;
        }

        const rect = element.getBoundingClientRect();
        items.set(key, {
          left: rect.left - bodyRect.left,
          top: rect.top - bodyRect.top,
          width: rect.width,
          height: rect.height,
          html: element.outerHTML
        });
      });

    return {
      body: buttonsBody,
      bodyRect,
      items
    };
  }

  function playEditorChannelButtonsTransition(snapshot) {
    const buttonsBody = dom.main?.querySelector('[data-editor-channel-buttons-body]');

    if (!snapshot || !buttonsBody) {
      return;
    }

    const nextBodyRect = buttonsBody.getBoundingClientRect();
    const nextItems = new Map();

    buttonsBody
      .querySelectorAll('[data-editor-channel-button-row], [data-editor-channel-button-add-row]')
      .forEach((element) => {
        const key = getEditorChannelButtonsTransitionKey(element);

        if (!key) {
          return;
        }

        nextItems.set(key, element);
      });

    nextItems.forEach((element, key) => {
      const nextRect = element.getBoundingClientRect();
      const previousRect = snapshot.items.get(key);

      if (previousRect) {
        const deltaX = previousRect.left - (nextRect.left - nextBodyRect.left);
        const deltaY = previousRect.top - (nextRect.top - nextBodyRect.top);

        if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
          element.animate([
            { transform: `translate(${deltaX}px, ${deltaY}px)` },
            { transform: 'translate(0, 0)' }
          ], {
            duration: 260,
            easing: 'cubic-bezier(0.22, 0.78, 0.2, 1)',
            fill: 'both'
          });
        }

        return;
      }
    });

    snapshot.items.forEach((previousRect, key) => {
      if (nextItems.has(key) || key === 'add-row') {
        return;
      }

      const ghost = document.createElement('div');
      ghost.className = 'entity-edit-channel-button-ghost';
      ghost.style.left = `${previousRect.left}px`;
      ghost.style.top = `${previousRect.top}px`;
      ghost.style.width = `${previousRect.width}px`;
      ghost.style.height = `${previousRect.height}px`;
      ghost.innerHTML = previousRect.html;
      buttonsBody.appendChild(ghost);

      const ghostAnimation = ghost.animate([
        { opacity: 1, transform: 'translateY(0) scale(1)' },
        { opacity: 0, transform: 'translateY(-16px) scale(0.96)' }
      ], {
        duration: 220,
        easing: 'ease',
        fill: 'both'
      });

      ghostAnimation.onfinish = () => {
        ghost.remove();
      };
    });
  }

  function syncEditorChannelButtonsUi(channel = getEditorChannel()) {
    const snapshot = captureEditorChannelButtonsSnapshot();
    const buttonsBody = dom.main?.querySelector('[data-editor-channel-buttons-body]');
    const placementWrap = dom.main?.querySelector('[data-editor-channel-button-placement-wrap]');

    if (buttonsBody) {
      buttonsBody.innerHTML = renderEditorChannelButtons(channel);
    }

    if (placementWrap) {
      placementWrap.classList.toggle('is-visible', shouldShowEditorChannelButtonPlacement(channel));
      placementWrap.classList.toggle('is-hidden', !shouldShowEditorChannelButtonPlacement(channel));
      placementWrap.innerHTML = renderEditorChannelButtonPlacementContent(channel);
    }

    playEditorChannelButtonsTransition(snapshot);

    if (editorState.latestAddedChannelButtonId) {
      animateEditorChannelButtonChip(editorState.latestAddedChannelButtonId);
      editorState.latestAddedChannelButtonId = null;
    }
  }

  function syncSidePanelSelectionState(channel = getEditorTargetEntity()) {
    if (!dom.sideOptions || !isTargetsSidePanelMode()) {
      return;
    }

    const targetMode = getChannelTargetMode(channel);

    if (targetMode === (window.CHANNEL_TARGET_MODES?.devices || 'devices')) {
      const selectedTargetIds = new Set(getChannelDeviceTargets(channel, getChannelDeviceTargetFlow(channel)).map((target) => target.id));
      dom.sideOptions.querySelectorAll('[data-editor-toggle-device-target]').forEach((option) => {
        option.classList.toggle('active', selectedTargetIds.has(option.dataset.editorToggleDeviceTarget));
      });
      return;
    }

    if (targetMode === (window.CHANNEL_TARGET_MODES?.focus || 'focus')) {
      const selectedExclusions = new Set(getChannelFocusExclusions(channel).map((target) => target.process));
      dom.sideOptions.querySelectorAll('[data-editor-toggle-focus-exclusion]').forEach((option) => {
        option.classList.toggle('active', selectedExclusions.has(option.dataset.editorToggleFocusExclusion));
      });
      return;
    }

    const selectedTargets = new Set(getChannelTargets(channel).map((target) => target.process));
    dom.sideOptions.querySelectorAll('[data-editor-toggle-target]').forEach((option) => {
      option.classList.toggle('active', selectedTargets.has(option.dataset.editorToggleTarget));
    });
  }

  function syncSidePanelOptions(channel = getEditorTargetEntity(), { preserveScroll = true } = {}) {
    if (!dom.sideOptions || !isTargetsSidePanelMode()) {
      return;
    }

    const previousScrollTop = preserveScroll ? dom.sideOptions.scrollTop : 0;
    dom.sideOptions.innerHTML = renderSidePanelOptions(channel);

    if (preserveScroll) {
      dom.sideOptions.scrollTop = previousScrollTop;
    }
  }

  function syncTargetSelectionUi(channel = getEditorTargetEntity()) {
    if (!channel) {
      return;
    }

    syncEditorTargetsBody(channel);
    if (isTargetsSidePanelMode()) {
      syncSidePanelSelectionState(channel);
    }
    if (editorState.entityType === 'button') {
      syncPreviewFromButton(getEditorStandaloneButton(editorState.buttonId));
    } else {
      renderPreviewContent();
    }
  }

  function animateEditorTargetChip(processName = '') {
    const normalizedProcess = String(processName || '').trim();

    if (!normalizedProcess) {
      return;
    }

    requestAnimationFrame(() => {
      const chip = dom.main?.querySelector(
        `[data-editor-target-chip="${escapeSelectorValue(normalizedProcess)}"]`
      );

      if (!chip) {
        return;
      }

      chip.classList.remove('is-entering');
      void chip.offsetWidth;
      chip.classList.add('is-entering');
      chip.addEventListener('animationend', () => {
        chip.classList.remove('is-entering');
      }, { once: true });
    });
  }

  function animateEditorChannelButtonChip(buttonId = '') {
    const normalizedButtonId = String(buttonId || '').trim();

    if (!normalizedButtonId) {
      return;
    }

    requestAnimationFrame(() => {
      const chip = dom.main?.querySelector(
        `[data-editor-channel-button-chip="${escapeSelectorValue(normalizedButtonId)}"]`
      );

      if (!chip) {
        return;
      }

      chip.classList.remove('is-entering');
      void chip.offsetWidth;
      chip.classList.add('is-entering');
      chip.addEventListener('animationend', () => {
        chip.classList.remove('is-entering');
      }, { once: true });
    });
  }

  function animateEditorListItemExit(element, onComplete) {
    if (!element) {
      onComplete?.();
      return;
    }

    const handleAnimationEnd = () => {
      element.removeEventListener('animationend', handleAnimationEnd);
      onComplete?.();
    };

    element.addEventListener('animationend', handleAnimationEnd);
    element.classList.remove('is-entering');
    void element.offsetWidth;
    element.classList.add('is-exiting');
  }

  function handleEditorAddChannelButton(channelId) {
    editorState.previewLayoutTransitionRequested = true;
    const button = typeof addChannelButton === 'function'
      ? addChannelButton(channelId)
      : null;

    if (!button) {
      return null;
    }

    editorState.latestAddedChannelButtonId = String(button.id);
    return button;
  }

  function syncPreviewDraftButtonTitle(buttonId, nextTitle) {
    const buttonLabel = dom.previewMount?.querySelector(
      `[data-preview-button-id="${escapeSelectorValue(buttonId)}"] .button-label`
    );

    if (!buttonLabel) {
      return;
    }

    buttonLabel.textContent = nextTitle;
  }

  function focusChannelButtonTitleInput(buttonId, selectionStart = null, selectionEnd = null) {
    const nextInput = dom.main?.querySelector(
      `[data-editor-button-title-input="${escapeSelectorValue(buttonId)}"]`
    );

    if (!nextInput) {
      return;
    }

    nextInput.focus({ preventScroll: true });

    if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
      nextInput.setSelectionRange(selectionStart, selectionEnd);
      return;
    }

    nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
  }

  function startChannelButtonTitleEdit(buttonId) {
    const button = getEditorChannelButton(buttonId);

    if (!button) {
      return;
    }

    editorState.editingChannelButtonId = buttonId;
    editorState.buttonTitleDraft = button.text || '';
    renderEntityEditor();
    requestAnimationFrame(() => {
      focusChannelButtonTitleInput(buttonId);
    });
  }

  function cancelChannelButtonTitleEdit() {
    const channel = getEditorChannel();
    const button = getEditorChannelButton(editorState.editingChannelButtonId, channel);

    editorState.buttonTitleDraft = '';
    editorState.editingChannelButtonId = null;
    renderEntityEditor();

    if (button) {
      syncPreviewFromChannel(channel);
    }
  }

  function commitChannelButtonTitleEdit() {
    if (!editorState.editingChannelButtonId) {
      return;
    }

    const buttonId = editorState.editingChannelButtonId;
    const channel = getEditorChannel();
    const button = getEditorChannelButton(buttonId, channel);

    if (!channel || !button) {
      editorState.buttonTitleDraft = '';
      editorState.editingChannelButtonId = null;
      return;
    }

    const nextTitle = String(editorState.buttonTitleDraft || '').trim() || button.text || t('buttons.defaultLabel');
    editorState.buttonTitleDraft = '';
    editorState.editingChannelButtonId = null;

    if (nextTitle === button.text) {
      renderEntityEditor();
      return;
    }

    window.channelActions?.updateChannelButton?.(channel.id, buttonId, {
      text: nextTitle
    }, {
      source: 'entity-editor'
    });
  }

  function syncEditorRangeFills() {
    dom.main?.querySelectorAll('.settings-range').forEach((element) => {
      updateSettingsRangeFill?.(element);
    });
  }

  function renderEntityEditor() {
    if (!dom.main) {
      return;
    }

    const previousMainScrollTop = dom.main.scrollTop || 0;

    if (editorState.entityType === 'fader') {
      const channel = getEditorChannel();
      const previewLayoutSnapshot = editorState.previewLayoutTransitionRequested
        ? capturePreviewLayoutTransition()
        : null;

      if (!channel) {
        dom.main.innerHTML = '';
        renderSidePanel(null);
        return;
      }

      dom.main.innerHTML = renderFaderEditor(channel);
      enhanceEntityEditorCustomSelects(dom.main);
      renderSidePanel(channel);
      syncEditorRangeFills();
      scheduleEntityEditorLivePeakMeterUpdate();
      dom.main.scrollTop = previousMainScrollTop;
      requestAnimationFrame(() => {
        dom.main.scrollTop = previousMainScrollTop;
      });
      renderPreviewContent();
      dom.previewFrame?.classList.add('is-ready');
      setSourcePreviewState(editorState.sourceHidden);

      if (editorState.latestAddedChannelButtonId) {
        animateEditorChannelButtonChip(editorState.latestAddedChannelButtonId);
        editorState.latestAddedChannelButtonId = null;
      }

      if (previewLayoutSnapshot) {
        playPreviewLayoutTransition(previewLayoutSnapshot);
        editorState.previewLayoutTransitionRequested = false;
      }
      return;
      }

      dom.main.innerHTML = renderButtonEditor();
      enhanceEntityEditorCustomSelects(dom.main);
      renderSidePanel(getEditorTargetEntity());
      syncEditorRangeFills();
      scheduleEntityEditorLivePeakMeterUpdate();
      dom.main.scrollTop = previousMainScrollTop;
      requestAnimationFrame(() => {
        dom.main.scrollTop = previousMainScrollTop;
      });
      renderPreviewContent();
      dom.previewFrame?.classList.add('is-ready');
      setSourcePreviewState(editorState.sourceHidden);
  }

  function commitEditorTitle() {
    if (!editorState.titleDirty) {
      return;
    }

    if (editorState.entityType === 'button') {
      const button = getEditorStandaloneButton(editorState.buttonId);

      if (!button) {
        return;
      }

      const nextTitle = editorState.titleDraft.trim() || button.text || t('buttons.defaultLabel');
      window.standaloneButtonActions?.updateStandaloneButton?.(editorState.buttonId, {
        text: nextTitle
      }, {
        type: 'standalone-buttons/update',
        source: 'entity-editor'
      });
      editorState.titleDraft = nextTitle;
      editorState.titleDirty = false;
      syncPreviewFromButton(getEditorStandaloneButton(editorState.buttonId));
      return;
    }

    const channel = getEditorChannel();

    if (!channel) {
      return;
    }

    const nextTitle = editorState.titleDraft.trim() || channel.appName || t('channels.unnamed');
    renameChannelState?.(channel.id, nextTitle, channel.appName || t('channels.unnamed'), {
      source: 'entity-editor'
    });
    editorState.titleDraft = nextTitle;
    editorState.titleDirty = false;
    saveProfileToLocal?.();
    syncPreviewFromChannel(getEditorChannel());
  }

  function updateChannelCustomSetting(settingKey, settingValue) {
    if (editorState.entityType !== 'fader') {
      return;
    }

    updateChannelCustomSettingsState?.(editorState.channelId, {
      [settingKey]: settingValue
    }, {
      source: 'entity-editor'
    });
    saveProfileToLocal?.();
  }

  function openTargetsPanel() {
    clearSidePanelCloseTimer();
    editorState.sidePanelClosing = false;
    editorState.sidePanelMode = 'targets';
    editorState.sidePanelButtonId = null;
    editorState.sidePanelIconPickerOpen = false;
    editorState.sidePanelIconPickerExpanded = false;
    editorState.sidePanelKeyCaptureActive = false;
    editorState.sidePanelOpen = true;
    renderSidePanel(getEditorTargetEntity());

    if (editorState.entityType === 'fader') {
      const channel = getEditorChannel();
      const targetMode = getChannelTargetMode(channel);

      if (targetMode === (window.CHANNEL_TARGET_MODES?.devices || 'devices')) {
        void ensureEditorAudioDevicesLoaded(getChannelDeviceTargetFlow(channel));
        return;
      }

      if (targetMode === (window.CHANNEL_TARGET_MODES?.focus || 'focus')) {
        requestTargetsPanelApplicationsRefresh({ force: true });
        return;
      }
    }

    requestTargetsPanelApplicationsRefresh({ force: true });
  }

  function openChannelButtonPanel(buttonId) {
    const button = getEditorButtonEntity(buttonId);

    clearSidePanelCloseTimer();
    editorState.sidePanelClosing = false;
    editorState.sidePanelMode = 'channel-button';
    editorState.sidePanelButtonId = buttonId;
    editorState.sidePanelIconPickerOpen = false;
    editorState.sidePanelIconPickerExpanded = false;
    editorState.sidePanelKeyCaptureActive = false;
    resetSidePanelButtonDraft(button);
    editorState.sidePanelOpen = true;
    renderSidePanel(getEditorTargetEntity());
  }

  function closeTargetsPanel() {
    clearSidePanelCloseTimer();

    if (!isTargetsPanelVisible()) {
      return;
    }

    editorState.sidePanelClosing = true;
    renderSidePanel(getEditorTargetEntity());

    editorState.sidePanelCloseTimerId = window.setTimeout(() => {
      editorState.sidePanelCloseTimerId = null;
      editorState.sidePanelOpen = false;
      editorState.sidePanelClosing = false;
      editorState.sidePanelMode = 'targets';
      editorState.sidePanelButtonId = null;
      editorState.sidePanelIconPickerOpen = false;
      editorState.sidePanelIconPickerExpanded = false;
      editorState.sidePanelKeyCaptureActive = false;
      resetSidePanelButtonDraft(null);
      renderSidePanel(getEditorTargetEntity());
    }, ENTITY_EDITOR_SIDE_PANEL_CLOSE_MS);
  }

  function resolveDefaultStandaloneLinkedChannelId(button = {}) {
    return resolveDefaultButtonLinkedChannelId(button, null);
  }

  function buildSynchronizedButtonModePatch(nextMode) {
    const interactionModes = getChannelButtonInteractionModes();
    const resolvedMode = Object.values(interactionModes).includes(nextMode)
      ? nextMode
      : interactionModes.trigger;

    return {
      actionMode: resolvedMode,
      indicatorModeLinkedToAction: true,
      indicatorMode: resolvedMode
    };
  }

  function buildSynchronizedButtonActionPatch(currentButton = {}, nextActionType = '', ownerChannelId = null) {
    const actionTypes = getStandaloneButtonActionTypes();
    const normalizedActionType = Object.values(actionTypes).includes(nextActionType)
      ? nextActionType
      : actionTypes.none;
    const nextPatch = {
      actionType: normalizedActionType,
      actionEnabled: normalizedActionType !== actionTypes.none,
      indicatorEnabled: typeof currentButton?.indicatorEnabled === 'boolean'
        ? currentButton.indicatorEnabled
        : true,
      indicatorModeLinkedToAction: true
    };

    nextPatch.icon = getDefaultIconForButtonActionType(
      normalizedActionType,
      String(currentButton?.icon || 'square').trim() || 'square'
    );

    if (normalizedActionType !== actionTypes.none) {
      const interactionModes = getChannelButtonInteractionModes();
      nextPatch.indicatorMode = Object.values(interactionModes).includes(currentButton?.actionMode)
        ? currentButton.actionMode
        : interactionModes.trigger;
    }

    if (isStandaloneButtonChannelActionType(normalizedActionType)) {
      if (Number.isFinite(Number(ownerChannelId))) {
        nextPatch.linkedChannelId = Number(ownerChannelId);
      } else {
        const defaultLinkedChannelId = resolveDefaultButtonLinkedChannelId(currentButton, ownerChannelId);

        if (
          !Number.isFinite(Number(currentButton?.linkedChannelId))
          && Number.isFinite(Number(defaultLinkedChannelId))
        ) {
          nextPatch.linkedChannelId = Number(defaultLinkedChannelId);
        }
      }
    }

    return nextPatch;
  }

  function getDefaultActionTypeForGroup(group = 'faders') {
    const actionTypes = getStandaloneButtonActionTypes();

    if (String(group || '').trim() === 'none') {
      return actionTypes.none;
    }

    return getEditorButtonActionOptions(group)
      .find((option) => option.value !== actionTypes.none)?.value || actionTypes.none;
  }

  function handleStandaloneButtonMainClick(event) {
    if (editorState.entityType !== 'button') {
      return false;
    }

    const currentButton = getEditorButtonEntity(editorState.sidePanelButtonId || editorState.buttonId);

    if (!currentButton) {
      return false;
    }

    const closedIconPicker = (
      editorState.sidePanelIconPickerOpen
      && !event.target.closest('[data-editor-button-icon-picker]')
    );

    if (closedIconPicker) {
      editorState.sidePanelIconPickerOpen = false;
      editorState.sidePanelIconPickerExpanded = false;
    }

    const iconPickerToggleButton = event.target.closest('[data-editor-toggle-button-icon-picker]');
    const iconPickerMoreButton = event.target.closest('[data-editor-toggle-button-icon-picker-more]');
    const iconButton = event.target.closest('[data-editor-button-icon-option]');
    const optionButton = event.target.closest('[data-editor-button-option-name]');
    const bindMidiButton = event.target.closest('[data-editor-bind-channel-button-midi]');
    const keyCaptureButton = event.target.closest('[data-editor-side-button-key-capture]');
    const pickFileButton = event.target.closest('[data-editor-button-pick-file]');
    const refreshDevicesButton = event.target.closest('[data-editor-button-refresh-devices]');

    if (iconPickerToggleButton) {
      editorState.sidePanelIconPickerOpen = !editorState.sidePanelIconPickerOpen;

      if (!editorState.sidePanelIconPickerOpen) {
        editorState.sidePanelIconPickerExpanded = false;
      }

      renderEntityEditor();
      return true;
    }

    if (iconPickerMoreButton) {
      editorState.sidePanelIconPickerOpen = true;
      editorState.sidePanelIconPickerExpanded = !editorState.sidePanelIconPickerExpanded;
      renderEntityEditor();
      return true;
    }

    if (bindMidiButton) {
      window.midiActions?.learnStandaloneButtonMapping?.(
        Number.parseInt(bindMidiButton.dataset.editorBindChannelButtonMidi, 10),
        { source: 'entity-editor-main' }
      );
      return true;
    }

    if (pickFileButton) {
      const api = typeof window.getApi === 'function'
        ? window.getApi()
        : (window.getNativeApi?.() ?? null);
      const pickMode = String(pickFileButton.dataset.editorButtonPickFile || 'app').trim().toLowerCase();
      const fieldName = String(pickFileButton.dataset.editorButtonPathTarget || '').trim();

      if (api?.pick_action_file && fieldName) {
        Promise.resolve(api.pick_action_file(pickMode))
          .then((response) => {
            if (response?.canceled || !response?.filePath) {
              return;
            }

            updateSidePanelChannelButton({
              [fieldName]: String(response.filePath || '')
            }, {
              type: 'standalone-buttons/update'
            });
          })
          .catch((error) => {
            console.error('pick_action_file error', error);
          });
      }

      return true;
    }

    if (refreshDevicesButton) {
      const flow = String(refreshDevicesButton.dataset.editorButtonRefreshDevices || 'output').trim().toLowerCase();
      void ensureEditorAudioDevicesLoaded(flow === 'input' ? 'input' : 'output', { force: true });
      return true;
    }

    if (keyCaptureButton) {
      editorState.sidePanelKeyCaptureActive = !editorState.sidePanelKeyCaptureActive;
      renderEntityEditor();

      if (editorState.sidePanelKeyCaptureActive) {
        requestAnimationFrame(() => {
          dom.main?.querySelector('[data-editor-side-button-key-capture]')?.focus?.();
        });
      }

      return true;
    }

    if (iconButton) {
      editorState.sidePanelIconPickerOpen = false;
      editorState.sidePanelIconPickerExpanded = false;
      updateSidePanelChannelButton({
        icon: iconButton.dataset.editorButtonIconOption
      }, {
        type: 'standalone-buttons/update'
      });
      return true;
    }

    if (optionButton) {
      const optionName = optionButton.dataset.editorButtonOptionName;
      const optionValue = optionButton.dataset.editorButtonOptionValue;

      if (optionName === 'content-display') {
        updateSidePanelChannelButton({
          contentDisplay: optionValue
        }, {
          type: 'standalone-buttons/update'
        });
        return true;
      }

      if (optionName === 'action-type-none') {
        updateSidePanelChannelButton(buildSynchronizedButtonActionPatch(
          currentButton,
          getStandaloneButtonActionTypes().none,
          null
        ), {
          type: 'standalone-buttons/update'
        });
        return true;
      }

      if (optionName === 'action-mode') {
        updateSidePanelChannelButton(buildSynchronizedButtonModePatch(optionValue), {
          type: 'standalone-buttons/update',
          motionChoices: ['action-mode']
        });
        return true;
      }

      if (optionName === 'indicator-behavior') {
        updateSidePanelChannelButton({
          indicatorBehavior: optionValue
        }, {
          type: 'standalone-buttons/update',
          motionChoices: ['indicator-behavior']
        });
        return true;
      }
    }

    if (closedIconPicker) {
      renderEntityEditor();
      return true;
    }

    return false;
  }

  function handleStandaloneButtonMainInput(event) {
    if (editorState.entityType !== 'button') {
      return false;
    }

    const actionValueRange = event.target.closest('[data-editor-side-button-action-value]');
    const indicatorThresholdRange = event.target.closest('[data-editor-side-button-indicator-threshold]');

    if (indicatorThresholdRange) {
      const nextValue = clampButtonIndicatorThreshold(indicatorThresholdRange.value);
      const valueLabel = indicatorThresholdRange.parentElement?.querySelector('[data-editor-side-button-indicator-threshold-label]');
      updateSettingsRangeFill?.(indicatorThresholdRange);

      if (valueLabel) {
        valueLabel.textContent = formatButtonIndicatorThreshold(nextValue);
      }

      const meterRoot = indicatorThresholdRange
        .closest('.entity-edit-button-side-subsection, .entity-edit-button-main-subsection')
        ?.querySelector('[data-editor-button-live-meter]');

      if (meterRoot) {
        meterRoot.dataset.editorButtonThreshold = String(nextValue);
      }

      scheduleEntityEditorLivePeakMeterUpdate();

      return true;
    }

    if (!actionValueRange) {
      return false;
    }

    const nextValue = Math.max(0, Math.min(100, Number.parseInt(actionValueRange.value, 10) || 0));
    const valueLabel = actionValueRange.parentElement?.querySelector('[data-editor-side-button-action-value-label]');
    updateSettingsRangeFill?.(actionValueRange);

    if (valueLabel) {
      valueLabel.textContent = `${nextValue}%`;
    }

    return true;
  }

  function handleStandaloneButtonMainChange(event) {
    if (editorState.entityType !== 'button') {
      return false;
    }

    const currentButton = getEditorButtonEntity(editorState.sidePanelButtonId || editorState.buttonId);
    const actionGroupSelect = event.target.closest('[data-editor-button-action-group-select]');
    const actionTypeSelect = event.target.closest('[data-editor-button-action-type-select]');
    const linkedChannelSelect = event.target.closest('[data-editor-button-linked-channel-select]');
    const deviceSelect = event.target.closest('[data-editor-button-device-select]');
    const pathInput = event.target.closest('[data-editor-button-path-field]');
    const actionValueRange = event.target.closest('[data-editor-side-button-action-value]');
    const indicatorThresholdRange = event.target.closest('[data-editor-side-button-indicator-threshold]');

    if (actionGroupSelect) {
      const nextActionType = getDefaultActionTypeForGroup(actionGroupSelect.value);
      updateSidePanelChannelButton(
        buildSynchronizedButtonActionPatch(currentButton, nextActionType, null),
        { type: 'standalone-buttons/update' }
      );
      return true;
    }

    if (actionTypeSelect) {
      updateSidePanelChannelButton(
        buildSynchronizedButtonActionPatch(currentButton, actionTypeSelect.value, null),
        { type: 'standalone-buttons/update' }
      );
      return true;
    }

    if (linkedChannelSelect) {
      const linkedChannelId = Number.parseInt(linkedChannelSelect.value, 10);
      updateSidePanelChannelButton({
        linkedChannelId: Number.isFinite(linkedChannelId) ? linkedChannelId : null
      }, {
        type: 'standalone-buttons/update'
      });
      return true;
    }

    if (deviceSelect) {
      updateSidePanelChannelButton({
        deviceId: String(deviceSelect.value || '').trim()
      }, {
        type: 'standalone-buttons/update'
      });
      return true;
    }

    if (pathInput) {
      const fieldName = String(pathInput.dataset.editorButtonPathField || '').trim();

      if (!fieldName) {
        return false;
      }

      updateSidePanelChannelButton({
        [fieldName]: pathInput.value
      }, {
        type: 'standalone-buttons/update'
      });
      return true;
    }

    if (actionValueRange) {
      updateSidePanelChannelButton({
        actionValue: Math.max(0, Math.min(100, Number.parseInt(actionValueRange.value, 10) || 0))
      }, {
        type: 'standalone-buttons/update'
      });

      return true;
    }

    if (indicatorThresholdRange) {
      updateSidePanelChannelButton({
        indicatorThreshold: clampButtonIndicatorThreshold(indicatorThresholdRange.value)
      }, {
        type: 'standalone-buttons/update'
      });

      const meterRoot = indicatorThresholdRange
        .closest('.entity-edit-button-side-subsection, .entity-edit-button-main-subsection')
        ?.querySelector('[data-editor-button-live-meter]');

      if (meterRoot) {
        meterRoot.dataset.editorButtonThreshold = String(
          clampButtonIndicatorThreshold(indicatorThresholdRange.value)
        );
      }

      scheduleEntityEditorLivePeakMeterUpdate();

      return true;
    }

    return false;
  }

  function handleStandaloneButtonMainKeyDown(event) {
    if (editorState.entityType !== 'button' || !editorState.sidePanelKeyCaptureActive) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      editorState.sidePanelKeyCaptureActive = false;
      renderEntityEditor();
      return true;
    }

    const normalizedKey = getNormalizedCapturedButtonKey(event);

    if (!normalizedKey) {
      return true;
    }

    const currentButton = getEditorButtonEntity(editorState.sidePanelButtonId || editorState.buttonId);
    const actionTypes = getStandaloneButtonActionTypes();
    const nextActionType = currentButton?.actionType === actionTypes.none
      ? actionTypes.sendKey
      : currentButton?.actionType;

    editorState.sidePanelKeyCaptureActive = false;
    updateSidePanelChannelButton({
      ...buildSynchronizedButtonActionPatch(currentButton, nextActionType, null),
      key: normalizedKey
    }, {
      type: 'standalone-buttons/update'
    });

    return true;
  }

  function handleMainClick(event) {
    if (handleStandaloneButtonMainClick(event)) {
      return;
    }

    const closedChannelIconPicker = (
      editorState.channelIconPickerOpen
      && !event.target.closest('[data-editor-channel-icon-picker]')
    );

    if (closedChannelIconPicker) {
      editorState.channelIconPickerOpen = false;
      renderEntityEditor();
      return;
    }

    const toggleChannelIconPickerButton = event.target.closest('[data-editor-toggle-channel-icon-picker]');

    if (toggleChannelIconPickerButton && editorState.entityType === 'fader') {
      editorState.channelIconPickerOpen = !editorState.channelIconPickerOpen;
      renderEntityEditor();
      return;
    }

    const channelIconOptionButton = event.target.closest('[data-editor-channel-icon-option]');

    if (channelIconOptionButton && editorState.entityType === 'fader') {
      editorState.channelIconPickerOpen = false;
      window.channelActions?.setChannelIcon?.(
        editorState.channelId,
        String(channelIconOptionButton.dataset.editorChannelIconOption || '').trim(),
        { source: 'entity-editor' }
      );
      return;
    }

    if (event.target.closest('[data-editor-open-targets]')) {
      openTargetsPanel();
      return;
    }

    const startButtonTitleEditButton = event.target.closest('[data-editor-start-button-title-edit]');

    if (startButtonTitleEditButton) {
      startChannelButtonTitleEdit(Number.parseInt(startButtonTitleEditButton.dataset.editorStartButtonTitleEdit, 10));
      return;
    }

    const removeChannelButton = event.target.closest('[data-editor-remove-channel-button]');

    if (removeChannelButton) {
      const buttonId = Number.parseInt(removeChannelButton.dataset.editorRemoveChannelButton, 10);

      if (Number.isNaN(buttonId)) {
        return;
      }

      editorState.previewLayoutTransitionRequested = true;
      editorState.buttonTitleDraft = '';
      editorState.editingChannelButtonId = null;
      window.channelActions?.removeChannelButton?.(editorState.channelId, buttonId, {
        source: 'entity-editor'
      });
      return;
    }

    const openChannelButtonPanelButton = event.target.closest('[data-editor-open-channel-button-panel]');

    if (openChannelButtonPanelButton) {
      const buttonId = Number.parseInt(openChannelButtonPanelButton.dataset.editorOpenChannelButtonPanel, 10);

      if (Number.isNaN(buttonId)) {
        return;
      }

      openChannelButtonPanel(buttonId);
      return;
    }

    const openStandaloneButtonPanelButton = event.target.closest('[data-editor-open-standalone-button-panel]');

    if (openStandaloneButtonPanelButton) {
      const buttonId = Number.parseInt(openStandaloneButtonPanelButton.dataset.editorOpenStandaloneButtonPanel, 10);

      if (Number.isNaN(buttonId)) {
        return;
      }

      openChannelButtonPanel(buttonId);
      return;
    }

    if (event.target.closest('[data-editor-remap]')) {
      if (editorState.entityType === 'button') {
        remapStandaloneButton?.(editorState.buttonId);
      } else {
        remapChannelFader?.(editorState.channelId);
      }
      return;
    }

    if (event.target.closest('[data-editor-toggle-custom-settings]')) {
      const channel = getEditorChannel();

      if (!channel) {
        return;
      }

      if (!channel.customSettingsEnabled) {
        const resolvedSettings = getEditorChannelResolvedSettings(channel);
        updateChannelCustomSettingsState?.(channel.id, {
          faderInterpolationEnabled: Boolean(resolvedSettings.faderInterpolationEnabled),
          softTakeoverEnabled: Boolean(resolvedSettings.softTakeoverEnabled),
          softTakeoverThreshold: Number(resolvedSettings.softTakeoverThreshold) || 0,
          volumeCurveEnabled: Boolean(resolvedSettings.volumeCurveEnabled),
          volumeCurveType: resolvedSettings.volumeCurveType || 'ease-in-out',
          volumeCurveAmount: Number(resolvedSettings.volumeCurveAmount) || 0,
          showFractionalNumbers: Boolean(resolvedSettings.showFractionalNumbers)
        }, {
          source: 'entity-editor'
        });
      }

      setChannelCustomSettingsEnabledState?.(channel.id, !channel.customSettingsEnabled, {
        source: 'entity-editor'
      });
      saveProfileToLocal?.();
      renderEntityEditor();
      requestAnimationFrame(() => {
        if (!channel.customSettingsEnabled) {
          dom.main?.querySelector('.entity-edit-custom-expandable.open')?.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth'
          });
        }
      });
      return;
    }

    const removeTargetButton = event.target.closest('[data-editor-remove-target]');

    if (removeTargetButton) {
      const targetChip = removeTargetButton.closest('.entity-edit-target-chip');

      animateEditorListItemExit(targetChip, () => {
        if (editorState.entityType === 'button') {
          window.standaloneButtonActions?.removeTarget?.(
            editorState.buttonId,
            removeTargetButton.dataset.editorRemoveTarget,
            { source: 'entity-editor' }
          );
          syncTargetSelectionUi(getEditorStandaloneButton(editorState.buttonId));
        } else {
          window.channelActions?.removeChannelTarget?.(editorState.channelId, removeTargetButton.dataset.editorRemoveTarget, {
            source: 'entity-editor'
          });
        }
      });
      return;
    }

    const removeDeviceTargetButton = event.target.closest('[data-editor-remove-device-target]');

    if (removeDeviceTargetButton && editorState.entityType === 'fader') {
      const targetChip = removeDeviceTargetButton.closest('.entity-edit-target-chip');
      const targetId = String(removeDeviceTargetButton.dataset.editorRemoveDeviceTarget || '').trim();
      const targetFlow = String(removeDeviceTargetButton.dataset.editorRemoveDeviceTargetFlow || '').trim();

      if (!targetId) {
        return;
      }

      animateEditorListItemExit(targetChip, () => {
        window.channelActions?.removeChannelDeviceTarget?.(
          editorState.channelId,
          targetId,
          targetFlow,
          { source: 'entity-editor' }
        );
      });
      return;
    }

    const removeFocusExclusionButton = event.target.closest('[data-editor-remove-focus-exclusion]');

    if (removeFocusExclusionButton && editorState.entityType === 'fader') {
      const targetChip = removeFocusExclusionButton.closest('.entity-edit-target-chip');
      const targetProcess = String(removeFocusExclusionButton.dataset.editorRemoveFocusExclusion || '').trim();

      if (!targetProcess) {
        return;
      }

      animateEditorListItemExit(targetChip, () => {
        window.channelActions?.removeChannelFocusExclusion?.(
          editorState.channelId,
          targetProcess,
          { source: 'entity-editor' }
        );
      });
      return;
    }

    const titleIconButton = event.target.closest('[data-editor-toggle-title-icon]');

    if (titleIconButton && editorState.entityType === 'fader') {
      const channel = getEditorChannel();
      const targetProcess = titleIconButton.dataset.editorToggleTitleIcon;
      const isActive = Boolean(
        channel?.showTargetIconInTitle
        && String(channel?.titleIconTargetProcess || '').trim() === String(targetProcess || '').trim()
      );

      editorState.previewLayoutTransitionRequested = true;
      window.channelActions?.setChannelTitleIconVisible?.(
        editorState.channelId,
        !isActive,
        targetProcess,
        { source: 'entity-editor' }
      );
      return;
    }

    const useTargetNameButton = event.target.closest('[data-editor-use-target-name]');

    if (useTargetNameButton && editorState.entityType === 'fader') {
      const channel = getEditorChannel();
      const targetProcess = useTargetNameButton.dataset.editorUseTargetName;
      const target = getChannelTargets(channel)
        .map(resolveTargetDisplayEntry)
        .find((entry) => entry.process === targetProcess);

      if (!target) {
        return;
      }

      editorState.previewLayoutTransitionRequested = true;
      editorState.titleDraft = target.name;
      editorState.titleDirty = false;
      window.channelActions?.renameChannel?.(
        editorState.channelId,
        target.name,
        target.name,
        { source: 'entity-editor' }
      );
      return;
    }

    const buttonPlacementToggle = event.target.closest('[data-editor-button-placement]');

    if (buttonPlacementToggle && editorState.entityType === 'fader') {
      editorState.previewLayoutTransitionRequested = true;
      window.channelActions?.setChannelButtonPlacement?.(
        editorState.channelId,
        buttonPlacementToggle.dataset.editorButtonPlacement,
        { source: 'entity-editor' }
      );
      return;
    }

    const toggleButton = event.target.closest('[data-editor-setting-toggle]');

    if (toggleButton && editorState.entityType === 'fader') {
      const settingKey = toggleButton.dataset.editorSettingToggle;
      const currentSettings = getEditorCustomSettings(getEditorChannel());
      updateChannelCustomSetting(settingKey, !currentSettings[settingKey]);
      renderEntityEditor();
      return;
    }

    const curveButton = event.target.closest('[data-editor-curve-type]');

    if (curveButton && editorState.entityType === 'fader') {
      updateChannelCustomSetting('volumeCurveType', curveButton.dataset.editorCurveType);
      renderEntityEditor();
    }
  }

  function handleMainInput(event) {
    if (handleStandaloneButtonMainInput(event)) {
      return;
    }

    if (event.target.matches('#entityEditTitleInput')) {
      editorState.titleDraft = event.target.value;
      editorState.titleDirty = true;

      if (editorState.entityType === 'button') {
        syncPreviewFromButton(getEditorStandaloneButton(editorState.buttonId));
      } else {
        const channel = getEditorChannel();
        syncPreviewWithLayoutTransition(channel, () => {
          syncPreviewFromChannel(channel);
        });
      }
      return;
    }

    const buttonTitleInput = event.target.closest('[data-editor-button-title-input]');

    if (buttonTitleInput) {
      editorState.editingChannelButtonId = Number.parseInt(buttonTitleInput.dataset.editorButtonTitleInput, 10);
      editorState.buttonTitleDraft = buttonTitleInput.value;
      syncPreviewDraftButtonTitle(buttonTitleInput.dataset.editorButtonTitleInput, buttonTitleInput.value);
      return;
    }

    const rangeElement = event.target.closest('[data-editor-setting-range]');

    if (!rangeElement) {
      return;
    }

    const settingKey = rangeElement.dataset.editorSettingRange;
    const nextValue = Number.parseInt(rangeElement.value, 10) || 0;
    const valueLabel = rangeElement.parentElement?.querySelector('.settings-range-value');

    updateSettingsRangeFill?.(rangeElement);

    if (valueLabel) {
      valueLabel.textContent = `${nextValue}%`;
    }

    updateChannelCustomSetting(settingKey, nextValue);
  }

  function handleMainFocusOut(event) {
    if (event.target.matches('[data-editor-button-title-input]')) {
      commitChannelButtonTitleEdit();
      return;
    }

    if (!event.target.matches('#entityEditTitleInput')) {
      return;
    }

    commitEditorTitle();
  }

  function handleMainChange(event) {
    if (handleStandaloneButtonMainChange(event)) {
      return;
    }
  }

  function handleMainKeyDown(event) {
    if (handleStandaloneButtonMainKeyDown(event)) {
      return;
    }

    if (event.target.matches('[data-editor-button-title-input]')) {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        cancelChannelButtonTitleEdit();
      }
      return;
    }

    if (!event.target.matches('#entityEditTitleInput')) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.target.blur();
      return;
    }

    if (event.key === 'Escape') {
      const channel = getEditorChannel();
      const button = getEditorStandaloneButton(editorState.buttonId);
      editorState.titleDraft = editorState.entityType === 'button'
        ? (button?.text || t('buttons.defaultLabel'))
        : (channel?.title || channel?.appName || t('channels.unnamed'));
      editorState.titleDirty = false;
      event.target.value = editorState.titleDraft;
      if (editorState.entityType === 'button') {
        syncPreviewFromButton(button);
      } else {
        syncPreviewFromChannel(channel);
      }
      event.target.blur();
    }
  }

  function updateSidePanelChannelButton(patch, meta = {}) {
    if (!editorState.sidePanelButtonId) {
      return null;
    }

    const currentButton = getEditorButtonEntity(editorState.sidePanelButtonId);

    if (!currentButton) {
      return null;
    }

    const changedKeys = Object.keys(patch || {}).filter((key) => currentButton[key] !== patch[key]);

    if (!changedKeys.length) {
      return currentButton;
    }

    editorState.sidePanelMotionChoices = Array.isArray(meta?.motionChoices)
      ? meta.motionChoices
      : [];

    if (editorState.entityType === 'button') {
      return window.standaloneButtonActions?.updateStandaloneButton?.(
        editorState.sidePanelButtonId,
        patch,
        {
          source: 'entity-editor-side-panel',
          ...meta
        }
      ) || null;
    }

    return window.channelActions?.updateChannelButton?.(
      editorState.channelId,
      editorState.sidePanelButtonId,
      patch,
      {
        source: 'entity-editor-side-panel',
        ...meta
      }
    ) || null;
  }

  function commitSidePanelButtonTitleDraft() {
    if (!editorState.sidePanelButtonId || !editorState.sidePanelButtonTitleDirty) {
      return;
    }

    const button = getEditorButtonEntity(editorState.sidePanelButtonId);

    if (!button) {
      resetSidePanelButtonDraft(null);
      return;
    }

    const nextTitle = String(editorState.sidePanelButtonTitleDraft || '').trim() || button.text || t('buttons.defaultLabel');
    resetSidePanelButtonDraft({
      ...button,
      text: nextTitle
    });

    if (nextTitle === button.text) {
      if (editorState.entityType === 'button') {
        syncPreviewFromButton(getEditorStandaloneButton(editorState.buttonId));
      } else {
        syncPreviewFromChannel(getEditorChannel());
      }
      return;
    }

    updateSidePanelChannelButton({
      text: nextTitle
    }, {
      type: editorState.entityType === 'button'
        ? 'standalone-buttons/update'
        : 'channels/button-update'
    });
  }

  function syncSidePanelButtonTitleDraft(button = getEditorButtonEntity(editorState.sidePanelButtonId)) {
    if (!button || editorState.sidePanelButtonTitleDirty) {
      return;
    }

    editorState.sidePanelButtonTitleDraft = button.text || '';
  }

  function handleSidePanelInput(event) {
    const titleInput = event.target.closest('[data-editor-side-button-title-input]');

    if (titleInput) {
      editorState.sidePanelButtonTitleDraft = titleInput.value;
      editorState.sidePanelButtonTitleDirty = true;
      syncPreviewDraftButtonTitle(titleInput.dataset.editorSideButtonTitleInput, titleInput.value);
      return;
    }

    const actionValueRange = event.target.closest('[data-editor-side-button-action-value]');
    const indicatorThresholdRange = event.target.closest('[data-editor-side-button-indicator-threshold]');

    if (actionValueRange) {
      const nextValue = Math.max(0, Math.min(100, Number.parseInt(actionValueRange.value, 10) || 0));
      const valueLabel = actionValueRange.parentElement?.querySelector('[data-editor-side-button-action-value-label]');
      updateSettingsRangeFill?.(actionValueRange);

      if (valueLabel) {
        valueLabel.textContent = `${nextValue}%`;
      }
    }

    if (indicatorThresholdRange) {
      const nextValue = clampButtonIndicatorThreshold(indicatorThresholdRange.value);
      const valueLabel = indicatorThresholdRange.parentElement?.querySelector('[data-editor-side-button-indicator-threshold-label]');
      updateSettingsRangeFill?.(indicatorThresholdRange);

      if (valueLabel) {
        valueLabel.textContent = formatButtonIndicatorThreshold(nextValue);
      }

      const meterRoot = indicatorThresholdRange
        .closest('.entity-edit-button-side-subsection, .entity-edit-button-main-subsection')
        ?.querySelector('[data-editor-button-live-meter]');

      if (meterRoot) {
        meterRoot.dataset.editorButtonThreshold = String(nextValue);
      }

      scheduleEntityEditorLivePeakMeterUpdate();
    }
  }

  function handleSidePanelChange(event) {
    const currentButton = getEditorButtonEntity(editorState.sidePanelButtonId);
    const updateType = editorState.entityType === 'button'
      ? 'standalone-buttons/update'
      : 'channels/button-update';
    const actionGroupSelect = event.target.closest('[data-editor-button-action-group-select]');
    const actionTypeSelect = event.target.closest('[data-editor-button-action-type-select]');
    const linkedChannelSelect = event.target.closest('[data-editor-button-linked-channel-select]');
    const deviceSelect = event.target.closest('[data-editor-button-device-select]');
    const pathInput = event.target.closest('[data-editor-button-path-field]');
    const actionValueRange = event.target.closest('[data-editor-side-button-action-value]');
    const indicatorThresholdRange = event.target.closest('[data-editor-side-button-indicator-threshold]');

    if (actionGroupSelect) {
      const nextActionType = getDefaultActionTypeForGroup(actionGroupSelect.value);
      updateSidePanelChannelButton(
        buildSynchronizedButtonActionPatch(
          currentButton,
          nextActionType,
          editorState.entityType === 'fader' ? editorState.channelId : null
        ),
        { type: updateType }
      );
      return;
    }

    if (actionTypeSelect) {
      updateSidePanelChannelButton(
        buildSynchronizedButtonActionPatch(
          currentButton,
          actionTypeSelect.value,
          editorState.entityType === 'fader' ? editorState.channelId : null
        ),
        { type: updateType }
      );
      return;
    }

    if (linkedChannelSelect) {
      const linkedChannelId = Number.parseInt(linkedChannelSelect.value, 10);
      updateSidePanelChannelButton({
        linkedChannelId: Number.isFinite(linkedChannelId) ? linkedChannelId : null
      }, {
        type: updateType
      });
      return;
    }

    if (deviceSelect) {
      updateSidePanelChannelButton({
        deviceId: String(deviceSelect.value || '').trim()
      }, {
        type: updateType
      });
      return;
    }

    if (pathInput) {
      const fieldName = String(pathInput.dataset.editorButtonPathField || '').trim();

      if (!fieldName) {
        return;
      }

      updateSidePanelChannelButton({
        [fieldName]: pathInput.value
      }, {
        type: updateType
      });
      return;
    }

    if (indicatorThresholdRange) {
      updateSidePanelChannelButton({
        indicatorThreshold: clampButtonIndicatorThreshold(indicatorThresholdRange.value)
      }, {
        type: updateType
      });

      const meterRoot = indicatorThresholdRange
        .closest('.entity-edit-button-side-subsection, .entity-edit-button-main-subsection')
        ?.querySelector('[data-editor-button-live-meter]');

      if (meterRoot) {
        meterRoot.dataset.editorButtonThreshold = String(
          clampButtonIndicatorThreshold(indicatorThresholdRange.value)
        );
      }

      scheduleEntityEditorLivePeakMeterUpdate();
      return;
    }

    if (!actionValueRange) {
      return;
    }

    updateSidePanelChannelButton({
      actionValue: Math.max(0, Math.min(100, Number.parseInt(actionValueRange.value, 10) || 0))
    }, {
      type: updateType
    });
  }

  function handleSidePanelFocusOut(event) {
    if (event.target.matches('[data-editor-side-button-title-input]')) {
      commitSidePanelButtonTitleDraft();
    }
  }

  function handleSidePanelKeyDown(event) {
    if (editorState.sidePanelKeyCaptureActive) {
      event.preventDefault();
      event.stopPropagation();

        if (event.key === 'Escape') {
          editorState.sidePanelKeyCaptureActive = false;
          renderSidePanel(getEditorTargetEntity());
          return;
        }

      const normalizedKey = getNormalizedCapturedButtonKey(event);

      if (!normalizedKey) {
        return;
      }

      const currentButton = getEditorButtonEntity(editorState.sidePanelButtonId);
      const actionTypes = getStandaloneButtonActionTypes();
      const nextActionType = currentButton?.actionType === actionTypes.none
        ? actionTypes.sendKey
        : currentButton?.actionType;

      editorState.sidePanelKeyCaptureActive = false;
      updateSidePanelChannelButton({
        ...buildSynchronizedButtonActionPatch(
          currentButton,
          nextActionType,
          editorState.entityType === 'fader' ? editorState.channelId : null
        ),
        key: normalizedKey
      }, {
        type: editorState.entityType === 'button'
          ? 'standalone-buttons/update'
          : 'channels/button-update'
      });
      return;
    }

    if (!event.target.matches('[data-editor-side-button-title-input]')) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.target.blur();
      return;
    }

      if (event.key === 'Escape') {
        const button = getEditorButtonEntity(editorState.sidePanelButtonId);
        resetSidePanelButtonDraft(button);
        event.target.value = editorState.sidePanelButtonTitleDraft;
        if (editorState.entityType === 'button') {
          syncPreviewFromButton(getEditorStandaloneButton(editorState.buttonId));
        } else {
          syncPreviewFromChannel(getEditorChannel());
        }
        event.target.blur();
      }
    }

  function handleSidePanelClick(event) {
    if (event.target.closest('[data-editor-close-targets]')) {
      commitSidePanelButtonTitleDraft();
      closeTargetsPanel();
      return;
    }

    if (!isTargetsSidePanelMode()) {
      const iconPickerToggleButton = event.target.closest('[data-editor-toggle-button-icon-picker]');
      const iconPickerMoreButton = event.target.closest('[data-editor-toggle-button-icon-picker-more]');
      const iconButton = event.target.closest('[data-editor-button-icon-option]');
      const optionButton = event.target.closest('[data-editor-button-option-name]');
      const bindMidiButton = event.target.closest('[data-editor-bind-channel-button-midi]');
      const keyCaptureButton = event.target.closest('[data-editor-side-button-key-capture]');
      const pickFileButton = event.target.closest('[data-editor-button-pick-file]');
      const refreshDevicesButton = event.target.closest('[data-editor-button-refresh-devices]');
      const updateType = editorState.entityType === 'button'
        ? 'standalone-buttons/update'
        : 'channels/button-update';

      if (iconPickerToggleButton) {
        editorState.sidePanelIconPickerOpen = !editorState.sidePanelIconPickerOpen;

        if (!editorState.sidePanelIconPickerOpen) {
          editorState.sidePanelIconPickerExpanded = false;
        }

        renderSidePanel(getEditorTargetEntity());
        return;
      }

      if (iconPickerMoreButton) {
        editorState.sidePanelIconPickerOpen = true;
        editorState.sidePanelIconPickerExpanded = !editorState.sidePanelIconPickerExpanded;
        renderSidePanel(getEditorTargetEntity());
        return;
      }

      if (bindMidiButton) {
        if (editorState.entityType === 'button') {
          window.midiActions?.learnStandaloneButtonMapping?.(
            Number.parseInt(bindMidiButton.dataset.editorBindChannelButtonMidi, 10),
            { source: 'entity-editor-side-panel' }
          );
        } else {
          window.midiActions?.learnChannelButtonMapping?.(
            editorState.channelId,
            Number.parseInt(bindMidiButton.dataset.editorBindChannelButtonMidi, 10),
            { source: 'entity-editor-side-panel' }
          );
        }
        return;
      }

      if (pickFileButton) {
        const api = typeof window.getApi === 'function'
          ? window.getApi()
          : (window.getNativeApi?.() ?? null);
        const pickMode = String(pickFileButton.dataset.editorButtonPickFile || 'app').trim().toLowerCase();
        const fieldName = String(pickFileButton.dataset.editorButtonPathTarget || '').trim();

        if (api?.pick_action_file && fieldName) {
          Promise.resolve(api.pick_action_file(pickMode))
            .then((response) => {
              if (response?.canceled || !response?.filePath) {
                return;
              }

              updateSidePanelChannelButton({
                [fieldName]: String(response.filePath || '')
              }, {
                type: updateType
              });
            })
            .catch((error) => {
              console.error('pick_action_file error', error);
            });
        }

        return;
      }

      if (refreshDevicesButton) {
        const flow = String(refreshDevicesButton.dataset.editorButtonRefreshDevices || 'output').trim().toLowerCase();
        void ensureEditorAudioDevicesLoaded(flow === 'input' ? 'input' : 'output', { force: true });
        return;
      }

      if (keyCaptureButton) {
        editorState.sidePanelKeyCaptureActive = !editorState.sidePanelKeyCaptureActive;
        renderSidePanel(getEditorTargetEntity());

        if (editorState.sidePanelKeyCaptureActive) {
          requestAnimationFrame(() => {
            dom.sidePanel?.querySelector('[data-editor-side-button-key-capture]')?.focus?.();
          });
        }

        return;
      }

      if (
        editorState.sidePanelIconPickerOpen
        && !event.target.closest('[data-editor-button-icon-picker]')
      ) {
        editorState.sidePanelIconPickerOpen = false;
        editorState.sidePanelIconPickerExpanded = false;
      }

      if (iconButton) {
        editorState.sidePanelIconPickerOpen = false;
        editorState.sidePanelIconPickerExpanded = false;
        updateSidePanelChannelButton({
          icon: iconButton.dataset.editorButtonIconOption
        }, {
          type: updateType
        });
        return;
      }

      if (optionButton) {
        const optionName = optionButton.dataset.editorButtonOptionName;
        const optionValue = optionButton.dataset.editorButtonOptionValue;
        const currentButton = getEditorButtonEntity(editorState.sidePanelButtonId);

        if (optionName === 'content-display') {
          updateSidePanelChannelButton({
            contentDisplay: optionValue
          }, {
            type: updateType
          });
          return;
        }

        if (optionName === 'action-type') {
          updateSidePanelChannelButton(
            buildSynchronizedButtonActionPatch(
              currentButton,
              optionValue,
              editorState.entityType === 'fader' ? editorState.channelId : null
            ),
            {
              type: updateType,
              motionChoices: ['action-type']
            }
          );
          return;
        }

        if (optionName === 'action-mode') {
          updateSidePanelChannelButton(buildSynchronizedButtonModePatch(optionValue), {
            type: updateType,
            motionChoices: ['action-mode']
          });
          return;
        }

        if (optionName === 'indicator-behavior') {
          updateSidePanelChannelButton({
            indicatorBehavior: optionValue
          }, {
            type: updateType,
            motionChoices: ['indicator-behavior']
          });
          return;
        }
      }

      return;
    }

    const optionButton = event.target.closest('[data-editor-button-option-name]');

    if (optionButton && editorState.entityType === 'fader') {
      const optionName = String(optionButton.dataset.editorButtonOptionName || '').trim();
      const optionValue = String(optionButton.dataset.editorButtonOptionValue || '').trim();

      if (optionName === 'target-mode') {
        window.channelActions?.setChannelTargetMode?.(
          editorState.channelId,
          optionValue,
          { source: 'entity-editor' }
        );

        if (optionValue === (window.CHANNEL_TARGET_MODES?.devices || 'devices')) {
          void ensureEditorAudioDevicesLoaded(getChannelDeviceTargetFlow(getEditorChannel()));
        } else if (optionValue === (window.CHANNEL_TARGET_MODES?.apps || 'apps')
          || optionValue === (window.CHANNEL_TARGET_MODES?.focus || 'focus')) {
          requestTargetsPanelApplicationsRefresh({ force: true });
        }
        return;
      }

      if (optionName === 'device-target-flow') {
        window.channelActions?.setChannelDeviceTargetFlow?.(
          editorState.channelId,
          optionValue,
          { source: 'entity-editor' }
        );
        void ensureEditorAudioDevicesLoaded(optionValue);
        return;
      }
    }

    const toggleTargetButton = event.target.closest('[data-editor-toggle-target]');

    if (toggleTargetButton) {
      const channel = getEditorTargetEntity();
      const targetProcess = String(toggleTargetButton.dataset.editorToggleTarget || '').trim();

      if (!channel || !targetProcess) {
        return;
      }

      const selectedTargets = new Set(getChannelTargets(channel).map((target) => target.process));
      const availableApp = (typeof getAvailableAudioApps === 'function'
        ? getAvailableAudioApps()
        : []).find((app) => app.process === targetProcess);

      if (selectedTargets.has(targetProcess)) {
        if (editorState.entityType === 'button') {
          window.standaloneButtonActions?.removeTarget?.(
            editorState.buttonId,
            targetProcess,
            { source: 'entity-editor' }
          );
          syncTargetSelectionUi(getEditorStandaloneButton(editorState.buttonId));
        } else {
          window.channelActions?.removeChannelTarget?.(
            channel.id,
            targetProcess,
            { source: 'entity-editor' }
          );
        }
        return;
      }

      if (editorState.entityType === 'button') {
        window.standaloneButtonActions?.addTarget?.(
          editorState.buttonId,
          targetProcess,
          availableApp?.name || targetProcess,
          { source: 'entity-editor' }
        );
        syncTargetSelectionUi(getEditorStandaloneButton(editorState.buttonId));
      } else {
        window.channelActions?.addChannelTarget?.(
          channel.id,
          targetProcess,
          availableApp?.name || targetProcess,
          { source: 'entity-editor' }
        );
      }

      animateEditorTargetChip(targetProcess);
      return;
    }

    const toggleDeviceTargetButton = event.target.closest('[data-editor-toggle-device-target]');

    if (toggleDeviceTargetButton && editorState.entityType === 'fader') {
      const channel = getEditorChannel();
      const targetId = String(toggleDeviceTargetButton.dataset.editorToggleDeviceTarget || '').trim();
      const targetFlow = String(toggleDeviceTargetButton.dataset.editorToggleDeviceTargetFlow || '').trim() || 'output';

      if (!channel || !targetId) {
        return;
      }

      const selectedTargetIds = new Set(
        getChannelDeviceTargets(channel, targetFlow).map((target) => target.id)
      );
      const availableDevice = (Array.isArray(editorState.audioDeviceOptions[targetFlow])
        ? editorState.audioDeviceOptions[targetFlow]
        : []).find((device) => String(device?.id || '').trim() === targetId);

      if (selectedTargetIds.has(targetId)) {
        window.channelActions?.removeChannelDeviceTarget?.(
          channel.id,
          targetId,
          targetFlow,
          { source: 'entity-editor' }
        );
        return;
      }

      window.channelActions?.addChannelDeviceTarget?.(
        channel.id,
        targetId,
        availableDevice?.name || targetId,
        targetFlow,
        { source: 'entity-editor' }
      );
      return;
    }

    const toggleFocusExclusionButton = event.target.closest('[data-editor-toggle-focus-exclusion]');

    if (toggleFocusExclusionButton && editorState.entityType === 'fader') {
      const channel = getEditorChannel();
      const targetProcess = String(toggleFocusExclusionButton.dataset.editorToggleFocusExclusion || '').trim();

      if (!channel || !targetProcess) {
        return;
      }

      const selectedExclusions = new Set(getChannelFocusExclusions(channel).map((target) => target.process));
      const availableApp = (typeof getAvailableAudioApps === 'function'
        ? getAvailableAudioApps()
        : []).find((app) => app.process === targetProcess);

      if (selectedExclusions.has(targetProcess)) {
        window.channelActions?.removeChannelFocusExclusion?.(
          channel.id,
          targetProcess,
          { source: 'entity-editor' }
        );
        return;
      }

      window.channelActions?.addChannelFocusExclusion?.(
        channel.id,
        targetProcess,
        availableApp?.name || targetProcess,
        { source: 'entity-editor' }
      );
      return;
    }
  }

  function handleEditorOpen(payload = {}) {
    cleanupPreviewState({ restoreSource: true });
    clearSidePanelCloseTimer();

    resetEditorSessionState({
      initialized: editorState.initialized,
      entityType: payload.entityType || 'fader',
      channelId: payload.channelId ?? null,
      buttonId: payload.buttonId ?? null,
      standalone: Boolean(payload.standalone),
      sourceSelector: resolveEntitySourceSelector(payload),
      sidePanelOpen: payload.initialSidePanelMode === 'channel-button' && Number.isFinite(payload.initialButtonId),
      sidePanelMode: payload.initialSidePanelMode === 'channel-button' ? 'channel-button' : 'targets',
      sidePanelButtonId: Number.isFinite(payload.initialButtonId) ? payload.initialButtonId : null
    });

    const channel = getEditorChannel();
    const standaloneButton = getEditorStandaloneButton(editorState.buttonId);
    editorState.titleDraft = editorState.entityType === 'button'
      ? (standaloneButton?.text || t('buttons.defaultLabel'))
      : (channel?.title || channel?.appName || t('channels.unnamed'));
    resetSidePanelButtonDraft(getEditorButtonEntity(editorState.sidePanelButtonId));

    dom.shell?.classList.remove('entity-edit-side-open');
    dom.sidePanel?.classList.remove('is-open');
    renderEntityEditor();
    dom.previewFrame?.classList.remove('is-ready');

    requestAnimationFrame(() => {
      startPreviewEntranceAnimation();
    });
  }

  function handleEditorBeforeClose() {
    commitEditorTitle();
    commitSidePanelButtonTitleDraft();
    editorState.sidePanelOpen = false;
    editorState.sidePanelClosing = false;
    clearSidePanelCloseTimer();
    dom.shell?.classList.remove('entity-edit-side-open');
    dom.shell?.classList.remove('entity-edit-side-closing');
    dom.sidePanel?.classList.remove('is-open');
    dom.sidePanel?.classList.remove('is-closing');
    stopPreviewDrag();
    startPreviewExitAnimation();
  }

  function handleEditorClose() {
    stopPreviewDrag();
    cleanupPreviewState({ restoreSource: true });
    clearSidePanelCloseTimer();

    resetEditorSessionState({
      initialized: editorState.initialized
    });

    if (dom.main) {
      dom.main.innerHTML = '';
    }

    if (dom.sidePanel) {
      dom.sidePanel.innerHTML = '';
      dom.sidePanel.classList.remove('is-open');
    }

    dom.sideOptions = null;

    dom.shell?.classList.remove('entity-edit-side-open');
    dom.shell?.classList.remove('entity-edit-side-closing');
  }

  function restoreTitleInputSelection(selectionStart, selectionEnd) {
    const nextInput = dom.main?.querySelector('#entityEditTitleInput');

    if (!nextInput) {
      return;
    }

    nextInput.focus({ preventScroll: true });

    if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
      nextInput.setSelectionRange(selectionStart, selectionEnd);
    }
  }

  function refreshEntityEditor(options = {}) {
    if (getCurrentActiveModalId() !== ENTITY_EDITOR_MODAL_ID) {
      return;
    }

    if (editorState.entityType === 'button') {
      const button = getEditorStandaloneButton(editorState.buttonId);

      if (!button) {
        closeModal?.(ENTITY_EDITOR_MODAL_ID, { reason: 'entity-missing' });
        return;
      }

      if (options.previewOnly) {
        syncPreviewFromButton(button);
        return;
      }
    }

    if (editorState.entityType === 'fader') {
      const channel = getEditorChannel();

      if (!channel) {
        closeModal?.(ENTITY_EDITOR_MODAL_ID, { reason: 'entity-missing' });
        return;
      }

      if (options.previewOnly) {
        syncPreviewFromChannel(channel);
        return;
      }
    }

    renderEntityEditor();
  }

  function openEntityEditor(payload = {}) {
    if (!window.modalManager) {
      return false;
    }

    return openModal?.(ENTITY_EDITOR_MODAL_ID, payload, { source: 'entity-editor' }) || false;
  }

  function openChannelEditor(channelId) {
    const channel = findChannelState?.(channelId);

    if (!channel) {
      return false;
    }

    return openEntityEditor({
      entityType: 'fader',
      channelId,
      sourceSelector: `.channel-strip[data-channel-id="${channelId}"]`
    });
  }

  function openChannelButtonEditor(channelId, buttonId) {
    const channel = findChannelState?.(channelId);
    const button = channel?.buttons?.find((item) => item.id === buttonId) || null;

    if (!channel || !button) {
      return false;
    }

    return openEntityEditor({
      entityType: 'fader',
      channelId,
      sourceSelector: `.channel-strip[data-channel-id="${channelId}"]`,
      initialSidePanelMode: 'channel-button',
      initialButtonId: buttonId
    });
  }

  function openStandaloneButtonEditor(buttonId) {
    const button = findStandaloneButtonState?.(buttonId) || null;

    if (!button) {
      return false;
    }

    return openEntityEditor({
      entityType: 'button',
      buttonId,
      standalone: true,
      sourceSelector: `.standalone-button[data-button-id="${buttonId}"]`,
      initialButtonId: buttonId
    });
  }

  function initEntityEditorStateSync() {
    if (initEntityEditorStateSync.initialized || typeof subscribeAppState !== 'function') {
      return;
    }

    subscribeAppState((nextState, previousState, meta = {}) => {
      if (getCurrentActiveModalId() !== ENTITY_EDITOR_MODAL_ID) {
        return;
      }

      if (editorState.entityType === 'fader' && nextState.channels !== previousState.channels) {
        const channel = findChannelState?.(editorState.channelId);

        if (!channel) {
          closeModal?.(ENTITY_EDITOR_MODAL_ID, { reason: 'channel-removed' });
          return;
        }

        if (meta?.source === 'entity-editor-preview') {
          syncPreviewFromChannel(channel);
          return;
        }

        if (
          meta?.type === 'channels/set-volume'
          || meta?.type === 'channels/button-toggle'
        ) {
          syncPreviewFromChannel(channel);
          return;
        }

        if (
          meta?.type === 'channels/add-app-target'
          || meta?.type === 'channels/remove-app-target'
          || meta?.type === 'channels/clear-app'
          || meta?.type === 'channels/set-app'
          || meta?.type === 'channels/add-device-target'
          || meta?.type === 'channels/remove-device-target'
          || meta?.type === 'channels/add-focus-exclusion'
          || meta?.type === 'channels/remove-focus-exclusion'
        ) {
          syncTargetSelectionUi(channel);

          if (isTargetsPanelVisible()) {
            syncSidePanelOptions(channel);
          }

          return;
        }

        if (
          meta?.type === 'channels/set-target-mode'
          || meta?.type === 'channels/set-device-target-flow'
        ) {
          syncTargetSelectionUi(channel);

          if (isTargetsPanelVisible()) {
            renderSidePanel(channel);
          }

          return;
        }

        if (
          meta?.type === 'channels/button-add'
          || meta?.type === 'channels/button-remove'
          || meta?.type === 'channels/button-update'
          || meta?.type === 'channels/set-button-placement'
        ) {
          syncEditorChannelButtonsUi(channel);

          if (
            editorState.sidePanelMode === 'channel-button'
            && editorState.sidePanelButtonId
            && !getEditorChannelButton(editorState.sidePanelButtonId, channel)
          ) {
            editorState.sidePanelOpen = false;
            editorState.sidePanelClosing = false;
            editorState.sidePanelMode = 'targets';
            editorState.sidePanelButtonId = null;
            editorState.sidePanelKeyCaptureActive = false;
            resetSidePanelButtonDraft(null);
            renderSidePanel(channel);
          } else if (editorState.sidePanelMode === 'channel-button' && editorState.sidePanelOpen) {
            syncSidePanelButtonTitleDraft(getEditorChannelButton(editorState.sidePanelButtonId, channel));
            renderSidePanel(channel);
          }

          if (editorState.previewLayoutTransitionRequested) {
            syncPreviewWithLayoutTransition(channel, renderPreviewContent);
            editorState.previewLayoutTransitionRequested = false;
          } else if (meta?.type === 'channels/button-update') {
            renderPreviewContent();
          }

          return;
        }

        if (meta?.type === 'channels/set-title-icon') {
          const previewTransitionRequested = editorState.previewLayoutTransitionRequested;
          syncEditorTargetsBody(channel);

          if (isTargetsPanelVisible() && isTargetsSidePanelMode()) {
            syncSidePanelSelectionState(channel);
          }

          if (previewTransitionRequested) {
            syncPreviewWithLayoutTransition(channel, renderPreviewContent);
            editorState.previewLayoutTransitionRequested = false;
          } else {
            syncPreviewFromChannel(channel);
          }
          return;
        }

        if (meta?.type === 'channels/rename') {
          const activeTitleInput = dom.main?.querySelector('#entityEditTitleInput');
          const nextTitle = channel.title || channel.appName || t('channels.unnamed');

          if (activeTitleInput && document.activeElement !== activeTitleInput) {
            activeTitleInput.value = nextTitle;
            editorState.titleDraft = nextTitle;
            editorState.titleDirty = false;
          } else if (!activeTitleInput) {
            editorState.titleDraft = nextTitle;
            editorState.titleDirty = false;
          }

          if (editorState.previewLayoutTransitionRequested) {
            syncPreviewWithLayoutTransition(channel, () => {
              syncPreviewFromChannel(channel);
            });
            editorState.previewLayoutTransitionRequested = false;
          } else {
            syncPreviewFromChannel(channel);
          }
          return;
        }

        if (
          editorState.sidePanelMode === 'channel-button'
          && editorState.sidePanelButtonId
          && !getEditorChannelButton(editorState.sidePanelButtonId, channel)
        ) {
          editorState.sidePanelOpen = false;
          editorState.sidePanelClosing = false;
          editorState.sidePanelMode = 'targets';
          editorState.sidePanelButtonId = null;
          editorState.sidePanelKeyCaptureActive = false;
        }

        const activeTitleInput = dom.main?.querySelector('#entityEditTitleInput');
        const activeButtonTitleInput = dom.main?.querySelector('[data-editor-button-title-input]');
        const isEditingTitle = document.activeElement === activeTitleInput;
        const isEditingButtonTitle = document.activeElement === activeButtonTitleInput;
        const selectionStart = isEditingTitle ? activeTitleInput.selectionStart : null;
        const selectionEnd = isEditingTitle ? activeTitleInput.selectionEnd : null;
        const buttonSelectionStart = isEditingButtonTitle ? activeButtonTitleInput.selectionStart : null;
        const buttonSelectionEnd = isEditingButtonTitle ? activeButtonTitleInput.selectionEnd : null;
        const editingButtonId = isEditingButtonTitle
          ? Number.parseInt(activeButtonTitleInput.dataset.editorButtonTitleInput, 10)
          : null;

        renderEntityEditor();

        if (isEditingTitle) {
          requestAnimationFrame(() => {
            restoreTitleInputSelection(selectionStart, selectionEnd);
          });
        }

        if (isEditingButtonTitle && Number.isFinite(editingButtonId)) {
          requestAnimationFrame(() => {
            focusChannelButtonTitleInput(editingButtonId, buttonSelectionStart, buttonSelectionEnd);
          });
        }

        return;
      }

      if (editorState.entityType === 'button' && nextState.standaloneButtons !== previousState.standaloneButtons) {
        const button = getEditorStandaloneButton(editorState.buttonId);

        if (!button) {
          closeModal?.(ENTITY_EDITOR_MODAL_ID, { reason: 'button-removed' });
          return;
        }

        if (editorState.sidePanelMode === 'channel-button' && editorState.sidePanelOpen) {
          syncSidePanelButtonTitleDraft(button);
        }

        const activeTitleInput = dom.main?.querySelector('#entityEditTitleInput');
        const isEditingTitle = document.activeElement === activeTitleInput;
        const selectionStart = isEditingTitle ? activeTitleInput.selectionStart : null;
        const selectionEnd = isEditingTitle ? activeTitleInput.selectionEnd : null;

        renderEntityEditor();

        if (isEditingTitle) {
          requestAnimationFrame(() => {
            restoreTitleInputSelection(selectionStart, selectionEnd);
          });
        }

        return;
      }
    });

    window.addEventListener('audio-apps-updated', () => {
      if (getCurrentActiveModalId() !== ENTITY_EDITOR_MODAL_ID) {
        return;
      }

      if (editorState.entityType === 'button') {
        const button = getEditorStandaloneButton(editorState.buttonId);

        if (!button) {
          return;
        }

        syncEditorTargetsBody(button);
        syncPreviewFromButton(button);

        if (isTargetsPanelVisible() && isTargetsSidePanelMode()) {
          syncSidePanelOptions(button);
        }
        return;
      }

      const channel = getEditorChannel();

      if (!channel) {
        return;
      }

      syncEditorTargetsBody(channel);
      syncPreviewFromChannel(channel);

      if (isTargetsPanelVisible() && isTargetsSidePanelMode()) {
        syncSidePanelOptions(channel);
      }
    });

    initEntityEditorStateSync.initialized = true;
  }

  function initEntityEditor() {
    if (editorState.initialized) {
      return;
    }

    cacheDom();

    if (!dom.modal || !dom.main || !dom.previewMount || !window.modalManager) {
      return;
    }

    registerModal(ENTITY_EDITOR_MODAL_ID, {
      element: dom.modal,
      initialFocusSelector: '#entityEditTitleInput, [data-modal-close]',
      transitionDuration: ENTITY_EDITOR_CLOSE_MS,
      onOpen: handleEditorOpen,
      onBeforeClose: handleEditorBeforeClose,
      onClose: handleEditorClose
    });

    dom.main.addEventListener('click', handleMainClick);
    dom.main.addEventListener('input', handleMainInput);
    dom.main.addEventListener('change', handleMainChange);
    dom.main.addEventListener('focusout', handleMainFocusOut);
    dom.main.addEventListener('keydown', handleMainKeyDown);
    dom.sidePanel?.addEventListener('click', handleSidePanelClick);
    dom.sidePanel?.addEventListener('input', handleSidePanelInput);
    dom.sidePanel?.addEventListener('change', handleSidePanelChange);
    dom.sidePanel?.addEventListener('focusout', handleSidePanelFocusOut);
    dom.sidePanel?.addEventListener('keydown', handleSidePanelKeyDown);
    dom.sidePanel?.addEventListener('pointerenter', () => {
      if (editorState.sidePanelOpen) {
        requestTargetsPanelApplicationsRefresh();
      }
    });
    dom.previewMount.addEventListener('pointerdown', startPreviewDrag);

    initEntityEditorStateSync();
    initEntityEditorRuntimeSync();
    editorState.initialized = true;
  }

  window.refreshEntityEditor = refreshEntityEditor;
    window.openEntityEditor = openEntityEditor;
    window.openChannelEditor = openChannelEditor;
    window.openChannelButtonEditor = openChannelButtonEditor;
    window.openStandaloneButtonEditor = openStandaloneButtonEditor;
    window.handleEditorAddChannelButton = handleEditorAddChannelButton;
    window.initEntityEditor = initEntityEditor;
  })(window);
