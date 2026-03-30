let channels = [];
let standaloneButtonsList = [];
let audioApps = [];
let currentButtonConfig = null;
let contextTarget = null;
let advancedMode = false;

const dom = {};
const FALLBACK_AUDIO_APPS = [
  { name: 'Chrome', process: 'chrome.exe' },
  { name: 'Spotify', process: 'spotify.exe' },
  { name: 'Discord', process: 'discord.exe' },
  { name: 'OBS Studio', process: 'obs64.exe' },
  { name: 'VLC', process: 'vlc.exe' }
];

function logTest(...args) {
  console.log('[TEST]', ...args);
}

function $(id) {
  return document.getElementById(id);
}

function getApi() {
  return window.pywebview?.api ?? null;
}

function buildAudioAppsList(applications = []) {
  const localizedMaster = { name: t('audio.systemVolume'), process: 'master' };
  const externalApps = Array.isArray(applications) ? applications.filter((app) => app.process !== 'master') : [];
  return [localizedMaster, ...externalApps];
}

function cacheDomElements() {
  dom.appShell = $('appShell');
  dom.advancedModeToggle = $('advancedModeToggle');
  dom.advancedInfo = $('advancedInfo');
  dom.buttonKey = $('buttonKey');
  dom.contextMenu = $('contextMenu');
  dom.mainMenuPanel = $('mainMenuPanel');
  dom.mainMenuTabs = Array.from(document.querySelectorAll('.main-menu-tab'));
  dom.mainMenuViews = Array.from(document.querySelectorAll('.main-menu-view'));
  dom.languageSelect = $('languageSelect');
}

function togglePanel(panel, isOpen) {
  if (!panel) {
    return;
  }

  panel.classList.toggle('open', isOpen);
}

function activateMainMenuTab(tabName) {
  dom.mainMenuTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  dom.mainMenuViews.forEach((view) => {
    view.hidden = view.dataset.tab !== tabName;
  });
}

function openMainMenu(tabName = null) {
  if (tabName) {
    activateMainMenuTab(tabName);
  }

  togglePanel(dom.mainMenuPanel, true);
  dom.appShell?.classList.add('menu-open');
}

function closeMainMenu() {
  togglePanel(dom.mainMenuPanel, false);
  dom.appShell?.classList.remove('menu-open');
}

function openSettings() {
  openMainMenu('settings');
}

function closeSettings() {
  closeMainMenu();
}

function openSettingsFromMenu() {
  openSettings();
}

function syncAdvancedModeUi() {
  if (!dom.advancedModeToggle || !dom.advancedInfo) {
    return;
  }

  dom.advancedModeToggle.classList.toggle('on', advancedMode);
  dom.advancedModeToggle.textContent = advancedMode ? t('settings.on') : t('settings.off');
  dom.advancedInfo.classList.toggle('hidden', !advancedMode);
}

function syncLanguageUi() {
  if (dom.languageSelect) {
    dom.languageSelect.value = getCurrentLanguage();
  }
}

function setupSettings() {
  if (!dom.advancedModeToggle) {
    return;
  }

  syncAdvancedModeUi();
  syncLanguageUi();

  dom.advancedModeToggle.addEventListener('click', () => {
    advancedMode = !advancedMode;
    syncAdvancedModeUi();
    renderMixer();
  });

  dom.languageSelect?.addEventListener('change', (event) => {
    setLanguage(event.target.value);
  });
}

async function loadAudioApps() {
  try {
    const api = getApi();

    if (!api) {
      console.warn('pywebview.api not ready in loadAudioApps');
      return;
    }

    const response = await api.get_audio_applications();
    audioApps = buildAudioAppsList(response?.applications?.length ? response.applications : FALLBACK_AUDIO_APPS);
    logTest('audio_apps', audioApps);
  } catch (error) {
    console.error(error);
    audioApps = buildAudioAppsList(FALLBACK_AUDIO_APPS);
  }

  renderMixer();
}

async function setupMidiInputs() {
  logTest('setupMidiInputs is disabled (WebMIDI used instead)');
}

function hideContextMenu() {
  if (dom.contextMenu) {
    dom.contextMenu.style.display = 'none';
  }
}

function onContextMenu(event) {
  const channelEl = event.target.closest('.channel-strip');
  const buttonEl = event.target.closest('.control-button');
  const standaloneEl = event.target.closest('.standalone-button');

  if (!channelEl && !buttonEl && !standaloneEl) {
    return;
  }

  event.preventDefault();

  if (buttonEl) {
    contextTarget = {
      type: 'button',
      channelId: Number.parseInt(buttonEl.closest('.channel-strip').dataset.channelId, 10),
      buttonId: Number.parseInt(buttonEl.dataset.buttonId, 10)
    };
  } else if (standaloneEl) {
    contextTarget = {
      type: 'standalone',
      buttonId: Number.parseInt(standaloneEl.dataset.buttonId, 10)
    };
  } else {
    contextTarget = {
      type: 'channel',
      channelId: Number.parseInt(channelEl.dataset.channelId, 10)
    };
  }

  if (!dom.contextMenu) {
    return;
  }

  dom.contextMenu.style.left = `${event.clientX}px`;
  dom.contextMenu.style.top = `${event.clientY}px`;
  dom.contextMenu.style.display = 'block';
}

function onContextItemClick(event) {
  const action = event.currentTarget.dataset.action;
  hideContextMenu();
  handleContextAction(action);
}

function handleContextAction(action) {
  if (!contextTarget) {
    return;
  }

  if (contextTarget.type === 'channel') {
    const { channelId } = contextTarget;

    if (action === 'delete') removeChannel(channelId);
    if (action === 'remap') remapChannelFader(channelId);
    if (action === 'edit') editChannelTitle(channelId);
    return;
  }

  if (contextTarget.type === 'button') {
    const { channelId, buttonId } = contextTarget;
    const channel = channels.find((item) => item.id === channelId);

    if (!channel) {
      return;
    }

    if (action === 'delete') {
      channel.buttons = channel.buttons.filter((button) => button.id !== buttonId);
      saveProfileToLocal();
      renderMixer();
    }

    if (action === 'remap') remapButton(channelId, buttonId);
    if (action === 'edit') configureButton(channelId, buttonId);
    return;
  }

  if (contextTarget.type === 'standalone') {
    const { buttonId } = contextTarget;

    if (action === 'delete') {
      standaloneButtonsList = standaloneButtonsList.filter((button) => button.id !== buttonId);
      saveProfileToLocal();
      renderStandaloneButtons();
    }

    if (action === 'remap') remapStandaloneButton(buttonId);
    if (action === 'edit') configureStandaloneButton(buttonId);
  }
}

function saveProfileToLocal() {
  const profile = { channels, standaloneButtons: standaloneButtonsList };
  localStorage.setItem('mixer_profile', JSON.stringify(profile));
}

function loadProfileFromLocal() {
  const savedProfile = localStorage.getItem('mixer_profile');

  if (!savedProfile) {
    renderMixer();
    renderStandaloneButtons();
    return;
  }

  try {
    const profile = JSON.parse(savedProfile);
    channels = Array.isArray(profile.channels) ? profile.channels : [];
    standaloneButtonsList = Array.isArray(profile.standaloneButtons)
      ? profile.standaloneButtons
      : [];
  } catch (error) {
    console.error('loadProfile error', error);
  }

  renderMixer();
  renderStandaloneButtons();
}

function openProfileModal() {
  showToast('warn', t('profile.autoSaveOnly'));
}

function closeAppWindow() {
  const api = getApi();

  if (api?.exit_app) {
    api.exit_app();
    return;
  }

  window.close();
}

function setupWindowControls() {
  document.querySelectorAll('.window-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      getApi()?.windowControl?.(action);
    });
  });
}

function setupMainMenuTabs() {
  dom.mainMenuTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      activateMainMenuTab(tab.dataset.tab);
    });
  });
}

function handleLanguageChanged() {
  syncLanguageUi();
  syncAdvancedModeUi();
  audioApps = buildAudioAppsList(audioApps);
  renderMixer();
  renderStandaloneButtons();

  if (typeof refreshMidiUiLanguage === 'function') {
    refreshMidiUiLanguage();
  }
}

function bindGlobalUi() {
  if (dom.buttonKey) {
    dom.buttonKey.addEventListener('keydown', captureKey);
  }

  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('click', hideContextMenu);
  window.addEventListener('app:language-changed', handleLanguageChanged);

  document.querySelectorAll('#contextMenu .context-item').forEach((item) => {
    item.addEventListener('click', onContextItemClick);
  });
}

function init() {
  cacheDomElements();
  applyTranslations();
  bindGlobalUi();
  setupSettings();
  setupWindowControls();
  setupMainMenuTabs();
  activateMainMenuTab('site');
  loadProfileFromLocal();
  loadAudioApps();
  initWebMIDI();
}

function safeInit() {
  try {
    if (getApi()) {
      init();
      return;
    }
  } catch (error) {
    console.error(error);
  }

  setTimeout(safeInit, 200);
}

setTimeout(safeInit, 300);
