// web/js/app.js

let channels = [];
let standaloneButtonsList = [];
let audioApps = [];
let currentButtonConfig = null;
let contextTarget = null;
let advancedMode = false;

function logTest(...args) {
  console.log('[TEST]', ...args);
}

// Settings

function openSettings() {
  document.getElementById('settingsPanel').classList.add('open');
}

function closeSettings() {
  document.getElementById('settingsPanel').classList.remove('open');
}

function setupSettings() {
  const advToggle = document.getElementById('advancedModeToggle');
  const advInfo = document.getElementById('advancedInfo');

  advToggle.addEventListener('click', () => {
    advancedMode = !advancedMode;
    if (advancedMode) {
      advToggle.classList.add('on');
      advToggle.textContent = 'On';
      advInfo.classList.remove('hidden');
    } else {
      advToggle.classList.remove('on');
      advToggle.textContent = 'Off';
      advInfo.classList.add('hidden');
    }
    renderMixer();
  });
}

// Init

function init() {
  loadAudioApps();
  loadProfileFromLocal();
  // setupMidiInputs(); // Больше не нужен, MIDI идёт через WebMIDI

  const keyEl = document.getElementById('buttonKey');
  if (keyEl) keyEl.addEventListener('keydown', captureKey);

  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('click', () => {
    document.getElementById('contextMenu').style.display = 'none';
  });
  document.querySelectorAll('#contextMenu .context-item')
    .forEach(item => item.addEventListener('click', onContextItemClick));

  setupSettings();
  initWebMIDI(); // из midi-ui.js
}

function safeInit() {
  try {
    // В Electron preload мы сами создаём window.pywebview.api
    if (window.pywebview && window.pywebview.api) {
      init();
    } else {
      setTimeout(safeInit, 200);
    }
  } catch (e) {
    console.error(e);
    setTimeout(safeInit, 200);
  }
}

setTimeout(safeInit, 500);

// Audio apps

async function loadAudioApps() {
  try {
    if (!window.pywebview || !window.pywebview.api) {
      console.warn('pywebview.api not ready in loadAudioApps');
      return;
    }
    const res = await window.pywebview.api.get_audio_applications();
    audioApps = res.applications || [];
    logTest('audio_apps', audioApps);
  } catch (e) {
    console.error(e);
    audioApps = [
      { name: 'Chrome', process: 'chrome.exe' },
      { name: 'Spotify', process: 'spotify.exe' },
      { name: 'Discord', process: 'discord.exe' },
      { name: 'OBS Studio', process: 'obs64.exe' },
      { name: 'VLC', process: 'vlc.exe' },
      { name: 'Master Volume', process: 'master' }
    ];
  }
  updateAppSelectors();
}

function updateAppSelectors() {
  const select = document.getElementById('modalAppSelect');
  if (!select) return;
  select.innerHTML = audioApps.map(app =>
    `<option value="${app.process}">${app.name}</option>`
  ).join('');
}

// MIDI inputs — больше не используется, оставляем заглушкой, если что-то вызывает

async function setupMidiInputs() {
  logTest('setupMidiInputs is disabled (WebMIDI used instead)');
}

// Context menu

function onContextMenu(e) {
  const channelEl = e.target.closest('.channel-strip');
  const buttonEl = e.target.closest('.control-button');
  const standaloneEl = e.target.closest('.standalone-button');

  if (!channelEl && !buttonEl && !standaloneEl) return;

  e.preventDefault();

  if (buttonEl) {
    const channelId = parseInt(buttonEl.closest('.channel-strip').dataset.channelId);
    const buttonId = parseInt(buttonEl.dataset.buttonId);
    contextTarget = { type: 'button', channelId, buttonId };
  } else if (standaloneEl) {
    const buttonId = parseInt(standaloneEl.dataset.buttonId);
    contextTarget = { type: 'standalone', buttonId };
  } else if (channelEl) {
    const channelId = parseInt(channelEl.dataset.channelId);
    contextTarget = { type: 'channel', channelId };
  }

  const menu = document.getElementById('contextMenu');
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.style.display = 'block';
}

function onContextItemClick(e) {
  const action = e.target.dataset.action;
  const menu = document.getElementById('contextMenu');
  menu.style.display = 'none';
  handleContextAction(action);
}

function handleContextAction(action) {
  if (!contextTarget) return;

  if (contextTarget.type === 'channel') {
    const id = contextTarget.channelId;
    if (action === 'delete') removeChannel(id);
    if (action === 'remap') remapChannelFader(id);
    if (action === 'edit')  editChannelTitle(id);
  } else if (contextTarget.type === 'button') {
    const { channelId, buttonId } = contextTarget;
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;
    if (action === 'delete') {
      // Можно добавить подтверждение как в твоём коде
      channel.buttons = channel.buttons.filter(b => b.id !== buttonId);
      saveProfileToLocal();
      renderMixer();
    }
    if (action === 'remap') remapButton(channelId, buttonId);
    if (action === 'edit')  configureButton(channelId, buttonId);
  } else if (contextTarget.type === 'standalone') {
    const id = contextTarget.buttonId;
    if (action === 'delete') {
      standaloneButtonsList = standaloneButtonsList.filter(b => b.id !== id);
      saveProfileToLocal();
      renderStandaloneButtons();
    }
    if (action === 'remap') remapStandaloneButton(id);
    if (action === 'edit')  configureStandaloneButton(id);
  }
}

// Profiles (localStorage)

function saveProfileToLocal() {
  const profile = { channels, standaloneButtons: standaloneButtonsList };
  localStorage.setItem('mixer_profile', JSON.stringify(profile));
}

function loadProfileFromLocal() {
  const saved = localStorage.getItem('mixer_profile');
  if (!saved) {
    renderMixer();
    renderStandaloneButtons();
    return;
  }
  try {
    const profile = JSON.parse(saved);
    channels = profile.channels || [];
    standaloneButtonsList = profile.standaloneButtons || [];
  } catch (e) {
    console.error('loadProfile error', e);
  }
  renderMixer();
  renderStandaloneButtons();
}

function openProfileModal() {
  showToast('warn', 'Profile UI is not implemented yet, use auto-save.');
}

function closeAppWindow() {
  if (window.pywebview && window.pywebview.api && window.pywebview.api.exit_app) {
    window.pywebview.api.exit_app();
  } else {
    window.close();
  }
}


function setupWindowControls() {
  const buttons = document.querySelectorAll('.window-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (window.pywebview && window.pywebview.api && window.pywebview.api.windowControl) {
        window.pywebview.api.windowControl(action);
      }
    });
  });
}

// В init() после setupSettings() и initWebMIDI():
function init() {
  loadAudioApps();
  loadProfileFromLocal();
  setupSettings();
  initWebMIDI();
  setupWindowControls();
}
