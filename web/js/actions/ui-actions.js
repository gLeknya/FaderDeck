(function initUiActions(window) {
  function patchUiSettings(patch, meta = {}) {
    return (
      window.patchUiSettingsState?.(patch, {
        source: 'ui-actions',
        ...(meta || {})
      }) || null
    );
  }

  function patchUiMenu(patch, meta = {}) {
    return (
      window.patchUiMenuState?.(patch, {
        source: 'ui-actions',
        ...(meta || {})
      }) || null
    );
  }

  function openMainMenu(meta = {}) {
    return patchUiMenu(
      { open: true },
      {
        type: 'ui-actions/menu-open',
        ...meta
      }
    );
  }

  function closeMainMenu(meta = {}) {
    return patchUiMenu(
      { open: false },
      {
        type: 'ui-actions/menu-close',
        ...meta
      }
    );
  }

  function toggleMainMenu(meta = {}) {
    return (window.getIsMenuOpenState?.() ?? false)
      ? closeMainMenu(meta)
      : openMainMenu(meta);
  }

  function setActiveMenuTab(tabName, meta = {}) {
    return patchUiMenu(
      { activeTab: tabName || null },
      {
        type: 'ui-actions/menu-set-tab',
        ...meta
      }
    );
  }

  function toggleMainMenuTab(tabName, meta = {}) {
    if (!(window.getIsMenuOpenState?.() ?? false)) {
      openMainMenu(meta);
      return setActiveMenuTab(tabName, meta);
    }

    const currentTab = window.getActiveMenuTabState?.() ?? null;
    return setActiveMenuTab(currentTab === tabName ? null : tabName, meta);
  }

  function setAdvancedMode(value, meta = {}) {
    return patchUiSettings(
      { advancedMode: Boolean(value) },
      {
        type: 'ui-actions/settings-advanced-mode',
        ...meta
      }
    );
  }

  function toggleAdvancedMode(meta = {}) {
    return setAdvancedMode(
      !(window.getAdvancedModeEnabledState?.() ?? false),
      meta
    );
  }

  function setDeveloperMode(value, meta = {}) {
    return patchUiSettings(
      { developerMode: Boolean(value) },
      {
        type: 'ui-actions/settings-developer-mode',
        ...meta
      }
    );
  }

  function toggleDeveloperMode(meta = {}) {
    return setDeveloperMode(
      !(window.getDeveloperModeEnabledState?.() ?? false),
      meta
    );
  }

  function setCloseToTrayEnabled(value, meta = {}) {
    return patchUiSettings(
      { closeToTrayEnabled: Boolean(value) },
      {
        type: 'ui-actions/settings-close-to-tray-enabled',
        ...meta
      }
    );
  }

  function toggleCloseToTrayEnabled(meta = {}) {
    return setCloseToTrayEnabled(
      !(window.getCloseToTrayEnabledState?.() ?? true),
      meta
    );
  }

  function setFaderInterpolationEnabled(value, meta = {}) {
    return patchUiSettings(
      { faderInterpolationEnabled: Boolean(value) },
      {
        type: 'ui-actions/settings-fader-interpolation',
        ...meta
      }
    );
  }

  function toggleFaderInterpolation(meta = {}) {
    return setFaderInterpolationEnabled(
      !(window.getFaderInterpolationEnabledState?.() ?? false),
      meta
    );
  }

  function setSoftTakeoverEnabled(value, meta = {}) {
    return patchUiSettings(
      { softTakeoverEnabled: Boolean(value) },
      {
        type: 'ui-actions/settings-soft-takeover-enabled',
        ...meta
      }
    );
  }

  function toggleSoftTakeover(meta = {}) {
    return setSoftTakeoverEnabled(
      !(window.getSoftTakeoverEnabledState?.() ?? false),
      meta
    );
  }

  function setSoftTakeoverThreshold(value, meta = {}) {
    return patchUiSettings(
      { softTakeoverThreshold: value },
      {
        type: 'ui-actions/settings-soft-takeover-threshold',
        ...meta
      }
    );
  }

  function setProfileToolbarSwitcherEnabled(value, meta = {}) {
    return patchUiSettings(
      { profileToolbarSwitcherEnabled: Boolean(value) },
      {
        type: 'ui-actions/settings-profile-toolbar-switcher',
        ...meta
      }
    );
  }

  function toggleProfileToolbarSwitcher(meta = {}) {
    return setProfileToolbarSwitcherEnabled(
      !(window.getProfileToolbarSwitcherEnabledState?.() ?? true),
      meta
    );
  }

  function setVolumeHudEnabled(value, meta = {}) {
    return patchUiSettings(
      { volumeHudEnabled: Boolean(value) },
      {
        type: 'ui-actions/settings-volume-hud-enabled',
        ...meta
      }
    );
  }

  function toggleVolumeHud(meta = {}) {
    return setVolumeHudEnabled(
      !(window.getVolumeHudEnabledState?.() ?? true),
      meta
    );
  }

  function setVolumeHudPosition(value, meta = {}) {
    return patchUiSettings(
      { volumeHudPosition: value },
      {
        type: 'ui-actions/settings-volume-hud-position',
        ...meta
      }
    );
  }

  function setVolumeHudOrientation(value, meta = {}) {
    return patchUiSettings(
      { volumeHudOrientation: value },
      {
        type: 'ui-actions/settings-volume-hud-orientation',
        ...meta
      }
    );
  }

  function toggleVolumeHudOrientation(meta = {}) {
    const nextOrientation =
      (window.getVolumeHudOrientationState?.() ?? 'horizontal') === 'vertical'
        ? 'horizontal'
        : 'vertical';
    return setVolumeHudOrientation(nextOrientation, meta);
  }

  function setVolumeHudShowIcon(value, meta = {}) {
    return patchUiSettings(
      { volumeHudShowIcon: Boolean(value) },
      {
        type: 'ui-actions/settings-volume-hud-show-icon',
        ...meta
      }
    );
  }

  function toggleVolumeHudShowIcon(meta = {}) {
    return setVolumeHudShowIcon(
      !(window.getVolumeHudShowIconState?.() ?? true),
      meta
    );
  }

  function setVolumeHudShowTitle(value, meta = {}) {
    return patchUiSettings(
      { volumeHudShowTitle: Boolean(value) },
      {
        type: 'ui-actions/settings-volume-hud-show-title',
        ...meta
      }
    );
  }

  function toggleVolumeHudShowTitle(meta = {}) {
    return setVolumeHudShowTitle(
      !(window.getVolumeHudShowTitleState?.() ?? true),
      meta
    );
  }

  function setVolumeHudShowSubtitle(value, meta = {}) {
    return patchUiSettings(
      { volumeHudShowSubtitle: Boolean(value) },
      {
        type: 'ui-actions/settings-volume-hud-show-subtitle',
        ...meta
      }
    );
  }

  function toggleVolumeHudShowSubtitle(meta = {}) {
    return setVolumeHudShowSubtitle(
      !(window.getVolumeHudShowSubtitleState?.() ?? true),
      meta
    );
  }

  function setVolumeHudShowPercent(value, meta = {}) {
    return patchUiSettings(
      { volumeHudShowPercent: Boolean(value) },
      {
        type: 'ui-actions/settings-volume-hud-show-percent',
        ...meta
      }
    );
  }

  function toggleVolumeHudShowPercent(meta = {}) {
    return setVolumeHudShowPercent(
      !(window.getVolumeHudShowPercentState?.() ?? true),
      meta
    );
  }

  function setVolumeHudShowMeter(value, meta = {}) {
    return patchUiSettings(
      { volumeHudShowMeter: Boolean(value) },
      {
        type: 'ui-actions/settings-volume-hud-show-meter',
        ...meta
      }
    );
  }

  function toggleVolumeHudShowMeter(meta = {}) {
    return setVolumeHudShowMeter(
      !(window.getVolumeHudShowMeterState?.() ?? true),
      meta
    );
  }

  function setMediaControllerVisible(value, meta = {}) {
    return patchUiSettings(
      { mediaControllerVisible: Boolean(value) },
      {
        type: 'ui-actions/settings-media-controller-visible',
        ...meta
      }
    );
  }

  function setMediaControllerTargetAppId(value, meta = {}) {
    return patchUiSettings(
      { mediaControllerTargetAppId: String(value || '').trim() },
      {
        type: 'ui-actions/settings-media-controller-target-app-id',
        ...meta
      }
    );
  }

  function toggleMediaControllerVisible(meta = {}) {
    return setMediaControllerVisible(
      !(window.getMediaControllerVisibleState?.() ?? true),
      meta
    );
  }

  function setShowFractionalNumbers(value, meta = {}) {
    return patchUiSettings(
      { showFractionalNumbers: Boolean(value) },
      {
        type: 'ui-actions/settings-show-fractional',
        ...meta
      }
    );
  }

  function toggleShowFractionalNumbers(meta = {}) {
    return setShowFractionalNumbers(
      !(window.getShowFractionalNumbersState?.() ?? false),
      meta
    );
  }

  function setShowFractionalOnlyLow(value, meta = {}) {
    return patchUiSettings(
      { showFractionalOnlyLow: Boolean(value) },
      {
        type: 'ui-actions/settings-show-fractional-only-low',
        ...meta
      }
    );
  }

  function toggleShowFractionalOnlyLow(meta = {}) {
    return setShowFractionalOnlyLow(
      !(window.getShowFractionalOnlyLowState?.() ?? false),
      meta
    );
  }

  function setVolumeCurveEnabled(value, meta = {}) {
    return patchUiSettings(
      { volumeCurveEnabled: Boolean(value) },
      {
        type: 'ui-actions/settings-volume-curve-enabled',
        ...meta
      }
    );
  }

  function toggleVolumeCurve(meta = {}) {
    return setVolumeCurveEnabled(
      !(window.getVolumeCurveEnabledState?.() ?? false),
      meta
    );
  }

  function setVolumeCurveType(value, meta = {}) {
    return patchUiSettings(
      { volumeCurveType: value },
      {
        type: 'ui-actions/settings-volume-curve-type',
        ...meta
      }
    );
  }

  function setVolumeCurveAmount(value, meta = {}) {
    return patchUiSettings(
      { volumeCurveAmount: value },
      {
        type: 'ui-actions/settings-volume-curve-amount',
        ...meta
      }
    );
  }

  window.uiActions = {
    patchUiSettings,
    openMainMenu,
    closeMainMenu,
    toggleMainMenu,
    setActiveMenuTab,
    toggleMainMenuTab,
    setAdvancedMode,
    toggleAdvancedMode,
    setDeveloperMode,
    toggleDeveloperMode,
    setCloseToTrayEnabled,
    toggleCloseToTrayEnabled,
    setFaderInterpolationEnabled,
    toggleFaderInterpolation,
    setSoftTakeoverEnabled,
    toggleSoftTakeover,
    setSoftTakeoverThreshold,
    setProfileToolbarSwitcherEnabled,
    toggleProfileToolbarSwitcher,
    setVolumeHudEnabled,
    toggleVolumeHud,
    setVolumeHudPosition,
    setVolumeHudOrientation,
    toggleVolumeHudOrientation,
    setVolumeHudShowIcon,
    toggleVolumeHudShowIcon,
    setVolumeHudShowTitle,
    toggleVolumeHudShowTitle,
    setVolumeHudShowSubtitle,
    toggleVolumeHudShowSubtitle,
    setVolumeHudShowPercent,
    toggleVolumeHudShowPercent,
    setVolumeHudShowMeter,
    toggleVolumeHudShowMeter,
    setMediaControllerVisible,
    setMediaControllerTargetAppId,
    toggleMediaControllerVisible,
    setShowFractionalNumbers,
    toggleShowFractionalNumbers,
    setShowFractionalOnlyLow,
    toggleShowFractionalOnlyLow,
    setVolumeCurveEnabled,
    toggleVolumeCurve,
    setVolumeCurveType,
    setVolumeCurveAmount
  };
})(window);
