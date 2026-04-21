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
const SETTINGS_SECTION_HIDE_THRESHOLD = 1 / 3;
const SETTINGS_SECTION_MIN_SCALE = 0.86;
const SETTINGS_SECTION_MAX_SHIFT = 8;

const appSessionState = {
  contextMenu: {
    open: false,
    target: null,
    anchorX: 0,
    anchorY: 0
  },
  menuPanelMetrics: {
    timeoutId: null,
    frameId: null
  },
  settingsTooltip: {
    activeTarget: null
  },
  volumeCurveDemo: {
    position: 0,
    timerId: null,
    frameId: null,
    dragging: false
  }
};
const sharedUiStateModel = window.rendererStateModel || {};
const DEFAULT_UI_SETTINGS = sharedUiStateModel.DEFAULT_PERSISTED_UI_SETTINGS || {
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
  volumeHudShowMeter: true,
  mediaControllerVisible: true,
  closeToTrayEnabled: true
};
const DEFAULT_UI_MENU = sharedUiStateModel.DEFAULT_SESSION_UI_MENU || {
  open: false,
  activeTab: null
};

let uiStateSyncInitialized = false;
let audioRuntimeBridgeInitialized = false;
const FRONTEND_LOG_SCOPE_STYLE = 'color:#8fd16a;font-weight:700;';
const FRONTEND_LOG_TEXT_STYLE = 'color:#d8d8d8;';
const MEDIA_CONTROLLER_AUTO_TARGET_VALUE = '__auto__';

function trimFrontendLogString(value, maxLength = 140) {
  const normalized = String(value ?? '');

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

function summarizeFrontendLogValue(value, depth = 0) {
  if (value == null) {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: trimFrontendLogString(value.stack || '', 240)
    };
  }

  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      return `[data-url:${value.length}]`;
    }

    return trimFrontendLogString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const sample = value.slice(0, 6).map((entry) => summarizeFrontendLogValue(entry, depth + 1));

    if (value.length > sample.length) {
      sample.push(`...+${value.length - sample.length} more`);
    }

    return sample;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);

    if (depth >= 2) {
      return `{${keys.slice(0, 8).join(', ')}}`;
    }

    const summary = {};

    keys.slice(0, 8).forEach((key) => {
      summary[key] = summarizeFrontendLogValue(value[key], depth + 1);
    });

    if (keys.length > 8) {
      summary.__moreKeys = keys.length - 8;
    }

    return summary;
  }

  return String(value);
}

function writeFrontendConsole(level, scope, payload) {
  const consoleMethod = typeof console[level] === 'function' ? console[level] : console.log;

  if (typeof payload === 'undefined') {
    consoleMethod(`%c[FD:front]%c ${scope}`, FRONTEND_LOG_SCOPE_STYLE, FRONTEND_LOG_TEXT_STYLE);
    return;
  }

  consoleMethod(
    `%c[FD:front]%c ${scope}`,
    FRONTEND_LOG_SCOPE_STYLE,
    FRONTEND_LOG_TEXT_STYLE,
    payload
  );
}

function frontendLog(scope, payload, level = 'log') {
  writeFrontendConsole(level, scope, summarizeFrontendLogValue(payload));
  return payload;
}

function frontendAction(scope, payload, level = 'log') {
  return frontendLog(`action/${scope}`, payload, level);
}

function logTest(...args) {
  if (!args.length) {
    return frontendAction('test');
  }

  if (typeof args[0] === 'string' && args.length === 1) {
    return frontendAction(args[0]);
  }

  if (typeof args[0] === 'string') {
    return frontendAction(args[0], args[1]);
  }

  return frontendAction('test', args);
}

function $(id) {
  return document.getElementById(id);
}

function escapeOptionHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getApi() {
  return window.getNativeApi?.() ?? null;
}

function ensureDynamicUiAugments() {
  const visualSection = Array.from(document.querySelectorAll('.settings-section')).find((section) => (
    section.querySelector('[data-i18n="settings.sections.visual"]')
  ));
  const profileToolbarItem = document.getElementById('profileToolbarToggle')?.closest('.settings-item');

  if (visualSection && profileToolbarItem && !document.getElementById('mediaControllerToggle')) {
    const mediaControllerItem = document.createElement('div');
    mediaControllerItem.className = 'settings-item';
    mediaControllerItem.innerHTML = `
      <span id="mediaControllerToggleLabel"></span>
      <button class="settings-toggle" id="mediaControllerToggle" type="button"></button>
    `;
    profileToolbarItem.insertAdjacentElement('afterend', mediaControllerItem);
  }

  const mediaControllerItem = document.getElementById('mediaControllerToggle')?.closest('.settings-item');

  if (visualSection && mediaControllerItem && !document.getElementById('mediaControllerTargetSettingsSelect')) {
    const mediaControllerTargetItem = document.createElement('label');
    mediaControllerTargetItem.className = 'settings-item settings-item-nested';
    mediaControllerTargetItem.innerHTML = `
      <span id="mediaControllerTargetSettingsLabel"></span>
      <select id="mediaControllerTargetSettingsSelect" class="settings-select"></select>
    `;
    mediaControllerItem.insertAdjacentElement('afterend', mediaControllerTargetItem);
    enhanceCustomSelects?.(mediaControllerTargetItem);
  }

  window.mediaControllerUi?.ensureStandaloneButtonsTopRow?.();
}

function cacheDomElements() {
  dom.appShell = $('appShell');
  dom.menuRail = $('menuRail');
  dom.menuPanelOverlay = $('menuPanelOverlay');
  dom.menuPanelCard = document.querySelector('.menu-panel-card');
  dom.settingsScrollShell = document.querySelector('.settings-scroll-shell');
  dom.advancedModeToggle = $('advancedModeToggle');
  dom.developerModeToggle = $('developerModeToggle');
  dom.closeToTrayToggle = $('closeToTrayToggle');
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
  dom.mediaControllerToggle = $('mediaControllerToggle');
  dom.mediaControllerToggleLabel = $('mediaControllerToggleLabel');
  dom.mediaControllerTargetSettingsLabel = $('mediaControllerTargetSettingsLabel');
  dom.mediaControllerTargetSettingsSelect = $('mediaControllerTargetSettingsSelect');
  dom.mediaControllerShell = $('mediaControllerShell');
  dom.mediaController = $('mediaController');
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
  dom.layoutEditModeToggle = $('layoutEditModeToggle');
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
  return getUiSettingsState?.() || { ...DEFAULT_UI_SETTINGS };
}

function getUiMenu() {
  return getUiMenuState?.() || { ...DEFAULT_UI_MENU };
}

function getLayoutEditorSession() {
  return getLayoutEditorSessionState?.() || {
    enabled: false,
    selectedItemId: null,
    hoveredItemId: null,
    dragItemId: null,
    dropPreview: null
  };
}

function isLayoutEditorParkedUi() {
  return window.isLayoutEditorParked?.() ?? true;
}

function getLayoutEditModeEnabled() {
  if (isLayoutEditorParkedUi()) {
    return false;
  }

  return isLayoutEditModeEnabledState?.() ?? getLayoutEditorSession().enabled;
}

function getAdvancedModeEnabled() {
  return getAdvancedModeEnabledState?.() ?? getUiSettings().advancedMode;
}

function getDeveloperModeEnabled() {
  return getDeveloperModeEnabledState?.() ?? getUiSettings().developerMode;
}

function getCloseToTrayEnabled() {
  return getCloseToTrayEnabledState?.() ?? getUiSettings().closeToTrayEnabled;
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

function getMediaControllerVisible() {
  return getMediaControllerVisibleState?.() ?? getUiSettings().mediaControllerVisible;
}

function getMediaControllerTargetAppId() {
  return String(window.getMediaControllerTargetAppIdState?.() ?? getUiSettings().mediaControllerTargetAppId ?? '').trim();
}

function getAvailableMediaControllerSessions() {
  return window.mediaControllerUi?.getAvailableSessions?.() || [];
}

function buildMediaControllerTargetSettingsOptionsMarkup() {
  const selectedAppId = getMediaControllerTargetAppId();
  const availableSessions = getAvailableMediaControllerSessions();
  const hasSelectedSession = selectedAppId
    ? availableSessions.some((session) => String(session?.appId || '').trim() === selectedAppId)
    : true;
  const autoLabel = t('mediaController.autoTarget');
  const unavailableLabel = t('mediaController.unavailableTarget');
  const options = [
    `<option value="${MEDIA_CONTROLLER_AUTO_TARGET_VALUE}">${escapeOptionHtml(autoLabel)}</option>`
  ];

  if (selectedAppId && !hasSelectedSession) {
    options.push(`<option value="${escapeOptionHtml(selectedAppId)}">${escapeOptionHtml(unavailableLabel)}</option>`);
  }

  availableSessions.forEach((session) => {
    const appId = String(session?.appId || '').trim();

    if (!appId) {
      return;
    }

    const label = String(session?.label || appId).trim();
    options.push(`<option value="${escapeOptionHtml(appId)}">${escapeOptionHtml(label)}</option>`);
  });

  return options.join('');
}

function syncMediaControllerTargetSettingsUi(options = {}) {
  if (dom.mediaControllerTargetSettingsLabel) {
    dom.mediaControllerTargetSettingsLabel.textContent = t('mediaController.targetAppLabel');
  }

  if (!dom.mediaControllerTargetSettingsSelect) {
    return;
  }

  const select = dom.mediaControllerTargetSettingsSelect;
  const optionsMarkup = buildMediaControllerTargetSettingsOptionsMarkup();
  const selectedValue = getMediaControllerTargetAppId() || MEDIA_CONTROLLER_AUTO_TARGET_VALUE;
  const customDropdown = select.nextElementSibling?.classList.contains('custom-select')
    ? select.nextElementSibling
    : null;
  const isDropdownOpen = Boolean(customDropdown?.classList.contains('open'));

  if (options.force === true || !isDropdownOpen) {
    if (select.dataset.optionsMarkup !== optionsMarkup) {
      select.innerHTML = optionsMarkup;
      select.dataset.optionsMarkup = optionsMarkup;
      enhanceCustomSelects?.(select);
    }

    if (select.value !== selectedValue) {
      select.value = selectedValue;
    }

    select.dataset.pendingSync = 'false';
  } else {
    select.dataset.pendingSync = 'true';
  }

  select.title = select.options[select.selectedIndex]?.text || '';
}

function refreshMediaControllerTargetSettingsOptions(options = {}) {
  const force = Boolean(options?.force);
  const refresh = force
    ? window.mediaControllerUi?.refreshAvailableSessions?.({ force: true })
    : Promise.resolve(getAvailableMediaControllerSessions());

  return Promise.resolve(refresh)
    .catch((error) => {
      console.error('refreshMediaControllerTargetSettingsOptions error', error);
      return getAvailableMediaControllerSessions();
    })
    .finally(() => {
      syncMediaControllerTargetSettingsUi({ force });
    });
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

function syncLayoutEditModeUi() {
  // Park marker: the layout editor foundation stays in state/actions, but
  // visible UI sync is intentionally dormant until the feature is re-enabled.
  if (isLayoutEditorParkedUi()) {
    document.body.classList.remove('layout-edit-mode');
    return;
  }

  const layoutEditModeEnabled = getLayoutEditModeEnabled();

  document.body.classList.toggle('layout-edit-mode', layoutEditModeEnabled);

  if (!dom.layoutEditModeToggle) {
    return;
  }

  dom.layoutEditModeToggle.classList.toggle('active', layoutEditModeEnabled);
  dom.layoutEditModeToggle.textContent = t(
    layoutEditModeEnabled
      ? 'layout.modeOn'
      : 'layout.modeOff'
  );
  dom.layoutEditModeToggle.setAttribute('aria-pressed', String(layoutEditModeEnabled));
  dom.layoutEditModeToggle.setAttribute('title', t(
    layoutEditModeEnabled
      ? 'layout.exitMode'
      : 'layout.modeOff'
  ));
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

window.getDefaultChannelCustomSettings = getDefaultChannelCustomSettings;
window.resolveChannelFaderSettings = resolveChannelFaderSettings;

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

  view.classList.remove('is-visible');
  view.__hideTimer = window.setTimeout(() => {
    view.classList.remove('is-active');
    view.hidden = true;
    view.__hideTimer = null;
  }, 190);
}

function syncMenuPanelCardSize() {
  if (!dom.menuPanelCard) {
    return;
  }

  const activeMenuTab = getActiveMenuTab();
  const activeView = dom.menuViews?.find((view) => view.dataset.tab === activeMenuTab);

  if (!activeView || !activeMenuTab) {
    if (isMenuOpen()) {
      dom.menuPanelCard.style.removeProperty('height');
      dom.menuPanelCard.style.removeProperty('width');
    }
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
  if (appSessionState.menuPanelMetrics.frameId) {
    cancelAnimationFrame(appSessionState.menuPanelMetrics.frameId);
  }

  if (appSessionState.menuPanelMetrics.timeoutId) {
    clearTimeout(appSessionState.menuPanelMetrics.timeoutId);
  }

  appSessionState.menuPanelMetrics.frameId = requestAnimationFrame(() => {
    appSessionState.menuPanelMetrics.frameId = null;
    syncMenuPanelCardSize();
    syncSettingsViewportUi();
  });

  appSessionState.menuPanelMetrics.timeoutId = window.setTimeout(() => {
    appSessionState.menuPanelMetrics.timeoutId = null;
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
  dom.menuPanelOverlay?.classList.toggle('hidden', !menuOpen || !getActiveMenuTab());
}

function openMainMenu() {
  window.uiActions?.openMainMenu({ source: 'ui' });
}

function closeMainMenu() {
  hideSettingsTooltip();
  window.uiActions?.closeMainMenu({ source: 'ui' });
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

function syncCloseToTrayUi() {
  if (!dom.closeToTrayToggle) {
    return;
  }

  const closeToTrayEnabled = getCloseToTrayEnabled();
  dom.closeToTrayToggle.classList.toggle('on', closeToTrayEnabled);
  dom.closeToTrayToggle.textContent = closeToTrayEnabled ? t('settings.on') : t('settings.off');
}

function syncMediaControllerUi() {
  const mediaControllerVisible = getMediaControllerVisible();
  dom.mediaControllerShell = dom.mediaControllerShell || $('mediaControllerShell');
  dom.mediaController = dom.mediaController || $('mediaController');

  if (dom.mediaControllerToggleLabel) {
    dom.mediaControllerToggleLabel.textContent = getCurrentLanguage?.() === 'en'
      ? 'Show multimedia controller'
      : 'Показывать мультимедиа контроллер';
  }

  if (dom.mediaControllerToggle) {
    dom.mediaControllerToggle.classList.toggle('on', mediaControllerVisible);
    dom.mediaControllerToggle.textContent = mediaControllerVisible ? t('settings.on') : t('settings.off');
  }

  syncMediaControllerTargetSettingsUi();
  dom.mediaControllerShell?.classList.toggle('hidden', !mediaControllerVisible);
  window.mediaControllerUi?.render?.();
}

function syncCloseToTrayRuntime() {
  return getApi()?.set_close_to_tray_enabled?.(getCloseToTrayEnabled()) || null;
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

function updateVolumeCurveDemoUi(position = appSessionState.volumeCurveDemo.position, { showPoint = false } = {}) {
  const previewPoint = getVolumeCurvePreviewPoint(position);
  const trackHeight = dom.volumeCurveDemoTrack?.clientHeight || 164;
  const thumbHeight = dom.volumeCurveDemoThumb?.offsetHeight || 44;
  const thumbTravel = Math.max(0, trackHeight - thumbHeight);
  const thumbBottom = (previewPoint.input / 100) * thumbTravel;
  const fillHeight = (previewPoint.output / 100) * trackHeight;

  appSessionState.volumeCurveDemo.position = previewPoint.input;

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
  if (appSessionState.volumeCurveDemo.timerId) {
    clearTimeout(appSessionState.volumeCurveDemo.timerId);
    appSessionState.volumeCurveDemo.timerId = null;
  }

  if (appSessionState.volumeCurveDemo.frameId) {
    cancelAnimationFrame(appSessionState.volumeCurveDemo.frameId);
    appSessionState.volumeCurveDemo.frameId = null;
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

  if (!getVolumeCurveEnabled() || appSessionState.volumeCurveDemo.dragging || !dom.volumeCurveDemoTrack) {
    return;
  }

  const startedAt = performance.now();
  const startPosition = appSessionState.volumeCurveDemo.position;
  dom.volumeCurveDemoOutput?.classList.add('is-live');
  updateVolumeCurveDemoUi(startPosition, { showPoint: true });

  const tick = (timestamp) => {
    if (!getVolumeCurveEnabled() || appSessionState.volumeCurveDemo.dragging) {
      appSessionState.volumeCurveDemo.frameId = null;
      dom.volumeCurveDemoOutput?.classList.remove('is-live');
      setVolumeCurvePointVisible(false);
      return;
    }

    const progress = Math.min(1, (timestamp - startedAt) / VOLUME_CURVE_DEMO_DURATION_MS);
    updateVolumeCurveDemoUi(getVolumeCurveDemoPosition(progress, startPosition), {
      showPoint: true
    });

    if (progress < 1) {
      appSessionState.volumeCurveDemo.frameId = requestAnimationFrame(tick);
      return;
    }

    appSessionState.volumeCurveDemo.frameId = null;
    dom.volumeCurveDemoOutput?.classList.remove('is-live');
    setVolumeCurvePointVisible(false);
  };

  appSessionState.volumeCurveDemo.frameId = requestAnimationFrame(tick);
}

function scheduleVolumeCurveDemo() {
  stopVolumeCurveDemo();

  if (!getVolumeCurveEnabled() || appSessionState.volumeCurveDemo.dragging || !dom.volumeCurveDemoTrack) {
    return;
  }

  appSessionState.volumeCurveDemo.timerId = setTimeout(() => {
    appSessionState.volumeCurveDemo.timerId = null;
    startVolumeCurveDemo();
  }, VOLUME_CURVE_DEMO_DELAY_MS);
}

function getVolumeCurveDemoPointerPosition(clientY) {
  if (!dom.volumeCurveDemoTrack) {
    return appSessionState.volumeCurveDemo.position;
  }

  const rect = dom.volumeCurveDemoTrack.getBoundingClientRect();
  const normalizedPosition = (rect.bottom - clientY) / rect.height;
  return clampPercent(Math.round(normalizedPosition * 100));
}

function onVolumeCurveDemoPointerMove(event) {
  if (!appSessionState.volumeCurveDemo.dragging) {
    return;
  }

  updateVolumeCurveDemoUi(getVolumeCurveDemoPointerPosition(event.clientY), {
    showPoint: true
  });
}

function stopVolumeCurveDemoDrag() {
  if (!appSessionState.volumeCurveDemo.dragging) {
    return;
  }

  appSessionState.volumeCurveDemo.dragging = false;
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
  appSessionState.volumeCurveDemo.dragging = true;
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

  updateVolumeCurveDemoUi(appSessionState.volumeCurveDemo.position, { showPoint: false });

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
  appSessionState.settingsTooltip.activeTarget = null;

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

  appSessionState.settingsTooltip.activeTarget = target;
  dom.settingsTooltipBubble.textContent = tooltipText;
  dom.settingsTooltipLayer.classList.remove('hidden');
  dom.settingsTooltipLayer.setAttribute('aria-hidden', 'false');

  requestAnimationFrame(() => {
    if (appSessionState.settingsTooltip.activeTarget !== target) {
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

function notifyAudioRuntimeUi(audioApps = window.getAvailableAudioApps?.() || []) {
  renderMixer();
  window.dispatchEvent(new CustomEvent('audio-apps-updated', {
    detail: {
      apps: audioApps
    }
  }));
  scheduleContentMetricsUpdate();
}

function initAudioRuntimeBridge() {
  if (audioRuntimeBridgeInitialized || typeof window.subscribeAudioRuntime !== 'function') {
    return;
  }

  window.subscribeAudioRuntime((audioRuntimeState, meta = {}) => {
    if (!['audio-runtime/apps-updated', 'audio-runtime/localization-refresh'].includes(meta.type)) {
      return;
    }

    notifyAudioRuntimeUi(audioRuntimeState.apps || []);
  });

  audioRuntimeBridgeInitialized = true;
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

  dom.closeToTrayToggle?.addEventListener('click', () => {
    window.uiActions?.toggleCloseToTrayEnabled({ source: 'ui' });
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

  dom.mediaControllerToggle?.addEventListener('click', () => {
    window.uiActions?.toggleMediaControllerVisible({ source: 'ui' });
  });

  dom.mediaControllerTargetSettingsSelect?.addEventListener('custom-select:will-open', () => {
    refreshMediaControllerTargetSettingsOptions({ force: true });
  });

  dom.mediaControllerTargetSettingsSelect?.addEventListener('change', (event) => {
    const nextValue = String(event.target.value || '').trim();
    const targetAppId = nextValue === MEDIA_CONTROLLER_AUTO_TARGET_VALUE ? '' : nextValue;

    window.uiActions?.setMediaControllerTargetAppId?.(targetAppId, { source: 'ui' });
    syncMediaControllerTargetSettingsUi({ force: true });
    window.mediaControllerUi?.getRuntimeSnapshot?.({ force: true });
  });

  dom.mediaControllerTargetSettingsSelect?.addEventListener('blur', () => {
    if (dom.mediaControllerTargetSettingsSelect?.dataset.pendingSync === 'true') {
      syncMediaControllerTargetSettingsUi({ force: true });
    }
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

function hideContextMenu(options = {}) {
  const shouldPreserveTarget = Boolean(options.preserveTarget);

  appSessionState.contextMenu.open = false;

  if (!shouldPreserveTarget) {
    appSessionState.contextMenu.target = null;
  }

  if (dom.contextMenu) {
    dom.contextMenu.style.display = 'none';
  }
}

function syncContextMenuUi(target = null) {
  if (!dom.contextMenu) {
    return;
  }

  const editItem = dom.contextMenu.querySelector('[data-action="edit"]');
  const selectItem = dom.contextMenu.querySelector('[data-action="select"]');
  const deleteItem = dom.contextMenu.querySelector('[data-action="delete"]');
  const isMediaControllerTarget = String(target?.type || '') === 'media-controller';

  if (editItem) {
    editItem.textContent = t('context.edit');
  }

  if (selectItem) {
    selectItem.textContent = t('context.select');
  }

  if (deleteItem) {
    deleteItem.textContent = isMediaControllerTarget ? t('context.hide') : t('context.delete');
    deleteItem.classList.toggle('context-item--danger', !isMediaControllerTarget);
  }
}

function onContextMenu(event) {
  const channelEl = event.target.closest('.channel-strip');
  const buttonEl = event.target.closest('.control-button, .channel-side-button');
  const standaloneEl = event.target.closest('.standalone-button');
  const mediaControllerButtonEl = event.target.closest('[data-media-controller-slot]');
  const mediaControllerEl = event.target.closest('#mediaController, .media-controller, #mediaControllerShell, .media-controller-shell');

  if (!channelEl && !buttonEl && !standaloneEl && !mediaControllerEl) {
    return;
  }

  event.preventDefault();

  if (mediaControllerEl) {
    appSessionState.contextMenu.target = {
      type: 'media-controller',
      buttonId: Number.parseInt(mediaControllerButtonEl?.dataset.buttonId || '', 10),
      slot: String(mediaControllerButtonEl?.dataset.mediaControllerSlot || '').trim()
    };
  } else if (buttonEl && buttonEl.dataset.buttonId) {
    appSessionState.contextMenu.target = {
      type: 'button',
      channelId: Number.parseInt(buttonEl.closest('.channel-strip').dataset.channelId, 10),
      buttonId: Number.parseInt(buttonEl.dataset.buttonId, 10)
    };
  } else if (standaloneEl) {
    appSessionState.contextMenu.target = {
      type: 'standalone',
      buttonId: Number.parseInt(standaloneEl.dataset.buttonId, 10)
    };
  } else if (channelEl) {
    appSessionState.contextMenu.target = {
      type: 'channel',
      channelId: Number.parseInt(channelEl.dataset.channelId, 10)
    };
  } else {
    return;
  }

  if (!dom.contextMenu) {
    return;
  }

  syncContextMenuUi(appSessionState.contextMenu.target);
  appSessionState.contextMenu.open = true;
  appSessionState.contextMenu.anchorX = event.clientX;
  appSessionState.contextMenu.anchorY = event.clientY;
  dom.contextMenu.style.display = 'block';

  const menuRect = dom.contextMenu.getBoundingClientRect();
  const nextLeft = Math.min(
    window.innerWidth - menuRect.width - 8,
    appSessionState.contextMenu.anchorX + 10
  );
  const nextTop = Math.min(
    window.innerHeight - menuRect.height - 8,
    appSessionState.contextMenu.anchorY + 10
  );

  dom.contextMenu.style.left = `${Math.max(8, nextLeft)}px`;
  dom.contextMenu.style.top = `${Math.max(8, nextTop)}px`;
}

function onContextItemClick(event) {
  const action = event.currentTarget.dataset.action;
  const contextTarget = appSessionState.contextMenu.target;

  hideContextMenu({ preserveTarget: true });
  handleContextAction(action, contextTarget);
}

function handleContextAction(action, explicitTarget = null) {
  const contextTarget = explicitTarget || appSessionState.contextMenu.target;

  if (!contextTarget) {
    return;
  }

  if (contextTarget.type === 'channel') {
    const { channelId } = contextTarget;

    if (action === 'select') return;
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

    if (action === 'select') return;
    if (action === 'delete') {
      window.channelActions?.removeChannelButton(channelId, buttonId, { source: 'context-menu' });
    }

    if (action === 'remap') remapButton(channelId, buttonId);
    if (action === 'edit') {
      if (typeof configureChannel === 'function') {
        configureChannel(channelId);
      } else {
        editChannelTitle(channelId);
      }
    }
    return;
  }

  if (contextTarget.type === 'standalone') {
    const { buttonId } = contextTarget;

    if (action === 'select') return;
    if (action === 'delete') {
      window.standaloneButtonActions?.removeStandaloneButton?.(buttonId, { source: 'context-menu' });
    }

    if (action === 'remap') remapStandaloneButton(buttonId);
    if (action === 'edit') configureStandaloneButton(buttonId);
    return;
  }

  if (contextTarget.type === 'media-controller') {
    const buttonId = Number.parseInt(contextTarget.buttonId, 10);

    if (action === 'select') {
      window.mediaControllerUi?.select?.({
        buttonId,
        slot: contextTarget.slot,
        source: 'context-menu'
      });
      return;
    }

    if (action === 'delete') {
      window.uiActions?.setMediaControllerVisible?.(false, { source: 'context-menu' });
      return;
    }

    if (action === 'edit') {
      window.mediaControllerUi?.openSettings?.({
        buttonId,
        slot: contextTarget.slot,
        source: 'context-menu'
      });
    }
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
    const nextMenu = nextUiState.session.menu;
    const previousMenu = previousUiState.session.menu;

    if (nextSettings.advancedMode !== previousSettings.advancedMode) {
      syncAdvancedModeUi();
      renderMixer();
    }

    if (nextSettings.developerMode !== previousSettings.developerMode) {
      syncDeveloperModeUi();
    }

    if (nextSettings.closeToTrayEnabled !== previousSettings.closeToTrayEnabled) {
      syncCloseToTrayUi();
      syncCloseToTrayRuntime();
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

    if (nextSettings.mediaControllerVisible !== previousSettings.mediaControllerVisible) {
      syncMediaControllerUi();
    }

    if (nextSettings.mediaControllerTargetAppId !== previousSettings.mediaControllerTargetAppId) {
      syncMediaControllerTargetSettingsUi({ force: true });
    }

    if (
      nextSettings.showFractionalNumbers !== previousSettings.showFractionalNumbers
      || nextSettings.showFractionalOnlyLow !== previousSettings.showFractionalOnlyLow
    ) {
      syncFractionalNumberUi();
      refreshCurveDrivenUi();
      updateVolumeCurveDemoUi(appSessionState.volumeCurveDemo.position, { showPoint: false });
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

function initLayoutEditorUiSync() {
  if (
    isLayoutEditorParkedUi()
    || initLayoutEditorUiSync.initialized
    || typeof subscribeLayoutEditorSessionState !== 'function'
  ) {
    return;
  }

  subscribeLayoutEditorSessionState((nextState, previousState) => {
    if (nextState.enabled !== previousState.enabled) {
      syncLayoutEditModeUi();
    }
  });

  initLayoutEditorUiSync.initialized = true;
}

function handleLanguageChanged() {
  syncLayoutEditModeUi();
  syncLanguageUi();
  syncCloseToTrayUi();
  syncAdvancedModeUi();
  syncDeveloperModeUi();
  syncFaderInterpolationUi();
  syncSoftTakeoverUi();
  syncProfileToolbarUi();
  syncVolumeHudUi();
  syncMediaControllerUi();
  window.mediaControllerUi?.render?.();
  window.mediaControllerUi?.refreshEditor?.();
  syncFractionalNumberUi();
  syncVolumeCurveUi();
  window.refreshAudioRuntimeLocalization?.({ source: 'app-language-changed' });
  renderMixer();
  renderStandaloneButtons();
  refreshProfilesLanguage?.();

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

  if (!isLayoutEditorParkedUi()) {
    document.addEventListener('keydown', (event) => {
      if (
        event.key === 'Escape'
        && getLayoutEditModeEnabled()
        && !window.getActiveModalId?.()
      ) {
        window.layoutActions?.exitLayoutEditMode({ source: 'ui' });
      }
    });
  }

  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('click', hideContextMenu);
  window.addEventListener('app:language-changed', handleLanguageChanged);
  window.addEventListener('beforeunload', stopVolumeCurveDemo);
  window.addEventListener('resize', scheduleMenuPanelCardSizeSync);
  window.addEventListener('focus', () => {
    window.requestAudioAppsRefresh?.('window-focus');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      window.requestAudioAppsRefresh?.('document-visible');
    }
  });
  window.addEventListener('audio-apps-refresh-requested', (event) => {
    window.requestAudioAppsRefresh?.(
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

function initializeAppShell() {
  ensureDynamicUiAugments();
  cacheDomElements();
  hideLegacyVolumeHudSettingsUi();
  initUiStore?.();
  window.audioRuntime?.init?.();
  applyTranslations();
  enhanceCustomSelects?.(document);
  initChannelUiStateSync?.();
  initStandaloneButtonsStateSync?.();
  initChannelButtonsRuntime?.();
  initStandaloneButtonsRuntime?.();
  initUiStateSync();
  initLayoutEditorUiSync();
  initAudioRuntimeBridge();
  // Legacy standalone-button modal stays in the codebase, but active button
  // configuration now goes through the shared entity editor.
  initEntityEditor?.();
  bindGlobalUi();
  setupSettings();
  setupSettingsTooltips();
  setupWindowControls();
  setupMenuTabs();
  syncMenuShellUi();
  syncCloseToTrayRuntime();
  syncAdvancedModeUi();
  syncCloseToTrayUi();
  syncDeveloperModeUi();
  syncFaderInterpolationUi();
  syncSoftTakeoverUi();
  syncProfileToolbarUi();
  syncVolumeHudUi();
  syncMediaControllerUi();
  syncFractionalNumberUi();
  syncVolumeCurveUi();
  syncLayoutEditModeUi();
  syncLanguageUi();
  syncMenuTabUi();
  scheduleMenuPanelCardSizeSync();
  syncSettingsViewportUi();
  window.profileActions?.loadRendererProfileFromLocal?.();
  initProfilesUi?.();
  window.mediaControllerUi?.init?.();
  refreshMediaControllerTargetSettingsOptions({ force: true });
  window.requestAudioAppsRefresh?.('init', { force: true });
  initWebMIDI();
  scheduleContentMetricsUpdate();
}

function toggleLayoutEditModeShell() {
  if (isLayoutEditorParkedUi()) {
    return null;
  }

  return window.layoutActions?.toggleLayoutEditMode({ source: 'ui' }) || null;
}

function selectLayoutSurfaceItemShell(itemId) {
  if (isLayoutEditorParkedUi()) {
    return null;
  }

  return window.layoutActions?.selectLayoutItem(itemId, { source: 'ui' }) || null;
}

function hoverLayoutSurfaceItemShell(itemId) {
  if (isLayoutEditorParkedUi()) {
    return null;
  }

  return window.layoutActions?.hoverLayoutItem(itemId, { source: 'ui' }) || null;
}

function clearLayoutSurfaceHoverShell() {
  if (isLayoutEditorParkedUi()) {
    return null;
  }

  return window.layoutActions?.clearLayoutHover({ source: 'ui' }) || null;
}

function insertLayoutSpacerIntoZoneShell(zone) {
  if (isLayoutEditorParkedUi()) {
    return null;
  }

  return window.layoutActions?.insertSpacer({ zone }, { source: 'ui' }) || null;
}

function removeLayoutSpacerShell(itemId) {
  if (isLayoutEditorParkedUi()) {
    return null;
  }

  return window.layoutActions?.removeLayoutItem(itemId, { source: 'ui' }) || null;
}

function startLayoutSurfaceDragShell(event, itemId) {
  if (isLayoutEditorParkedUi() || !getLayoutEditModeEnabled()) {
    return null;
  }

  event.stopPropagation();

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', itemId);
  }

  return window.layoutActions?.beginLayoutItemDrag(itemId, { source: 'ui' }) || null;
}

function previewLayoutSurfaceDropShell(event, zone, itemId) {
  if (isLayoutEditorParkedUi() || !getLayoutEditModeEnabled()) {
    return null;
  }

  event.preventDefault();
  event.stopPropagation();

  const targetElement = event.currentTarget;
  const targetRect = targetElement?.getBoundingClientRect?.();

  if (!targetRect) {
    return null;
  }

  const position = zone === (window.LAYOUT_ZONES?.standalone || 'standalone')
    ? (event.clientY <= (targetRect.top + (targetRect.height / 2)) ? 'before' : 'after')
    : (event.clientX <= (targetRect.left + (targetRect.width / 2)) ? 'before' : 'after');

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }

  return window.layoutActions?.previewLayoutDrop({
    zone,
    itemId,
    position
  }, {
    source: 'ui'
  }) || null;
}

function dropLayoutSurfaceItemShell(event, zone, itemId) {
  if (isLayoutEditorParkedUi() || !getLayoutEditModeEnabled()) {
    return null;
  }

  previewLayoutSurfaceDropShell(event, zone, itemId);
  return window.layoutActions?.commitLayoutDrop({ source: 'ui' }) || null;
}

function endLayoutSurfaceDragShell() {
  if (isLayoutEditorParkedUi()) {
    return null;
  }

  return window.layoutActions?.cancelLayoutItemDrag({ source: 'ui' }) || null;
}

window.appShell = Object.freeze({
  initialize: initializeAppShell,
  getVolumeHudPresentationSettings,
  getApi,
  frontendLog,
  frontendAction,
  logTest,
  toggleMainMenu,
  toggleLayoutEditMode: toggleLayoutEditModeShell,
  selectLayoutSurfaceItem: selectLayoutSurfaceItemShell,
  hoverLayoutSurfaceItem: hoverLayoutSurfaceItemShell,
  clearLayoutSurfaceHover: clearLayoutSurfaceHoverShell,
  insertLayoutSpacerIntoZone: insertLayoutSpacerIntoZoneShell,
  removeLayoutSpacer: removeLayoutSpacerShell,
  startLayoutSurfaceDrag: startLayoutSurfaceDragShell,
  previewLayoutSurfaceDrop: previewLayoutSurfaceDropShell,
  dropLayoutSurfaceItem: dropLayoutSurfaceItemShell,
  endLayoutSurfaceDrag: endLayoutSurfaceDragShell
});

window.getVolumeHudPresentationSettings = getVolumeHudPresentationSettings;
window.getApi = getApi;
window.frontendLog = frontendLog;
window.frontendAction = frontendAction;
window.logTest = logTest;
window.toggleMainMenu = toggleMainMenu;
window.toggleLayoutEditMode = toggleLayoutEditModeShell;
window.selectLayoutSurfaceItem = selectLayoutSurfaceItemShell;
window.hoverLayoutSurfaceItem = hoverLayoutSurfaceItemShell;
window.clearLayoutSurfaceHover = clearLayoutSurfaceHoverShell;
window.insertLayoutSpacerIntoZone = insertLayoutSpacerIntoZoneShell;
window.removeLayoutSpacer = removeLayoutSpacerShell;
window.startLayoutSurfaceDrag = startLayoutSurfaceDragShell;
window.previewLayoutSurfaceDrop = previewLayoutSurfaceDropShell;
window.dropLayoutSurfaceItem = dropLayoutSurfaceItemShell;
window.endLayoutSurfaceDrag = endLayoutSurfaceDragShell;
