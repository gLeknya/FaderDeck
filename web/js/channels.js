let activeFaderDrag = null;
const CHANNEL_VOLUME_PUSH_DELAY_MS = 18;
const CHANNEL_INTERPOLATION_STEPS = 4;
const CHANNEL_INTERPOLATION_STEP_DELAY_MS = 24;
const CHANNEL_PICKUP_FLASH_DURATION_MS = 380;
const channelVolumePushState = new Map();
const channelPickupFlashTimers = new Map();
const channelEntranceAnimatedIds = new Set();
let channelUiStateSyncInitialized = false;
let channelPickupUiInitialized = false;

function getChannels() {
  return typeof getChannelsState === 'function' ? getChannelsState() : [];
}

function getChannelById(channelId) {
  return typeof findChannelState === 'function' ? findChannelState(channelId) : null;
}

function getMixerLayoutItems() {
  return typeof getLayoutItemsByZoneState === 'function'
    ? getLayoutItemsByZoneState(window.LAYOUT_ZONES?.mixer || 'mixer')
    : getChannels().map((channel) => ({
      id: `layout-channel-${channel.id}`,
      type: window.LAYOUT_ITEM_TYPES?.channel || 'channel',
      zone: window.LAYOUT_ZONES?.mixer || 'mixer',
      entityId: channel.id
    }));
}

function getChannelLayoutEditModeEnabled() {
  // Park marker: keep layout ordering support active, but leave editor UI
  // and interaction paths disabled until layout editing is re-enabled later.
  if (window.isLayoutEditorParked?.()) {
    return false;
  }

  return typeof isLayoutEditModeEnabledState === 'function'
    ? isLayoutEditModeEnabledState()
    : false;
}

function getSelectedChannelLayoutItemId() {
  return typeof getSelectedLayoutItemIdState === 'function'
    ? getSelectedLayoutItemIdState()
    : null;
}

function getHoveredChannelLayoutItemId() {
  return typeof getHoveredLayoutItemIdState === 'function'
    ? getHoveredLayoutItemIdState()
    : null;
}

function getDraggedChannelLayoutItemId() {
  return typeof getDraggedLayoutItemIdState === 'function'
    ? getDraggedLayoutItemIdState()
    : null;
}

function getChannelLayoutDropPreview() {
  return typeof getLayoutDropPreviewState === 'function'
    ? getLayoutDropPreviewState()
    : null;
}

function getChannelLayoutItemClassName(layoutItem) {
  const classNames = ['surface-layout-item', 'surface-layout-item--channel'];

  if (window.isLayoutEditorParked?.()) {
    if (layoutItem.type === (window.LAYOUT_ITEM_TYPES?.spacer || 'spacer')) {
      classNames.push('layout-spacer-shell');
    }

    return classNames.join(' ');
  }

  const selectedItemId = getSelectedChannelLayoutItemId();
  const hoveredItemId = getHoveredChannelLayoutItemId();
  const draggedItemId = getDraggedChannelLayoutItemId();
  const dropPreview = getChannelLayoutDropPreview();

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

function getChannelLayoutInteractionAttributes(layoutItem) {
  if (!layoutItem || !getChannelLayoutEditModeEnabled()) {
    return '';
  }

  const zone = layoutItem.zone || window.LAYOUT_ZONES?.mixer || 'mixer';

  return `
    draggable="true"
    ondragstart="startLayoutSurfaceDrag(event, '${layoutItem.id}')"
    ondragend="endLayoutSurfaceDrag(event)"
    ondragover="previewLayoutSurfaceDrop(event, '${zone}', '${layoutItem.id}')"
    ondrop="dropLayoutSurfaceItem(event, '${zone}', '${layoutItem.id}')"
  `;
}

function renderChannelLayoutEditOverlay(layoutItem, labelKey) {
  if (!layoutItem || !getChannelLayoutEditModeEnabled()) {
    return '';
  }

  const isSelected = getSelectedChannelLayoutItemId() === layoutItem.id;
  const isHovered = getHoveredChannelLayoutItemId() === layoutItem.id;

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

function renderChannelLayoutItemActions(layoutItem) {
  if (!layoutItem || !getChannelLayoutEditModeEnabled()) {
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

function renderMixerLayoutInsertControl() {
  if (!getChannelLayoutEditModeEnabled()) {
    return '';
  }

  return `
    <button
      class="layout-zone-insert layout-zone-insert--channel"
      type="button"
      title="${t('layout.addSpacer')}"
      aria-label="${t('layout.addSpacer')}"
      onclick="insertLayoutSpacerIntoZone('${window.LAYOUT_ZONES?.mixer || 'mixer'}')">
      <span class="layout-zone-insert__plus">+</span>
      <span class="layout-zone-insert__label">${t('layout.addSpacer')}</span>
    </button>
  `;
}

function createChannelModel(index) {
  if (typeof createChannelStateModel === 'function') {
    return createChannelStateModel(index);
  }

  return {
    id: Date.now(),
    app: 'master',
    appName: t('audio.systemVolume'),
    title: t('channels.defaultTitle', { index }),
    faderCC: null,
    faderMapping: null,
    volume: 100,
    buttons: [],
    hasBeenConfigured: false,
    skipBinding: false,
    showBindHint: true,
    flashOnCreate: true
  };
}

async function createChannel() {
  return window.channelActions?.createChannel({}, { source: 'ui' })
    || (typeof createChannelState === 'function'
      ? createChannelState({}, { source: 'ui' })
      : createChannelModel(getChannels().length + 1));
}

function removeChannel(channelId) {
  return window.channelActions?.removeChannel(channelId, { source: 'ui' }) || null;
}

function changeChannelApp(channelId, appProcess) {
  return window.channelActions?.setChannelApp(channelId, appProcess, { source: 'ui' }) || null;
}

function editChannelTitle(channelId) {
  window.channelActions?.markChannelConfigured(channelId, { source: 'ui' });
  openChannelEditor?.(channelId);
}

function dismissFaderBindHint(channelId) {
  return window.channelActions?.dismissChannelBindHint(channelId, { source: 'ui' }) || null;
}

function isChannelConfigured(channel) {
  return Boolean(channel?.hasBeenConfigured);
}

function configureChannel(channelId) {
  const channel = getChannelById(channelId);

  if (!channel) {
    return null;
  }

  window.channelActions?.markChannelConfigured(channelId, { source: 'ui' });
  openChannelEditor?.(channelId);
  return channel;
}

function clampVolume(value) {
  const clampedValue = Math.max(0, Math.min(100, Number(value) || 0));

  if (typeof normalizeVolumeValue === 'function') {
    return normalizeVolumeValue(clampedValue);
  }

  return Math.round(clampedValue * 1000) / 1000;
}

function formatChannelVolume(value, channel = null) {
  const channelSettings = channel ? getChannelRuntimeSettings(channel) : {};

  if (typeof formatVolumeValue === 'function') {
    return formatVolumeValue(value, channelSettings);
  }

  return `${clampVolume(value)}%`;
}

function getChannelRuntimeSettings(channel) {
  return typeof resolveChannelFaderSettings === 'function'
    ? resolveChannelFaderSettings(channel)
    : {};
}

function getChannelTargetProcess(channel) {
  const process = String(channel?.app || '').trim();
  return process || null;
}

function getChannelTargetProcesses(channel) {
  const explicitTargets = Array.isArray(channel?.targets)
    ? channel.targets
        .map((target) => String(target?.process || '').trim())
        .filter(Boolean)
    : [];

  if (explicitTargets.length > 0) {
    return [...new Set(explicitTargets)];
  }

  const fallbackProcess = getChannelTargetProcess(channel);
  return fallbackProcess ? [fallbackProcess] : [];
}

function getHudAvailableAudioApps() {
  if (typeof getAvailableAudioApps === 'function') {
    return getAvailableAudioApps();
  }

  return [];
}

function isVolumeHudSelfTarget(target = {}) {
  const processName = String(target?.process || '').trim().toLowerCase();
  const displayName = String(target?.name || '').trim().toLowerCase();
  const applicationPath = String(target?.path || '').trim().toLowerCase();
  const matchesFaderDeck = [processName, displayName, applicationPath].some((value) => value.includes('faderdeck'));
  const matchesDevElectron = processName === 'electron.exe' && displayName.includes('faderdeck');

  return matchesFaderDeck || matchesDevElectron;
}

function getResolvedChannelHudTargets(channel) {
  const availableApps = getHudAvailableAudioApps();
  const explicitTargets = Array.isArray(channel?.targets)
    ? channel.targets
        .map((target) => {
          const process = String(target?.process || '').trim();
          const matchedApp = availableApps.find((application) => application.process === process);

          if (!process) {
            return null;
          }

          return {
            process,
            name: String(target?.name || matchedApp?.name || process).trim() || process,
            path: String(matchedApp?.path || '').trim(),
            iconDataUrl: String(matchedApp?.iconDataUrl || '').trim()
          };
        })
        .filter(Boolean)
        .filter((target) => !isVolumeHudSelfTarget(target))
    : [];

  if (explicitTargets.length > 0) {
    return explicitTargets;
  }

  const fallbackProcess = String(channel?.app || '').trim();

  if (!fallbackProcess) {
    return [];
  }

  const matchedApp = availableApps.find((application) => application.process === fallbackProcess);
  const fallbackTargets = [{
    process: fallbackProcess,
    name: String(channel?.appName || matchedApp?.name || fallbackProcess).trim() || fallbackProcess,
    path: String(matchedApp?.path || '').trim(),
    iconDataUrl: String(matchedApp?.iconDataUrl || '').trim()
  }];

  return fallbackTargets.filter((target) => !isVolumeHudSelfTarget(target));
}

function getChannelHudPrimaryLabel(channel, targets) {
  if (!targets.length) {
    return String(channel?.title || channel?.appName || t('audio.systemVolume')).trim();
  }

  if (targets.length === 1) {
    return targets[0].name;
  }

  return `${targets[0].name} +${targets.length - 1}`;
}

function getVolumeHudPresentationConfig() {
  if (typeof getVolumeHudPresentationSettings === 'function') {
    return getVolumeHudPresentationSettings();
  }

  const uiSettings = typeof getUiSettingsState === 'function'
    ? getUiSettingsState()
    : {};

  return {
    enabled: uiSettings.volumeHudEnabled ?? true,
    position: uiSettings.volumeHudPosition || 'bottom-center',
    orientation: uiSettings.volumeHudOrientation || 'horizontal',
    showIcon: uiSettings.volumeHudShowIcon ?? true,
    showTitle: uiSettings.volumeHudShowTitle ?? true,
    showSubtitle: uiSettings.volumeHudShowSubtitle ?? true,
    showPercent: uiSettings.volumeHudShowPercent ?? true,
    showMeter: uiSettings.volumeHudShowMeter ?? true
  };
}

function buildChannelVolumeHudPayload(channel, meta = {}) {
  if (!channel) {
    return null;
  }

  const presentation = getVolumeHudPresentationConfig();

  if (
    !presentation.enabled
    || (
      !presentation.showIcon
      && !presentation.showTitle
      && !presentation.showSubtitle
      && !presentation.showPercent
      && !presentation.showMeter
    )
  ) {
    return null;
  }

  const targets = getResolvedChannelHudTargets(channel);
  if (!targets.length && isVolumeHudSelfTarget({
    process: channel?.app,
    name: channel?.appName
  })) {
    return null;
  }
  const primaryLabel = getChannelHudPrimaryLabel(channel, targets);
  const channelTitle = String(channel?.title || '').trim();
  const outputVolume = getChannelOutputVolume(channel);

  return {
    channelId: channel.id,
    source: String(meta?.source || 'ui'),
    title: primaryLabel,
    subtitle: channelTitle && channelTitle !== primaryLabel ? channelTitle : '',
    iconDataUrl: targets.length === 1 ? targets[0].iconDataUrl : '',
    volume: outputVolume,
    valueText: formatChannelVolume(outputVolume, channel),
    presentation
  };
}

function emitChannelVolumeHud(channel, meta = {}) {
  const payload = buildChannelVolumeHudPayload(channel, meta);
  const api = typeof getApi === 'function' ? getApi() : window.getNativeApi?.() ?? null;

  if (!payload || !api?.show_volume_hud) {
    return;
  }

  api.show_volume_hud(payload);
}

function getChannelOutputVolume(channel) {
  if (!channel) {
    return 0;
  }

  const channelSettings = getChannelRuntimeSettings(channel);

  if (typeof mapFaderPositionToVolume === 'function') {
    return clampVolume(mapFaderPositionToVolume(channel.volume, channelSettings));
  }

  return clampVolume(channel.volume);
}

function getChannelVolumePushState(channelId) {
  if (!channelVolumePushState.has(channelId)) {
    channelVolumePushState.set(channelId, {
      timerId: null,
      inFlight: false,
      pendingVolume: null,
      lastSentVolume: null
    });
  }

  return channelVolumePushState.get(channelId);
}

function resetChannelVolumePushState(channelId) {
  const state = channelVolumePushState.get(channelId);

  if (state?.timerId) {
    clearTimeout(state.timerId);
  }

  channelVolumePushState.delete(channelId);
}

function pushVolumeToTargets(api, targetProcesses, volume) {
  if (!api?.set_app_volume || !Array.isArray(targetProcesses) || !targetProcesses.length) {
    return Promise.resolve();
  }

  return Promise.all(
    targetProcesses.map((targetProcess) => api.set_app_volume(targetProcess, volume))
  );
}

async function flushChannelVolumePush(channelId) {
  const state = channelVolumePushState.get(channelId);

  if (!state) {
    return;
  }

  state.timerId = null;

  const channel = getChannelById(channelId);

  if (!channel) {
    resetChannelVolumePushState(channelId);
    return;
  }

  const volumeToSend = state.pendingVolume;

  if (volumeToSend === null) {
    return;
  }

  state.pendingVolume = null;
  state.inFlight = true;

  try {
    const api = typeof getApi === 'function' ? getApi() : window.getNativeApi?.() ?? null;
    const channelSettings = getChannelRuntimeSettings(channel);
    const targetProcesses = getChannelTargetProcesses(channel);

    if (!targetProcesses.length || !api?.set_app_volume) {
      return;
    }

    const shouldInterpolate = (
      channelSettings.faderInterpolationEnabled
      && state.lastSentVolume !== null
      && Math.abs(volumeToSend - state.lastSentVolume) > 1
    );

    if (shouldInterpolate) {
      const startVolume = state.lastSentVolume;

      for (let step = 1; step <= CHANNEL_INTERPOLATION_STEPS; step += 1) {
        const interpolatedVolume = clampVolume(
          startVolume + ((volumeToSend - startVolume) * (step / CHANNEL_INTERPOLATION_STEPS))
        );

        await pushVolumeToTargets(api, targetProcesses, interpolatedVolume);
        state.lastSentVolume = interpolatedVolume;

        if (step < CHANNEL_INTERPOLATION_STEPS) {
          await new Promise((resolve) => setTimeout(resolve, CHANNEL_INTERPOLATION_STEP_DELAY_MS));
        }
      }
    } else {
      await pushVolumeToTargets(api, targetProcesses, volumeToSend);
      state.lastSentVolume = volumeToSend;
    }
  } catch (error) {
    console.error('set_app_volume error', error);
  } finally {
    state.inFlight = false;

    if (state.pendingVolume !== null) {
      state.timerId = setTimeout(() => {
        flushChannelVolumePush(channelId);
      }, CHANNEL_VOLUME_PUSH_DELAY_MS);
    }
  }
}

function queueChannelVolumePush(channel) {
  const state = getChannelVolumePushState(channel.id);
  const nextVolume = getChannelOutputVolume(channel);

  if (state.pendingVolume === nextVolume) {
    return;
  }

  if (!state.inFlight && !state.timerId && state.lastSentVolume === nextVolume) {
    return;
  }

  state.pendingVolume = nextVolume;

  if (state.inFlight || state.timerId) {
    return;
  }

  state.timerId = setTimeout(() => {
    flushChannelVolumePush(channel.id);
  }, CHANNEL_VOLUME_PUSH_DELAY_MS);
}

function applyVolumeToChannel(channelId, volume, meta = {}) {
  return window.channelActions?.setChannelVolume(channelId, volume, { source: 'ui', ...meta }) || null;
}

function getVolumeFromPointer(track, clientY) {
  const rect = track.getBoundingClientRect();
  const offsetY = clientY - rect.top;
  const volume = ((rect.height - offsetY) / rect.height) * 100;
  return clampVolume(volume);
}

function startFaderDrag(event) {
  const track = event.target.closest('.fader-track');

  if (!track) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  activeFaderDrag = {
    channelId: Number.parseInt(track.dataset.channel, 10),
    track
  };
  activeFaderDrag.track.classList.add('is-dragging');

  applyVolumeToChannel(activeFaderDrag.channelId, getVolumeFromPointer(track, event.clientY));
}

function handleFaderDrag(event) {
  if (!activeFaderDrag) {
    return;
  }

  applyVolumeToChannel(
    activeFaderDrag.channelId,
    getVolumeFromPointer(activeFaderDrag.track, event.clientY)
  );
}

function stopFaderDrag() {
  if (!activeFaderDrag) {
    return;
  }

  activeFaderDrag.track?.classList.remove('is-dragging');
  activeFaderDrag = null;
  window.profileActions?.saveRendererProfileToLocal?.();
}

function setupFaderDrag() {
  if (setupFaderDrag.initialized) {
    return;
  }

  document.addEventListener('mousedown', (event) => {
    if (!event.target.closest('.fader-track')) {
      return;
    }

    startFaderDrag(event);
  });

  document.addEventListener('mousemove', handleFaderDrag);
  document.addEventListener('mouseup', stopFaderDrag);
  setupFaderDrag.initialized = true;
}

function updateChannelFaderUi(channel) {
  const track = document.querySelector(`.fader-track[data-channel="${channel.id}"]`);

  if (!track) {
    return;
  }

  const thumb = track.querySelector('.fader-thumb');
  const fill = track.querySelector('.fader-fill');
  const strip = track.closest('.channel-strip');
  const value = strip?.querySelector('.volume-value');

  if (!thumb || !fill || !value) {
    return;
  }

  const outputVolume = getChannelOutputVolume(channel);
  const channelSettings = getChannelRuntimeSettings(channel);
  thumb.style.bottom = `calc(${channel.volume}% - 25px)`;
  fill.style.height = `${channel.volume}%`;
  value.textContent = formatVolumeValue(outputVolume, channelSettings);
}

function updateFadersFromState() {
  getChannels().forEach(updateChannelFaderUi);
}

function refreshChannelOutputVolumes() {
  getChannels().forEach((channel) => {
    updateChannelFaderUi(channel);
    queueChannelVolumePush(channel);
  });
}

function triggerChannelPickupFlash(channelId) {
  const channelElement = document.querySelector(`.channel-strip[data-channel-id="${channelId}"]`);

  if (!channelElement) {
    return;
  }

  const previousTimerId = channelPickupFlashTimers.get(channelId);

  if (previousTimerId) {
    clearTimeout(previousTimerId);
  }

  channelElement.classList.remove('pickup-success');
  void channelElement.offsetWidth;
  channelElement.classList.add('pickup-success');

  const timerId = setTimeout(() => {
    channelElement.classList.remove('pickup-success');
    channelPickupFlashTimers.delete(channelId);
  }, CHANNEL_PICKUP_FLASH_DURATION_MS);

  channelPickupFlashTimers.set(channelId, timerId);
}

function setupChannelPickupUi() {
  if (channelPickupUiInitialized) {
    return;
  }

  window.addEventListener('midi:pickup', (event) => {
    triggerChannelPickupFlash(event.detail?.channelId);
  });

  channelPickupUiInitialized = true;
}

function getFaderMappingLabel(mapping) {
  if (!mapping) {
    return '';
  }

  const mappingType = mapping.type === 'pitchwheel' ? 'pitch_bend' : mapping.type;
  const displayChannel = (Number(mapping.channel) || 0) + 1;

  if (mappingType === 'control_change') {
    return t('channels.advancedControlChange', { control: mapping.control });
  }

  if (mappingType === 'control_change_14bit') {
    return t('channels.advancedControlChange14Bit', { control: mapping.control });
  }

  if (mappingType === 'nrpn') {
    return t('channels.advancedNrpn', {
      channel: displayChannel,
      parameterMsb: mapping.parameterMsb,
      parameterLsb: mapping.parameterLsb
    });
  }

  if (mappingType === 'rpn') {
    return t('channels.advancedRpn', {
      channel: displayChannel,
      parameterMsb: mapping.parameterMsb,
      parameterLsb: mapping.parameterLsb
    });
  }

  return t('channels.advancedPitchBend', { channel: displayChannel });
}

function renderAppOptions(selectedProcess) {
  const availableApps = typeof getAvailableAudioApps === 'function'
    ? getAvailableAudioApps()
    : [];
  const placeholderOption = !selectedProcess
    ? `<option value="" selected>${t('editor.noTargetAssigned')}</option>`
    : '';

  return `${placeholderOption}${availableApps
    .map((app) => `
      <option value="${app.process}" ${app.process === selectedProcess ? 'selected' : ''}>
        ${app.name}
      </option>
    `)
    .join('')}`;
}

function renderChannelButtonSlot(channel, button) {
  const className = typeof window.getChannelButtonClassName === 'function'
    ? window.getChannelButtonClassName(channel, button)
    : `channel-side-button ${button.active ? 'active' : ''}`;
  const bodyMarkup = typeof window.renderChannelButtonBodyMarkup === 'function'
    ? window.renderChannelButtonBodyMarkup(channel, button)
    : `
      <span class="channel-button-face">
        <span class="channel-button-main">
          <span class="button-icon">${button.icon}</span>
          <span class="button-label">${button.text}</span>
        </span>
      </span>
    `;

  return `
    <button class="${className}"
            type="button"
            data-channel-id="${channel.id}"
            data-button-id="${button.id}"
            onclick="toggleButton(${channel.id}, ${button.id})"
            ondblclick="configureButton(${channel.id}, ${button.id})">
      ${bodyMarkup}
    </button>
  `;
}

function getVisibleChannelButtons(channel) {
  return (Array.isArray(channel?.buttons) ? channel.buttons : []).slice(0, MAX_CHANNEL_BUTTONS);
}

function escapeChannelMarkup(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveChannelTitleIconTarget(channel) {
  if (!channel?.showTargetIconInTitle) {
    return null;
  }

  const availableApps = getHudAvailableAudioApps();
  const requestedProcess = String(channel?.titleIconTargetProcess || '').trim();
  const explicitTargets = Array.isArray(channel?.targets)
    ? channel.targets
        .map((target) => {
          const process = String(target?.process || '').trim();
          const matchedApp = availableApps.find((application) => application.process === process);

          if (!process) {
            return null;
          }

          return {
            process,
            name: String(target?.name || matchedApp?.name || process).trim() || process,
            iconDataUrl: String(matchedApp?.iconDataUrl || '').trim()
          };
        })
        .filter(Boolean)
    : [];

  const fallbackProcess = requestedProcess || explicitTargets[0]?.process || String(channel?.app || '').trim();

  if (!fallbackProcess) {
    return null;
  }

  return explicitTargets.find((target) => target.process === fallbackProcess)
    || getResolvedChannelHudTargets(channel).find((target) => target.process === fallbackProcess)
    || null;
}

function renderChannelTitleMarkup(channel, title) {
  const titleIconTarget = resolveChannelTitleIconTarget(channel);

  if (!titleIconTarget) {
    return `<span class="channel-title-text">${title}</span>`;
  }

  const iconLabel = String(titleIconTarget.name || titleIconTarget.process || '')
    .trim()
    .charAt(0)
    .toUpperCase() || 'A';
  const iconMarkup = titleIconTarget.iconDataUrl
    ? `<span class="channel-title-icon has-image"><img class="channel-title-icon-image" src="${escapeChannelMarkup(titleIconTarget.iconDataUrl)}" alt="${escapeChannelMarkup(titleIconTarget.name || titleIconTarget.process || 'App')}"></span>`
    : `<span class="channel-title-icon">${iconLabel}</span>`;

  return `
    <span class="channel-title-inner has-icon">
      ${iconMarkup}
      <span class="channel-title-text">${title}</span>
    </span>
  `;
}

function getChannelButtonLayoutMode(channel) {
  const buttonCount = getVisibleChannelButtons(channel).length;

  if (buttonCount >= 3) {
    return 'side';
  }

  if (buttonCount >= 1) {
    return channel?.buttonPlacement === 'side' ? 'side' : 'inline';
  }

  return 'none';
}

function renderChannelButtons(channel, options = {}) {
  const buttons = getVisibleChannelButtons(channel);

  if (!buttons.length) {
    return '';
  }

  const layoutMode = options.layoutMode || getChannelButtonLayoutMode(channel);
  const className = options.className || '';

  return `
    <div class="channel-buttons-grid channel-buttons-grid--${layoutMode} channel-buttons-grid--count-${buttons.length}${className ? ` ${className}` : ''}">
      ${buttons.map((button) => renderChannelButtonSlot(channel, button)).join('')}
    </div>
  `;
}

function renderBindHint(channel) {
  return '';
}

function renderChannelConfigureButton(channel) {
  if (!channel || isChannelConfigured(channel)) {
    return '';
  }

  return `
    <div class="channel-configure-shell" data-channel-configure-shell-id="${channel.id}">
      <button
        class="btn channel-configure-button"
        type="button"
        data-channel-configure-id="${channel.id}"
        onclick="configureChannel(${channel.id})">
        ${t('channels.configure')}
      </button>
    </div>
  `;
}

function renderAddChannelStrip(options = {}) {
  const layoutEditModeEnabled = getChannelLayoutEditModeEnabled();
  const emptyState = Boolean(options.emptyState);

  return `
    <div class="add-channel-strip ${emptyState ? 'add-channel-strip--empty' : ''} ${layoutEditModeEnabled ? 'is-disabled' : ''}" ${layoutEditModeEnabled ? '' : 'onclick="createChannel()"'} >
      <div class="add-channel-plus">+</div>
    </div>
  `;
}

function renderMixerSpacer(layoutItem) {
  return `
    <div
      class="${getChannelLayoutItemClassName(layoutItem)}"
      data-layout-item-id="${layoutItem.id}"
      data-layout-item-type="${layoutItem.type}"
      data-layout-zone="${layoutItem.zone || window.LAYOUT_ZONES?.mixer || 'mixer'}"
      ${getChannelLayoutInteractionAttributes(layoutItem)}>
      <div class="layout-spacer layout-spacer--channel" data-layout-spacer-size="${layoutItem.size || 1}"></div>
      ${renderChannelLayoutEditOverlay(layoutItem, 'layout.itemTypes.spacer')}
      ${renderChannelLayoutItemActions(layoutItem)}
    </div>
  `;
}

function renderChannel(channel, layoutItem = null) {
  const title = channel.title || channel.appName || t('channels.unnamed');
  const mappingLabel = getAdvancedModeEnabled?.()
    ? getFaderMappingLabel(channel.faderMapping)
    : '';
  const outputVolume = getChannelOutputVolume(channel);
  const resolvedLayoutItem = layoutItem || {
    id: `layout-channel-${channel.id}`,
    type: window.LAYOUT_ITEM_TYPES?.channel || 'channel',
    entityId: channel.id
  };

  const channelButtonLayoutMode = getChannelButtonLayoutMode(channel);
  const inlineButtonsMarkup = channelButtonLayoutMode === 'inline'
    ? renderChannelButtons(channel, { layoutMode: 'inline' })
    : '';
  const sideButtonsMarkup = channelButtonLayoutMode === 'side'
    ? renderChannelButtons(channel, { layoutMode: 'side' })
    : '';
  const volumeValueMarkup = `<div class="volume-value">${formatChannelVolume(outputVolume, channel)}</div>`;

  return `
    <div
      class="${getChannelLayoutItemClassName(resolvedLayoutItem)}"
      data-layout-item-id="${resolvedLayoutItem.id}"
      data-layout-item-type="${resolvedLayoutItem.type}"
      data-layout-zone="${resolvedLayoutItem.zone || window.LAYOUT_ZONES?.mixer || 'mixer'}"
      ${getChannelLayoutInteractionAttributes(resolvedLayoutItem)}>
      <div class="channel-strip channel-strip--${channelButtonLayoutMode}" data-channel-id="${channel.id}">
        <div class="channel-body">
          <div class="channel-title" title="${title}" ondblclick="editChannelTitle(${channel.id})">
            ${renderChannelTitleMarkup(channel, title)}
          </div>

          ${mappingLabel ? `<div class="fader-meta">${mappingLabel}</div>` : ''}

          <div class="channel-main channel-main--${channelButtonLayoutMode}">
            <div class="channel-primary-column">
              <div class="fader-column">
                <div class="fader-track" data-channel="${channel.id}">
                  <div class="fader-rail"></div>
                  <div class="fader-fill" style="height: ${channel.volume}%"></div>
                  <div class="fader-thumb" style="bottom: calc(${channel.volume}% - 25px)"></div>
                </div>
              </div>

              ${channelButtonLayoutMode === 'side'
                ? ''
                : `
                  <div class="channel-inline-footer">
                    ${volumeValueMarkup}
                    ${inlineButtonsMarkup}
                  </div>
                `}
            </div>

            ${sideButtonsMarkup
              ? `
                <div class="channel-secondary-column">
                  ${sideButtonsMarkup}
                  ${volumeValueMarkup}
                </div>
              `
              : ''}
          </div>
        </div>
      </div>
      ${renderChannelConfigureButton(channel)}
      ${renderChannelLayoutEditOverlay(resolvedLayoutItem, 'layout.itemTypes.channel')}
      ${renderChannelLayoutItemActions(resolvedLayoutItem)}
    </div>
  `;
}

function syncAddChannelStripHeight(container) {
  const firstChannel = container.querySelector('.channel-strip');
  const addStrip = container.querySelector('.add-channel-strip');

  if (firstChannel && addStrip) {
    addStrip.style.height = `${firstChannel.offsetHeight}px`;
  }
}

function triggerNewChannelFlash(container) {
  getChannels().forEach((channel) => {
    if (!channel.flashOnCreate || channelEntranceAnimatedIds.has(channel.id)) {
      return;
    }

    const channelElement = container.querySelector(
      `.channel-strip[data-channel-id="${channel.id}"]`
    );
    const configureShellElement = container.querySelector(
      `[data-channel-configure-shell-id="${channel.id}"]`
    );

    if (!channelElement) {
      return;
    }

    channelEntranceAnimatedIds.add(channel.id);
    channelElement.classList.add('flash');
    configureShellElement?.classList.add('is-entering');

    setTimeout(() => {
      channelElement.classList.remove('flash');
      configureShellElement?.classList.remove('is-entering');
      clearChannelFlashState?.(channel.id, { source: 'render' });
    }, 460);
  });
}

function renderMixer() {
  const container = document.getElementById('mixerContainer');
  const channels = getChannels();
  const layoutItems = getMixerLayoutItems();
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));

  if (!container) {
    return;
  }

  if (channels.length === 0 && layoutItems.length === 0) {
    container.innerHTML = `
      ${renderMixerLayoutInsertControl()}
      ${renderAddChannelStrip({ emptyState: true })}
    `;
    scheduleContentMetricsUpdate();
    return;
  }

  container.innerHTML = `
    ${layoutItems.map((layoutItem) => {
      if (layoutItem.type === (window.LAYOUT_ITEM_TYPES?.spacer || 'spacer')) {
        return renderMixerSpacer(layoutItem);
      }

      const channel = channelsById.get(layoutItem.entityId);
      return channel ? renderChannel(channel, layoutItem) : '';
    }).join('')}
    ${renderMixerLayoutInsertControl()}
    ${renderAddChannelStrip()}
  `;

  setupFaderDrag();
  setupChannelPickupUi();
  enhanceCustomSelects?.(container);
  triggerNewChannelFlash(container);
  syncAddChannelStripHeight(container);
  scheduleContentMetricsUpdate();
}

function initChannelUiStateSync() {
  if (channelUiStateSyncInitialized || typeof subscribeAppState !== 'function') {
    return;
  }

  subscribeAppState((nextState, previousState, meta = {}) => {
    const channelsChanged = nextState.channels !== previousState.channels;
    const layoutChanged = nextState.layout !== previousState.layout;
    const layoutEditorChanged = !window.isLayoutEditorParked?.()
      && nextState.layoutEditor !== previousState.layoutEditor;

    if (!channelsChanged && !layoutChanged && !layoutEditorChanged) {
      return;
    }

    if (channelsChanged && !layoutChanged && !layoutEditorChanged && meta.type === 'channels/set-volume') {
      const channel = getChannelById(meta.channelId);

      if (channel) {
        updateChannelFaderUi(channel);
      }

      return;
    }

    if (channelsChanged && !layoutChanged && !layoutEditorChanged && meta.type === 'channels/clear-flash') {
      return;
    }

    renderMixer();
  });

  channelUiStateSyncInitialized = true;
}

window.applyChannelVolumeRuntime = function applyChannelVolumeRuntime(channelId, volume, meta = {}) {
  return applyVolumeToChannel(channelId, volume, { source: 'midi-runtime', ...meta });
};
window.createChannel = createChannel;
window.queueChannelVolumePushRuntime = queueChannelVolumePush;
window.resetChannelVolumePushRuntime = resetChannelVolumePushState;
window.emitChannelVolumeHudRuntime = emitChannelVolumeHud;
window.configureChannel = configureChannel;
