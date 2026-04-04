let audioApps = [];
let contextTarget = null;
let menuPanelMetricsTimeout = null;
const audioAppIconCache = new Map();

const dom = {};
const VOLUME_CURVE_MAX = 100;
const VOLUME_CURVE_EXPONENT_RANGE = 2.2;
const VOLUME_PRECISION_DIGITS = 3;
const LOW_FRACTIONAL_VOLUME_THRESHOLD = 10;
const VOLUME_CURVE_GRAPH_MIN_X = 20;
const VOLUME_CURVE_GRAPH_MAX_X = 200;
const VOLUME_CURVE_GRAPH_MIN_Y = 20;
const VOLUME_CURVE_GRAPH_MAX_Y = 120;
const SOFT_TAKEOVER_MAX_THRESHOLD = 15;
const VOLUME_CURVE_DEMO_DELAY_MS = 1000;
const VOLUME_CURVE_DEMO_DURATION_MS = 2200;
const VOLUME_CURVE_DEMO_START_POSITION = 0;
const VOLUME_CURVE_DEMO_PEAK_POSITION = 100;
const VOLUME_CURVE_DEMO_END_POSITION = 0;
const MENU_PANEL_SIZE_SETTLE_DELAY_MS = 260;
const AUDIO_APPS_REFRESH_MIN_INTERVAL_MS = 1500;
const SETTINGS_SECTION_HIDE_THRESHOLD = 1 / 3;
const SETTINGS_SECTION_MIN_SCALE = 0.86;
const SETTINGS_SECTION_MAX_SHIFT = 8;
const FALLBACK_AUDIO_APPS = [
  { name: 'Chrome', process: 'chrome.exe' },
  { name: 'Spotify', process: 'spotify.exe' },
  { name: 'Discord', process: 'discord.exe' },
  { name: 'OBS Studio', process: 'obs64.exe' },
  { name: 'VLC', process: 'vlc.exe' }
];

let volumeCurveDemoPosition = 0;
let volumeCurveDemoTimer = null;
let volumeCurveDemoFrame = null;
let volumeCurveDemoDragging = false;
let menuPanelMetricsFrame = null;
let activeSettingsTooltipTarget = null;
let uiStateSyncInitialized = false;
let audioAppsRefreshInFlight = null;
let audioAppsRefreshQueued = false;
let audioAppsLastRefreshAt = 0;

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
  const localizedMaster = { name: t('audio.systemVolume'), process: 'master', iconDataUrl: '' };
  const externalApps = Array.isArray(applications)
    ? applications.filter((app) => app.process !== 'master')
    : [];
  return [localizedMaster, ...externalApps];
}

function getAvailableAudioApps() {
  return Array.isArray(audioApps)
    ? audioApps.map((app) => ({ ...app }))
    : [];
}

function getAudioAppIconCacheKey(application = {}) {
  const pathKey = String(application?.path || '').trim().toLowerCase();

  if (pathKey) {
    return pathKey;
  }

  return String(application?.process || '').trim().toLowerCase();
}

function areAudioAppsEqual(nextApplications = [], previousApplications = []) {
  if (nextApplications.length !== previousApplications.length) {
    return false;
  }

  return nextApplications.every((application, index) => {
    const previousApplication = previousApplications[index] || {};
    return (
      String(application?.name || '') === String(previousApplication?.name || '')
      && String(application?.process || '') === String(previousApplication?.process || '')
      && String(application?.path || '') === String(previousApplication?.path || '')
      && String(application?.iconDataUrl || '') === String(previousApplication?.iconDataUrl || '')
    );
  });
}

function setAudioApps(nextApplications = []) {
  const normalizedApplications = Array.isArray(nextApplications)
    ? nextApplications.map((application) => ({ ...application }))
    : [];
  const hasChanged = !areAudioAppsEqual(normalizedApplications, audioApps);

  audioApps = normalizedApplications;

  if (hasChanged) {
    notifyAudioAppsUpdated();
  }

  return hasChanged;
}

function applyCachedAudioAppIcons(applications = []) {
  return applications.map((application) => {
    const cacheKey = getAudioAppIconCacheKey(application);

    if (!cacheKey || !audioAppIconCache.has(cacheKey)) {
      return { ...application };
    }

    return {
      ...application,
      iconDataUrl: audioAppIconCache.get(cacheKey)
    };
  });
}

function notifyAudioAppsUpdated() {
  renderMixer();
  window.dispatchEvent(new CustomEvent('audio-apps-updated', {
    detail: {
      apps: getAvailableAudioApps()
    }
  }));
  scheduleContentMetricsUpdate();
}

async function enrichAudioAppsWithIcons(applications = []) {
  const api = getApi();

  if (!api?.get_application_icons || !Array.isArray(applications) || !applications.length) {
    return applyCachedAudioAppIcons(applications);
  }

  const uncachedPaths = [];

  applications.forEach((application) => {
    const cacheKey = getAudioAppIconCacheKey(application);
    const applicationPath = String(application?.path || '').trim();

    if (!cacheKey || !applicationPath || audioAppIconCache.has(cacheKey)) {
      return;
    }

    uncachedPaths.push(applicationPath);
  });

  if (uncachedPaths.length > 0) {
    try {
      const response = await api.get_application_icons([...new Set(uncachedPaths)]);
      const iconMap = response?.success && response?.icons && typeof response.icons === 'object'
        ? response.icons
        : {};

      applications.forEach((application) => {
        const cacheKey = getAudioAppIconCacheKey(application);
        const applicationPath = String(application?.path || '').trim();
        const iconDataUrl = applicationPath ? iconMap[applicationPath] : '';

        if (cacheKey && iconDataUrl) {
          audioAppIconCache.set(cacheKey, iconDataUrl);
        }
      });
    } catch (error) {
      console.error('loadAudioAppIcons error', error);
    }
  }

  return applyCachedAudioAppIcons(applications);
}

function cacheDomElements() {
  dom.appShell = $('appShell');
  dom.menuRail = $('menuRail');
  dom.menuPanelOverlay = $('menuPanelOverlay');
  dom.menuPanelCard = document.querySelector('.menu-panel-card');
  dom.settingsScrollShell = document.querySelector('.settings-scroll-shell');
  dom.advancedModeToggle = $('advancedModeToggle');
  dom.developerModeToggle = $('developerModeToggle');
  dom.faderInterpolationToggle = $('faderInterpolationToggle');
  dom.softTakeoverToggle = $('softTakeoverToggle');
  dom.softTakeoverAdvanced = $('softTakeoverAdvanced');
  dom.softTakeoverThresholdRange = $('softTakeoverThresholdRange');
  dom.softTakeoverThresholdValue = $('softTakeoverThresholdValue');
  dom.profileToolbarToggle = $('profileToolbarToggle');
  dom.legacyVolumeHudGroup = $('volumeHudToggle')?.closest('.settings-group') || null;
  dom.volumeHudToggle = $('volumeHudSettingsToggle');
  dom.volumeHudAdvanced = $('volumeHudSettingsAdvanced');
  dom.volumeHudPositionSelect = $('volumeHudSettingsPositionSelect');
  dom.volumeHudOrientationToggle = $('volumeHudOrientationToggle');
  dom.volumeHudShowIconToggle = $('volumeHudSettingsShowIconToggle');
  dom.volumeHudShowTitleToggle = $('volumeHudSettingsShowTitleToggle');
  dom.volumeHudShowSubtitleToggle = $('volumeHudSettingsShowSubtitleToggle');
  dom.volumeHudShowPercentToggle = $('volumeHudSettingsShowPercentToggle');
  dom.volumeHudShowMeterToggle = $('volumeHudSettingsShowMeterToggle');
  dom.volumeHudPreviewStage = $('volumeHudPreviewStage');
  dom.volumeHudPreviewAnchor = $('volumeHudPreviewAnchor');
  dom.volumeHudPreview = $('volumeHudPreview');
  dom.volumeHudPreviewIconShell = $('volumeHudPreviewIconShell');
  dom.volumeHudPreviewContent = $('volumeHudPreviewContent');
  dom.volumeHudPreviewHeader = $('volumeHudPreviewHeader');
  dom.volumeHudPreviewTitles = $('volumeHudPreviewTitles');
  dom.volumeHudPreviewTitle = $('volumeHudPreviewTitle');
  dom.volumeHudPreviewSubtitle = $('volumeHudPreviewSubtitle');
  dom.volumeHudPreviewValue = $('volumeHudPreviewValue');
  dom.volumeHudPreviewMeter = $('volumeHudPreviewMeter');
  dom.volumeHudPreviewMeterFill = $('volumeHudPreviewMeterFill');
  dom.volumeHudPreviewMeterThumb = $('volumeHudPreviewMeterThumb');
  dom.showFractionalNumbersToggle = $('showFractionalNumbersToggle');
  dom.showFractionalOnlyLowToggle = $('showFractionalOnlyLowToggle');
  dom.fractionalNumbersAdvanced = $('fractionalNumbersAdvanced');
  dom.volumeCurveToggle = $('volumeCurveToggle');
  dom.volumeCurveAdvanced = $('volumeCurveAdvanced');
  dom.volumeCurveRange = $('volumeCurveRange');
  dom.volumeCurvePath = $('volumeCurvePath');
  dom.volumeCurvePoint = $('volumeCurvePoint');
  dom.volumeCurveModeButtons = Array.from(document.querySelectorAll('.curve-mode-button'));
  dom.volumeCurveDemoTrack = $('volumeCurveDemoTrack');
  dom.volumeCurveDemoOutput = $('volumeCurveDemoOutput');
  dom.volumeCurveDemoFill = $('volumeCurveDemoFill');
  dom.volumeCurveDemoThumb = $('volumeCurveDemoThumb');
  dom.volumeCurveDemoValue = $('volumeCurveDemoValue');
  dom.buttonKey = $('buttonKey');
  dom.contextMenu = $('contextMenu');
  dom.menuTabs = Array.from(document.querySelectorAll('.menu-icon-tab'));
  dom.menuViews = Array.from(document.querySelectorAll('.menu-panel-view'));
  dom.languageSelect = $('languageSelect');
  dom.settingsContent = $('settingsContent');
  dom.settingsSections = Array.from(document.querySelectorAll('.settings-section'));
  dom.settingsTooltipLayer = $('settingsTooltipLayer');
  dom.settingsTooltipBubble = $('settingsTooltipBubble');
  dom.mainContentViewport = $('mainContentViewport');
}

function getUiSettings() {
  return getUiSettingsState?.() || {
    advancedMode: false,
    developerMode: false,
    faderInterpolationEnabled: false,
    softTakeoverEnabled: false,
    softTakeoverThreshold: 5,
    showFractionalNumbers: false,
    showFractionalOnlyLow: false,
    volumeCurveEnabled: false,
    volumeCurveType: 'ease-in-out',
    volumeCurveAmount: 0,
    profileToolbarSwitcherEnabled: true,
    volumeHudEnabled: true,
    volumeHudPosition: 'bottom-center',
    volumeHudOrientation: 'horizontal',
    volumeHudShowIcon: true,
    volumeHudShowTitle: true,
    volumeHudShowSubtitle: true,
    volumeHudShowPercent: true,
    volumeHudShowMeter: true
  };
}

function getUiMenu() {
  return getUiMenuState?.() || {
    open: false,
    activeTab: null
  };
}

function getAdvancedModeEnabled() {
  return getAdvancedModeEnabledState?.() ?? getUiSettings().advancedMode;
}

function getDeveloperModeEnabled() {
  return getDeveloperModeEnabledState?.() ?? getUiSettings().developerMode;
}

function getShowFractionalNumbersEnabled() {
  return getShowFractionalNumbersState?.() ?? getUiSettings().showFractionalNumbers;
}

function getSoftTakeoverEnabled() {
  return getSoftTakeoverEnabledState?.() ?? getUiSettings().softTakeoverEnabled;
}

function getSoftTakeoverThreshold() {
  return getSoftTakeoverThresholdState?.() ?? getUiSettings().softTakeoverThreshold;
}

function getShowFractionalOnlyLowEnabled() {
  return getShowFractionalOnlyLowState?.() ?? getUiSettings().showFractionalOnlyLow;
}

function getVolumeHudEnabled() {
  return getVolumeHudEnabledState?.() ?? getUiSettings().volumeHudEnabled;
}

function getVolumeHudPosition() {
  return getVolumeHudPositionState?.() ?? getUiSettings().volumeHudPosition;
}

function getVolumeHudOrientation() {
  return getVolumeHudOrientationState?.() ?? getUiSettings().volumeHudOrientation;
}

function getVolumeHudShowIcon() {
  return getVolumeHudShowIconState?.() ?? getUiSettings().volumeHudShowIcon;
}

function getVolumeHudShowTitle() {
  return getVolumeHudShowTitleState?.() ?? getUiSettings().volumeHudShowTitle;
}

function getVolumeHudShowSubtitle() {
  return getVolumeHudShowSubtitleState?.() ?? getUiSettings().volumeHudShowSubtitle;
}

function getVolumeHudShowPercent() {
  return getVolumeHudShowPercentState?.() ?? getUiSettings().volumeHudShowPercent;
}

function getVolumeHudShowMeter() {
  return getVolumeHudShowMeterState?.() ?? getUiSettings().volumeHudShowMeter;
}

function getVolumeHudPresentationSettings() {
  return {
    enabled: getVolumeHudEnabled(),
    position: getVolumeHudPosition(),
    orientation: getVolumeHudOrientation(),
    showIcon: getVolumeHudShowIcon(),
    showTitle: getVolumeHudShowTitle(),
    showSubtitle: getVolumeHudShowSubtitle(),
    showPercent: getVolumeHudShowPercent(),
    showMeter: getVolumeHudShowMeter()
  };
}

function getActiveMenuTab() {
  return getActiveMenuTabState?.() ?? getUiMenu().activeTab;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function normalizeVolumeValue(value) {
  const precisionFactor = 10 ** VOLUME_PRECISION_DIGITS;
  return Math.round(clampPercent(value) * precisionFactor) / precisionFactor;
}

function getDefaultChannelCustomSettings() {
  return typeof createDefaultChannelCustomSettingsState === 'function'
    ? createDefaultChannelCustomSettingsState()
    : {
      faderInterpolationEnabled: false,
      softTakeoverEnabled: false,
      softTakeoverThreshold: 5,
      volumeCurveEnabled: false,
      volumeCurveType: 'ease-in-out',
      volumeCurveAmount: 0,
      showFractionalNumbers: false
    };
}

function resolveChannelFaderSettings(channelOrId = null) {
  const globalSettings = getUiSettings();
  const channel = typeof channelOrId === 'object' && channelOrId
    ? channelOrId
    : findChannelState?.(channelOrId);

  if (!channel?.customSettingsEnabled) {
    return {
      ...globalSettings
    };
  }

  return {
    ...globalSettings,
    ...getDefaultChannelCustomSettings(),
    ...(channel.customSettings || {}),
    showFractionalOnlyLow: globalSettings.showFractionalOnlyLow
  };
}

function formatVolumeValue(value, options = {}) {
  const normalizedValue = normalizeVolumeValue(value);
  const showFractionalNumbers = options.showFractionalNumbers ?? getShowFractionalNumbersEnabled();
  const showFractionalOnlyLow = options.showFractionalOnlyLow ?? getShowFractionalOnlyLowEnabled();
  const shouldShowFractions = showFractionalNumbers
    && (!showFractionalOnlyLow || normalizedValue < LOW_FRACTIONAL_VOLUME_THRESHOLD);
  const formattedValue = shouldShowFractions
    ? normalizedValue.toFixed(1).replace(/\.0$/, '')
    : String(Math.round(normalizedValue));

  return `${formattedValue}%`;
}

function getVolumeCurveAmount(options = {}) {
  return options.volumeCurveAmount ?? (getVolumeCurveAmountState?.() ?? getUiSettings().volumeCurveAmount);
}

function getVolumeCurveEnabled(options = {}) {
  return options.volumeCurveEnabled ?? (getVolumeCurveEnabledState?.() ?? getUiSettings().volumeCurveEnabled);
}

function getVolumeCurveType(options = {}) {
  return options.volumeCurveType ?? (getVolumeCurveTypeState?.() ?? getUiSettings().volumeCurveType);
}

function getFaderInterpolationEnabled(options = {}) {
  return options.faderInterpolationEnabled
    ?? (getFaderInterpolationEnabledState?.() ?? getUiSettings().faderInterpolationEnabled);
}

function getVolumeCurveExponent(options = {}) {
  return 1 + (getVolumeCurveAmount(options) / VOLUME_CURVE_MAX) * VOLUME_CURVE_EXPONENT_RANGE;
}

function applySelectedVolumeCurve(normalizedPosition, options = {}) {
  const exponent = getVolumeCurveExponent(options);

  if (!getVolumeCurveEnabled(options)) {
    return normalizedPosition;
  }

  if (getVolumeCurveType(options) === 'ease-in') {
    return normalizedPosition ** exponent;
  }

  if (getVolumeCurveType(options) === 'ease-out') {
    return 1 - ((1 - normalizedPosition) ** exponent);
  }

  if (normalizedPosition < 0.5) {
    return 0.5 * ((normalizedPosition * 2) ** exponent);
  }

  return 1 - 0.5 * (((1 - normalizedPosition) * 2) ** exponent);
}

function mapFaderPositionToVolume(position, options = {}) {
  const normalizedPosition = clampPercent(position) / 100;

  if (normalizedPosition <= 0) {
    return 0;
  }

  if (normalizedPosition >= 1) {
    return 100;
  }

  if (!getVolumeCurveEnabled(options) || getVolumeCurveAmount(options) <= 0) {
    return normalizeVolumeValue(normalizedPosition * 100);
  }

  const curvedValue = applySelectedVolumeCurve(normalizedPosition, options);
  return normalizeVolumeValue(curvedValue * 100);
}

window.getAvailableAudioApps = getAvailableAudioApps;
window.getDefaultChannelCustomSettings = getDefaultChannelCustomSettings;
window.resolveChannelFaderSettings = resolveChannelFaderSettings;

function isMenuOpen() {
  return getIsMenuOpenState?.() ?? getUiMenu().open;
}

function transitionMenuView(view, shouldBeActive) {
  if (shouldBeActive) {
    view.hidden = false;
    view.classList.add('is-active');

    requestAnimationFrame(() => {
      view.classList.add('is-visible');
    });
    return;
  }

  view.classList.remove('is-active', 'is-visible');
  view.hidden = true;
}

function syncMenuPanelCardSize() {
  if (!dom.menuPanelCard) {
    return;
  }

  const activeMenuTab = getActiveMenuTab();
  const activeView = dom.menuViews?.find((view) => view.dataset.tab === activeMenuTab);

  if (!activeView || !activeMenuTab) {
    dom.menuPanelCard.style.removeProperty('height');
    dom.menuPanelCard.style.removeProperty('width');
    return;
  }

  const computedStyle = window.getComputedStyle(dom.menuPanelCard);
  const horizontalPadding = (
    Number.parseFloat(computedStyle.paddingLeft) + Number.parseFloat(computedStyle.paddingRight)
  );
  const verticalPadding = (
    Number.parseFloat(computedStyle.paddingTop) + Number.parseFloat(computedStyle.paddingBottom)
  );
  const maxHeight = Number.parseFloat(computedStyle.maxHeight) || window.innerHeight;
  const maxWidth = Math.max(280, Math.min(420, window.innerWidth - 140));
  const nextWidth = activeMenuTab === 'settings'
    ? maxWidth
    : Math.max(280, Math.min(maxWidth, Math.ceil(activeView.scrollWidth + horizontalPadding)));
  const nextContentWidth = Math.max(0, nextWidth - horizontalPadding);
  const nextContentHeight = activeMenuTab === 'settings'
    ? measureMenuViewContentHeight(activeView, nextContentWidth)
    : activeView.scrollHeight;
  const nextHeight = activeMenuTab === 'settings'
    ? Math.round(maxHeight)
    : Math.min(
      maxHeight,
      Math.ceil(nextContentHeight + verticalPadding)
    );

  dom.menuPanelCard.style.width = `${nextWidth}px`;
  dom.menuPanelCard.style.height = `${nextHeight}px`;
}

function measureMenuViewContentHeight(view, width) {
  if (!view) {
    return 0;
  }

  const probe = view.cloneNode(true);
  probe.hidden = false;
  probe.classList.add('is-active', 'is-visible');
  probe.style.position = 'fixed';
  probe.style.left = '-10000px';
  probe.style.top = '0';
  probe.style.right = 'auto';
  probe.style.bottom = 'auto';
  probe.style.width = `${Math.max(0, width)}px`;
  probe.style.height = 'auto';
  probe.style.maxHeight = 'none';
  probe.style.opacity = '1';
  probe.style.transform = 'none';
  probe.style.pointerEvents = 'none';
  probe.style.visibility = 'hidden';
  probe.style.zIndex = '-1';

  probe.querySelectorAll('.settings-expandable').forEach((expandable) => {
    const isOpen = expandable.classList.contains('open');
    expandable.style.maxHeight = isOpen ? 'none' : '0';
    expandable.style.opacity = isOpen ? '1' : '0';
    expandable.style.transform = 'none';
    expandable.style.marginTop = isOpen ? '12px' : '0';
    expandable.style.pointerEvents = isOpen ? 'auto' : 'none';
  });

  document.body.appendChild(probe);
  const measuredHeight = Math.ceil(probe.scrollHeight);
  probe.remove();
  return measuredHeight;
}

function scheduleMenuPanelCardSizeSync() {
  if (menuPanelMetricsFrame) {
    cancelAnimationFrame(menuPanelMetricsFrame);
  }

  if (menuPanelMetricsTimeout) {
    clearTimeout(menuPanelMetricsTimeout);
  }

  menuPanelMetricsFrame = requestAnimationFrame(() => {
    menuPanelMetricsFrame = null;
    syncMenuPanelCardSize();
    syncSettingsViewportUi();
  });

  menuPanelMetricsTimeout = window.setTimeout(() => {
    menuPanelMetricsTimeout = null;
    syncMenuPanelCardSize();
    syncSettingsViewportUi();
  }, MENU_PANEL_SIZE_SETTLE_DELAY_MS);
}

function syncMenuTabUi() {
  const activeMenuTab = getActiveMenuTab();
  hideSettingsTooltip();
  dom.menuTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === activeMenuTab);
  });

  dom.menuViews.forEach((view) => {
    transitionMenuView(view, view.dataset.tab === activeMenuTab);
  });

  dom.menuPanelOverlay?.classList.toggle('hidden', !activeMenuTab);
  scheduleMenuPanelCardSizeSync();
  requestAnimationFrame(syncSettingsViewportUi);
}

function setActiveMenuTab(tabName) {
  window.uiActions?.setActiveMenuTab(tabName, { source: 'ui' });
}

function syncMenuShellUi() {
  const menuOpen = isMenuOpen();
  dom.menuRail?.classList.toggle('open', menuOpen);
  document.body.classList.toggle('menu-open', menuOpen);
}

function openMainMenu() {
  window.uiActions?.openMainMenu({ source: 'ui' });
}

function closeMainMenu() {
  hideSettingsTooltip();
  window.uiActions?.closeMainMenu({ source: 'ui' });

  dom.menuPanelOverlay?.classList.add('hidden');
  dom.menuViews?.forEach((view) => {
    clearTimeout(view.__hideTimer);
    view.classList.remove('is-active', 'is-visible');
    view.hidden = true;
  });
  requestAnimationFrame(() => {
    scheduleContentMetricsUpdate();
    syncSettingsViewportUi();
  });
}

function toggleMainMenu() {
  if (isMenuOpen()) {
    closeMainMenu();
    return;
  }

  window.uiActions?.toggleMainMenu({ source: 'ui' });
}

function syncAdvancedModeUi() {
  if (!dom.advancedModeToggle) {
    return;
  }

  const advancedMode = getAdvancedModeEnabled();
  dom.advancedModeToggle.classList.toggle('on', advancedMode);
  dom.advancedModeToggle.textContent = advancedMode ? t('settings.on') : t('settings.off');
  scheduleMenuPanelCardSizeSync();
}

function syncDeveloperModeUi() {
  if (!dom.developerModeToggle) {
    return;
  }

  const developerMode = getDeveloperModeEnabled();
  dom.developerModeToggle.classList.toggle('on', developerMode);
  dom.developerModeToggle.textContent = developerMode ? t('settings.on') : t('settings.off');
}

function syncFaderInterpolationUi() {
  const faderInterpolationEnabled = getFaderInterpolationEnabled();
  if (dom.faderInterpolationToggle) {
    dom.faderInterpolationToggle.classList.toggle('on', faderInterpolationEnabled);
    dom.faderInterpolationToggle.textContent = faderInterpolationEnabled
      ? t('settings.on')
      : t('settings.off');
  }

  document.body.classList.toggle('fader-interpolation-enabled', faderInterpolationEnabled);
}

function syncSoftTakeoverUi() {
  const softTakeoverEnabled = getSoftTakeoverEnabled();
  const softTakeoverThreshold = getSoftTakeoverThreshold();

  if (dom.softTakeoverToggle) {
    dom.softTakeoverToggle.classList.toggle('on', softTakeoverEnabled);
    dom.softTakeoverToggle.textContent = softTakeoverEnabled
      ? t('settings.on')
      : t('settings.off');
  }

  if (dom.softTakeoverAdvanced) {
    dom.softTakeoverAdvanced.classList.toggle('open', softTakeoverEnabled);
    dom.softTakeoverAdvanced.setAttribute('aria-hidden', String(!softTakeoverEnabled));
  }

  if (dom.softTakeoverThresholdRange) {
    dom.softTakeoverThresholdRange.value = String(softTakeoverThreshold);
    dom.softTakeoverThresholdRange.disabled = !softTakeoverEnabled;
    updateSettingsRangeFill(dom.softTakeoverThresholdRange);
  }

  if (dom.softTakeoverThresholdValue) {
    dom.softTakeoverThresholdValue.textContent = `${softTakeoverThreshold}%`;
  }

  scheduleMenuPanelCardSizeSync();
}

function isToolbarProfilePickerEnabled() {
  return getProfileToolbarSwitcherEnabledState?.() ?? getUiSettings().profileToolbarSwitcherEnabled;
}

function syncProfileToolbarUi() {
  if (!dom.profileToolbarToggle) {
    return;
  }

  const profileToolbarSwitcherEnabled = isToolbarProfilePickerEnabled();
  dom.profileToolbarToggle.classList.toggle('on', profileToolbarSwitcherEnabled);
  dom.profileToolbarToggle.textContent = profileToolbarSwitcherEnabled
    ? t('settings.on')
    : t('settings.off');
  syncToolbarProfilePickerVisibility?.();
}

function hideLegacyVolumeHudSettingsUi() {
  if (dom.legacyVolumeHudGroup) {
    dom.legacyVolumeHudGroup.hidden = true;
  }
}

function syncVolumeHudPreviewUi(settings = getVolumeHudPresentationSettings()) {
  if (!dom.volumeHudPreview) {
    return;
  }

  const isVertical = settings.orientation === 'vertical';
  const previewVolume = 42;
  const previewTitle = 'FaderDeck';
  const previewSubtitle = t('settings.volumeHudPreviewSubtitle');

  dom.volumeHudPreview.classList.toggle('settings-hud-preview--vertical', isVertical);
  dom.volumeHudPreview.classList.toggle('settings-hud-preview--horizontal', !isVertical);
  dom.volumeHudPreviewAnchor?.classList.remove(
    'is-bottom-center',
    'is-bottom-left',
    'is-bottom-right',
    'is-top-center',
    'is-top-left',
    'is-top-right'
  );

  if (dom.volumeHudPreviewTitle) {
    dom.volumeHudPreviewTitle.textContent = previewTitle;
    dom.volumeHudPreviewTitle.classList.toggle('hidden', !settings.showTitle);
  }

  if (dom.volumeHudPreviewSubtitle) {
    dom.volumeHudPreviewSubtitle.textContent = previewSubtitle;
    dom.volumeHudPreviewSubtitle.classList.toggle('hidden', !settings.showSubtitle);
  }

  if (dom.volumeHudPreviewValue) {
    dom.volumeHudPreviewValue.textContent = `${previewVolume}%`;
    dom.volumeHudPreviewValue.classList.toggle('hidden', !settings.showPercent);
  }

  dom.volumeHudPreviewIconShell?.classList.toggle('hidden', !settings.showIcon);
  dom.volumeHudPreviewMeter?.classList.toggle('hidden', !settings.showMeter);
  dom.volumeHudPreviewTitles?.classList.toggle(
    'hidden',
    !settings.showTitle && !settings.showSubtitle
  );
  dom.volumeHudPreviewHeader?.classList.toggle(
    'hidden',
    (!settings.showTitle && !settings.showSubtitle) && !settings.showPercent
  );
  dom.volumeHudPreviewContent?.classList.toggle(
    'hidden',
    ((!settings.showTitle && !settings.showSubtitle) && !settings.showPercent) && !settings.showMeter
  );

  if (dom.volumeHudPreviewMeterFill) {
    if (isVertical) {
      dom.volumeHudPreviewMeterFill.style.height = `${previewVolume}%`;
      dom.volumeHudPreviewMeterFill.style.width = '100%';
    } else {
      dom.volumeHudPreviewMeterFill.style.width = `${previewVolume}%`;
      dom.volumeHudPreviewMeterFill.style.height = '100%';
    }
  }

  if (dom.volumeHudPreviewMeterThumb) {
    if (isVertical) {
      dom.volumeHudPreviewMeterThumb.style.bottom = `${previewVolume}%`;
      dom.volumeHudPreviewMeterThumb.style.left = '50%';
    } else {
      dom.volumeHudPreviewMeterThumb.style.left = `${previewVolume}%`;
      dom.volumeHudPreviewMeterThumb.style.bottom = '0';
    }
  }
}

function syncVolumeHudUi() {
  const settings = getVolumeHudPresentationSettings();

  if (dom.volumeHudToggle) {
    dom.volumeHudToggle.classList.toggle('on', settings.enabled);
    dom.volumeHudToggle.textContent = settings.enabled ? t('settings.on') : t('settings.off');
  }

  if (dom.volumeHudAdvanced) {
    dom.volumeHudAdvanced.classList.toggle('open', settings.enabled);
    dom.volumeHudAdvanced.setAttribute('aria-hidden', String(!settings.enabled));
  }

  if (dom.volumeHudPositionSelect) {
    dom.volumeHudPositionSelect.value = settings.position;
    dom.volumeHudPositionSelect.disabled = !settings.enabled;
    enhanceCustomSelects?.(dom.volumeHudPositionSelect);
  }

  if (dom.volumeHudOrientationToggle) {
    const orientationLabel = settings.orientation === 'vertical'
      ? t('settings.volumeHudOrientations.vertical')
      : t('settings.volumeHudOrientations.horizontal');

    dom.volumeHudOrientationToggle.disabled = !settings.enabled;
    dom.volumeHudOrientationToggle.classList.toggle('on', settings.orientation === 'vertical');
    dom.volumeHudOrientationToggle.textContent = orientationLabel;
  }

  [
    [dom.volumeHudShowIconToggle, settings.showIcon],
    [dom.volumeHudShowTitleToggle, settings.showTitle],
    [dom.volumeHudShowSubtitleToggle, settings.showSubtitle],
    [dom.volumeHudShowPercentToggle, settings.showPercent],
    [dom.volumeHudShowMeterToggle, settings.showMeter]
  ].forEach(([button, value]) => {
    if (!button) {
      return;
    }

    button.disabled = !settings.enabled;
    button.classList.toggle('on', value);
    button.textContent = value ? t('settings.on') : t('settings.off');
  });

  syncVolumeHudPreviewUi(settings);
  scheduleMenuPanelCardSizeSync();
}

function syncFractionalNumberUi() {
  const showFractionalNumbers = getShowFractionalNumbersEnabled();
  const showFractionalOnlyLow = getShowFractionalOnlyLowEnabled();
  if (dom.showFractionalNumbersToggle) {
    dom.showFractionalNumbersToggle.classList.toggle('on', showFractionalNumbers);
    dom.showFractionalNumbersToggle.textContent = showFractionalNumbers
      ? t('settings.on')
      : t('settings.off');
  }

  if (dom.showFractionalOnlyLowToggle) {
    dom.showFractionalOnlyLowToggle.classList.toggle('on', showFractionalOnlyLow);
    dom.showFractionalOnlyLowToggle.textContent = showFractionalOnlyLow
      ? t('settings.on')
      : t('settings.off');
  }

  if (dom.fractionalNumbersAdvanced) {
    dom.fractionalNumbersAdvanced.classList.toggle('open', showFractionalNumbers);
    dom.fractionalNumbersAdvanced.setAttribute('aria-hidden', String(!showFractionalNumbers));
  }

  scheduleMenuPanelCardSizeSync();
}

function buildVolumeCurvePreviewPath() {
  const points = [];

  for (let step = 0; step <= 24; step += 1) {
    const progress = step / 24;
    const x = VOLUME_CURVE_GRAPH_MIN_X + progress * (VOLUME_CURVE_GRAPH_MAX_X - VOLUME_CURVE_GRAPH_MIN_X);
    const y = VOLUME_CURVE_GRAPH_MAX_Y
      - applySelectedVolumeCurve(progress) * (VOLUME_CURVE_GRAPH_MAX_Y - VOLUME_CURVE_GRAPH_MIN_Y);
    points.push(`${step === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }

  return points.join(' ');
}

function getVolumeCurvePreviewPoint(position) {
  const clampedPosition = clampPercent(position);
  const normalizedPosition = clampedPosition / 100;
  const curvedValue = applySelectedVolumeCurve(normalizedPosition);

  return {
    input: clampedPosition,
    output: mapFaderPositionToVolume(clampedPosition),
    x: VOLUME_CURVE_GRAPH_MIN_X
      + normalizedPosition * (VOLUME_CURVE_GRAPH_MAX_X - VOLUME_CURVE_GRAPH_MIN_X),
    y: VOLUME_CURVE_GRAPH_MAX_Y
      - curvedValue * (VOLUME_CURVE_GRAPH_MAX_Y - VOLUME_CURVE_GRAPH_MIN_Y)
  };
}

function setVolumeCurvePointVisible(isVisible) {
  dom.volumeCurvePoint?.classList.toggle('is-visible', isVisible);
}

function updateSettingsRangeFill(rangeElement) {
  if (!rangeElement) {
    return;
  }

  const min = Number(rangeElement.min || 0);
  const max = Number(rangeElement.max || 100);
  const value = Number(rangeElement.value || 0);
  const fillPercent = max === min
    ? 0
    : ((value - min) / (max - min)) * 100;

  rangeElement.style.setProperty('--settings-range-fill', `${clampPercent(fillPercent)}%`);
}

function updateVolumeCurveDemoUi(position = volumeCurveDemoPosition, { showPoint = false } = {}) {
  const previewPoint = getVolumeCurvePreviewPoint(position);
  const trackHeight = dom.volumeCurveDemoTrack?.clientHeight || 164;
  const thumbHeight = dom.volumeCurveDemoThumb?.offsetHeight || 44;
  const thumbTravel = Math.max(0, trackHeight - thumbHeight);
  const thumbBottom = (previewPoint.input / 100) * thumbTravel;
  const fillHeight = (previewPoint.output / 100) * trackHeight;

  volumeCurveDemoPosition = previewPoint.input;

  if (dom.volumeCurvePoint) {
    dom.volumeCurvePoint.setAttribute('cx', previewPoint.x.toFixed(1));
    dom.volumeCurvePoint.setAttribute('cy', previewPoint.y.toFixed(1));
  }

  setVolumeCurvePointVisible(showPoint);

  if (dom.volumeCurveDemoThumb) {
    dom.volumeCurveDemoThumb.style.bottom = `${thumbBottom}px`;
  }

  if (dom.volumeCurveDemoFill) {
    dom.volumeCurveDemoFill.style.height = `${fillHeight}px`;
  }

  if (dom.volumeCurveDemoValue) {
    dom.volumeCurveDemoValue.textContent = formatVolumeValue(previewPoint.output);
  }
}

function stopVolumeCurveDemo() {
  if (volumeCurveDemoTimer) {
    clearTimeout(volumeCurveDemoTimer);
    volumeCurveDemoTimer = null;
  }

  if (volumeCurveDemoFrame) {
    cancelAnimationFrame(volumeCurveDemoFrame);
    volumeCurveDemoFrame = null;
  }

  dom.volumeCurveDemoOutput?.classList.remove('is-live');
  setVolumeCurvePointVisible(false);
}

function easeInOutSine(progress) {
  return -(Math.cos(Math.PI * progress) - 1) / 2;
}

function interpolateValue(start, end, progress) {
  return start + ((end - start) * progress);
}

function getVolumeCurveDemoPosition(progress, startPosition = VOLUME_CURVE_DEMO_START_POSITION) {
  const splitPoint = 0.56;

  if (progress <= splitPoint) {
    return interpolateValue(
      startPosition,
      VOLUME_CURVE_DEMO_PEAK_POSITION,
      easeInOutSine(progress / splitPoint)
    );
  }

  return interpolateValue(
    VOLUME_CURVE_DEMO_PEAK_POSITION,
    VOLUME_CURVE_DEMO_END_POSITION,
    easeInOutSine((progress - splitPoint) / (1 - splitPoint))
  );
}

function startVolumeCurveDemo() {
  stopVolumeCurveDemo();

  if (!getVolumeCurveEnabled() || volumeCurveDemoDragging || !dom.volumeCurveDemoTrack) {
    return;
  }

  const startedAt = performance.now();
  const startPosition = volumeCurveDemoPosition;
  dom.volumeCurveDemoOutput?.classList.add('is-live');
  updateVolumeCurveDemoUi(startPosition, { showPoint: true });

  const tick = (timestamp) => {
    if (!getVolumeCurveEnabled() || volumeCurveDemoDragging) {
      volumeCurveDemoFrame = null;
      dom.volumeCurveDemoOutput?.classList.remove('is-live');
      setVolumeCurvePointVisible(false);
      return;
    }

    const progress = Math.min(1, (timestamp - startedAt) / VOLUME_CURVE_DEMO_DURATION_MS);
    updateVolumeCurveDemoUi(getVolumeCurveDemoPosition(progress, startPosition), {
      showPoint: true
    });

    if (progress < 1) {
      volumeCurveDemoFrame = requestAnimationFrame(tick);
      return;
    }

    volumeCurveDemoFrame = null;
    dom.volumeCurveDemoOutput?.classList.remove('is-live');
    setVolumeCurvePointVisible(false);
  };

  volumeCurveDemoFrame = requestAnimationFrame(tick);
}

function scheduleVolumeCurveDemo() {
  stopVolumeCurveDemo();

  if (!getVolumeCurveEnabled() || volumeCurveDemoDragging || !dom.volumeCurveDemoTrack) {
    return;
  }

  volumeCurveDemoTimer = setTimeout(() => {
    volumeCurveDemoTimer = null;
    startVolumeCurveDemo();
  }, VOLUME_CURVE_DEMO_DELAY_MS);
}

function getVolumeCurveDemoPointerPosition(clientY) {
  if (!dom.volumeCurveDemoTrack) {
    return volumeCurveDemoPosition;
  }

  const rect = dom.volumeCurveDemoTrack.getBoundingClientRect();
  const normalizedPosition = (rect.bottom - clientY) / rect.height;
  return clampPercent(Math.round(normalizedPosition * 100));
}

function onVolumeCurveDemoPointerMove(event) {
  if (!volumeCurveDemoDragging) {
    return;
  }

  updateVolumeCurveDemoUi(getVolumeCurveDemoPointerPosition(event.clientY), {
    showPoint: true
  });
}

function stopVolumeCurveDemoDrag() {
  if (!volumeCurveDemoDragging) {
    return;
  }

  volumeCurveDemoDragging = false;
  dom.volumeCurveDemoTrack?.classList.remove('is-dragging');
  dom.volumeCurveDemoOutput?.classList.remove('is-live');
  setVolumeCurvePointVisible(false);
  document.removeEventListener('pointermove', onVolumeCurveDemoPointerMove);
  document.removeEventListener('pointerup', stopVolumeCurveDemoDrag);
  document.removeEventListener('pointercancel', stopVolumeCurveDemoDrag);
}

function startVolumeCurveDemoDrag(event) {
  if (!dom.volumeCurveDemoTrack || event.button !== 0) {
    return;
  }

  event.preventDefault();
  stopVolumeCurveDemo();
  volumeCurveDemoDragging = true;
  dom.volumeCurveDemoTrack.classList.add('is-dragging');
  dom.volumeCurveDemoOutput?.classList.add('is-live');
  updateVolumeCurveDemoUi(getVolumeCurveDemoPointerPosition(event.clientY), {
    showPoint: true
  });
  document.addEventListener('pointermove', onVolumeCurveDemoPointerMove);
  document.addEventListener('pointerup', stopVolumeCurveDemoDrag);
  document.addEventListener('pointercancel', stopVolumeCurveDemoDrag);
}

function syncVolumeCurveUi() {
  const volumeCurveEnabled = getVolumeCurveEnabled();
  const volumeCurveType = getVolumeCurveType();
  const volumeCurveAmount = getVolumeCurveAmount();
  if (dom.volumeCurveToggle) {
    dom.volumeCurveToggle.classList.toggle('on', volumeCurveEnabled);
    dom.volumeCurveToggle.textContent = volumeCurveEnabled ? t('settings.on') : t('settings.off');
  }

  if (dom.volumeCurveAdvanced) {
    dom.volumeCurveAdvanced.classList.toggle('open', volumeCurveEnabled);
    dom.volumeCurveAdvanced.setAttribute('aria-hidden', String(!volumeCurveEnabled));
  }

  if (dom.volumeCurveRange) {
    dom.volumeCurveRange.value = String(volumeCurveAmount);
    dom.volumeCurveRange.disabled = !volumeCurveEnabled;
    updateSettingsRangeFill(dom.volumeCurveRange);
  }

  dom.volumeCurveModeButtons?.forEach((button) => {
    button.classList.toggle('active', button.dataset.curveType === volumeCurveType);
    button.disabled = !volumeCurveEnabled;
  });

  if (dom.volumeCurvePath) {
    dom.volumeCurvePath.setAttribute('d', buildVolumeCurvePreviewPath());
  }

  updateVolumeCurveDemoUi(volumeCurveDemoPosition, { showPoint: false });

  if (!volumeCurveEnabled) {
    stopVolumeCurveDemo();
  }

  scheduleMenuPanelCardSizeSync();
}

function syncLanguageUi() {
  if (dom.languageSelect) {
    dom.languageSelect.value = getCurrentLanguage();
    enhanceCustomSelects?.(dom.languageSelect);
  }
}

function refreshCurveDrivenUi() {
  if (typeof refreshChannelOutputVolumes === 'function') {
    refreshChannelOutputVolumes();
    return;
  }

  if (typeof updateFadersFromState === 'function') {
    updateFadersFromState();
  }
}

function syncSettingsViewportUi() {
  const settingsScroller = dom.settingsContent;
  const settingsTabActive = isMenuOpen() && getActiveMenuTab() === 'settings';

  if (!settingsScroller || !settingsTabActive) {
    dom.settingsScrollShell?.classList.remove('has-overflow', 'at-top', 'at-bottom');
    dom.menuPanelCard?.classList.remove('settings-fade-active', 'settings-at-top', 'settings-at-bottom');
    resetSettingsSectionEffects();
    return;
  }

  const maxScroll = Math.max(0, settingsScroller.scrollHeight - settingsScroller.clientHeight);
  const shouldShowFade = maxScroll > 1;
  const isAtTop = settingsScroller.scrollTop <= 1;
  const isAtBottom = !shouldShowFade || settingsScroller.scrollTop >= (maxScroll - 1);

  dom.settingsScrollShell?.classList.toggle('has-overflow', shouldShowFade);
  dom.settingsScrollShell?.classList.toggle('at-top', isAtTop);
  dom.settingsScrollShell?.classList.toggle('at-bottom', isAtBottom);
  dom.menuPanelCard?.classList.toggle('settings-fade-active', shouldShowFade);
  dom.menuPanelCard?.classList.toggle('settings-at-top', isAtTop);
  dom.menuPanelCard?.classList.toggle('settings-at-bottom', isAtBottom);

  if (!shouldShowFade) {
    resetSettingsSectionEffects();
    return;
  }

  syncSettingsSectionEffects();
}

function resetSettingsSectionEffects() {
  dom.settingsSections?.forEach((section) => {
    section.style.removeProperty('transform');
    section.style.removeProperty('opacity');
    section.style.removeProperty('transform-origin');
  });
}

function syncSettingsSectionEffects() {
  const settingsScroller = dom.settingsContent || dom.settingsScrollShell;

  if (!settingsScroller || !dom.settingsSections?.length) {
    return;
  }

  const viewportTop = settingsScroller.scrollTop;
  const viewportBottom = viewportTop + settingsScroller.clientHeight;

  dom.settingsSections.forEach((section) => {
    const sectionTop = section.offsetTop;
    const sectionHeight = section.offsetHeight;
    const sectionBottom = sectionTop + sectionHeight;
    const visibleHeight = Math.max(
      0,
      Math.min(sectionBottom, viewportBottom) - Math.max(sectionTop, viewportTop)
    );
    const visibleRatio = sectionHeight > 0 ? (visibleHeight / sectionHeight) : 1;

    if (visibleRatio >= SETTINGS_SECTION_HIDE_THRESHOLD) {
      section.style.transform = 'translateY(0) scale(1)';
      section.style.opacity = '1';
      section.style.transformOrigin = 'center center';
      return;
    }

    const progress = Math.max(
      0,
      Math.min(
        1,
        (SETTINGS_SECTION_HIDE_THRESHOLD - visibleRatio) / SETTINGS_SECTION_HIDE_THRESHOLD
      )
    );
    const scale = SETTINGS_SECTION_MIN_SCALE + ((1 - progress) * (1 - SETTINGS_SECTION_MIN_SCALE));
    const opacity = 0.72 + ((1 - progress) * 0.28);
    const isLeavingTop = sectionTop < viewportTop;
    const isLeavingBottom = sectionBottom > viewportBottom;
    const shift = isLeavingTop
      ? -(SETTINGS_SECTION_MAX_SHIFT * progress)
      : (isLeavingBottom ? (SETTINGS_SECTION_MAX_SHIFT * progress) : 0);

    section.style.transformOrigin = isLeavingTop
      ? 'center top'
      : (isLeavingBottom ? 'center bottom' : 'center center');
    section.style.transform = `translateY(${shift.toFixed(2)}px) scale(${scale.toFixed(4)})`;
    section.style.opacity = opacity.toFixed(4);
  });
}

function hideSettingsTooltip() {
  activeSettingsTooltipTarget = null;

  if (!dom.settingsTooltipLayer || !dom.settingsTooltipBubble) {
    return;
  }

  dom.settingsTooltipLayer.classList.add('hidden');
  dom.settingsTooltipLayer.setAttribute('aria-hidden', 'true');
  dom.settingsTooltipBubble.textContent = '';
  dom.settingsTooltipBubble.style.removeProperty('left');
  dom.settingsTooltipBubble.style.removeProperty('top');
}

function positionSettingsTooltip(target) {
  if (!target || !dom.settingsTooltipLayer || !dom.settingsTooltipBubble || !dom.menuPanelOverlay) {
    return;
  }

  const tooltipText = target.dataset.tooltip || target.getAttribute('aria-label') || '';

  if (!tooltipText) {
    hideSettingsTooltip();
    return;
  }

  activeSettingsTooltipTarget = target;
  dom.settingsTooltipBubble.textContent = tooltipText;
  dom.settingsTooltipLayer.classList.remove('hidden');
  dom.settingsTooltipLayer.setAttribute('aria-hidden', 'false');

  requestAnimationFrame(() => {
    if (activeSettingsTooltipTarget !== target) {
      return;
    }

    const overlayRect = dom.menuPanelOverlay.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const bubbleRect = dom.settingsTooltipBubble.getBoundingClientRect();
    const horizontalPadding = 10;
    const preferredLeft = (
      targetRect.left
      - overlayRect.left
      + (targetRect.width / 2)
      - (bubbleRect.width / 2)
    );
    const maxLeft = Math.max(horizontalPadding, overlayRect.width - bubbleRect.width - horizontalPadding);
    const clampedLeft = Math.max(horizontalPadding, Math.min(preferredLeft, maxLeft));
    const top = (
      targetRect.top
      - overlayRect.top
      - bubbleRect.height
      - 14
    );

    dom.settingsTooltipBubble.style.left = `${clampedLeft}px`;
    dom.settingsTooltipBubble.style.top = `${top}px`;
  });
}

function scheduleContentMetricsUpdate() {
  // Native scrollbars are used everywhere now, so external callers can keep
  // calling this safely without any JS-driven scrollbar sync work.
}

function setupSettingsTooltips() {
  document.querySelectorAll('.settings-help').forEach((button) => {
    button.addEventListener('mouseenter', () => {
      positionSettingsTooltip(button);
    });

    button.addEventListener('mouseleave', () => {
      hideSettingsTooltip();
    });

    button.addEventListener('focus', () => {
      positionSettingsTooltip(button);
    });

    button.addEventListener('blur', () => {
      hideSettingsTooltip();
    });
  });
}

function setupSettings() {
  dom.advancedModeToggle?.addEventListener('click', () => {
    window.uiActions?.toggleAdvancedMode({ source: 'ui' });
  });

  dom.developerModeToggle?.addEventListener('click', () => {
    window.uiActions?.toggleDeveloperMode({ source: 'ui' });
  });

  dom.faderInterpolationToggle?.addEventListener('click', () => {
    window.uiActions?.toggleFaderInterpolation({ source: 'ui' });
  });

  dom.softTakeoverToggle?.addEventListener('click', () => {
    window.uiActions?.toggleSoftTakeover({ source: 'ui' });
  });

  dom.softTakeoverThresholdRange?.addEventListener('input', (event) => {
    const sliderValue = Math.max(
      0,
      Math.min(SOFT_TAKEOVER_MAX_THRESHOLD, Number.parseInt(event.target.value, 10) || 0)
    );

    if (sliderValue === getSoftTakeoverThreshold()) {
      return;
    }

    window.uiActions?.setSoftTakeoverThreshold(sliderValue, { source: 'ui' });
  });

  dom.profileToolbarToggle?.addEventListener('click', () => {
    window.uiActions?.toggleProfileToolbarSwitcher({ source: 'ui' });
  });

  dom.volumeHudToggle?.addEventListener('click', () => {
    window.uiActions?.toggleVolumeHud({ source: 'ui' });
  });

  dom.volumeHudPositionSelect?.addEventListener('change', (event) => {
    window.uiActions?.setVolumeHudPosition(event.target.value, { source: 'ui' });
  });

  dom.volumeHudOrientationToggle?.addEventListener('click', () => {
    window.uiActions?.toggleVolumeHudOrientation({ source: 'ui' });
  });

  dom.volumeHudShowIconToggle?.addEventListener('click', () => {
    window.uiActions?.toggleVolumeHudShowIcon({ source: 'ui' });
  });

  dom.volumeHudShowTitleToggle?.addEventListener('click', () => {
    window.uiActions?.toggleVolumeHudShowTitle({ source: 'ui' });
  });

  dom.volumeHudShowSubtitleToggle?.addEventListener('click', () => {
    window.uiActions?.toggleVolumeHudShowSubtitle({ source: 'ui' });
  });

  dom.volumeHudShowPercentToggle?.addEventListener('click', () => {
    window.uiActions?.toggleVolumeHudShowPercent({ source: 'ui' });
  });

  dom.volumeHudShowMeterToggle?.addEventListener('click', () => {
    window.uiActions?.toggleVolumeHudShowMeter({ source: 'ui' });
  });

  dom.showFractionalNumbersToggle?.addEventListener('click', () => {
    window.uiActions?.toggleShowFractionalNumbers({ source: 'ui' });
  });

  dom.showFractionalOnlyLowToggle?.addEventListener('click', () => {
    window.uiActions?.toggleShowFractionalOnlyLow({ source: 'ui' });
  });

  dom.volumeCurveToggle?.addEventListener('click', () => {
    window.uiActions?.toggleVolumeCurve({ source: 'ui' });
  });

  dom.volumeCurveModeButtons?.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.curveType === getVolumeCurveType()) {
        return;
      }

      window.uiActions?.setVolumeCurveType(button.dataset.curveType, { source: 'ui' });
    });
  });

  dom.volumeCurveRange?.addEventListener('input', (event) => {
    const sliderValue = Math.max(
      0,
      Math.min(VOLUME_CURVE_MAX, Number.parseInt(event.target.value, 10) || 0)
    );

    if (sliderValue === getVolumeCurveAmount()) {
      return;
    }

    window.uiActions?.setVolumeCurveAmount(sliderValue, { source: 'ui' });
  });

  dom.languageSelect?.addEventListener('change', (event) => {
    setLanguage(event.target.value);
  });

  dom.volumeCurveDemoTrack?.addEventListener('pointerdown', startVolumeCurveDemoDrag);
  dom.settingsContent?.addEventListener('scroll', () => {
    hideSettingsTooltip();
    syncSettingsViewportUi();
  }, { passive: true });
}

async function loadAudioApps(options = {}) {
  const force = Boolean(options?.force);
  const now = Date.now();

  if (audioAppsRefreshInFlight) {
    if (force) {
      audioAppsRefreshQueued = true;
    }
    return audioAppsRefreshInFlight;
  }

  if (!force && audioApps.length && (now - audioAppsLastRefreshAt) < AUDIO_APPS_REFRESH_MIN_INTERVAL_MS) {
    return audioApps;
  }

  audioAppsRefreshInFlight = (async () => {
    let nextApplications;

    try {
      const api = getApi();

      if (!api) {
        console.warn('pywebview.api not ready in loadAudioApps');
        return audioApps;
      }

      const response = await api.get_audio_applications();
      nextApplications = buildAudioAppsList(
        response?.applications?.length ? response.applications : FALLBACK_AUDIO_APPS
      );
    } catch (error) {
      console.error(error);
      nextApplications = buildAudioAppsList(FALLBACK_AUDIO_APPS);
    }

    nextApplications = applyCachedAudioAppIcons(nextApplications);
    setAudioApps(nextApplications);

    const enrichedApplications = await enrichAudioAppsWithIcons(nextApplications);
    setAudioApps(enrichedApplications);
    audioAppsLastRefreshAt = Date.now();
    return audioApps;
  })();

  try {
    return await audioAppsRefreshInFlight;
  } finally {
    audioAppsRefreshInFlight = null;

    if (audioAppsRefreshQueued) {
      audioAppsRefreshQueued = false;
      requestAudioAppsRefresh('queued-refresh', { force: true });
    }
  }
}

function requestAudioAppsRefresh(reason = 'runtime', options = {}) {
  const force = Boolean(options?.force);

  if (!force && document.visibilityState === 'hidden') {
    return Promise.resolve(audioApps);
  }

  return loadAudioApps({ force });
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

  dom.contextMenu.style.display = 'block';

  const menuRect = dom.contextMenu.getBoundingClientRect();
  const nextLeft = Math.min(
    window.innerWidth - menuRect.width - 8,
    event.clientX + 10
  );
  const nextTop = Math.min(
    window.innerHeight - menuRect.height - 8,
    event.clientY + 10
  );

  dom.contextMenu.style.left = `${Math.max(8, nextLeft)}px`;
  dom.contextMenu.style.top = `${Math.max(8, nextTop)}px`;
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
    const channel = findChannelState?.(channelId);

    if (!channel) {
      return;
    }

    if (action === 'delete') {
      window.channelActions?.removeChannelButton(channelId, buttonId, { source: 'context-menu' });
    }

    if (action === 'remap') remapButton(channelId, buttonId);
    if (action === 'edit') configureButton(channelId, buttonId);
    return;
  }

  if (contextTarget.type === 'standalone') {
    const { buttonId } = contextTarget;

    if (action === 'delete') {
      removeStandaloneButtonState?.(buttonId, { source: 'context-menu' });
      window.profileActions?.saveRendererProfileToLocal?.();
    }

    if (action === 'remap') remapStandaloneButton(buttonId);
    if (action === 'edit') configureStandaloneButton(buttonId);
  }
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
      window.uiActions?.toggleMainMenuTab(tab.dataset.tab, { source: 'ui' });
    });
  });
}

function initUiStateSync() {
  if (uiStateSyncInitialized || typeof subscribeUiState !== 'function') {
    return;
  }

  subscribeUiState((nextUiState, previousUiState) => {
    const nextSettings = nextUiState.settings;
    const previousSettings = previousUiState.settings;
    const nextMenu = nextUiState.menu;
    const previousMenu = previousUiState.menu;

    if (nextSettings.advancedMode !== previousSettings.advancedMode) {
      syncAdvancedModeUi();
      renderMixer();
    }

    if (nextSettings.developerMode !== previousSettings.developerMode) {
      syncDeveloperModeUi();
    }

    if (nextSettings.faderInterpolationEnabled !== previousSettings.faderInterpolationEnabled) {
      syncFaderInterpolationUi();
    }

    if (
      nextSettings.softTakeoverEnabled !== previousSettings.softTakeoverEnabled
      || nextSettings.softTakeoverThreshold !== previousSettings.softTakeoverThreshold
    ) {
      syncSoftTakeoverUi();
    }

    if (nextSettings.profileToolbarSwitcherEnabled !== previousSettings.profileToolbarSwitcherEnabled) {
      syncProfileToolbarUi();
    }

    if (
      nextSettings.volumeHudEnabled !== previousSettings.volumeHudEnabled
      || nextSettings.volumeHudPosition !== previousSettings.volumeHudPosition
      || nextSettings.volumeHudOrientation !== previousSettings.volumeHudOrientation
      || nextSettings.volumeHudShowIcon !== previousSettings.volumeHudShowIcon
      || nextSettings.volumeHudShowTitle !== previousSettings.volumeHudShowTitle
      || nextSettings.volumeHudShowSubtitle !== previousSettings.volumeHudShowSubtitle
      || nextSettings.volumeHudShowPercent !== previousSettings.volumeHudShowPercent
      || nextSettings.volumeHudShowMeter !== previousSettings.volumeHudShowMeter
    ) {
      syncVolumeHudUi();
    }

    if (
      nextSettings.showFractionalNumbers !== previousSettings.showFractionalNumbers
      || nextSettings.showFractionalOnlyLow !== previousSettings.showFractionalOnlyLow
    ) {
      syncFractionalNumberUi();
      refreshCurveDrivenUi();
      updateVolumeCurveDemoUi(volumeCurveDemoPosition, { showPoint: false });
    }

    if (
      nextSettings.volumeCurveEnabled !== previousSettings.volumeCurveEnabled
      || nextSettings.volumeCurveType !== previousSettings.volumeCurveType
      || nextSettings.volumeCurveAmount !== previousSettings.volumeCurveAmount
    ) {
      syncVolumeCurveUi();
      refreshCurveDrivenUi();
      scheduleVolumeCurveDemo();
    }

    if (nextMenu.open !== previousMenu.open) {
      syncMenuShellUi();
      scheduleContentMetricsUpdate();
      syncSettingsViewportUi();
    }

    if (nextMenu.activeTab !== previousMenu.activeTab) {
      syncMenuTabUi();
      syncSettingsViewportUi();
    }
  });

  uiStateSyncInitialized = true;
}

function handleLanguageChanged() {
  syncLanguageUi();
  syncAdvancedModeUi();
  syncDeveloperModeUi();
  syncFaderInterpolationUi();
  syncSoftTakeoverUi();
  syncProfileToolbarUi();
  syncVolumeHudUi();
  syncFractionalNumberUi();
  syncVolumeCurveUi();
  audioApps = buildAudioAppsList(audioApps);
  audioApps = applyCachedAudioAppIcons(audioApps);
  renderMixer();
  renderStandaloneButtons();
  refreshProfilesLanguage?.();
  window.dispatchEvent(new CustomEvent('audio-apps-updated', {
    detail: {
      apps: getAvailableAudioApps()
    }
  }));

  if (typeof refreshMidiUiLanguage === 'function') {
    refreshMidiUiLanguage();
  }

  scheduleContentMetricsUpdate();
  scheduleMenuPanelCardSizeSync();
  syncSettingsViewportUi();
}

function bindGlobalUi() {
  if (dom.buttonKey) {
    dom.buttonKey.addEventListener('keydown', captureKey);
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'F12' || !getDeveloperModeEnabled()) {
      return;
    }

    event.preventDefault();
    getApi()?.toggle_devtools?.();
  });

  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('click', hideContextMenu);
  window.addEventListener('app:language-changed', handleLanguageChanged);
  window.addEventListener('beforeunload', stopVolumeCurveDemo);
  window.addEventListener('resize', scheduleMenuPanelCardSizeSync);
  window.addEventListener('focus', () => {
    requestAudioAppsRefresh('window-focus');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestAudioAppsRefresh('document-visible');
    }
  });
  window.addEventListener('audio-apps-refresh-requested', (event) => {
    requestAudioAppsRefresh(
      event?.detail?.reason || 'external-request',
      event?.detail || {}
    );
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.settings-help')) {
      hideSettingsTooltip();
    }
  });

  document.querySelectorAll('#contextMenu .context-item').forEach((item) => {
    item.addEventListener('click', onContextItemClick);
  });
}

function init() {
  cacheDomElements();
  hideLegacyVolumeHudSettingsUi();
  initUiStore?.();
  applyTranslations();
  enhanceCustomSelects?.(document);
  initChannelUiStateSync?.();
  initStandaloneButtonsStateSync?.();
  initUiStateSync();
  initButtonModal?.();
  initEntityEditor?.();
  bindGlobalUi();
  setupSettings();
  setupSettingsTooltips();
  setupWindowControls();
  setupMenuTabs();
  syncMenuShellUi();
  syncAdvancedModeUi();
  syncDeveloperModeUi();
  syncFaderInterpolationUi();
  syncSoftTakeoverUi();
  syncProfileToolbarUi();
  syncVolumeHudUi();
  syncFractionalNumberUi();
  syncVolumeCurveUi();
  syncLanguageUi();
  syncMenuTabUi();
  scheduleMenuPanelCardSizeSync();
  syncSettingsViewportUi();
  window.profileActions?.loadRendererProfileFromLocal?.();
  initProfilesUi?.();
  requestAudioAppsRefresh('init', { force: true });
  initWebMIDI();
  scheduleContentMetricsUpdate();
}

window.requestAudioAppsRefresh = requestAudioAppsRefresh;
window.getVolumeHudPresentationSettings = getVolumeHudPresentationSettings;
window.getApi = getApi;
window.logTest = logTest;

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
