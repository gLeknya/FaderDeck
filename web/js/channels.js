let activeFaderDrag = null;
const CHANNEL_VOLUME_PUSH_DELAY_MS = 18;
const CHANNEL_INTERPOLATION_STEPS = 4;
const CHANNEL_INTERPOLATION_STEP_DELAY_MS = 24;
const CHANNEL_PICKUP_FLASH_DURATION_MS = 380;
const channelVolumePushState = new Map();
const channelPickupFlashTimers = new Map();
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
  openChannelEditor?.(channelId);
}

function dismissFaderBindHint(channelId) {
  return window.channelActions?.dismissChannelBindHint(channelId, { source: 'ui' }) || null;
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
  const api = typeof getApi === 'function' ? getApi() : window.pywebview?.api ?? null;

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
    const api = typeof getApi === 'function' ? getApi() : window.pywebview?.api ?? null;
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
  if (!button) {
    return `
      <button class="channel-side-button channel-side-button-add"
              onclick="addChannelButton(${channel.id})"
              type="button">
        <span class="button-icon">+</span>
        <span class="button-label">${t('channels.addButton')}</span>
      </button>
    `;
  }

  return `
    <button class="channel-side-button ${button.active ? 'active' : ''}"
            type="button"
            data-button-id="${button.id}"
            onclick="toggleButton(${channel.id}, ${button.id})"
            ondblclick="configureButton(${channel.id}, ${button.id})">
      <span class="button-icon">${button.icon}</span>
      <span class="button-label">${button.text}</span>
    </button>
  `;
}

function renderChannelButtons(channel) {
  const slots = [];

  for (let index = 0; index < MAX_CHANNEL_BUTTONS; index += 1) {
    slots.push(renderChannelButtonSlot(channel, channel.buttons[index] || null));
  }

  return slots.join('');
}

function renderBindHint(channel) {
  if (channel.faderMapping || !channel.showBindHint) {
    return '';
  }

  return `
    <button class="fader-bind-chip" type="button" onclick="startBindFader(event, ${channel.id})">
      ${t('channels.bindToMixer')}
    </button>
  `;
}

function renderAddChannelStrip() {
  const layoutEditModeEnabled = getChannelLayoutEditModeEnabled();

  return `
    <div class="add-channel-strip ${layoutEditModeEnabled ? 'is-disabled' : ''}" ${layoutEditModeEnabled ? '' : 'onclick="createChannel()"'} >
      <div class="add-channel-plus">+</div>
    </div>
  `;
}

function renderEmptyMixerState() {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">Mixer</div>
      <div class="empty-state-text">${t('empty.message')}</div>
    </div>
  `;
}

function renderMixerSpacer(layoutItem) {
  const isSelected = getSelectedChannelLayoutItemId() === layoutItem.id;
  const isHovered = getHoveredChannelLayoutItemId() === layoutItem.id;

  return `
    <div
      class="surface-layout-item surface-layout-item--channel layout-spacer-shell ${isSelected ? 'is-selected' : ''} ${isHovered ? 'is-hovered' : ''}"
      data-layout-item-id="${layoutItem.id}"
      data-layout-item-type="${layoutItem.type}">
      <div class="layout-spacer layout-spacer--channel" data-layout-spacer-size="${layoutItem.size || 1}"></div>
      ${renderChannelLayoutEditOverlay(layoutItem, 'layout.itemTypes.spacer')}
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
  const isSelected = getSelectedChannelLayoutItemId() === resolvedLayoutItem.id;
  const isHovered = getHoveredChannelLayoutItemId() === resolvedLayoutItem.id;

  return `
    <div
      class="surface-layout-item surface-layout-item--channel ${isSelected ? 'is-selected' : ''} ${isHovered ? 'is-hovered' : ''}"
      data-layout-item-id="${resolvedLayoutItem.id}"
      data-layout-item-type="${resolvedLayoutItem.type}">
      <div class="channel-strip" data-channel-id="${channel.id}">
        <div class="channel-body">
          <div class="channel-main">
            <div class="fader-column">
              <div class="fader-track" data-channel="${channel.id}">
                <div class="fader-rail"></div>
                <div class="fader-fill" style="height: ${channel.volume}%"></div>
                <div class="fader-thumb" style="bottom: calc(${channel.volume}% - 25px)"></div>
              </div>
            </div>

            <div class="channel-side-column">
              <div class="channel-title" title="${title}" ondblclick="editChannelTitle(${channel.id})">
                ${title}
              </div>

              ${mappingLabel ? `<div class="fader-meta">${mappingLabel}</div>` : '<div class="fader-meta"></div>'}

              <div class="channel-buttons-grid">
                ${renderChannelButtons(channel)}
              </div>

              <div class="volume-value">${formatChannelVolume(outputVolume, channel)}</div>
            </div>
          </div>

          ${renderBindHint(channel)}

          <select class="app-selector" onchange="changeChannelApp(${channel.id}, this.value)">
            ${renderAppOptions(channel.app)}
          </select>
        </div>
      </div>
      ${renderChannelLayoutEditOverlay(resolvedLayoutItem, 'layout.itemTypes.channel')}
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
    if (!channel.flashOnCreate) {
      return;
    }

    const channelElement = container.querySelector(
      `.channel-strip[data-channel-id="${channel.id}"]`
    );

    if (!channelElement) {
      return;
    }

    channelElement.classList.add('flash');
    clearChannelFlashState?.(channel.id, { source: 'render' });

    setTimeout(() => {
      channelElement.classList.remove('flash');
    }, 250);
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
      ${renderEmptyMixerState()}
      ${renderAddChannelStrip()}
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
    const layoutEditorChanged = nextState.layoutEditor !== previousState.layoutEditor;

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
window.queueChannelVolumePushRuntime = queueChannelVolumePush;
window.resetChannelVolumePushRuntime = resetChannelVolumePushState;
window.emitChannelVolumeHudRuntime = emitChannelVolumeHud;
