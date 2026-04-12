(function initUiStore(window) {
  const {
    DEFAULT_PERSISTED_UI_SETTINGS,
    DEFAULT_SESSION_UI_MENU,
    DEFAULT_SESSION_UI_STATE
  } = window.rendererStateModel;
  const uiPreferencesStorage = window.uiPreferencesStorage;
  const UI_STORAGE_KEYS = Object.freeze({
    advancedMode: 'faderdeck_advanced_mode',
    developerMode: 'faderdeck_developer_mode',
    faderInterpolationEnabled: 'faderdeck_fader_interpolation_enabled',
    softTakeoverEnabled: 'faderdeck_soft_takeover_enabled',
    softTakeoverThreshold: 'faderdeck_soft_takeover_threshold',
    showFractionalNumbers: 'faderdeck_show_fractional_numbers',
    showFractionalOnlyLow: 'faderdeck_show_fractional_only_low',
    volumeCurveEnabled: 'faderdeck_volume_curve_enabled',
    volumeCurveType: 'faderdeck_volume_curve_type',
    volumeCurveAmount: 'faderdeck_volume_curve_amount',
    profileToolbarSwitcherEnabled: 'faderdeck_profile_toolbar_switcher_enabled',
    volumeHudEnabled: 'faderdeck_volume_hud_enabled',
    volumeHudPosition: 'faderdeck_volume_hud_position',
    volumeHudOrientation: 'faderdeck_volume_hud_orientation',
    volumeHudShowIcon: 'faderdeck_volume_hud_show_icon',
    volumeHudShowTitle: 'faderdeck_volume_hud_show_title',
    volumeHudShowSubtitle: 'faderdeck_volume_hud_show_subtitle',
    volumeHudShowPercent: 'faderdeck_volume_hud_show_percent',
    volumeHudShowMeter: 'faderdeck_volume_hud_show_meter'
  });

  const HUD_POSITIONS = Object.freeze([
    'bottom-center',
    'bottom-left',
    'bottom-right',
    'top-center',
    'top-left',
    'top-right'
  ]);

  const HUD_ORIENTATIONS = Object.freeze([
    'horizontal',
    'vertical'
  ]);

  let uiStoreInitialized = false;

  function readUiBooleanSetting(key, fallback = false) {
    return uiPreferencesStorage?.readBoolean(key, fallback) ?? fallback;
  }

  function readUiNumberSetting(key, fallback, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
    return uiPreferencesStorage?.readNumber(key, fallback, { min, max }) ?? fallback;
  }

  function saveUiBooleanSetting(key, value) {
    uiPreferencesStorage?.writeBoolean(key, value);
  }

  function saveUiNumberSetting(key, value) {
    uiPreferencesStorage?.writeNumber(key, value);
  }

  function saveUiStringSetting(key, value) {
    uiPreferencesStorage?.writeString(key, value);
  }

  function normalizeUiSettings(settings = {}) {
    const nextType = ['ease-in', 'ease-out', 'ease-in-out'].includes(settings.volumeCurveType)
      ? settings.volumeCurveType
      : DEFAULT_PERSISTED_UI_SETTINGS.volumeCurveType;
    const nextHudPosition = HUD_POSITIONS.includes(settings.volumeHudPosition)
      ? settings.volumeHudPosition
      : DEFAULT_PERSISTED_UI_SETTINGS.volumeHudPosition;
    const nextHudOrientation = HUD_ORIENTATIONS.includes(settings.volumeHudOrientation)
      ? settings.volumeHudOrientation
      : DEFAULT_PERSISTED_UI_SETTINGS.volumeHudOrientation;

    return {
      ...DEFAULT_PERSISTED_UI_SETTINGS,
      ...settings,
      softTakeoverEnabled: Boolean(settings.softTakeoverEnabled),
      softTakeoverThreshold: Math.max(
        0,
        Math.min(15, Number.parseInt(settings.softTakeoverThreshold, 10) || 0)
      ),
      volumeHudEnabled: Boolean(
        settings.volumeHudEnabled ?? DEFAULT_PERSISTED_UI_SETTINGS.volumeHudEnabled
      ),
      volumeHudPosition: nextHudPosition,
      volumeHudOrientation: nextHudOrientation,
      volumeHudShowIcon: Boolean(
        settings.volumeHudShowIcon ?? DEFAULT_PERSISTED_UI_SETTINGS.volumeHudShowIcon
      ),
      volumeHudShowTitle: Boolean(
        settings.volumeHudShowTitle ?? DEFAULT_PERSISTED_UI_SETTINGS.volumeHudShowTitle
      ),
      volumeHudShowSubtitle: Boolean(
        settings.volumeHudShowSubtitle ?? DEFAULT_PERSISTED_UI_SETTINGS.volumeHudShowSubtitle
      ),
      volumeHudShowPercent: Boolean(
        settings.volumeHudShowPercent ?? DEFAULT_PERSISTED_UI_SETTINGS.volumeHudShowPercent
      ),
      volumeHudShowMeter: Boolean(
        settings.volumeHudShowMeter ?? DEFAULT_PERSISTED_UI_SETTINGS.volumeHudShowMeter
      ),
      volumeCurveType: nextType,
      volumeCurveAmount: Math.max(
        0,
        Math.min(100, Number.parseInt(settings.volumeCurveAmount, 10) || 0)
      )
    };
  }

  function normalizeUiMenu(menu = {}) {
    return {
      ...DEFAULT_SESSION_UI_MENU,
      ...menu,
      activeTab: menu.activeTab || null,
      open: Boolean(menu.open)
    };
  }

  function normalizeUiSessionState(session = {}, legacyMenu = undefined) {
    const nextMenu = session?.menu ?? legacyMenu;

    return {
      ...DEFAULT_SESSION_UI_STATE,
      ...(session || {}),
      menu: normalizeUiMenu(nextMenu)
    };
  }

  function getUiState() {
    const rawUiState = window.getAppState?.().ui || {};

    return {
      settings: normalizeUiSettings(rawUiState.settings),
      session: normalizeUiSessionState(rawUiState.session, rawUiState.menu)
    };
  }

  function getUiSettingsState() {
    return getUiState().settings;
  }

  function getUiSessionState() {
    return getUiState().session;
  }

  function getUiMenuState() {
    return getUiSessionState().menu;
  }

  function updateUiState(updater, meta = {}) {
    let nextUiState = null;

    window.setAppState?.((previousState) => {
      const currentUiState = {
        settings: normalizeUiSettings(previousState.ui?.settings),
        session: normalizeUiSessionState(previousState.ui?.session, previousState.ui?.menu)
      };
      const draftUiState = typeof updater === 'function'
        ? updater(currentUiState) || currentUiState
        : {
          ...currentUiState,
          ...(updater || {})
        };
      nextUiState = {
        settings: normalizeUiSettings(draftUiState.settings),
        session: normalizeUiSessionState(draftUiState.session, draftUiState.menu)
      };

      return {
        ...previousState,
        ui: {
          ...nextUiState
        }
      };
    }, meta);

    return nextUiState;
  }

  function setUiSettingsState(settings, meta = {}) {
    const nextSettings = normalizeUiSettings(settings);
    updateUiState((uiState) => ({
      ...uiState,
      settings: nextSettings
    }), {
      type: 'ui/set-settings',
      source: 'ui-store',
      ...meta
    });
    return nextSettings;
  }

  function patchUiSettingsState(patch, meta = {}) {
    const currentSettings = getUiSettingsState();
    const nextSettings = normalizeUiSettings({
      ...currentSettings,
      ...(patch || {})
    });

    if ('advancedMode' in (patch || {})) {
      saveUiBooleanSetting(UI_STORAGE_KEYS.advancedMode, nextSettings.advancedMode);
    }

    if ('developerMode' in (patch || {})) {
      saveUiBooleanSetting(UI_STORAGE_KEYS.developerMode, nextSettings.developerMode);
    }

    if ('faderInterpolationEnabled' in (patch || {})) {
      saveUiBooleanSetting(
        UI_STORAGE_KEYS.faderInterpolationEnabled,
        nextSettings.faderInterpolationEnabled
      );
    }

    if ('softTakeoverEnabled' in (patch || {})) {
      saveUiBooleanSetting(UI_STORAGE_KEYS.softTakeoverEnabled, nextSettings.softTakeoverEnabled);
    }

    if ('softTakeoverThreshold' in (patch || {})) {
      saveUiNumberSetting(UI_STORAGE_KEYS.softTakeoverThreshold, nextSettings.softTakeoverThreshold);
    }

    if ('showFractionalNumbers' in (patch || {})) {
      saveUiBooleanSetting(UI_STORAGE_KEYS.showFractionalNumbers, nextSettings.showFractionalNumbers);
    }

    if ('showFractionalOnlyLow' in (patch || {})) {
      saveUiBooleanSetting(
        UI_STORAGE_KEYS.showFractionalOnlyLow,
        nextSettings.showFractionalOnlyLow
      );
    }

    if ('volumeCurveEnabled' in (patch || {})) {
      saveUiBooleanSetting(UI_STORAGE_KEYS.volumeCurveEnabled, nextSettings.volumeCurveEnabled);
    }

    if ('volumeCurveType' in (patch || {})) {
      saveUiStringSetting(UI_STORAGE_KEYS.volumeCurveType, nextSettings.volumeCurveType);
    }

    if ('volumeCurveAmount' in (patch || {})) {
      saveUiNumberSetting(UI_STORAGE_KEYS.volumeCurveAmount, nextSettings.volumeCurveAmount);
    }

    if ('profileToolbarSwitcherEnabled' in (patch || {})) {
      saveUiBooleanSetting(
        UI_STORAGE_KEYS.profileToolbarSwitcherEnabled,
        nextSettings.profileToolbarSwitcherEnabled
      );
    }

    if ('volumeHudEnabled' in (patch || {})) {
      saveUiBooleanSetting(UI_STORAGE_KEYS.volumeHudEnabled, nextSettings.volumeHudEnabled);
    }

    if ('volumeHudPosition' in (patch || {})) {
      saveUiStringSetting(UI_STORAGE_KEYS.volumeHudPosition, nextSettings.volumeHudPosition);
    }

    if ('volumeHudOrientation' in (patch || {})) {
      saveUiStringSetting(UI_STORAGE_KEYS.volumeHudOrientation, nextSettings.volumeHudOrientation);
    }

    if ('volumeHudShowIcon' in (patch || {})) {
      saveUiBooleanSetting(UI_STORAGE_KEYS.volumeHudShowIcon, nextSettings.volumeHudShowIcon);
    }

    if ('volumeHudShowTitle' in (patch || {})) {
      saveUiBooleanSetting(UI_STORAGE_KEYS.volumeHudShowTitle, nextSettings.volumeHudShowTitle);
    }

    if ('volumeHudShowSubtitle' in (patch || {})) {
      saveUiBooleanSetting(UI_STORAGE_KEYS.volumeHudShowSubtitle, nextSettings.volumeHudShowSubtitle);
    }

    if ('volumeHudShowPercent' in (patch || {})) {
      saveUiBooleanSetting(UI_STORAGE_KEYS.volumeHudShowPercent, nextSettings.volumeHudShowPercent);
    }

    if ('volumeHudShowMeter' in (patch || {})) {
      saveUiBooleanSetting(UI_STORAGE_KEYS.volumeHudShowMeter, nextSettings.volumeHudShowMeter);
    }

    return setUiSettingsState(nextSettings, meta);
  }

  function setUiSessionState(session, meta = {}) {
    const nextSession = normalizeUiSessionState(session);
    updateUiState((uiState) => ({
      ...uiState,
      session: nextSession
    }), {
      type: 'ui/set-session',
      source: 'ui-store',
      ...meta
    });
    return nextSession;
  }

  function patchUiSessionState(patch, meta = {}) {
    const currentSession = getUiSessionState();
    return setUiSessionState({
      ...currentSession,
      ...(patch || {})
    }, meta);
  }

  function setUiMenuState(menu, meta = {}) {
    const nextMenu = normalizeUiMenu(menu);
    patchUiSessionState({
      menu: nextMenu
    }, {
      type: 'ui/set-menu',
      source: 'ui-store',
      ...meta
    });
    return nextMenu;
  }

  function patchUiMenuState(patch, meta = {}) {
    const currentMenu = getUiMenuState();
    return setUiMenuState({
      ...currentMenu,
      ...(patch || {})
    }, meta);
  }

  function subscribeUiState(listener) {
    if (typeof listener !== 'function' || typeof window.subscribeAppState !== 'function') {
      return () => {};
    }

    return window.subscribeAppState((nextState, previousState, meta = {}) => {
      if (nextState.ui === previousState.ui) {
        return;
      }

      listener(
        {
          settings: normalizeUiSettings(nextState.ui?.settings),
          session: normalizeUiSessionState(nextState.ui?.session, nextState.ui?.menu)
        },
        {
          settings: normalizeUiSettings(previousState.ui?.settings),
          session: normalizeUiSessionState(previousState.ui?.session, previousState.ui?.menu)
        },
        meta
      );
    });
  }

  function initUiStore() {
    if (uiStoreInitialized) {
      return getUiState();
    }

    setUiSettingsState({
      advancedMode: readUiBooleanSetting(UI_STORAGE_KEYS.advancedMode),
      developerMode: readUiBooleanSetting(UI_STORAGE_KEYS.developerMode),
      faderInterpolationEnabled: readUiBooleanSetting(UI_STORAGE_KEYS.faderInterpolationEnabled),
      softTakeoverEnabled: readUiBooleanSetting(UI_STORAGE_KEYS.softTakeoverEnabled),
      softTakeoverThreshold: readUiNumberSetting(UI_STORAGE_KEYS.softTakeoverThreshold, 5, {
        min: 0,
        max: 15
      }),
      showFractionalNumbers: readUiBooleanSetting(UI_STORAGE_KEYS.showFractionalNumbers),
      showFractionalOnlyLow: readUiBooleanSetting(UI_STORAGE_KEYS.showFractionalOnlyLow),
      volumeCurveEnabled: readUiBooleanSetting(UI_STORAGE_KEYS.volumeCurveEnabled),
      volumeCurveType: uiPreferencesStorage?.readString(UI_STORAGE_KEYS.volumeCurveType, 'ease-in-out') || 'ease-in-out',
      volumeCurveAmount: readUiNumberSetting(UI_STORAGE_KEYS.volumeCurveAmount, 0, {
        min: 0,
        max: 100
      }),
      profileToolbarSwitcherEnabled: readUiBooleanSetting(
        UI_STORAGE_KEYS.profileToolbarSwitcherEnabled,
        true
      ),
      volumeHudEnabled: readUiBooleanSetting(UI_STORAGE_KEYS.volumeHudEnabled, true),
      volumeHudPosition: uiPreferencesStorage?.readString(UI_STORAGE_KEYS.volumeHudPosition, 'bottom-center') || 'bottom-center',
      volumeHudOrientation: uiPreferencesStorage?.readString(UI_STORAGE_KEYS.volumeHudOrientation, 'horizontal') || 'horizontal',
      volumeHudShowIcon: readUiBooleanSetting(UI_STORAGE_KEYS.volumeHudShowIcon, true),
      volumeHudShowTitle: readUiBooleanSetting(UI_STORAGE_KEYS.volumeHudShowTitle, true),
      volumeHudShowSubtitle: readUiBooleanSetting(UI_STORAGE_KEYS.volumeHudShowSubtitle, true),
      volumeHudShowPercent: readUiBooleanSetting(UI_STORAGE_KEYS.volumeHudShowPercent, true),
      volumeHudShowMeter: readUiBooleanSetting(UI_STORAGE_KEYS.volumeHudShowMeter, true)
    }, {
      type: 'ui/init-settings',
      source: 'ui-store'
    });

    setUiSessionState(DEFAULT_SESSION_UI_STATE, {
      type: 'ui/init-menu',
      source: 'ui-store'
    });
 
    uiStoreInitialized = true;
    return getUiState();
  }

  function resetSessionUiMenuState(meta = {}) {
    return setUiMenuState(DEFAULT_SESSION_UI_MENU, {
      type: 'ui/init-menu',
      source: 'ui-store',
      ...meta
    });
  }

  function getAdvancedModeEnabledState() {
    return getUiSettingsState().advancedMode;
  }

  function getDeveloperModeEnabledState() {
    return getUiSettingsState().developerMode;
  }

  function getFaderInterpolationEnabledState() {
    return getUiSettingsState().faderInterpolationEnabled;
  }

  function getSoftTakeoverEnabledState() {
    return getUiSettingsState().softTakeoverEnabled;
  }

  function getSoftTakeoverThresholdState() {
    return getUiSettingsState().softTakeoverThreshold;
  }

  function getShowFractionalNumbersState() {
    return getUiSettingsState().showFractionalNumbers;
  }

  function getShowFractionalOnlyLowState() {
    return getUiSettingsState().showFractionalOnlyLow;
  }

  function getVolumeCurveEnabledState() {
    return getUiSettingsState().volumeCurveEnabled;
  }

  function getVolumeCurveTypeState() {
    return getUiSettingsState().volumeCurveType;
  }

  function getVolumeCurveAmountState() {
    return getUiSettingsState().volumeCurveAmount;
  }

  function getProfileToolbarSwitcherEnabledState() {
    return getUiSettingsState().profileToolbarSwitcherEnabled;
  }

  function getVolumeHudEnabledState() {
    return getUiSettingsState().volumeHudEnabled;
  }

  function getVolumeHudPositionState() {
    return getUiSettingsState().volumeHudPosition;
  }

  function getVolumeHudOrientationState() {
    return getUiSettingsState().volumeHudOrientation;
  }

  function getVolumeHudShowIconState() {
    return getUiSettingsState().volumeHudShowIcon;
  }

  function getVolumeHudShowTitleState() {
    return getUiSettingsState().volumeHudShowTitle;
  }

  function getVolumeHudShowSubtitleState() {
    return getUiSettingsState().volumeHudShowSubtitle;
  }

  function getVolumeHudShowPercentState() {
    return getUiSettingsState().volumeHudShowPercent;
  }

  function getVolumeHudShowMeterState() {
    return getUiSettingsState().volumeHudShowMeter;
  }

  function getIsMenuOpenState() {
    return getUiMenuState().open;
  }

  function getActiveMenuTabState() {
    return getUiMenuState().activeTab;
  }

  function setAdvancedModeState(value, meta = {}) {
    return patchUiSettingsState({ advancedMode: Boolean(value) }, {
      type: 'ui/settings/advanced-mode',
      ...meta
    });
  }

  function setDeveloperModeState(value, meta = {}) {
    return patchUiSettingsState({ developerMode: Boolean(value) }, {
      type: 'ui/settings/developer-mode',
      ...meta
    });
  }

  function setFaderInterpolationEnabledState(value, meta = {}) {
    return patchUiSettingsState({ faderInterpolationEnabled: Boolean(value) }, {
      type: 'ui/settings/fader-interpolation',
      ...meta
    });
  }

  function setSoftTakeoverEnabledState(value, meta = {}) {
    return patchUiSettingsState({ softTakeoverEnabled: Boolean(value) }, {
      type: 'ui/settings/soft-takeover-enabled',
      ...meta
    });
  }

  function setSoftTakeoverThresholdState(value, meta = {}) {
    return patchUiSettingsState({ softTakeoverThreshold: value }, {
      type: 'ui/settings/soft-takeover-threshold',
      ...meta
    });
  }

  function setShowFractionalNumbersState(value, meta = {}) {
    return patchUiSettingsState({ showFractionalNumbers: Boolean(value) }, {
      type: 'ui/settings/show-fractional',
      ...meta
    });
  }

  function setShowFractionalOnlyLowState(value, meta = {}) {
    return patchUiSettingsState({ showFractionalOnlyLow: Boolean(value) }, {
      type: 'ui/settings/show-fractional-only-low',
      ...meta
    });
  }

  function setVolumeCurveEnabledState(value, meta = {}) {
    return patchUiSettingsState({ volumeCurveEnabled: Boolean(value) }, {
      type: 'ui/settings/volume-curve-enabled',
      ...meta
    });
  }

  function setVolumeCurveTypeState(value, meta = {}) {
    return patchUiSettingsState({ volumeCurveType: value }, {
      type: 'ui/settings/volume-curve-type',
      ...meta
    });
  }

  function setVolumeCurveAmountState(value, meta = {}) {
    return patchUiSettingsState({ volumeCurveAmount: value }, {
      type: 'ui/settings/volume-curve-amount',
      ...meta
    });
  }

  function setProfileToolbarSwitcherEnabledState(value, meta = {}) {
    return patchUiSettingsState({ profileToolbarSwitcherEnabled: Boolean(value) }, {
      type: 'ui/settings/profile-toolbar-switcher',
      ...meta
    });
  }

  function setVolumeHudEnabledState(value, meta = {}) {
    return patchUiSettingsState({ volumeHudEnabled: Boolean(value) }, {
      type: 'ui/settings/volume-hud-enabled',
      ...meta
    });
  }

  function setVolumeHudPositionState(value, meta = {}) {
    return patchUiSettingsState({ volumeHudPosition: value }, {
      type: 'ui/settings/volume-hud-position',
      ...meta
    });
  }

  function setVolumeHudOrientationState(value, meta = {}) {
    return patchUiSettingsState({ volumeHudOrientation: value }, {
      type: 'ui/settings/volume-hud-orientation',
      ...meta
    });
  }

  function setVolumeHudShowIconState(value, meta = {}) {
    return patchUiSettingsState({ volumeHudShowIcon: Boolean(value) }, {
      type: 'ui/settings/volume-hud-show-icon',
      ...meta
    });
  }

  function setVolumeHudShowTitleState(value, meta = {}) {
    return patchUiSettingsState({ volumeHudShowTitle: Boolean(value) }, {
      type: 'ui/settings/volume-hud-show-title',
      ...meta
    });
  }

  function setVolumeHudShowSubtitleState(value, meta = {}) {
    return patchUiSettingsState({ volumeHudShowSubtitle: Boolean(value) }, {
      type: 'ui/settings/volume-hud-show-subtitle',
      ...meta
    });
  }

  function setVolumeHudShowPercentState(value, meta = {}) {
    return patchUiSettingsState({ volumeHudShowPercent: Boolean(value) }, {
      type: 'ui/settings/volume-hud-show-percent',
      ...meta
    });
  }

  function setVolumeHudShowMeterState(value, meta = {}) {
    return patchUiSettingsState({ volumeHudShowMeter: Boolean(value) }, {
      type: 'ui/settings/volume-hud-show-meter',
      ...meta
    });
  }

  function setMenuOpenState(value, meta = {}) {
    return patchUiMenuState({ open: Boolean(value) }, {
      type: 'ui/menu/open',
      ...meta
    });
  }

  function setActiveMenuTabState(value, meta = {}) {
    return patchUiMenuState({ activeTab: value || null }, {
      type: 'ui/menu/active-tab',
      ...meta
    });
  }

  window.initUiStore = initUiStore;
  window.getUiState = getUiState;
  window.getUiSettingsState = getUiSettingsState;
  window.getUiSessionState = getUiSessionState;
  window.getUiMenuState = getUiMenuState;
  window.subscribeUiState = subscribeUiState;
  window.setUiSettingsState = setUiSettingsState;
  window.patchUiSettingsState = patchUiSettingsState;
  window.setUiSessionState = setUiSessionState;
  window.patchUiSessionState = patchUiSessionState;
  window.setUiMenuState = setUiMenuState;
  window.patchUiMenuState = patchUiMenuState;
  window.resetSessionUiMenuState = resetSessionUiMenuState;
  window.getAdvancedModeEnabledState = getAdvancedModeEnabledState;
  window.getDeveloperModeEnabledState = getDeveloperModeEnabledState;
  window.getFaderInterpolationEnabledState = getFaderInterpolationEnabledState;
  window.getSoftTakeoverEnabledState = getSoftTakeoverEnabledState;
  window.getSoftTakeoverThresholdState = getSoftTakeoverThresholdState;
  window.getShowFractionalNumbersState = getShowFractionalNumbersState;
  window.getShowFractionalOnlyLowState = getShowFractionalOnlyLowState;
  window.getVolumeCurveEnabledState = getVolumeCurveEnabledState;
  window.getVolumeCurveTypeState = getVolumeCurveTypeState;
  window.getVolumeCurveAmountState = getVolumeCurveAmountState;
  window.getProfileToolbarSwitcherEnabledState = getProfileToolbarSwitcherEnabledState;
  window.getVolumeHudEnabledState = getVolumeHudEnabledState;
  window.getVolumeHudPositionState = getVolumeHudPositionState;
  window.getVolumeHudOrientationState = getVolumeHudOrientationState;
  window.getVolumeHudShowIconState = getVolumeHudShowIconState;
  window.getVolumeHudShowTitleState = getVolumeHudShowTitleState;
  window.getVolumeHudShowSubtitleState = getVolumeHudShowSubtitleState;
  window.getVolumeHudShowPercentState = getVolumeHudShowPercentState;
  window.getVolumeHudShowMeterState = getVolumeHudShowMeterState;
  window.getIsMenuOpenState = getIsMenuOpenState;
  window.getActiveMenuTabState = getActiveMenuTabState;
  window.setAdvancedModeState = setAdvancedModeState;
  window.setDeveloperModeState = setDeveloperModeState;
  window.setFaderInterpolationEnabledState = setFaderInterpolationEnabledState;
  window.setSoftTakeoverEnabledState = setSoftTakeoverEnabledState;
  window.setSoftTakeoverThresholdState = setSoftTakeoverThresholdState;
  window.setShowFractionalNumbersState = setShowFractionalNumbersState;
  window.setShowFractionalOnlyLowState = setShowFractionalOnlyLowState;
  window.setVolumeCurveEnabledState = setVolumeCurveEnabledState;
  window.setVolumeCurveTypeState = setVolumeCurveTypeState;
  window.setVolumeCurveAmountState = setVolumeCurveAmountState;
  window.setProfileToolbarSwitcherEnabledState = setProfileToolbarSwitcherEnabledState;
  window.setVolumeHudEnabledState = setVolumeHudEnabledState;
  window.setVolumeHudPositionState = setVolumeHudPositionState;
  window.setVolumeHudOrientationState = setVolumeHudOrientationState;
  window.setVolumeHudShowIconState = setVolumeHudShowIconState;
  window.setVolumeHudShowTitleState = setVolumeHudShowTitleState;
  window.setVolumeHudShowSubtitleState = setVolumeHudShowSubtitleState;
  window.setVolumeHudShowPercentState = setVolumeHudShowPercentState;
  window.setVolumeHudShowMeterState = setVolumeHudShowMeterState;
  window.setMenuOpenState = setMenuOpenState;
  window.setActiveMenuTabState = setActiveMenuTabState;
})(window);
