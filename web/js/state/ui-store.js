(function initUiStore(window) {
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
    profileToolbarSwitcherEnabled: 'faderdeck_profile_toolbar_switcher_enabled'
  });

  const DEFAULT_UI_SETTINGS = Object.freeze({
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
    profileToolbarSwitcherEnabled: true
  });

  const DEFAULT_UI_MENU = Object.freeze({
    open: false,
    activeTab: null
  });

  let uiStoreInitialized = false;

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

  function saveUiBooleanSetting(key, value) {
    localStorage.setItem(key, String(Boolean(value)));
  }

  function saveUiNumberSetting(key, value) {
    localStorage.setItem(key, String(value));
  }

  function saveUiStringSetting(key, value) {
    if (value === null || value === undefined || value === '') {
      localStorage.removeItem(key);
      return;
    }

    localStorage.setItem(key, String(value));
  }

  function normalizeUiSettings(settings = {}) {
    const nextType = ['ease-in', 'ease-out', 'ease-in-out'].includes(settings.volumeCurveType)
      ? settings.volumeCurveType
      : DEFAULT_UI_SETTINGS.volumeCurveType;

    return {
      ...DEFAULT_UI_SETTINGS,
      ...settings,
      softTakeoverEnabled: Boolean(settings.softTakeoverEnabled),
      softTakeoverThreshold: Math.max(
        0,
        Math.min(15, Number.parseInt(settings.softTakeoverThreshold, 10) || 0)
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
      ...DEFAULT_UI_MENU,
      ...menu,
      activeTab: menu.activeTab || null,
      open: Boolean(menu.open)
    };
  }

  function getUiState() {
    return window.getAppState?.().ui || {
      settings: { ...DEFAULT_UI_SETTINGS },
      menu: { ...DEFAULT_UI_MENU }
    };
  }

  function getUiSettingsState() {
    return normalizeUiSettings(getUiState().settings);
  }

  function getUiMenuState() {
    return normalizeUiMenu(getUiState().menu);
  }

  function updateUiState(updater, meta = {}) {
    let nextUiState = null;

    window.setAppState?.((previousState) => {
      const currentUiState = {
        settings: normalizeUiSettings(previousState.ui?.settings),
        menu: normalizeUiMenu(previousState.ui?.menu)
      };
      nextUiState = typeof updater === 'function'
        ? updater(currentUiState) || currentUiState
        : {
          ...currentUiState,
          ...(updater || {})
        };

      return {
        ...previousState,
        ui: {
          ...previousState.ui,
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

    return setUiSettingsState(nextSettings, meta);
  }

  function setUiMenuState(menu, meta = {}) {
    const nextMenu = normalizeUiMenu(menu);
    updateUiState((uiState) => ({
      ...uiState,
      menu: nextMenu
    }), {
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
          menu: normalizeUiMenu(nextState.ui?.menu)
        },
        {
          settings: normalizeUiSettings(previousState.ui?.settings),
          menu: normalizeUiMenu(previousState.ui?.menu)
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
      volumeCurveType: localStorage.getItem(UI_STORAGE_KEYS.volumeCurveType) || 'ease-in-out',
      volumeCurveAmount: readUiNumberSetting(UI_STORAGE_KEYS.volumeCurveAmount, 0, {
        min: 0,
        max: 100
      }),
      profileToolbarSwitcherEnabled: readUiBooleanSetting(
        UI_STORAGE_KEYS.profileToolbarSwitcherEnabled,
        true
      )
    }, {
      type: 'ui/init-settings',
      source: 'ui-store'
    });

    setUiMenuState(DEFAULT_UI_MENU, {
      type: 'ui/init-menu',
      source: 'ui-store'
    });

    uiStoreInitialized = true;
    return getUiState();
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
  window.getUiMenuState = getUiMenuState;
  window.subscribeUiState = subscribeUiState;
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
  window.setMenuOpenState = setMenuOpenState;
  window.setActiveMenuTabState = setActiveMenuTabState;
})(window);
