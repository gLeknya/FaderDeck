let channels = [];
let standaloneButtonsList = [];
let audioApps = [];
let currentButtonConfig = null;
let contextTarget = null;
let advancedMode = false;
let developerMode = false;
let activeMenuTab = null;
let menuScrollVisibilitySnapshot = null;

const dom = {};
const UI_STORAGE_KEYS = {
  advancedMode: 'faderdeck_advanced_mode',
  developerMode: 'faderdeck_developer_mode'
};
const FALLBACK_AUDIO_APPS = [
  { name: 'Chrome', process: 'chrome.exe' },
  { name: 'Spotify', process: 'spotify.exe' },
  { name: 'Discord', process: 'discord.exe' },
  { name: 'OBS Studio', process: 'obs64.exe' },
  { name: 'VLC', process: 'vlc.exe' }
];

let contentMetricsFrame = null;

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
  const externalApps = Array.isArray(applications)
    ? applications.filter((app) => app.process !== 'master')
    : [];
  return [localizedMaster, ...externalApps];
}

function cacheDomElements() {
  dom.appShell = $('appShell');
  dom.menuRail = $('menuRail');
  dom.menuPanelOverlay = $('menuPanelOverlay');
  dom.advancedModeToggle = $('advancedModeToggle');
  dom.developerModeToggle = $('developerModeToggle');
  dom.devtoolsAction = $('devtoolsAction');
  dom.openDevtoolsButton = $('openDevtoolsButton');
  dom.advancedInfo = $('advancedInfo');
  dom.buttonKey = $('buttonKey');
  dom.contextMenu = $('contextMenu');
  dom.menuTabs = Array.from(document.querySelectorAll('.menu-icon-tab'));
  dom.menuViews = Array.from(document.querySelectorAll('.menu-panel-view'));
  dom.languageSelect = $('languageSelect');
  dom.mainContentViewport = $('mainContentViewport');
  dom.contentScrollBar = $('contentScrollBar');
  dom.contentScrollRange = $('contentScrollRange');
}

function loadUiSettingsFromLocal() {
  advancedMode = localStorage.getItem(UI_STORAGE_KEYS.advancedMode) === 'true';
  developerMode = localStorage.getItem(UI_STORAGE_KEYS.developerMode) === 'true';
}

function saveUiSetting(key, value) {
  localStorage.setItem(key, String(Boolean(value)));
}

function isMenuOpen() {
  return dom.menuRail?.classList.contains('open');
}

function syncMenuTabUi() {
  dom.menuTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === activeMenuTab);
  });

  dom.menuViews.forEach((view) => {
    view.hidden = view.dataset.tab !== activeMenuTab;
  });

  dom.menuPanelOverlay?.classList.toggle('hidden', !activeMenuTab);
}

function setActiveMenuTab(tabName) {
  activeMenuTab = tabName;
  syncMenuTabUi();
}

function openMainMenu() {
  menuScrollVisibilitySnapshot = !dom.contentScrollBar?.classList.contains('hidden');
  dom.menuRail?.classList.add('open');
  document.body.classList.add('menu-open');
  scheduleContentMetricsUpdate();
}

function closeMainMenu() {
  dom.menuRail?.classList.remove('open');
  document.body.classList.remove('menu-open');
  setActiveMenuTab(null);

  if (menuScrollVisibilitySnapshot === false) {
    dom.contentScrollBar?.classList.add('hidden');
  }

  scheduleContentMetricsUpdate();

  requestAnimationFrame(() => {
    if (menuScrollVisibilitySnapshot === false) {
      dom.contentScrollBar?.classList.add('hidden');
    }
    menuScrollVisibilitySnapshot = null;
    scheduleContentMetricsUpdate();
  });
}

function toggleMainMenu() {
  if (isMenuOpen()) {
    closeMainMenu();
    return;
  }

  openMainMenu();
}

function openSettings() {
  openMainMenu();
  setActiveMenuTab('settings');
}

function closeSettings() {
  setActiveMenuTab(null);
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

function syncDeveloperModeUi() {
  if (!dom.developerModeToggle || !dom.devtoolsAction) {
    return;
  }

  dom.developerModeToggle.classList.toggle('on', developerMode);
  dom.developerModeToggle.textContent = developerMode ? t('settings.on') : t('settings.off');
  dom.devtoolsAction.hidden = !developerMode;
}

function syncLanguageUi() {
  if (dom.languageSelect) {
    dom.languageSelect.value = getCurrentLanguage();
  }
}

function syncContentScrollUi() {
  if (!dom.mainContentViewport || !dom.contentScrollRange || !dom.contentScrollBar) {
    return;
  }

  const actualMaxScroll = Math.max(
    0,
    dom.mainContentViewport.scrollWidth - dom.mainContentViewport.clientWidth
  );
  const railCompensation = isMenuOpen() ? (dom.menuRail?.offsetWidth || 0) : 0;
  const baseVisibleWidth = dom.mainContentViewport.clientWidth + railCompensation;
  const baseOverflow = Math.max(0, dom.mainContentViewport.scrollWidth - baseVisibleWidth);
  const shouldShowScroll = menuScrollVisibilitySnapshot === false
    ? false
    : baseOverflow > 0;

  dom.contentScrollBar.classList.toggle('hidden', !shouldShowScroll);
  dom.contentScrollRange.max = String(actualMaxScroll);
  dom.contentScrollRange.value = String(
    Math.min(actualMaxScroll, Math.round(dom.mainContentViewport.scrollLeft))
  );
}

function scheduleContentMetricsUpdate() {
  if (contentMetricsFrame) {
    cancelAnimationFrame(contentMetricsFrame);
  }

  contentMetricsFrame = requestAnimationFrame(() => {
    contentMetricsFrame = null;
    syncContentScrollUi();
  });
}

function setupContentScroller() {
  if (!dom.contentScrollRange || !dom.mainContentViewport) {
    return;
  }

  dom.contentScrollRange.addEventListener('input', (event) => {
    dom.mainContentViewport.scrollLeft = Number(event.target.value);
  });

  dom.mainContentViewport.addEventListener('scroll', syncContentScrollUi);
  window.addEventListener('resize', scheduleContentMetricsUpdate);
}

function setupSettings() {
  syncAdvancedModeUi();
  syncDeveloperModeUi();
  syncLanguageUi();

  dom.advancedModeToggle?.addEventListener('click', () => {
    advancedMode = !advancedMode;
    saveUiSetting(UI_STORAGE_KEYS.advancedMode, advancedMode);
    syncAdvancedModeUi();
    renderMixer();
  });

  dom.developerModeToggle?.addEventListener('click', () => {
    developerMode = !developerMode;
    saveUiSetting(UI_STORAGE_KEYS.developerMode, developerMode);
    syncDeveloperModeUi();
  });

  dom.openDevtoolsButton?.addEventListener('click', () => {
    getApi()?.toggle_devtools?.();
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
    audioApps = buildAudioAppsList(
      response?.applications?.length ? response.applications : FALLBACK_AUDIO_APPS
    );
  } catch (error) {
    console.error(error);
    audioApps = buildAudioAppsList(FALLBACK_AUDIO_APPS);
  }

  renderMixer();
  scheduleContentMetricsUpdate();
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
  const buttonEl = event.target.closest('.control-button, .channel-side-button');
  const standaloneEl = event.target.closest('.standalone-button');

  if (!channelEl && !buttonEl && !standaloneEl) {
    return;
  }

  event.preventDefault();

  if (buttonEl && buttonEl.dataset.buttonId) {
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
  } else if (channelEl) {
    contextTarget = {
      type: 'channel',
      channelId: Number.parseInt(channelEl.dataset.channelId, 10)
    };
  } else {
    return;
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

function setupMenuTabs() {
  dom.menuTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      if (!isMenuOpen()) {
        openMainMenu();
      }

      if (activeMenuTab === tab.dataset.tab) {
        setActiveMenuTab(null);
        return;
      }

      setActiveMenuTab(tab.dataset.tab);
    });
  });
}

function handleLanguageChanged() {
  syncLanguageUi();
  syncAdvancedModeUi();
  syncDeveloperModeUi();
  audioApps = buildAudioAppsList(audioApps);
  renderMixer();
  renderStandaloneButtons();

  if (typeof refreshMidiUiLanguage === 'function') {
    refreshMidiUiLanguage();
  }

  scheduleContentMetricsUpdate();
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
  loadUiSettingsFromLocal();
  applyTranslations();
  bindGlobalUi();
  setupSettings();
  setupWindowControls();
  setupMenuTabs();
  setupContentScroller();
  syncMenuTabUi();
  loadProfileFromLocal();
  loadAudioApps();
  initWebMIDI();
  scheduleContentMetricsUpdate();
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
