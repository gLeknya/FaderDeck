let channels = [];
let standaloneButtonsList = [];
let audioApps = [];
let currentButtonConfig = null;
let contextTarget = null;
let advancedMode = false;
let developerMode = false;
let faderInterpolationEnabled = false;
let showFractionalNumbers = false;
let showFractionalOnlyLow = false;
let volumeCurveEnabled = false;
let volumeCurveType = 'ease-in-out';
let volumeCurveAmount = 0;
let profileToolbarSwitcherEnabled = true;
let activeMenuTab = null;
let menuScrollVisibilitySnapshot = null;
let menuPanelMetricsTimeout = null;

const dom = {};
const VOLUME_CURVE_MAX = 100;
const VOLUME_CURVE_EXPONENT_RANGE = 2.2;
const VOLUME_PRECISION_DIGITS = 3;
const LOW_FRACTIONAL_VOLUME_THRESHOLD = 10;
const VOLUME_CURVE_GRAPH_MIN_X = 20;
const VOLUME_CURVE_GRAPH_MAX_X = 200;
const VOLUME_CURVE_GRAPH_MIN_Y = 20;
const VOLUME_CURVE_GRAPH_MAX_Y = 120;
const VOLUME_CURVE_DEMO_DELAY_MS = 1000;
const VOLUME_CURVE_DEMO_DURATION_MS = 2200;
const VOLUME_CURVE_DEMO_START_POSITION = 0;
const VOLUME_CURVE_DEMO_PEAK_POSITION = 100;
const VOLUME_CURVE_DEMO_END_POSITION = 0;
const MENU_PANEL_SIZE_SETTLE_DELAY_MS = 260;
const UI_STORAGE_KEYS = {
  advancedMode: 'faderdeck_advanced_mode',
  developerMode: 'faderdeck_developer_mode',
  faderInterpolationEnabled: 'faderdeck_fader_interpolation_enabled',
  showFractionalNumbers: 'faderdeck_show_fractional_numbers',
  showFractionalOnlyLow: 'faderdeck_show_fractional_only_low',
  volumeCurveEnabled: 'faderdeck_volume_curve_enabled',
  volumeCurveType: 'faderdeck_volume_curve_type',
  volumeCurveAmount: 'faderdeck_volume_curve_amount',
  profileToolbarSwitcherEnabled: 'faderdeck_profile_toolbar_switcher_enabled'
};
const FALLBACK_AUDIO_APPS = [
  { name: 'Chrome', process: 'chrome.exe' },
  { name: 'Spotify', process: 'spotify.exe' },
  { name: 'Discord', process: 'discord.exe' },
  { name: 'OBS Studio', process: 'obs64.exe' },
  { name: 'VLC', process: 'vlc.exe' }
];

let contentMetricsFrame = null;
let volumeCurveDemoPosition = 0;
let volumeCurveDemoTimer = null;
let volumeCurveDemoFrame = null;
let volumeCurveDemoDragging = false;
let menuPanelMetricsFrame = null;

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
  dom.menuPanelCard = document.querySelector('.menu-panel-card');
  dom.advancedModeToggle = $('advancedModeToggle');
  dom.developerModeToggle = $('developerModeToggle');
  dom.faderInterpolationToggle = $('faderInterpolationToggle');
  dom.profileToolbarToggle = $('profileToolbarToggle');
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
  dom.mainContentViewport = $('mainContentViewport');
  dom.contentScrollBar = $('contentScrollBar');
  dom.contentScrollRange = $('contentScrollRange');
}

function loadUiSettingsFromLocal() {
  advancedMode = readUiBooleanSetting(UI_STORAGE_KEYS.advancedMode);
  developerMode = readUiBooleanSetting(UI_STORAGE_KEYS.developerMode);
  faderInterpolationEnabled = readUiBooleanSetting(UI_STORAGE_KEYS.faderInterpolationEnabled);
  profileToolbarSwitcherEnabled = readUiBooleanSetting(
    UI_STORAGE_KEYS.profileToolbarSwitcherEnabled,
    true
  );
  showFractionalNumbers = readUiBooleanSetting(UI_STORAGE_KEYS.showFractionalNumbers);
  showFractionalOnlyLow = readUiBooleanSetting(UI_STORAGE_KEYS.showFractionalOnlyLow);
  volumeCurveEnabled = readUiBooleanSetting(UI_STORAGE_KEYS.volumeCurveEnabled);
  volumeCurveType = localStorage.getItem(UI_STORAGE_KEYS.volumeCurveType) || 'ease-in-out';
  if (!['ease-in', 'ease-out', 'ease-in-out'].includes(volumeCurveType)) {
    volumeCurveType = 'ease-in-out';
  }
  volumeCurveAmount = readUiNumberSetting(UI_STORAGE_KEYS.volumeCurveAmount, 0, {
    min: 0,
    max: VOLUME_CURVE_MAX
  });
}

function saveUiBooleanSetting(key, value) {
  localStorage.setItem(key, String(Boolean(value)));
}

function saveUiNumberSetting(key, value) {
  localStorage.setItem(key, String(value));
}

function readUiBooleanSetting(key, fallback = false) {
  const rawValue = localStorage.getItem(key);
  return rawValue === null ? fallback : rawValue === 'true';
}

function readUiNumberSetting(key, fallback, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  const rawValue = localStorage.getItem(key);
  const parsedValue = Number.parseInt(rawValue ?? '', 10);

  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsedValue));
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function normalizeVolumeValue(value) {
  const precisionFactor = 10 ** VOLUME_PRECISION_DIGITS;
  return Math.round(clampPercent(value) * precisionFactor) / precisionFactor;
}

function formatVolumeValue(value) {
  const normalizedValue = normalizeVolumeValue(value);
  const shouldShowFractions = showFractionalNumbers
    && (!showFractionalOnlyLow || normalizedValue < LOW_FRACTIONAL_VOLUME_THRESHOLD);
  const formattedValue = shouldShowFractions
    ? normalizedValue.toFixed(1).replace(/\.0$/, '')
    : String(Math.round(normalizedValue));

  return `${formattedValue}%`;
}

function getVolumeCurveAmount() {
  return volumeCurveAmount;
}

function getVolumeCurveEnabled() {
  return volumeCurveEnabled;
}

function getVolumeCurveType() {
  return volumeCurveType;
}

function getFaderInterpolationEnabled() {
  return faderInterpolationEnabled;
}

function getVolumeCurveExponent() {
  return 1 + (volumeCurveAmount / VOLUME_CURVE_MAX) * VOLUME_CURVE_EXPONENT_RANGE;
}

function applySelectedVolumeCurve(normalizedPosition) {
  const exponent = getVolumeCurveExponent();

  if (!volumeCurveEnabled) {
    return normalizedPosition;
  }

  if (volumeCurveType === 'ease-in') {
    return normalizedPosition ** exponent;
  }

  if (volumeCurveType === 'ease-out') {
    return 1 - ((1 - normalizedPosition) ** exponent);
  }

  if (normalizedPosition < 0.5) {
    return 0.5 * ((normalizedPosition * 2) ** exponent);
  }

  return 1 - 0.5 * (((1 - normalizedPosition) * 2) ** exponent);
}

function mapFaderPositionToVolume(position) {
  const normalizedPosition = clampPercent(position) / 100;

  if (normalizedPosition <= 0) {
    return 0;
  }

  if (normalizedPosition >= 1) {
    return 100;
  }

  if (!volumeCurveEnabled || volumeCurveAmount <= 0) {
    return normalizeVolumeValue(normalizedPosition * 100);
  }

  const curvedValue = applySelectedVolumeCurve(normalizedPosition);
  return normalizeVolumeValue(curvedValue * 100);
}

function isMenuOpen() {
  return dom.menuRail?.classList.contains('open');
}

function transitionMenuView(view, shouldBeActive) {
  clearTimeout(view.__hideTimer);

  if (shouldBeActive) {
    view.hidden = false;
    view.classList.add('is-active');

    requestAnimationFrame(() => {
      view.classList.add('is-visible');
    });
    return;
  }

  view.classList.remove('is-active', 'is-visible');

  if (view.hidden) {
    return;
  }

  view.__hideTimer = setTimeout(() => {
    if (!view.classList.contains('is-active')) {
      view.hidden = true;
    }
  }, 180);
}

function syncMenuPanelCardSize() {
  if (!dom.menuPanelCard) {
    return;
  }

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
  const maxWidth = Math.max(280, Math.min(420, window.innerWidth - 140));
  const nextWidth = activeMenuTab === 'settings'
    ? maxWidth
    : Math.max(280, Math.min(maxWidth, Math.ceil(activeView.scrollWidth + horizontalPadding)));
  const nextContentWidth = Math.max(0, nextWidth - horizontalPadding);
  const nextContentHeight = activeMenuTab === 'settings'
    ? measureMenuViewContentHeight(activeView, nextContentWidth)
    : activeView.scrollHeight;
  const nextHeight = Math.ceil(nextContentHeight + verticalPadding);

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
  });

  menuPanelMetricsTimeout = window.setTimeout(() => {
    menuPanelMetricsTimeout = null;
    syncMenuPanelCardSize();
  }, MENU_PANEL_SIZE_SETTLE_DELAY_MS);
}

function syncMenuTabUi() {
  dom.menuTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === activeMenuTab);
  });

  dom.menuViews.forEach((view) => {
    transitionMenuView(view, view.dataset.tab === activeMenuTab);
  });

  dom.menuPanelOverlay?.classList.toggle('hidden', !activeMenuTab);
  scheduleMenuPanelCardSizeSync();
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

function syncAdvancedModeUi() {
  if (!dom.advancedModeToggle) {
    return;
  }

  dom.advancedModeToggle.classList.toggle('on', advancedMode);
  dom.advancedModeToggle.textContent = advancedMode ? t('settings.on') : t('settings.off');
  scheduleMenuPanelCardSizeSync();
}

function syncDeveloperModeUi() {
  if (!dom.developerModeToggle) {
    return;
  }

  dom.developerModeToggle.classList.toggle('on', developerMode);
  dom.developerModeToggle.textContent = developerMode ? t('settings.on') : t('settings.off');
}

function syncFaderInterpolationUi() {
  if (dom.faderInterpolationToggle) {
    dom.faderInterpolationToggle.classList.toggle('on', faderInterpolationEnabled);
    dom.faderInterpolationToggle.textContent = faderInterpolationEnabled
      ? t('settings.on')
      : t('settings.off');
  }

  document.body.classList.toggle('fader-interpolation-enabled', faderInterpolationEnabled);
}

function isToolbarProfilePickerEnabled() {
  return profileToolbarSwitcherEnabled;
}

function syncProfileToolbarUi() {
  if (!dom.profileToolbarToggle) {
    return;
  }

  dom.profileToolbarToggle.classList.toggle('on', profileToolbarSwitcherEnabled);
  dom.profileToolbarToggle.textContent = profileToolbarSwitcherEnabled
    ? t('settings.on')
    : t('settings.off');
  syncToolbarProfilePickerVisibility?.();
}

function syncFractionalNumberUi() {
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

  if (!volumeCurveEnabled || volumeCurveDemoDragging || !dom.volumeCurveDemoTrack) {
    return;
  }

  const startedAt = performance.now();
  const startPosition = volumeCurveDemoPosition;
  dom.volumeCurveDemoOutput?.classList.add('is-live');
  updateVolumeCurveDemoUi(startPosition, { showPoint: true });

  const tick = (timestamp) => {
    if (!volumeCurveEnabled || volumeCurveDemoDragging) {
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

  if (!volumeCurveEnabled || volumeCurveDemoDragging || !dom.volumeCurveDemoTrack) {
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
  syncFaderInterpolationUi();
  syncProfileToolbarUi();
  syncFractionalNumberUi();
  syncVolumeCurveUi();
  syncLanguageUi();

  dom.advancedModeToggle?.addEventListener('click', () => {
    advancedMode = !advancedMode;
    saveUiBooleanSetting(UI_STORAGE_KEYS.advancedMode, advancedMode);
    syncAdvancedModeUi();
    renderMixer();
  });

  dom.developerModeToggle?.addEventListener('click', () => {
    developerMode = !developerMode;
    saveUiBooleanSetting(UI_STORAGE_KEYS.developerMode, developerMode);
    syncDeveloperModeUi();
  });

  dom.faderInterpolationToggle?.addEventListener('click', () => {
    faderInterpolationEnabled = !faderInterpolationEnabled;
    saveUiBooleanSetting(UI_STORAGE_KEYS.faderInterpolationEnabled, faderInterpolationEnabled);
    syncFaderInterpolationUi();
  });

  dom.profileToolbarToggle?.addEventListener('click', () => {
    profileToolbarSwitcherEnabled = !profileToolbarSwitcherEnabled;
    saveUiBooleanSetting(
      UI_STORAGE_KEYS.profileToolbarSwitcherEnabled,
      profileToolbarSwitcherEnabled
    );
    syncProfileToolbarUi();
  });

  dom.showFractionalNumbersToggle?.addEventListener('click', () => {
    showFractionalNumbers = !showFractionalNumbers;
    saveUiBooleanSetting(UI_STORAGE_KEYS.showFractionalNumbers, showFractionalNumbers);
    syncFractionalNumberUi();
    refreshCurveDrivenUi();
    updateVolumeCurveDemoUi(volumeCurveDemoPosition, { showPoint: false });
  });

  dom.showFractionalOnlyLowToggle?.addEventListener('click', () => {
    showFractionalOnlyLow = !showFractionalOnlyLow;
    saveUiBooleanSetting(UI_STORAGE_KEYS.showFractionalOnlyLow, showFractionalOnlyLow);
    syncFractionalNumberUi();
    refreshCurveDrivenUi();
    updateVolumeCurveDemoUi(volumeCurveDemoPosition, { showPoint: false });
  });

  dom.volumeCurveToggle?.addEventListener('click', () => {
    volumeCurveEnabled = !volumeCurveEnabled;
    saveUiBooleanSetting(UI_STORAGE_KEYS.volumeCurveEnabled, volumeCurveEnabled);
    syncVolumeCurveUi();
    refreshCurveDrivenUi();
    scheduleVolumeCurveDemo();
  });

  dom.volumeCurveModeButtons?.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.curveType === volumeCurveType) {
        return;
      }

      volumeCurveType = button.dataset.curveType;
      localStorage.setItem(UI_STORAGE_KEYS.volumeCurveType, volumeCurveType);
      syncVolumeCurveUi();
      refreshCurveDrivenUi();
      scheduleVolumeCurveDemo();
    });
  });

  dom.volumeCurveRange?.addEventListener('input', (event) => {
    const sliderValue = Math.max(
      0,
      Math.min(VOLUME_CURVE_MAX, Number.parseInt(event.target.value, 10) || 0)
    );

    if (sliderValue === volumeCurveAmount) {
      return;
    }

    volumeCurveAmount = sliderValue;
    saveUiNumberSetting(UI_STORAGE_KEYS.volumeCurveAmount, volumeCurveAmount);
    syncVolumeCurveUi();
    refreshCurveDrivenUi();
    scheduleVolumeCurveDemo();
  });

  dom.languageSelect?.addEventListener('change', (event) => {
    setLanguage(event.target.value);
  });

  dom.volumeCurveDemoTrack?.addEventListener('pointerdown', startVolumeCurveDemoDrag);
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
  const profile = {
    channels,
    standaloneButtons: standaloneButtonsList,
    settings: getCurrentMidiSelectionSettings?.() || {}
  };
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
    applySavedMidiInputSelection?.(
      profile.settings?.midiInputId || '',
      profile.settings?.midiInputName || ''
    );
  } catch (error) {
    console.error('loadProfile error', error);
  }

  renderMixer();
  renderStandaloneButtons();
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
  syncFaderInterpolationUi();
  syncProfileToolbarUi();
  syncFractionalNumberUi();
  syncVolumeCurveUi();
  audioApps = buildAudioAppsList(audioApps);
  renderMixer();
  renderStandaloneButtons();
  refreshProfilesLanguage?.();

  if (typeof refreshMidiUiLanguage === 'function') {
    refreshMidiUiLanguage();
  }

  scheduleContentMetricsUpdate();
  scheduleMenuPanelCardSizeSync();
}

function bindGlobalUi() {
  if (dom.buttonKey) {
    dom.buttonKey.addEventListener('keydown', captureKey);
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'F12' || !developerMode) {
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

  document.querySelectorAll('#contextMenu .context-item').forEach((item) => {
    item.addEventListener('click', onContextItemClick);
  });
}

function init() {
  cacheDomElements();
  loadUiSettingsFromLocal();
  applyTranslations();
  enhanceCustomSelects?.(document);
  bindGlobalUi();
  setupSettings();
  setupWindowControls();
  setupMenuTabs();
  setupContentScroller();
  syncMenuTabUi();
  scheduleMenuPanelCardSizeSync();
  loadProfileFromLocal();
  initProfilesUi?.();
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
