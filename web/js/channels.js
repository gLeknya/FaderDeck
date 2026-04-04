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
  const channel = typeof createChannelState === 'function'
    ? createChannelState({}, { source: 'ui' })
    : createChannelModel(getChannels().length + 1);

  if (!channel) {
    return;
  }

  saveProfileToLocal();
  logTest('createChannel', { channelId: channel.id, title: channel.title });
}

function removeChannel(channelId) {
  if (typeof removeChannelState === 'function') {
    removeChannelState(channelId, { source: 'ui' });
  }

  resetChannelVolumePushState(channelId);
  saveProfileToLocal();
}

function changeChannelApp(channelId, appProcess) {
  const channel = getChannelById(channelId);

  if (!channel) {
    return;
  }

  if (!appProcess) {
    resetChannelVolumePushState(channelId);
    clearChannelAppTargetState?.(channelId, { source: 'ui' });
    saveProfileToLocal();
    return;
  }

  const selectedApp = audioApps.find((app) => app.process === appProcess);
  resetChannelVolumePushState(channelId);
  const updatedChannel = typeof assignChannelAppState === 'function'
    ? assignChannelAppState(
      channelId,
      appProcess,
      selectedApp?.name || appProcess,
      { source: 'ui' }
    )
    : null;

  saveProfileToLocal();
  queueChannelVolumePush(updatedChannel || getChannelById(channelId));
}

function editChannelTitle(channelId) {
  openChannelEditor?.(channelId);
}

function dismissFaderBindHint(channelId) {
  const channel = getChannelById(channelId);

  if (!channel) {
    return;
  }

  if (typeof dismissChannelBindHintState === 'function') {
    dismissChannelBindHintState(channelId, { source: 'ui' });
  }

  saveProfileToLocal();
  showToast('warn', t('channels.unboundWarning'));
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
  const channel = getChannelById(channelId);

  if (!channel) {
    return;
  }

  const updatedChannel = typeof setChannelVolumeState === 'function'
    ? setChannelVolumeState(channelId, volume, { source: 'ui', ...meta })
    : null;
  queueChannelVolumePush(updatedChannel || getChannelById(channelId));
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
  saveProfileToLocal();
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
  const placeholderOption = !selectedProcess
    ? `<option value="" selected>${t('editor.noTargetAssigned')}</option>`
    : '';

  return `${placeholderOption}${audioApps
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
  return `
    <div class="add-channel-strip" onclick="createChannel()">
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

function renderChannel(channel) {
  const title = channel.title || channel.appName || t('channels.unnamed');
  const mappingLabel = getAdvancedModeEnabled?.()
    ? getFaderMappingLabel(channel.faderMapping)
    : '';
  const outputVolume = getChannelOutputVolume(channel);

  return `
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

  if (!container) {
    return;
  }

  if (channels.length === 0) {
    container.innerHTML = `
      ${renderEmptyMixerState()}
      ${renderAddChannelStrip()}
    `;
    scheduleContentMetricsUpdate();
    return;
  }

  container.innerHTML = `
    ${channels.map(renderChannel).join('')}
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
    if (nextState.channels === previousState.channels) {
      return;
    }

    if (meta.type === 'channels/set-volume') {
      const channel = getChannelById(meta.channelId);

      if (channel) {
        updateChannelFaderUi(channel);
      }

      return;
    }

    if (meta.type === 'channels/clear-flash') {
      return;
    }

    renderMixer();
  });

  channelUiStateSyncInitialized = true;
}

window.applyChannelVolumeRuntime = function applyChannelVolumeRuntime(channelId, volume, meta = {}) {
  return applyVolumeToChannel(channelId, volume, { source: 'midi-runtime', ...meta });
};
