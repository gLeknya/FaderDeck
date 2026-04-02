let audioApps = [];
let currentButtonConfig = null;
let contextTarget = null;
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
let uiStateSyncInitialized = false;

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

function getUiSettings() {
  return getUiSettingsState?.() || {
    advancedMode: false,
    developerMode: false,
    faderInterpolationEnabled: false,
    showFractionalNumbers: false,
    showFractionalOnlyLow: false,
    volumeCurveEnabled: false,
    volumeCurveType: 'ease-in-out',
    volumeCurveAmount: 0,
    profileToolbarSwitcherEnabled: true
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

function getShowFractionalOnlyLowEnabled() {
  return getShowFractionalOnlyLowState?.() ?? getUiSettings().showFractionalOnlyLow;
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

function formatVolumeValue(value) {
  const normalizedValue = normalizeVolumeValue(value);
  const shouldShowFractions = getShowFractionalNumbersEnabled()
    && (!getShowFractionalOnlyLowEnabled() || normalizedValue < LOW_FRACTIONAL_VOLUME_THRESHOLD);
  const formattedValue = shouldShowFractions
    ? normalizedValue.toFixed(1).replace(/\.0$/, '')
    : String(Math.round(normalizedValue));

  return `${formattedValue}%`;
}

function getVolumeCurveAmount() {
  return getVolumeCurveAmountState?.() ?? getUiSettings().volumeCurveAmount;
}

function getVolumeCurveEnabled() {
  return getVolumeCurveEnabledState?.() ?? getUiSettings().volumeCurveEnabled;
}

function getVolumeCurveType() {
  return getVolumeCurveTypeState?.() ?? getUiSettings().volumeCurveType;
}

function getFaderInterpolationEnabled() {
  return getFaderInterpolationEnabledState?.() ?? getUiSettings().faderInterpolationEnabled;
}

function getVolumeCurveExponent() {
  return 1 + (getVolumeCurveAmount() / VOLUME_CURVE_MAX) * VOLUME_CURVE_EXPONENT_RANGE;
}

function applySelectedVolumeCurve(normalizedPosition) {
  const exponent = getVolumeCurveExponent();

  if (!getVolumeCurveEnabled()) {
    return normalizedPosition;
  }

  if (getVolumeCurveType() === 'ease-in') {
    return normalizedPosition ** exponent;
  }

  if (getVolumeCurveType() === 'ease-out') {
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

  if (!getVolumeCurveEnabled() || getVolumeCurveAmount() <= 0) {
    return normalizeVolumeValue(normalizedPosition * 100);
  }

  const curvedValue = applySelectedVolumeCurve(normalizedPosition);
  return normalizeVolumeValue(curvedValue * 100);
}

function isMenuOpen() {
  return getIsMenuOpenState?.() ?? getUiMenu().open;
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
  const activeMenuTab = getActiveMenuTab();
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
  setActiveMenuTabState?.(tabName, { source: 'ui' });
}

function syncMenuShellUi() {
  const menuOpen = isMenuOpen();
  dom.menuRail?.classList.toggle('open', menuOpen);
  document.body.classList.toggle('menu-open', menuOpen);
}

function openMainMenu() {
  menuScrollVisibilitySnapshot = !dom.contentScrollBar?.classList.contains('hidden');
  setMenuOpenState?.(true, { source: 'ui' });
}

function closeMainMenu() {
  setMenuOpenState?.(false, { source: 'ui' });
  setActiveMenuTab(null);

  if (menuScrollVisibilitySnapshot === false) {
    dom.contentScrollBar?.classList.add('hidden');
  }
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
  dom.advancedModeToggle?.addEventListener('click', () => {
    setAdvancedModeState?.(!getAdvancedModeEnabled(), { source: 'ui' });
  });

  dom.developerModeToggle?.addEventListener('click', () => {
    setDeveloperModeState?.(!getDeveloperModeEnabled(), { source: 'ui' });
  });

  dom.faderInterpolationToggle?.addEventListener('click', () => {
    setFaderInterpolationEnabledState?.(!getFaderInterpolationEnabled(), { source: 'ui' });
  });

  dom.profileToolbarToggle?.addEventListener('click', () => {
    setProfileToolbarSwitcherEnabledState?.(!isToolbarProfilePickerEnabled(), { source: 'ui' });
  });

  dom.showFractionalNumbersToggle?.addEventListener('click', () => {
    setShowFractionalNumbersState?.(!getShowFractionalNumbersEnabled(), { source: 'ui' });
  });

  dom.showFractionalOnlyLowToggle?.addEventListener('click', () => {
    setShowFractionalOnlyLowState?.(!getShowFractionalOnlyLowEnabled(), { source: 'ui' });
  });

  dom.volumeCurveToggle?.addEventListener('click', () => {
    setVolumeCurveEnabledState?.(!getVolumeCurveEnabled(), { source: 'ui' });
  });

  dom.volumeCurveModeButtons?.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.curveType === getVolumeCurveType()) {
        return;
      }

      setVolumeCurveTypeState?.(button.dataset.curveType, { source: 'ui' });
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

    setVolumeCurveAmountState?.(sliderValue, { source: 'ui' });
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
    const channel = findChannelState?.(channelId);

    if (!channel) {
      return;
    }

    if (action === 'delete') {
      removeChannelButtonState?.(channelId, buttonId, { source: 'context-menu' });
      saveProfileToLocal();
    }

    if (action === 'remap') remapButton(channelId, buttonId);
    if (action === 'edit') configureButton(channelId, buttonId);
    return;
  }

  if (contextTarget.type === 'standalone') {
    const { buttonId } = contextTarget;

    if (action === 'delete') {
      removeStandaloneButtonState?.(buttonId, { source: 'context-menu' });
      saveProfileToLocal();
    }

    if (action === 'remap') remapStandaloneButton(buttonId);
    if (action === 'edit') configureStandaloneButton(buttonId);
  }
}

function saveProfileToLocal() {
  const profile = typeof serializeRendererState === 'function'
    ? serializeRendererState()
    : {
      channels: [],
      standaloneButtons: [],
      settings: {
        midiInputId: getMidiSelectionState?.()?.selectedInputId || null,
        midiInputName: getMidiSelectionState?.()?.selectedInputName || ''
      }
    };
  localStorage.setItem('mixer_profile', JSON.stringify(profile));
}

function loadProfileFromLocal() {
  const savedProfile = localStorage.getItem('mixer_profile');

  if (!savedProfile) {
    hydrateRendererState?.({
      channels: [],
      standaloneButtons: [],
      settings: {
        midiInputId: getMidiSelectionState?.()?.selectedInputId || null,
        midiInputName: getMidiSelectionState?.()?.selectedInputName || ''
      }
    }, { source: 'local-storage' });
    return;
  }

  try {
    const profile = JSON.parse(savedProfile);
    hydrateRendererState?.(profile, { source: 'local-storage' });
  } catch (error) {
    console.error('loadProfile error', error);
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
      if (!isMenuOpen()) {
        openMainMenu();
      }

      if (getActiveMenuTab() === tab.dataset.tab) {
        setActiveMenuTab(null);
        return;
      }

      setActiveMenuTab(tab.dataset.tab);
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

    if (nextSettings.profileToolbarSwitcherEnabled !== previousSettings.profileToolbarSwitcherEnabled) {
      syncProfileToolbarUi();
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
    }

    if (nextMenu.activeTab !== previousMenu.activeTab) {
      syncMenuTabUi();
    }
  });

  uiStateSyncInitialized = true;
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

  document.querySelectorAll('#contextMenu .context-item').forEach((item) => {
    item.addEventListener('click', onContextItemClick);
  });
}

function init() {
  cacheDomElements();
  initUiStore?.();
  applyTranslations();
  enhanceCustomSelects?.(document);
  initChannelUiStateSync?.();
  initStandaloneButtonsStateSync?.();
  initUiStateSync();
  bindGlobalUi();
  setupSettings();
  setupWindowControls();
  setupMenuTabs();
  setupContentScroller();
  syncMenuShellUi();
  syncAdvancedModeUi();
  syncDeveloperModeUi();
  syncFaderInterpolationUi();
  syncProfileToolbarUi();
  syncFractionalNumberUi();
  syncVolumeCurveUi();
  syncLanguageUi();
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
