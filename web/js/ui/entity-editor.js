(function initEntityEditorModule(window) {
  const ENTITY_EDITOR_MODAL_ID = 'entity-edit';
  const ENTITY_EDITOR_CLOSE_MS = 240;
  const ENTITY_EDITOR_SIDE_PANEL_CLOSE_MS = 220;
  const ENTITY_EDITOR_PREVIEW_MOVE_MS = 250;
  const ENTITY_EDITOR_SCROLLBAR_HIDE_MS = 1500;

  const dom = {};
  const scrollControllers = {
    main: null,
    side: null
  };
  let editorScrollSyncFrame = null;
  let editorScrollSyncTimeoutId = null;
  const editorState = {
    initialized: false,
    entityType: null,
    channelId: null,
    buttonId: null,
    standalone: false,
    sourceSelector: '',
    sidePanelOpen: false,
    sidePanelClosing: false,
    sidePanelCloseTimerId: null,
    titleDraft: '',
    titleDirty: false,
    previewTimerId: null,
    previewDrag: null,
    previewDragFrameId: null,
    sourceHidden: false
  };

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
    dom.mainScrollBar = $('entityEditMainScrollBar');
    dom.mainScrollTrack = $('entityEditMainScrollTrack');
    dom.mainScrollThumb = $('entityEditMainScrollThumb');
    dom.sidePanel = $('entityEditSidePanel');
    dom.sideOptions = null;
    dom.sideScrollBar = null;
    dom.sideScrollTrack = null;
    dom.sideScrollThumb = null;
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

  function clearEditorScrollSyncFrame() {
    if (editorScrollSyncFrame) {
      cancelAnimationFrame(editorScrollSyncFrame);
      editorScrollSyncFrame = null;
    }

    if (editorScrollSyncTimeoutId) {
      clearTimeout(editorScrollSyncTimeoutId);
      editorScrollSyncTimeoutId = null;
    }

    scrollControllers.main?.cancelSync?.();
    scrollControllers.side?.cancelSync?.();
  }

  function clearSidePanelCloseTimer() {
    if (!editorState.sidePanelCloseTimerId) {
      return;
    }

    clearTimeout(editorState.sidePanelCloseTimerId);
    editorState.sidePanelCloseTimerId = null;
  }

  function requestTargetsPanelApplicationsRefresh(options = {}) {
    if (!editorState.sidePanelOpen && !editorState.sidePanelClosing) {
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

  function clearEditorScrollbarHideTimer(area) {
    scrollControllers[area]?.clearActivity?.();
  }

  function showEditorScrollbarForActivity(area) {
    scrollControllers[area]?.showForActivity?.();
  }

  function scheduleEditorScrollSync() {
    scrollControllers.main?.scheduleSync?.();
    scrollControllers.side?.scheduleSync?.();

    if (editorScrollSyncFrame) {
      cancelAnimationFrame(editorScrollSyncFrame);
    }

    if (editorScrollSyncTimeoutId) {
      clearTimeout(editorScrollSyncTimeoutId);
    }

    editorScrollSyncFrame = requestAnimationFrame(() => {
      editorScrollSyncFrame = null;
      scrollControllers.main?.scheduleSync?.();
      scrollControllers.side?.scheduleSync?.();
      requestAnimationFrame(() => {
        scrollControllers.main?.scheduleSync?.();
        scrollControllers.side?.scheduleSync?.();
      });
    });

    editorScrollSyncTimeoutId = window.setTimeout(() => {
      editorScrollSyncTimeoutId = null;
      scrollControllers.main?.scheduleSync?.();
      scrollControllers.side?.scheduleSync?.();
    }, ENTITY_EDITOR_SIDE_PANEL_CLOSE_MS + 40);
  }

  function setupEditorScrollbars() {
    if (scrollControllers.main || typeof createAppScrollbar !== 'function') {
      return;
    }

    scrollControllers.main = createAppScrollbar({
      orientation: 'vertical',
      alwaysVisible: true,
      hideDelay: ENTITY_EDITOR_SCROLLBAR_HIDE_MS,
      getScroller: () => dom.main,
      getScrollbar: () => dom.mainScrollBar,
      getTrack: () => dom.mainScrollTrack,
      getThumb: () => dom.mainScrollThumb
    });

    scrollControllers.side = createAppScrollbar({
      orientation: 'vertical',
      alwaysVisible: true,
      hideDelay: ENTITY_EDITOR_SCROLLBAR_HIDE_MS,
      getScroller: () => dom.sideOptions,
      getScrollbar: () => dom.sideScrollBar,
      getTrack: () => dom.sideScrollTrack,
      getThumb: () => dom.sideScrollThumb,
      getEnabled: () => Boolean(editorState.sidePanelOpen || editorState.sidePanelClosing)
    });
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

  function getPreviewTargetLabel(channel) {
    const targets = getChannelTargets(channel);

    if (!targets.length) {
      return t('editor.noTargetAssigned');
    }

    if (targets.length === 1) {
      return targets[0].name;
    }

    return `${targets[0].name} +${targets.length - 1}`;
  }

  function renderPreviewButtonSlot(button) {
    if (!button) {
      return `
        <div class="channel-side-button channel-side-button-add entity-edit-preview-button">
          <span class="button-icon">+</span>
          <span class="button-label">${t('channels.addButton')}</span>
        </div>
      `;
    }

    return `
      <div class="channel-side-button ${button.active ? 'active' : ''} entity-edit-preview-button">
        <span class="button-icon">${escapeHtml(button.icon)}</span>
        <span class="button-label">${escapeHtml(button.text)}</span>
      </div>
    `;
  }

  function renderPreviewButtons(channel) {
    const slots = [];

    for (let index = 0; index < 4; index += 1) {
      slots.push(renderPreviewButtonSlot(channel?.buttons?.[index] || null));
    }

    return slots.join('');
  }

  function renderFaderPreview(channel) {
    const title = editorState.titleDraft || channel?.title || channel?.appName || t('channels.unnamed');
    const outputVolume = typeof mapFaderPositionToVolume === 'function'
      ? mapFaderPositionToVolume(channel.volume, getEditorChannelResolvedSettings(channel))
      : channel.volume;
    const mappingLabel = getPreviewMappingLabel(channel);

    return `
      <div class="channel-strip entity-edit-preview-channel" data-preview-channel-id="${channel.id}">
        <div class="channel-body">
          <div class="channel-main">
            <div class="fader-column">
              <div class="fader-track entity-edit-preview-track" data-preview-track data-preview-channel-id="${channel.id}">
                <div class="fader-rail"></div>
                <div class="fader-fill" style="height: ${channel.volume}%"></div>
                <div class="fader-thumb" style="bottom: calc(${channel.volume}% - 25px)"></div>
              </div>
            </div>

            <div class="channel-side-column">
              <div class="channel-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
              ${mappingLabel ? `<div class="fader-meta">${escapeHtml(mappingLabel)}</div>` : '<div class="fader-meta"></div>'}
              <div class="channel-buttons-grid">${renderPreviewButtons(channel)}</div>
              <div class="volume-value">${formatVolumeValue(outputVolume, getEditorChannelResolvedSettings(channel))}</div>
            </div>
          </div>

          <div class="entity-edit-preview-target-pill">${escapeHtml(getPreviewTargetLabel(channel))}</div>
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
    const targetPill = previewRoot.querySelector('.entity-edit-preview-target-pill');
    const mappingLabel = getPreviewMappingLabel(channel);
    const outputVolume = typeof mapFaderPositionToVolume === 'function'
      ? mapFaderPositionToVolume(channel.volume, getEditorChannelResolvedSettings(channel))
      : channel.volume;

    if (titleElement) {
      titleElement.textContent = title;
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

    if (targetPill) {
      targetPill.textContent = getPreviewTargetLabel(channel);
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
    clearEditorScrollSyncFrame();
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

          <div class="app-scrollbar app-scrollbar--vertical entity-edit-scrollbar entity-edit-scrollbar-side hidden" id="entityEditSideScrollBar" aria-hidden="true">
            <div class="app-scrollbar-track" id="entityEditSideScrollTrack">
              <div class="app-scrollbar-thumb" id="entityEditSideScrollThumb"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    dom.sideOptions = $('entityEditSideOptions');
    dom.sideScrollBar = $('entityEditSideScrollBar');
    dom.sideScrollTrack = $('entityEditSideScrollTrack');
    dom.sideScrollThumb = $('entityEditSideScrollThumb');
  }

  function syncEditorTargetsBody(channel = getEditorChannel()) {
    const targetsBody = dom.main?.querySelector('[data-editor-targets-body]');

    if (!targetsBody) {
      return;
    }

    targetsBody.innerHTML = renderEditorTargets(channel);
  }

  function syncSidePanelSelectionState(channel = getEditorChannel()) {
    if (!dom.sideOptions) {
      return;
    }

    const selectedTargets = new Set(getChannelTargets(channel).map((target) => target.process));

    dom.sideOptions.querySelectorAll('[data-editor-toggle-target]').forEach((option) => {
      option.classList.toggle('active', selectedTargets.has(option.dataset.editorToggleTarget));
    });
  }

  function syncSidePanelOptions(channel = getEditorChannel(), { preserveScroll = true } = {}) {
    if (!dom.sideOptions) {
      return;
    }

    const previousScrollTop = preserveScroll ? dom.sideOptions.scrollTop : 0;
    dom.sideOptions.innerHTML = renderSidePanelOptions(channel);

    if (preserveScroll) {
      dom.sideOptions.scrollTop = previousScrollTop;
    }

    scheduleEditorScrollSync();
  }

  function syncTargetSelectionUi(channel = getEditorChannel()) {
    if (!channel) {
      return;
    }

    syncEditorTargetsBody(channel);
    syncSidePanelSelectionState(channel);
    syncPreviewFromChannel(channel);
    showEditorScrollbarForActivity('main');
    showEditorScrollbarForActivity('side');
    scheduleEditorScrollSync();
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

      if (!channel) {
        dom.main.innerHTML = '';
        renderSidePanel(null);
        return;
      }

      dom.main.innerHTML = renderFaderEditor(channel);
      renderSidePanel(channel);
      syncEditorRangeFills();
      syncPreviewFromChannel(channel);
      dom.previewFrame?.classList.add('is-ready');
      setSourcePreviewState(editorState.sourceHidden);
      scheduleEditorScrollSync();
      requestAnimationFrame(() => {
        showEditorScrollbarForActivity('main');

        if (editorState.sidePanelOpen || editorState.sidePanelClosing) {
          showEditorScrollbarForActivity('side');
        }
      });
      return;
    }

    dom.main.innerHTML = renderButtonEditor();
    renderSidePanel(null);
    renderPreviewContent();
    dom.previewFrame?.classList.add('is-ready');
    setSourcePreviewState(editorState.sourceHidden);
    scheduleEditorScrollSync();
    requestAnimationFrame(() => {
      showEditorScrollbarForActivity('main');
    });
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
    editorState.sidePanelOpen = true;
    renderEntityEditor();
    scheduleEditorScrollSync();
    requestAnimationFrame(() => {
      showEditorScrollbarForActivity('side');
      scheduleEditorScrollSync();
    });
    requestTargetsPanelApplicationsRefresh({ force: true });
  }

  function closeTargetsPanel() {
    clearSidePanelCloseTimer();

    if (!editorState.sidePanelOpen && !editorState.sidePanelClosing) {
      return;
    }

    editorState.sidePanelClosing = true;
    renderEntityEditor();
    scheduleEditorScrollSync();

    editorState.sidePanelCloseTimerId = window.setTimeout(() => {
      editorState.sidePanelCloseTimerId = null;
      editorState.sidePanelOpen = false;
      editorState.sidePanelClosing = false;
      renderEntityEditor();
    }, ENTITY_EDITOR_SIDE_PANEL_CLOSE_MS);
  }

  function handleMainClick(event) {
    if (event.target.closest('[data-editor-open-targets]')) {
      openTargetsPanel();
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
        showEditorScrollbarForActivity('main');
        scheduleEditorScrollSync();
      });
      return;
    }

    const removeTargetButton = event.target.closest('[data-editor-remove-target]');

    if (removeTargetButton) {
      removeChannelAppTargetState?.(editorState.channelId, removeTargetButton.dataset.editorRemoveTarget, {
        source: 'entity-editor'
      });
      saveProfileToLocal?.();
      syncTargetSelectionUi(getEditorChannel());
      return;
    }

    const toggleButton = event.target.closest('[data-editor-setting-toggle]');

    if (toggleButton) {
      const settingKey = toggleButton.dataset.editorSettingToggle;
      const currentSettings = getEditorCustomSettings(getEditorChannel());
      updateChannelCustomSetting(settingKey, !currentSettings[settingKey]);
      renderEntityEditor();
      showEditorScrollbarForActivity('main');
      return;
    }

    const curveButton = event.target.closest('[data-editor-curve-type]');

    if (curveButton) {
      updateChannelCustomSetting('volumeCurveType', curveButton.dataset.editorCurveType);
      renderEntityEditor();
      showEditorScrollbarForActivity('main');
    }
  }

  function handleMainInput(event) {
    if (event.target.matches('#entityEditTitleInput')) {
      editorState.titleDraft = event.target.value;
      editorState.titleDirty = true;
      syncPreviewFromChannel(getEditorChannel());
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
    if (!event.target.matches('#entityEditTitleInput')) {
      return;
    }

    commitEditorTitle();
  }

  function handleMainKeyDown(event) {
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
    clearEditorScrollbarHideTimer('main');
    clearEditorScrollbarHideTimer('side');
    clearSidePanelCloseTimer();

    editorState.entityType = payload.entityType || 'fader';
    editorState.channelId = payload.channelId ?? null;
    editorState.buttonId = payload.buttonId ?? null;
    editorState.standalone = Boolean(payload.standalone);
    editorState.sourceSelector = resolveEntitySourceSelector(payload);
    editorState.sidePanelOpen = false;
    editorState.sidePanelClosing = false;
    editorState.titleDirty = false;
    editorState.previewDrag = null;
    editorState.sourceHidden = false;

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
    clearEditorScrollbarHideTimer('main');
    clearEditorScrollbarHideTimer('side');
    clearSidePanelCloseTimer();

    editorState.entityType = null;
    editorState.channelId = null;
    editorState.buttonId = null;
    editorState.standalone = false;
    editorState.sourceSelector = '';
    editorState.sidePanelOpen = false;
    editorState.sidePanelClosing = false;
    editorState.titleDraft = '';
    editorState.titleDirty = false;
    editorState.previewDragFrameId = null;
    editorState.sourceHidden = false;

    if (dom.main) {
      dom.main.innerHTML = '';
    }

    if (dom.sidePanel) {
      dom.sidePanel.innerHTML = '';
      dom.sidePanel.classList.remove('is-open');
    }

    dom.mainScrollBar?.classList.add('hidden');
    dom.mainScrollBar?.classList.remove('is-active');

    dom.sideOptions = null;
    dom.sideScrollBar = null;
    dom.sideScrollTrack = null;
    dom.sideScrollThumb = null;

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
          meta?.type === 'channels/add-app-target'
          || meta?.type === 'channels/remove-app-target'
          || meta?.type === 'channels/clear-app'
          || meta?.type === 'channels/set-app'
        ) {
          syncTargetSelectionUi(channel);

          if (editorState.sidePanelOpen || editorState.sidePanelClosing) {
            syncSidePanelOptions(channel);
          }

          return;
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

      if (editorState.sidePanelOpen || editorState.sidePanelClosing) {
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
    setupEditorScrollbars();

    initEntityEditorStateSync();
    editorState.initialized = true;
  }

  window.refreshEntityEditor = refreshEntityEditor;
  window.openEntityEditor = openEntityEditor;
  window.openChannelEditor = openChannelEditor;
  window.initEntityEditor = initEntityEditor;
})(window);
