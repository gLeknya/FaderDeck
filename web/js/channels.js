let activeFaderDrag = null;

function addChannel() {
  document.getElementById('channelModal')?.classList.add('active');
}

function closeModal() {
  document.getElementById('channelModal')?.classList.remove('active');
}

function createChannelModel(index) {
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
  const channel = createChannelModel(channels.length + 1);
  channels.push(channel);
  renderMixer();
  saveProfileToLocal();
  logTest('createChannel', { channelId: channel.id, title: channel.title });
}

function removeChannel(channelId) {
  channels = channels.filter((channel) => channel.id !== channelId);
  renderMixer();
  saveProfileToLocal();
}

function changeChannelApp(channelId, appProcess) {
  const channel = findChannel(channelId);

  if (!channel) {
    return;
  }

  const selectedApp = audioApps.find((app) => app.process === appProcess);
  channel.app = appProcess;
  channel.appName = selectedApp?.name || appProcess;

  if (!channel.title) {
    channel.title = channel.appName;
  }

  saveProfileToLocal();
  renderMixer();
  logTest('changeChannelApp', { channelId, appProcess });
}

function editChannelTitle(channelId) {
  const channel = findChannel(channelId);

  if (!channel) {
    return;
  }

  const currentTitle = channel.title || channel.appName;
  const name = prompt(t('channels.channelNamePrompt'), currentTitle);

  if (name === null) {
    return;
  }

  channel.title = name.trim() || channel.appName;
  saveProfileToLocal();
  renderMixer();
}

function dismissFaderBindHint(channelId) {
  const channel = findChannel(channelId);

  if (!channel) {
    return;
  }

  channel.showBindHint = false;
  channel.skipBinding = true;
  saveProfileToLocal();
  showToast('warn', t('channels.unboundWarning'));
  renderMixer();
}

function clampVolume(value) {
  return Math.max(0, Math.min(100, value));
}

function applyVolumeToChannel(channelId, volume) {
  const channel = findChannel(channelId);

  if (!channel) {
    return;
  }

  channel.volume = clampVolume(volume);
  updateChannelFaderUi(channel);
  window.pywebview?.api?.set_app_volume(channel.app || 'master', channel.volume);
}

function getVolumeFromPointer(track, clientY) {
  const rect = track.getBoundingClientRect();
  const offsetY = clientY - rect.top;
  const volume = Math.round(((rect.height - offsetY) / rect.height) * 100);
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
  const value = track.parentElement?.querySelector('.volume-value');

  if (!thumb || !fill || !value) {
    return;
  }

  thumb.style.bottom = `calc(${channel.volume}% - 10px)`;
  fill.style.height = `${channel.volume}%`;
  value.textContent = `${channel.volume}%`;
}

function updateFadersFromState() {
  channels.forEach(updateChannelFaderUi);
}

function getFaderMappingLabel(mapping) {
  if (!mapping) {
    return '';
  }

  if (mapping.type === 'control_change') {
    return t('channels.advancedControlChange', { control: mapping.control });
  }

  return t('channels.advancedPitchwheel', { channel: mapping.channel });
}

function renderAppOptions(selectedProcess) {
  return audioApps
    .map((app) => `
      <option value="${app.process}" ${app.process === selectedProcess ? 'selected' : ''}>
        ${app.name}
      </option>
    `)
    .join('');
}

function renderChannelButtons(channel) {
  return channel.buttons
    .map((button) => `
      <button class="control-button ${button.active ? 'active' : ''}"
              data-button-id="${button.id}"
              onclick="toggleButton(${channel.id}, ${button.id})"
              ondblclick="configureButton(${channel.id}, ${button.id})">
        ${button.icon ? `${button.icon} ` : ''}${button.text}
      </button>
    `)
    .join('');
}

function renderBindHint(channel) {
  if (channel.faderMapping || !channel.showBindHint) {
    return '';
  }

  return `
    <div class="fader-bind-bar">
      <span class="fader-bind-text" onclick="startBindFader(event, ${channel.id})">
        ${t('channels.bindToMixer')}
      </span>
      <button class="fader-bind-close"
              onclick="dismissFaderBindHint(${channel.id}); event.stopPropagation();">
        x
      </button>
    </div>
  `;
}

function renderChannel(channel) {
  const title = channel.title || channel.appName || t('channels.unnamed');
  const mappingLabel = advancedMode ? getFaderMappingLabel(channel.faderMapping) : '';

  return `
    <div class="channel-strip" data-channel-id="${channel.id}">
      <div class="channel-header">
        <div class="channel-name" title="${title}" ondblclick="editChannelTitle(${channel.id})">
          ${title}
        </div>
        <button class="btn-remove" onclick="removeChannel(${channel.id}); event.stopPropagation();">
          x
        </button>
      </div>

      <div class="channel-body">
        <div class="fader-container">
          ${mappingLabel ? `<div class="fader-meta">${mappingLabel}</div>` : ''}
          <div class="fader-track" data-channel="${channel.id}">
            <div class="fader-fill" style="height: ${channel.volume}%"></div>
            <div class="fader-thumb" style="bottom: calc(${channel.volume}% - 10px)"></div>
          </div>
          <div class="volume-value">${channel.volume}%</div>
          ${renderBindHint(channel)}
        </div>

        <select class="app-selector" onchange="changeChannelApp(${channel.id}, this.value)">
          ${renderAppOptions(channel.app)}
        </select>

        <div class="button-group">
          ${renderChannelButtons(channel)}
        </div>
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
  channels.forEach((channel) => {
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
    channel.flashOnCreate = false;

    setTimeout(() => {
      channelElement.classList.remove('flash');
    }, 250);
  });
}

function renderMixer() {
  const container = document.getElementById('mixerContainer');

  if (!container) {
    return;
  }

  if (channels.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">Mixer</div>
        <div class="empty-state-text">${t('empty.message')}</div>
      </div>
      <div class="add-channel-strip" onclick="createChannel()">
        <div class="add-channel-plus">+</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    ${channels.map(renderChannel).join('')}
    <div class="add-channel-strip" onclick="createChannel()">
      <div class="add-channel-plus">+</div>
    </div>
  `;

  setupFaderDrag();
  triggerNewChannelFlash(container);
  syncAddChannelStripHeight(container);
}
