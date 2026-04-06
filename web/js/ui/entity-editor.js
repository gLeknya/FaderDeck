(function initEntityEditorModule(window) {
  const ENTITY_EDITOR_MODAL_ID = 'entity-edit';
  const ENTITY_EDITOR_CLOSE_MS = 240;
  const ENTITY_EDITOR_SIDE_PANEL_CLOSE_MS = 220;
  const ENTITY_EDITOR_PREVIEW_MOVE_MS = 250;

  const dom = {};

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
      sourceHidden: false
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

  function resolveTargetDisplayEntry(target = {}) {
    const matchedApplication = getAvailableAppByProcess(target.process);

    return {
      process: String(target.process || matchedApplication?.process || '').trim(),
      name: String(matchedApplication?.name || target.name || target.process || '').trim(),
      iconDataUrl: String(matchedApplication?.iconDataUrl || '').trim()
    };
  }

  function renderAppIconMarkup(entry, className) {
    const iconLabel = String(entry?.name || entry?.process || '').trim().charAt(0).toUpperCase() || 'A';
    const hasImage = Boolean(entry?.iconDataUrl);

    return `
      <span class="${className} ${hasImage ? 'has-image' : ''}">
        ${hasImage
          ? `<img class="entity-edit-app-icon-image" src="${escapeHtml(entry.iconDataUrl)}" alt="${escapeHtml(entry.name || entry.process || 'App')}">`
          : escapeHtml(iconLabel)}
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

  function getPreviewMappingLabel(channel) {
    if (!getAdvancedModeEnabled?.() || typeof getFaderMappingLabel !== 'function') {
      return '';
    }

    return getFaderMappingLabel(channel?.faderMapping);
  }

  function renderPreviewButtonSlot(button) {
    return `
      <div class="channel-side-button ${button.active ? 'active' : ''} entity-edit-preview-button" data-preview-button-id="${button.id}">
        <span class="button-icon">${escapeHtml(button.icon)}</span>
        <span class="button-label">${escapeHtml(button.text)}</span>
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
              : button
          ))
      : [];

    if (!buttons.length) {
      return '';
    }

    const layoutMode = getPreviewButtonLayoutMode(channel);

    return `
      <div class="channel-buttons-grid channel-buttons-grid--${layoutMode} channel-buttons-grid--count-${buttons.length}">
        ${buttons.map((button) => renderPreviewButtonSlot(button)).join('')}
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
    const titleIconTarget = getPreviewTitleIconTarget(channel);

    if (!titleIconTarget) {
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
    return `
      <div class="standalone-button entity-edit-preview-standalone">
        <div class="button-icon">BTN</div>
        <div class="button-label">Button</div>
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

  function startPreviewEntranceAnimation() {
    clearPreviewTimer();
    cleanupFloatingPreviews();
    renderPreviewContent();

    const sourceElement = resolveEntitySourceElement();
    const previewElement = dom.previewMount?.firstElementChild;

    if (!dom.previewFrame || !previewElement) {
      setSourcePreviewState(true);
      return;
    }

    const floatingPreview = createFloatingPreview(sourceElement);

    if (!floatingPreview) {
      dom.previewFrame.classList.add('is-ready');
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
      cleanupFloatingPreviews();
      dom.previewFrame?.classList.add('is-ready');
      editorState.previewTimerId = null;
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
    const targets = getChannelTargets(channel).map(resolveTargetDisplayEntry);
    const activeTitleIconProcess = channel?.showTargetIconInTitle
      ? String(channel?.titleIconTargetProcess || '').trim()
      : '';

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
          <div class="entity-edit-target-chip" data-editor-target-chip="${escapeHtml(target.process)}">
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
      </div>
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
            <span class="entity-edit-target-icon">${escapeHtml(button.icon)}</span>
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
                  data-editor-start-button-title-edit="${button.id}">
                  ${escapeHtml(button.text)}
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

  function renderChannelButtonSidePanel(channel) {
    const button = getEditorChannelButton(editorState.sidePanelButtonId, channel);

    return `
      <div class="entity-edit-side-panel-inner">
        <div class="entity-edit-side-header">
          <button
            class="entity-edit-side-back"
            type="button"
            data-editor-close-targets
            aria-label="${escapeHtml(t('editor.close'))}">
            <span class="entity-edit-side-back-arrow" aria-hidden="true"></span>
            <span class="entity-edit-side-back-label">${t('editor.buttonPanelTitle')}</span>
          </button>
          <div class="entity-edit-side-subtitle">${t('editor.buttonPanelSubtitle')}</div>
        </div>

        <div class="entity-edit-button-side-stub">
          <div class="entity-edit-button-side-card">
            <div class="entity-edit-button-side-card-label">${t('editor.buttonPanelTargetButton')}</div>
            <div class="entity-edit-button-side-card-value">${escapeHtml(button?.text || t('buttons.defaultLabel'))}</div>
          </div>
          <div class="entity-edit-button-side-card is-placeholder">
            <div class="entity-edit-button-side-card-title">${t('editor.buttonPanelStubTitle')}</div>
            <p class="entity-edit-button-side-card-text">${t('editor.buttonPanelStubText')}</p>
          </div>
        </div>
      </div>
    `;
  }

  function renderSidePanelOptions(channel) {
    const selectedTargets = new Set(getChannelTargets(channel).map((target) => target.process));
    const availableApps = getAvailableApps();

    if (!availableApps.length) {
      return `<div class="entity-edit-side-empty">${t('editor.sidePanelEmpty')}</div>`;
    }

    return availableApps.map((application) => `
      <button
        class="entity-edit-side-option ${selectedTargets.has(application.process) ? 'active' : ''}"
        type="button"
        data-editor-toggle-target="${escapeHtml(application.process)}">
        ${renderAppIconMarkup(application, 'entity-edit-side-option-icon')}
        <span class="entity-edit-side-option-label">${escapeHtml(application.name || application.process)}</span>
      </button>
    `).join('');
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

        <section class="entity-edit-section entity-edit-section-stub">
          <div class="entity-edit-stub-title">${t('editor.buttonStubTitle')}</div>
          <p class="entity-edit-stub-text">${t('editor.buttonStubText')}</p>
        </section>
      </div>
    `;
  }

  function renderSidePanel(channel) {
    if (!dom.sidePanel) {
      return;
    }

    dom.shell?.classList.toggle('entity-edit-side-open', editorState.sidePanelOpen);
    dom.shell?.classList.toggle('entity-edit-side-closing', editorState.sidePanelClosing);
    dom.sidePanel.classList.toggle('is-open', editorState.sidePanelOpen);
    dom.sidePanel.classList.toggle('is-closing', editorState.sidePanelClosing);

    if (!isTargetsSidePanelMode()) {
      dom.sidePanel.innerHTML = renderChannelButtonSidePanel(channel);
      dom.sideOptions = null;
      return;
    }

    dom.sidePanel.innerHTML = `
      <div class="entity-edit-side-panel-inner">
        <div class="entity-edit-side-header">
          <button
            class="entity-edit-side-back"
            type="button"
            data-editor-close-targets
            aria-label="${escapeHtml(t('editor.close'))}">
            <span class="entity-edit-side-back-arrow" aria-hidden="true"></span>
            <span class="entity-edit-side-back-label">${t('editor.sidePanelTitle')}</span>
          </button>
          <div class="entity-edit-side-subtitle">${t('editor.sidePanelSubtitle')}</div>
        </div>

        <div class="entity-edit-side-options-shell">
          <div class="entity-edit-side-options" id="entityEditSideOptions">
            ${renderSidePanelOptions(channel)}
          </div>
        </div>
      </div>
    `;

    dom.sideOptions = $('entityEditSideOptions');
  }

  function syncEditorTargetsBody(channel = getEditorChannel()) {
    const targetsBody = dom.main?.querySelector('[data-editor-targets-body]');

    if (!targetsBody) {
      return;
    }

    targetsBody.innerHTML = renderEditorTargets(channel);
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

  function syncSidePanelSelectionState(channel = getEditorChannel()) {
    if (!dom.sideOptions || !isTargetsSidePanelMode()) {
      return;
    }

    const selectedTargets = new Set(getChannelTargets(channel).map((target) => target.process));

    dom.sideOptions.querySelectorAll('[data-editor-toggle-target]').forEach((option) => {
      option.classList.toggle('active', selectedTargets.has(option.dataset.editorToggleTarget));
    });
  }

  function syncSidePanelOptions(channel = getEditorChannel(), { preserveScroll = true } = {}) {
    if (!dom.sideOptions || !isTargetsSidePanelMode()) {
      return;
    }

    const previousScrollTop = preserveScroll ? dom.sideOptions.scrollTop : 0;
    dom.sideOptions.innerHTML = renderSidePanelOptions(channel);

    if (preserveScroll) {
      dom.sideOptions.scrollTop = previousScrollTop;
    }
  }

  function syncTargetSelectionUi(channel = getEditorChannel()) {
    if (!channel) {
      return;
    }

    syncEditorTargetsBody(channel);
    if (isTargetsSidePanelMode()) {
      syncSidePanelSelectionState(channel);
    }
    renderPreviewContent();
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
      renderSidePanel(channel);
      syncEditorRangeFills();
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
    renderSidePanel(null);
    renderPreviewContent();
    dom.previewFrame?.classList.add('is-ready');
    setSourcePreviewState(editorState.sourceHidden);
  }

  function commitEditorTitle() {
    if (!editorState.titleDirty || editorState.entityType !== 'fader') {
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
    editorState.sidePanelOpen = true;
    renderEntityEditor();
    requestTargetsPanelApplicationsRefresh({ force: true });
  }

  function openChannelButtonPanel(buttonId) {
    clearSidePanelCloseTimer();
    editorState.sidePanelClosing = false;
    editorState.sidePanelMode = 'channel-button';
    editorState.sidePanelButtonId = buttonId;
    editorState.sidePanelOpen = true;
    renderEntityEditor();
  }

  function closeTargetsPanel() {
    clearSidePanelCloseTimer();

    if (!isTargetsPanelVisible()) {
      return;
    }

    editorState.sidePanelClosing = true;
    renderEntityEditor();

    editorState.sidePanelCloseTimerId = window.setTimeout(() => {
      editorState.sidePanelCloseTimerId = null;
      editorState.sidePanelOpen = false;
      editorState.sidePanelClosing = false;
      editorState.sidePanelMode = 'targets';
      editorState.sidePanelButtonId = null;
      renderEntityEditor();
    }, ENTITY_EDITOR_SIDE_PANEL_CLOSE_MS);
  }

  function handleMainClick(event) {
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

    if (event.target.closest('[data-editor-remap]')) {
      remapChannelFader?.(editorState.channelId);
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
        removeChannelAppTargetState?.(editorState.channelId, removeTargetButton.dataset.editorRemoveTarget, {
          source: 'entity-editor'
        });
        saveProfileToLocal?.();
        syncTargetSelectionUi(getEditorChannel());
      });
      return;
    }

    const titleIconButton = event.target.closest('[data-editor-toggle-title-icon]');

    if (titleIconButton) {
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

    if (useTargetNameButton) {
      const channel = getEditorChannel();
      const targetProcess = useTargetNameButton.dataset.editorUseTargetName;
      const target = getChannelTargets(channel)
        .map(resolveTargetDisplayEntry)
        .find((entry) => entry.process === targetProcess);

      if (!target) {
        return;
      }

      editorState.previewLayoutTransitionRequested = true;
      window.channelActions?.renameChannel?.(
        editorState.channelId,
        target.name,
        target.name,
        { source: 'entity-editor' }
      );
      editorState.titleDraft = '';
      editorState.titleDirty = false;
      return;
    }

    const buttonPlacementToggle = event.target.closest('[data-editor-button-placement]');

    if (buttonPlacementToggle) {
      editorState.previewLayoutTransitionRequested = true;
      window.channelActions?.setChannelButtonPlacement?.(
        editorState.channelId,
        buttonPlacementToggle.dataset.editorButtonPlacement,
        { source: 'entity-editor' }
      );
      return;
    }

    const toggleButton = event.target.closest('[data-editor-setting-toggle]');

    if (toggleButton) {
      const settingKey = toggleButton.dataset.editorSettingToggle;
      const currentSettings = getEditorCustomSettings(getEditorChannel());
      updateChannelCustomSetting(settingKey, !currentSettings[settingKey]);
      renderEntityEditor();
      return;
    }

    const curveButton = event.target.closest('[data-editor-curve-type]');

    if (curveButton) {
      updateChannelCustomSetting('volumeCurveType', curveButton.dataset.editorCurveType);
      renderEntityEditor();
    }
  }

  function handleMainInput(event) {
    if (event.target.matches('#entityEditTitleInput')) {
      const channel = getEditorChannel();
      editorState.titleDraft = event.target.value;
      editorState.titleDirty = true;

      if (channel) {
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

  function handleMainKeyDown(event) {
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
      editorState.titleDraft = channel?.title || channel?.appName || t('channels.unnamed');
      editorState.titleDirty = false;
      event.target.value = editorState.titleDraft;
      syncPreviewFromChannel(channel);
      event.target.blur();
    }
  }

  function handleSidePanelClick(event) {
    if (event.target.closest('[data-editor-close-targets]')) {
      closeTargetsPanel();
      return;
    }

    if (!isTargetsSidePanelMode()) {
      return;
    }

    const toggleTargetButton = event.target.closest('[data-editor-toggle-target]');

    if (!toggleTargetButton || editorState.entityType !== 'fader') {
      return;
    }

    const channel = getEditorChannel();
    const targetProcess = String(toggleTargetButton.dataset.editorToggleTarget || '').trim();

    if (!channel || !targetProcess) {
      return;
    }

    const selectedTargets = new Set(getChannelTargets(channel).map((target) => target.process));
    const availableApp = (typeof getAvailableAudioApps === 'function'
      ? getAvailableAudioApps()
      : []).find((app) => app.process === targetProcess);

    if (selectedTargets.has(targetProcess)) {
      removeChannelAppTargetState?.(channel.id, targetProcess, {
        source: 'entity-editor'
      });
      saveProfileToLocal?.();
      syncTargetSelectionUi(getEditorChannel());
    } else {
      addChannelAppTargetState?.(channel.id, targetProcess, availableApp?.name || targetProcess, {
        source: 'entity-editor'
      });
      saveProfileToLocal?.();
      syncTargetSelectionUi(getEditorChannel());
      animateEditorTargetChip(targetProcess);
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
      sourceSelector: resolveEntitySourceSelector(payload)
    });

    const channel = getEditorChannel();
    editorState.titleDraft = channel?.title || channel?.appName || t('channels.unnamed');

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
        ) {
          syncTargetSelectionUi(channel);

          if (isTargetsPanelVisible()) {
            syncSidePanelOptions(channel);
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
            renderSidePanel(channel);
          } else if (editorState.sidePanelMode === 'channel-button' && editorState.sidePanelOpen) {
            renderSidePanel(channel);
          }

          if (editorState.previewLayoutTransitionRequested) {
            syncPreviewWithLayoutTransition(channel, renderPreviewContent);
            editorState.previewLayoutTransitionRequested = false;
          } else if (meta?.type === 'channels/button-update') {
            syncPreviewFromChannel(channel);
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

          if (activeTitleInput && document.activeElement !== activeTitleInput) {
            activeTitleInput.value = channel.title || channel.appName || t('channels.unnamed');
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
        renderEntityEditor();
      }
    });

    window.addEventListener('audio-apps-updated', () => {
      if (getCurrentActiveModalId() !== ENTITY_EDITOR_MODAL_ID || editorState.entityType !== 'fader') {
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
    dom.main.addEventListener('focusout', handleMainFocusOut);
    dom.main.addEventListener('keydown', handleMainKeyDown);
    dom.sidePanel?.addEventListener('click', handleSidePanelClick);
    dom.sidePanel?.addEventListener('pointerenter', () => {
      if (editorState.sidePanelOpen) {
        requestTargetsPanelApplicationsRefresh();
      }
    });
    dom.previewMount.addEventListener('pointerdown', startPreviewDrag);

    initEntityEditorStateSync();
    editorState.initialized = true;
  }

  window.refreshEntityEditor = refreshEntityEditor;
  window.openEntityEditor = openEntityEditor;
  window.openChannelEditor = openChannelEditor;
  window.handleEditorAddChannelButton = handleEditorAddChannelButton;
  window.initEntityEditor = initEntityEditor;
})(window);
