let activeFaderDrag = null;
const CHANNEL_VOLUME_PUSH_DELAY_MS = 18;
const CHANNEL_INTERPOLATION_STEPS = 4;
const CHANNEL_INTERPOLATION_STEP_DELAY_MS = 24;
const CHANNEL_PICKUP_FLASH_DURATION_MS = 380;
const CHANNEL_AUDIO_RUNTIME_CACHE_TTL_MS = 90;
const CHANNEL_AUDIO_RUNTIME_LOCAL_OVERRIDE_MS = 220;
const CHANNEL_AUDIO_RUNTIME_FADER_SYNC_EPSILON = 0.35;
const channelVolumePushState = new Map();
const channelMuteHoldState = new Map();
const channelPickupFlashTimers = new Map();
const channelEntranceAnimatedIds = new Set();
const channelFaderDomCache = new Map();
const channelAudioRuntimeState = new Map();
let channelUiStateSyncInitialized = false;
let channelPickupUiInitialized = false;

function getChannels() {
  return typeof getChannelsState === 'function' ? getChannelsState() : [];
}

function getChannelById(channelId) {
  return typeof findChannelState === 'function' ? findChannelState(channelId) : null;
}

function getMixerLayoutItems() {
  return typeof getLayoutItemsByZoneState === 'function'
    ? getLayoutItemsByZoneState(window.LAYOUT_ZONES?.mixer || 'mixer')
    : getChannels().map((channel) => ({
      id: `layout-channel-${channel.id}`,
      type: window.LAYOUT_ITEM_TYPES?.channel || 'channel',
      zone: window.LAYOUT_ZONES?.mixer || 'mixer',
      entityId: channel.id
    }));
}

function getChannelLayoutEditModeEnabled() {
  // Park marker: keep layout ordering support active, but leave editor UI
  // and interaction paths disabled until layout editing is re-enabled later.
  if (window.isLayoutEditorParked?.()) {
    return false;
  }

  return typeof isLayoutEditModeEnabledState === 'function'
    ? isLayoutEditModeEnabledState()
    : false;
}

function getSelectedChannelLayoutItemId() {
  return typeof getSelectedLayoutItemIdState === 'function'
    ? getSelectedLayoutItemIdState()
    : null;
}

function getHoveredChannelLayoutItemId() {
  return typeof getHoveredLayoutItemIdState === 'function'
    ? getHoveredLayoutItemIdState()
    : null;
}

function getDraggedChannelLayoutItemId() {
  return typeof getDraggedLayoutItemIdState === 'function'
    ? getDraggedLayoutItemIdState()
    : null;
}

function getChannelLayoutDropPreview() {
  return typeof getLayoutDropPreviewState === 'function'
    ? getLayoutDropPreviewState()
    : null;
}

function getChannelLayoutItemClassName(layoutItem) {
  const classNames = ['surface-layout-item', 'surface-layout-item--channel'];

  if (window.isLayoutEditorParked?.()) {
    if (layoutItem.type === (window.LAYOUT_ITEM_TYPES?.spacer || 'spacer')) {
      classNames.push('layout-spacer-shell');
    }

    return classNames.join(' ');
  }

  const selectedItemId = getSelectedChannelLayoutItemId();
  const hoveredItemId = getHoveredChannelLayoutItemId();
  const draggedItemId = getDraggedChannelLayoutItemId();
  const dropPreview = getChannelLayoutDropPreview();

  if (selectedItemId === layoutItem.id) {
    classNames.push('is-selected');
  }

  if (hoveredItemId === layoutItem.id) {
    classNames.push('is-hovered');
  }

  if (draggedItemId === layoutItem.id) {
    classNames.push('is-dragging-layout-item');
  }

  if (dropPreview?.itemId === layoutItem.id) {
    classNames.push(dropPreview.position === 'before' ? 'is-drop-before' : 'is-drop-after');
  }

  if (layoutItem.type === (window.LAYOUT_ITEM_TYPES?.spacer || 'spacer')) {
    classNames.push('layout-spacer-shell');
  }

  return classNames.join(' ');
}

function getChannelLayoutInteractionAttributes(layoutItem) {
  if (!layoutItem || !getChannelLayoutEditModeEnabled()) {
    return '';
  }

  const zone = layoutItem.zone || window.LAYOUT_ZONES?.mixer || 'mixer';

  return `
    draggable="true"
    ondragstart="startLayoutSurfaceDrag(event, '${layoutItem.id}')"
    ondragend="endLayoutSurfaceDrag(event)"
    ondragover="previewLayoutSurfaceDrop(event, '${zone}', '${layoutItem.id}')"
    ondrop="dropLayoutSurfaceItem(event, '${zone}', '${layoutItem.id}')"
  `;
}

function renderChannelLayoutEditOverlay(layoutItem, labelKey) {
  if (!layoutItem || !getChannelLayoutEditModeEnabled()) {
    return '';
  }

  const isSelected = getSelectedChannelLayoutItemId() === layoutItem.id;
  const isHovered = getHoveredChannelLayoutItemId() === layoutItem.id;

  return `
    <button
      class="layout-edit-overlay ${isSelected ? 'is-selected' : ''} ${isHovered ? 'is-hovered' : ''}"
      type="button"
      onclick="selectLayoutSurfaceItem('${layoutItem.id}')"
      onmouseenter="hoverLayoutSurfaceItem('${layoutItem.id}')"
      onmouseleave="clearLayoutSurfaceHover()">
      <span class="layout-edit-overlay__label">${t(labelKey)}</span>
    </button>
  `;
}

function renderChannelLayoutItemActions(layoutItem) {
  if (!layoutItem || !getChannelLayoutEditModeEnabled()) {
    return '';
  }

  if (layoutItem.type !== (window.LAYOUT_ITEM_TYPES?.spacer || 'spacer')) {
    return '';
  }

  return `
    <div class="layout-item-mini-actions">
      <button
        class="layout-item-mini-action"
        type="button"
        title="${t('layout.removeSpacer')}"
        aria-label="${t('layout.removeSpacer')}"
        onclick="removeLayoutSpacer('${layoutItem.id}')">
        &times;
      </button>
    </div>
  `;
}

function renderMixerLayoutInsertControl() {
  if (!getChannelLayoutEditModeEnabled()) {
    return '';
  }

  return `
    <button
      class="layout-zone-insert layout-zone-insert--channel"
      type="button"
      title="${t('layout.addSpacer')}"
      aria-label="${t('layout.addSpacer')}"
      onclick="insertLayoutSpacerIntoZone('${window.LAYOUT_ZONES?.mixer || 'mixer'}')">
      <span class="layout-zone-insert__plus">+</span>
      <span class="layout-zone-insert__label">${t('layout.addSpacer')}</span>
    </button>
  `;
}

function createChannelModel(index) {
  if (typeof createChannelStateModel === 'function') {
    return createChannelStateModel(index);
  }

  return {
    id: Date.now(),
    app: 'master',
    appName: t('audio.systemVolume'),
    title: t('channels.defaultTitle', { index }),
    faderCC: null,
    faderMapping: null,
    volume: 100,
    buttons: [],
    hasBeenConfigured: false,
    skipBinding: false,
    showBindHint: true,
    flashOnCreate: true
  };
}

async function createChannel() {
  return window.channelActions?.createChannel({}, { source: 'ui' })
    || (typeof createChannelState === 'function'
      ? createChannelState({}, { source: 'ui' })
      : createChannelModel(getChannels().length + 1));
}

function removeChannel(channelId) {
  return window.channelActions?.removeChannel(channelId, { source: 'ui' }) || null;
}

function changeChannelApp(channelId, appProcess) {
  return window.channelActions?.setChannelApp(channelId, appProcess, { source: 'ui' }) || null;
}

function editChannelTitle(channelId) {
  window.channelActions?.markChannelConfigured(channelId, { source: 'ui' });
  openChannelEditor?.(channelId);
}

function dismissFaderBindHint(channelId) {
  return window.channelActions?.dismissChannelBindHint(channelId, { source: 'ui' }) || null;
}

function isChannelConfigured(channel) {
  return Boolean(channel?.hasBeenConfigured);
}

function configureChannel(channelId) {
  const channel = getChannelById(channelId);

  if (!channel) {
    return null;
  }

  window.channelActions?.markChannelConfigured(channelId, { source: 'ui' });
  openChannelEditor?.(channelId);
  return channel;
}

function clampVolume(value) {
  const clampedValue = Math.max(0, Math.min(100, Number(value) || 0));

  if (typeof normalizeVolumeValue === 'function') {
    return normalizeVolumeValue(clampedValue);
  }

  return Math.round(clampedValue * 1000) / 1000;
}

function formatChannelVolume(value, channel = null) {
  const channelSettings = channel ? getChannelRuntimeSettings(channel) : {};

  if (typeof formatVolumeValue === 'function') {
    return formatVolumeValue(value, channelSettings);
  }

  return `${clampVolume(value)}%`;
}

function getChannelRuntimeSettings(channel) {
  return typeof resolveChannelFaderSettings === 'function'
    ? resolveChannelFaderSettings(channel)
    : {};
}

function getChannelTargetProcess(channel) {
  if (window.channelTargeting?.getChannelTargetMode?.(channel) === window.CHANNEL_TARGET_MODES?.focus) {
    return null;
  }

  const process = String(channel?.app || '').trim();
  return process || null;
}

function getChannelTargetProcesses(channel) {
  if (window.channelTargeting?.getChannelTargetMode?.(channel) === window.CHANNEL_TARGET_MODES?.focus) {
    return [];
  }

  const explicitTargets = Array.isArray(channel?.targets)
    ? channel.targets
        .map((target) => String(target?.process || '').trim())
        .filter(Boolean)
    : [];

  if (explicitTargets.length > 0) {
    return [...new Set(explicitTargets)];
  }

  const fallbackProcess = getChannelTargetProcess(channel);
  return fallbackProcess ? [fallbackProcess] : [];
}

function resolveChannelTargetBinding(channel, options = {}) {
  if (window.channelTargeting?.resolveChannelTargetBinding) {
    return window.channelTargeting.resolveChannelTargetBinding(channel, options);
  }

  return Promise.resolve({
    mode: 'apps',
    appTargets: [],
    deviceTargets: [],
    deviceFlow: 'output',
    focusTarget: null,
    focusExclusions: [],
    hasTargets: false
  });
}

function getHudAvailableAudioApps() {
  if (typeof getAvailableAudioApps === 'function') {
    return getAvailableAudioApps();
  }

  return [];
}

function isVolumeHudSelfTarget(target = {}) {
  const processName = String(target?.process || '').trim().toLowerCase();
  const displayName = String(target?.name || '').trim().toLowerCase();
  const applicationPath = String(target?.path || '').trim().toLowerCase();
  const matchesFaderDeck = [processName, displayName, applicationPath].some((value) => value.includes('faderdeck'));
  const matchesDevElectron = processName === 'electron.exe' && displayName.includes('faderdeck');

  return matchesFaderDeck || matchesDevElectron;
}

function getMeaningfulVolumeHudTargetIconDataUrl(target = {}) {
  const iconDataUrl = String(
    target?.iconDataUrl
    || window.getCachedAudioAppIconDataUrl?.(target)
    || ''
  ).trim();

  if (!iconDataUrl) {
    if (target?.path && typeof window.ensureAudioAppIconDataUrl === 'function') {
      void window.ensureAudioAppIconDataUrl(target, {
        reason: 'volume-hud-target'
      });
    }

    return '';
  }

  if (String(target?.process || '').trim() && typeof window.isMeaningfulAudioAppIcon === 'function') {
    return window.isMeaningfulAudioAppIcon(target, iconDataUrl) ? iconDataUrl : '';
  }

  return iconDataUrl;
}

function getChannelIconDataUrl(channel = {}) {
  const iconKey = String(channel?.icon || '').trim();

  if (!iconKey || typeof window.renderChannelButtonIconSvg !== 'function') {
    return '';
  }

  const rawSvg = String(window.renderChannelButtonIconSvg(iconKey) || '').trim();

  if (!rawSvg) {
    return '';
  }

  const styledSvg = rawSvg
    .replace(
      '<svg',
      '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="rgba(255,255,255,0.96)" stroke-width="2.05" stroke-linecap="round" stroke-linejoin="round"'
    )
    .replace(/\s{2,}/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(styledSvg)}`;
}

function getResolvedChannelHudTargets(channel) {
  const targetMode = window.channelTargeting?.getChannelTargetMode?.(channel) || 'apps';

  if (targetMode === window.CHANNEL_TARGET_MODES?.focus) {
    return [{
      process: '__focus__',
      name: t('editor.targetModeFocusCurrent'),
      path: '',
      iconDataUrl: ''
    }];
  }

  const availableApps = getHudAvailableAudioApps();
  const explicitTargets = Array.isArray(channel?.targets)
    ? channel.targets
        .map((target) => {
          const process = String(target?.process || '').trim();
          const matchedApp = availableApps.find((application) => application.process === process);

          if (!process) {
            return null;
          }

          return {
            process,
            name: String(target?.name || matchedApp?.name || process).trim() || process,
            path: String(target?.path || matchedApp?.path || '').trim(),
            iconDataUrl: String(
              target?.iconDataUrl
              || matchedApp?.iconDataUrl
              || window.getCachedAudioAppIconDataUrl?.({
                process,
                path: String(target?.path || matchedApp?.path || '').trim()
              })
              || ''
            ).trim()
          };
        })
        .filter(Boolean)
        .filter((target) => !isVolumeHudSelfTarget(target))
    : [];

  const deviceTargets = (window.channelTargeting?.getChannelDeviceTargets?.(channel) || []).map((target) => ({
    process: '',
    name: target.name,
    path: '',
    iconDataUrl: '',
    flow: target.flow
  }));

  if (explicitTargets.length > 0 || deviceTargets.length > 0) {
    return [...explicitTargets, ...deviceTargets];
  }

  const fallbackProcess = String(channel?.app || '').trim();

  if (!fallbackProcess) {
    return [];
  }

  const matchedApp = availableApps.find((application) => application.process === fallbackProcess);
  const fallbackTargets = [{
    process: fallbackProcess,
    name: String(channel?.appName || matchedApp?.name || fallbackProcess).trim() || fallbackProcess,
    path: String(matchedApp?.path || '').trim(),
    iconDataUrl: String(
      matchedApp?.iconDataUrl
      || window.getCachedAudioAppIconDataUrl?.({
        process: fallbackProcess,
        path: String(matchedApp?.path || '').trim()
      })
      || ''
    ).trim()
  }];

  return fallbackTargets.filter((target) => !isVolumeHudSelfTarget(target));
}

function getChannelHudPrimaryLabel(channel, targets) {
  if (!targets.length) {
    return String(channel?.title || channel?.appName || t('audio.systemVolume')).trim();
  }

  if (targets.length === 1) {
    return targets[0].name;
  }

  return `${targets[0].name} +${targets.length - 1}`;
}

function getVolumeHudPresentationConfig() {
  if (typeof getVolumeHudPresentationSettings === 'function') {
    return getVolumeHudPresentationSettings();
  }

  const uiSettings = typeof getUiSettingsState === 'function'
    ? getUiSettingsState()
    : {};

  return {
    enabled: uiSettings.volumeHudEnabled ?? true,
    position: uiSettings.volumeHudPosition || 'bottom-center',
    orientation: uiSettings.volumeHudOrientation || 'horizontal',
    showIcon: uiSettings.volumeHudShowIcon ?? true,
    showTitle: uiSettings.volumeHudShowTitle ?? true,
    showSubtitle: uiSettings.volumeHudShowSubtitle ?? true,
    showPercent: uiSettings.volumeHudShowPercent ?? true,
    showMeter: uiSettings.volumeHudShowMeter ?? true
  };
}

async function resolveChannelVolumeHudContext(channel, meta = {}, binding = null) {
  const targetMode = binding?.mode || window.channelTargeting?.getChannelTargetMode?.(channel) || 'apps';
  let focusTarget = null;

  if (targetMode === window.CHANNEL_TARGET_MODES?.focus) {
    focusTarget = binding?.focusTarget || null;

    if (!focusTarget) {
      try {
        focusTarget = await window.channelTargeting?.getFocusedApplication?.({
          force: Boolean(meta?.forceFocusRefresh)
        });
      } catch (error) {
        console.error('resolveChannelVolumeHudContext focus error', error);
        focusTarget = null;
      }
    }

    if (focusTarget && isVolumeHudSelfTarget(focusTarget)) {
      focusTarget = null;
    }
  }

  return {
    targetMode,
    focusTarget,
    targets: focusTarget
      ? [focusTarget]
      : (
        targetMode === window.CHANNEL_TARGET_MODES?.focus
          ? []
          : ((Array.isArray(binding?.appTargets) && binding.appTargets.length)
            ? binding.appTargets
            : getResolvedChannelHudTargets(channel))
      )
  };
}

function resolveChannelVolumeHudIcon(channel, context = {}) {
  if (context.targetMode === window.CHANNEL_TARGET_MODES?.focus) {
    return getMeaningfulVolumeHudTargetIconDataUrl(context.focusTarget);
  }

  const channelIconDataUrl = getChannelIconDataUrl(channel);

  if (channelIconDataUrl) {
    return channelIconDataUrl;
  }

  if (context.targets?.length === 1) {
    return getMeaningfulVolumeHudTargetIconDataUrl(context.targets[0]);
  }

  return '';
}

function isFaderDeckWindowForeground() {
  if (typeof document === 'undefined') {
    return false;
  }

  const isVisible = document.visibilityState === 'visible';
  const hasFocus = typeof document.hasFocus === 'function'
    ? document.hasFocus()
    : true;

  return isVisible && hasFocus;
}

async function buildChannelVolumeHudPayload(channel, meta = {}) {
  if (!channel) {
    return null;
  }

  const presentation = getVolumeHudPresentationConfig();

  if (
    !presentation.enabled
    || (
      !presentation.showIcon
      && !presentation.showTitle
      && !presentation.showSubtitle
      && !presentation.showPercent
      && !presentation.showMeter
    )
  ) {
    return null;
  }

  const audioRuntimeSnapshot = await readChannelAudioRuntime(channel, {
    forceFocusRefresh: Boolean(meta?.forceFocusRefresh),
    forceStateRefresh: Boolean(meta?.forceStateRefresh)
  });
  const context = await resolveChannelVolumeHudContext(channel, meta, audioRuntimeSnapshot?.binding || null);
  const targets = context.targets;

  if (context.targetMode === window.CHANNEL_TARGET_MODES?.focus && !context.focusTarget) {
    return null;
  }

  if (!targets.length && isVolumeHudSelfTarget({
    process: channel?.app,
    name: channel?.appName
  })) {
    return null;
  }
  const primaryLabel = context.focusTarget?.name || getChannelHudPrimaryLabel(channel, targets);
  const channelTitle = String(channel?.title || '').trim();
  const muted = Boolean(audioRuntimeSnapshot?.muted);
  const outputVolume = audioRuntimeSnapshot?.displayVolume ?? getChannelOutputVolume(channel);

  return {
    channelId: channel.id,
    source: String(meta?.source || 'ui'),
    title: primaryLabel,
    subtitle: channelTitle && channelTitle !== primaryLabel ? channelTitle : '',
    iconDataUrl: resolveChannelVolumeHudIcon(channel, context),
    volume: outputVolume,
    valueText: formatChannelVolume(outputVolume, channel),
    muted,
    presentation
  };
}

async function emitChannelVolumeHud(channel, meta = {}) {
  if (isFaderDeckWindowForeground()) {
    return;
  }

  const payload = await buildChannelVolumeHudPayload(channel, meta);
  const api = typeof getApi === 'function' ? getApi() : window.getNativeApi?.() ?? null;

  if (!payload || !api?.show_volume_hud) {
    return;
  }

  try {
    await api.show_volume_hud(payload);
  } catch (error) {
    console.error('emitChannelVolumeHud error', error);
  }
}

function getChannelOutputVolume(channel) {
  if (!channel) {
    return 0;
  }

  const channelSettings = getChannelRuntimeSettings(channel);

  if (typeof mapFaderPositionToVolume === 'function') {
    return clampVolume(mapFaderPositionToVolume(channel.volume, channelSettings));
  }

  return clampVolume(channel.volume);
}

function createEmptyChannelBindingState(hasTargets = false) {
  return {
    hasTargets: Boolean(hasTargets),
    volume: 0,
    muted: false,
    peakLevel: 0,
    appStateMap: new Map(),
    deviceStateMap: new Map()
  };
}

function getChannelAudioRuntimeEntry(channelId) {
  if (!channelAudioRuntimeState.has(channelId)) {
    channelAudioRuntimeState.set(channelId, {
      binding: null,
      bindingKey: '',
      bindingFetchedAt: 0,
      state: null,
      stateFetchedAt: 0,
      lastLocalVolumeAt: 0
    });
  }

  return channelAudioRuntimeState.get(channelId);
}

function getChannelAudioRuntimeBindingKey(binding = {}) {
  const appKey = (Array.isArray(binding?.appTargets) ? binding.appTargets : [])
    .map((target) => String(target?.process || '').trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',');
  const deviceKey = (Array.isArray(binding?.deviceTargets) ? binding.deviceTargets : [])
    .map((target) => {
      const flow = String(target?.flow || binding?.deviceFlow || '').trim().toLowerCase();
      return `${String(target?.id || '').trim().toLowerCase()}:${flow}`;
    })
    .filter(Boolean)
    .sort()
    .join(',');
  const focusKey = String(binding?.focusTarget?.process || '').trim().toLowerCase();
  const modeKey = String(binding?.mode || '').trim().toLowerCase();
  const exclusionsKey = (Array.isArray(binding?.focusExclusions) ? binding.focusExclusions : [])
    .map((target) => String(target?.process || '').trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',');

  return [modeKey, appKey, deviceKey, focusKey, exclusionsKey].join('|');
}

function normalizeChannelAudioRuntimeState(binding = {}, state = {}) {
  const hasTargets = Boolean(binding?.hasTargets || state?.hasTargets);
  return {
    hasTargets,
    volume: clampVolume(state?.volume),
    muted: Boolean(state?.muted),
    peakLevel: Math.max(0, Math.min(1, Number(state?.peakLevel) || 0)),
    appStateMap: state?.appStateMap instanceof Map ? state.appStateMap : new Map(),
    deviceStateMap: state?.deviceStateMap instanceof Map ? state.deviceStateMap : new Map()
  };
}

function isChannelAudioRuntimeLocalOverrideActive(channelId, entry = null) {
  const runtimeEntry = entry || channelAudioRuntimeState.get(channelId);

  if (!runtimeEntry?.lastLocalVolumeAt) {
    return false;
  }

  return (Date.now() - runtimeEntry.lastLocalVolumeAt) < CHANNEL_AUDIO_RUNTIME_LOCAL_OVERRIDE_MS;
}

function getChannelAudioRuntimeSnapshot(channel) {
  if (!channel) {
    return null;
  }

  const entry = channelAudioRuntimeState.get(channel.id);
  const desiredVolume = getChannelOutputVolume(channel);
  const committedVolume = entry?.state?.hasTargets
    ? clampVolume(entry.state.volume)
    : desiredVolume;
  const muteHoldActive = isChannelMuteHoldActive(channel.id);
  const localOverrideActive = isChannelAudioRuntimeLocalOverrideActive(channel.id, entry);

  return {
    binding: entry?.binding || null,
    state: entry?.state || createEmptyChannelBindingState(false),
    hasTargets: Boolean(entry?.binding?.hasTargets || entry?.state?.hasTargets),
    desiredVolume,
    committedVolume,
    displayVolume: (muteHoldActive || localOverrideActive) ? desiredVolume : committedVolume,
    muted: muteHoldActive || Boolean(entry?.state?.muted)
  };
}

function syncChannelVolumePushStateFromRuntime(channelId, volume, options = {}) {
  const state = getChannelVolumePushState(channelId);
  state.lastSentVolume = clampVolume(volume);

  if (options.clearPending === false) {
    return state;
  }

  state.pendingVolume = null;

  if (state.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }

  return state;
}

function syncChannelFaderWithAudioRuntime(channel, snapshot, meta = {}) {
  const entry = channel ? channelAudioRuntimeState.get(channel.id) : null;

  if (
    !channel
    || !snapshot?.hasTargets
    || isChannelVolumeSyncSuppressed(channel.id)
    || isChannelAudioRuntimeLocalOverrideActive(channel.id, entry)
  ) {
    return snapshot;
  }

  const nextFaderPosition = getChannelFaderPositionForOutputVolume(channel, snapshot.committedVolume);

  if (Math.abs(nextFaderPosition - clampVolume(channel.volume)) < CHANNEL_AUDIO_RUNTIME_FADER_SYNC_EPSILON) {
    return snapshot;
  }

  window.setChannelVolumeState?.(channel.id, nextFaderPosition, {
    source: 'channel-audio-runtime',
    reason: meta?.reason || 'binding-state-sync'
  });

  return snapshot;
}

function commitChannelAudioRuntimeState(channel, binding = null, state = null, meta = {}) {
  if (!channel) {
    return null;
  }

  const entry = getChannelAudioRuntimeEntry(channel.id);
  const resolvedBinding = binding || entry.binding || {
    mode: 'apps',
    appTargets: [],
    deviceTargets: [],
    deviceFlow: 'output',
    focusTarget: null,
    focusExclusions: [],
    hasTargets: false
  };

  entry.binding = resolvedBinding;
  entry.bindingKey = getChannelAudioRuntimeBindingKey(resolvedBinding);
  entry.bindingFetchedAt = Date.now();

  if (meta?.localVolumeChange) {
    entry.lastLocalVolumeAt = Date.now();
  }

  if (state) {
    entry.state = normalizeChannelAudioRuntimeState(resolvedBinding, state);
    entry.stateFetchedAt = Date.now();
  } else if (!entry.state) {
    entry.state = createEmptyChannelBindingState(Boolean(resolvedBinding?.hasTargets));
    entry.stateFetchedAt = Date.now();
  }

  const snapshot = getChannelAudioRuntimeSnapshot(channel);

  if (meta?.updatePushState) {
    syncChannelVolumePushStateFromRuntime(channel.id, snapshot?.committedVolume ?? 0, {
      clearPending: meta?.clearPending !== false
    });
  }

  if (meta?.syncFader !== false) {
    syncChannelFaderWithAudioRuntime(channel, snapshot, meta);
  }

  if (meta?.refreshUi !== false) {
    updateChannelFaderUi(channel);
  }

  return snapshot;
}

function commitChannelAudioRuntimeVolume(channel, binding = null, volume = 0, meta = {}) {
  const entry = channel ? getChannelAudioRuntimeEntry(channel.id) : null;
  const resolvedBinding = binding || entry?.binding || null;
  const previousState = entry?.state || createEmptyChannelBindingState(Boolean(resolvedBinding?.hasTargets));

  return commitChannelAudioRuntimeState(channel, resolvedBinding, {
    ...previousState,
    hasTargets: Boolean(resolvedBinding?.hasTargets || previousState?.hasTargets),
    volume: clampVolume(volume),
    muted: meta?.muted ?? Boolean(previousState?.muted)
  }, meta);
}

function getChannelDisplayedOutputVolume(channel) {
  return getChannelAudioRuntimeSnapshot(channel)?.displayVolume ?? getChannelOutputVolume(channel);
}

async function readChannelAudioRuntime(channel, options = {}) {
  if (!channel) {
    return null;
  }

  const entry = getChannelAudioRuntimeEntry(channel.id);
  const now = Date.now();
  const currentBinding = entry.binding;
  const shouldRefreshFocusBinding = currentBinding?.mode === window.CHANNEL_TARGET_MODES?.focus
    && ((now - entry.bindingFetchedAt) >= CHANNEL_AUDIO_RUNTIME_CACHE_TTL_MS);
  const shouldRefreshBinding = Boolean(options?.forceFocusRefresh) || !currentBinding || shouldRefreshFocusBinding;
  const previousBindingKey = entry.bindingKey;
  const binding = shouldRefreshBinding
    ? await resolveChannelTargetBinding(channel, {
      force: Boolean(options?.forceFocusRefresh)
    }).catch((error) => {
      console.error('readChannelAudioRuntime binding error', error);
      return currentBinding || {
        mode: 'apps',
        appTargets: [],
        deviceTargets: [],
        deviceFlow: 'output',
        focusTarget: null,
        focusExclusions: [],
        hasTargets: false
      };
    })
    : currentBinding;
  const bindingKey = getChannelAudioRuntimeBindingKey(binding);
  const bindingChanged = bindingKey !== previousBindingKey;

  entry.binding = binding;
  entry.bindingKey = bindingKey;
  entry.bindingFetchedAt = now;

  if (!binding?.hasTargets) {
    return commitChannelAudioRuntimeState(channel, binding, createEmptyChannelBindingState(false), {
      syncFader: false
    });
  }

  const pushState = channelVolumePushState.get(channel.id);
  const hasPendingOutputSync = Boolean(
    activeFaderDrag?.channelId === channel.id
    || pushState?.inFlight
    || pushState?.timerId
    || (pushState && pushState.pendingVolume !== null)
  );

  if (hasPendingOutputSync && entry.state) {
    return commitChannelAudioRuntimeState(channel, binding, {
      ...entry.state,
      hasTargets: true
    }, {
      syncFader: false,
      refreshUi: false
    });
  }

  const stateIsFresh = entry.state
    && !bindingChanged
    && !options?.forceStateRefresh
    && (now - entry.stateFetchedAt) < CHANNEL_AUDIO_RUNTIME_CACHE_TTL_MS;

  if (stateIsFresh) {
    return getChannelAudioRuntimeSnapshot(channel);
  }

  if (!window.channelTargeting?.readBindingState) {
    return getChannelAudioRuntimeSnapshot(channel);
  }

  const bindingState = await window.channelTargeting.readBindingState(binding, {
    force: Boolean(options?.forceStateRefresh || bindingChanged)
  }).catch((error) => {
    console.error('readChannelAudioRuntime state error', error);
    return null;
  });

  if (!bindingState) {
    return getChannelAudioRuntimeSnapshot(channel);
  }

  return commitChannelAudioRuntimeState(channel, binding, bindingState, {
    reason: 'binding-state-read',
    updatePushState: true,
    clearPending: false
  });
}

function getChannelFaderPositionForOutputVolume(channel, volume) {
  if (!channel) {
    return 0;
  }

  const channelSettings = getChannelRuntimeSettings(channel);

  if (typeof mapVolumeToFaderPosition === 'function') {
    return clampVolume(mapVolumeToFaderPosition(volume, channelSettings));
  }

  return clampVolume(volume);
}

function isChannelMuteHoldActive(channelId) {
  return Boolean(channelMuteHoldState.get(channelId)?.active);
}

function setChannelMuteHoldState(channelId, active) {
  const normalizedChannelId = Number.parseInt(channelId, 10);

  if (!Number.isFinite(normalizedChannelId)) {
    return false;
  }

  if (active) {
    channelMuteHoldState.set(normalizedChannelId, { active: true });
  } else {
    channelMuteHoldState.delete(normalizedChannelId);
  }

  const pushState = channelVolumePushState.get(normalizedChannelId);

  if (pushState?.timerId) {
    clearTimeout(pushState.timerId);
    pushState.timerId = null;
  }

  if (pushState) {
    pushState.pendingVolume = null;
  }

  return Boolean(active);
}

function setChannelCommittedOutputVolume(channelId, volume) {
  const normalizedChannelId = Number.parseInt(channelId, 10);

  if (!Number.isFinite(normalizedChannelId)) {
    return null;
  }

  const pushState = getChannelVolumePushState(normalizedChannelId);

  if (pushState?.timerId) {
    clearTimeout(pushState.timerId);
    pushState.timerId = null;
  }

  pushState.pendingVolume = null;
  pushState.lastSentVolume = clampVolume(volume);
  const channel = getChannelById(normalizedChannelId);

  if (channel) {
    commitChannelAudioRuntimeVolume(channel, null, volume, {
      syncFader: false,
      refreshUi: true
    });
  }

  return pushState.lastSentVolume;
}

function isChannelVolumeSyncSuppressed(channelId) {
  if (activeFaderDrag?.channelId === channelId || isChannelMuteHoldActive(channelId)) {
    return true;
  }

  const pushState = channelVolumePushState.get(channelId);

  return Boolean(
    pushState?.inFlight
    || pushState?.timerId
    || (pushState && pushState.pendingVolume !== null)
  );
}

function shouldSyncLinkedAppChannel(channel, targetProcess = '', sourceChannelId = null) {
  if (!channel || channel.id === sourceChannelId || isChannelVolumeSyncSuppressed(channel.id)) {
    return false;
  }

  const targeting = window.channelTargeting;
  const targetMode = targeting?.getChannelTargetMode?.(channel);

  if (targetMode !== window.CHANNEL_TARGET_MODES?.apps) {
    return false;
  }

  const appTargets = targeting?.getChannelAppTargets?.(channel) || [];
  const deviceTargets = targeting?.getChannelDeviceTargets?.(channel) || [];
  const channelProcess = String(appTargets[0]?.process || '').trim().toLowerCase();

  return (
    appTargets.length === 1
    && deviceTargets.length === 0
    && channelProcess
    && channelProcess === String(targetProcess || '').trim().toLowerCase()
  );
}

function syncLinkedAppChannelsFromBindingVolume(sourceChannel, binding = {}, volume = 0) {
  const appTargets = Array.isArray(binding?.appTargets) ? binding.appTargets : [];
  const deviceTargets = Array.isArray(binding?.deviceTargets) ? binding.deviceTargets : [];
  const targetProcess = String(appTargets[0]?.process || '').trim().toLowerCase();

  if (
    appTargets.length !== 1
    || deviceTargets.length > 0
    || !targetProcess
    || targetProcess === 'master'
    || isVolumeHudSelfTarget(appTargets[0])
  ) {
    return;
  }

  getChannels().forEach((channel) => {
    if (!shouldSyncLinkedAppChannel(channel, targetProcess, sourceChannel?.id)) {
      return;
    }

    commitChannelAudioRuntimeVolume(channel, {
      mode: window.CHANNEL_TARGET_MODES?.apps || 'apps',
      appTargets: appTargets.slice(),
      deviceTargets: [],
      deviceFlow: 'output',
      focusTarget: null,
      focusExclusions: [],
      hasTargets: true
    }, volume, {
      reason: 'linked-app-volume-sync',
      linkedSourceChannelId: sourceChannel?.id ?? null,
      updatePushState: true
    });
  });
}

function getChannelVolumePushState(channelId) {
  if (!channelVolumePushState.has(channelId)) {
    channelVolumePushState.set(channelId, {
      timerId: null,
      inFlight: false,
      pendingVolume: null,
      lastSentVolume: null
    });
  }

  return channelVolumePushState.get(channelId);
}

function resetChannelVolumePushState(channelId) {
  const state = channelVolumePushState.get(channelId);

  if (state?.timerId) {
    clearTimeout(state.timerId);
  }

  channelVolumePushState.delete(channelId);
}

function pushVolumeToBinding(binding, volume) {
  if (!window.channelTargeting?.setBindingVolume) {
    return Promise.resolve();
  }

  return window.channelTargeting.setBindingVolume(binding, volume);
}

async function flushChannelVolumePush(channelId) {
  const state = channelVolumePushState.get(channelId);

  if (!state) {
    return;
  }

  state.timerId = null;

  const channel = getChannelById(channelId);

  if (!channel) {
    resetChannelVolumePushState(channelId);
    return;
  }

  const volumeToSend = state.pendingVolume;

  if (volumeToSend === null) {
    return;
  }

  if (isChannelMuteHoldActive(channelId)) {
    state.pendingVolume = null;
    return;
  }

  state.pendingVolume = null;
  state.inFlight = true;

  try {
    const channelSettings = getChannelRuntimeSettings(channel);
    const targetBinding = await resolveChannelTargetBinding(channel);

    if (!targetBinding?.hasTargets) {
      return;
    }

    const shouldInterpolate = (
      channelSettings.faderInterpolationEnabled
      && state.lastSentVolume !== null
      && Math.abs(volumeToSend - state.lastSentVolume) > 1
    );

    if (shouldInterpolate) {
      const startVolume = state.lastSentVolume;

      for (let step = 1; step <= CHANNEL_INTERPOLATION_STEPS; step += 1) {
        if (isChannelMuteHoldActive(channelId)) {
          break;
        }

        const interpolatedVolume = clampVolume(
          startVolume + ((volumeToSend - startVolume) * (step / CHANNEL_INTERPOLATION_STEPS))
        );

        await pushVolumeToBinding(targetBinding, interpolatedVolume);
        commitChannelAudioRuntimeVolume(channel, targetBinding, interpolatedVolume, {
          reason: 'channel-volume-interpolation',
          syncFader: false,
          updatePushState: true,
          clearPending: false
        });
        syncLinkedAppChannelsFromBindingVolume(channel, targetBinding, interpolatedVolume);

        if (step < CHANNEL_INTERPOLATION_STEPS) {
          await new Promise((resolve) => setTimeout(resolve, CHANNEL_INTERPOLATION_STEP_DELAY_MS));
        }
      }
    } else {
      if (isChannelMuteHoldActive(channelId)) {
        return;
      }

      await pushVolumeToBinding(targetBinding, volumeToSend);
      commitChannelAudioRuntimeVolume(channel, targetBinding, volumeToSend, {
        reason: 'channel-volume-push',
        syncFader: false,
        updatePushState: true,
        clearPending: false
      });
      syncLinkedAppChannelsFromBindingVolume(channel, targetBinding, volumeToSend);
    }
  } catch (error) {
    console.error('set_channel_target_volume error', error);
  } finally {
    state.inFlight = false;

    if (state.pendingVolume !== null) {
      state.timerId = setTimeout(() => {
        flushChannelVolumePush(channelId);
      }, CHANNEL_VOLUME_PUSH_DELAY_MS);
    }
  }
}

function queueChannelVolumePush(channel) {
  const state = getChannelVolumePushState(channel.id);

  if (isChannelMuteHoldActive(channel.id)) {
    if (state.timerId) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }

    state.pendingVolume = null;
    return;
  }

  const nextVolume = getChannelOutputVolume(channel);

  if (state.pendingVolume === nextVolume) {
    return;
  }

  if (!state.inFlight && !state.timerId && state.lastSentVolume === nextVolume) {
    return;
  }

  state.pendingVolume = nextVolume;

  if (state.inFlight || state.timerId) {
    return;
  }

  state.timerId = setTimeout(() => {
    flushChannelVolumePush(channel.id);
  }, CHANNEL_VOLUME_PUSH_DELAY_MS);
}

function applyVolumeToChannel(channelId, volume, meta = {}) {
  return window.channelActions?.setChannelVolume(channelId, volume, { source: 'ui', ...meta }) || null;
}

function cacheChannelFaderDom(track) {
  const channelId = Number.parseInt(track?.dataset?.channel, 10);

  if (!Number.isFinite(channelId) || !track?.isConnected) {
    return null;
  }

  const strip = track.closest('.channel-strip');
  const domRefs = {
    track,
    thumb: track.querySelector('.fader-thumb'),
    fill: track.querySelector('.fader-fill'),
    value: strip?.querySelector('.volume-value')
  };

  if (!domRefs.thumb || !domRefs.fill || !domRefs.value) {
    channelFaderDomCache.delete(channelId);
    return null;
  }

  channelFaderDomCache.set(channelId, domRefs);
  return domRefs;
}

function getChannelFaderDom(channelId) {
  const normalizedChannelId = Number.parseInt(channelId, 10);

  if (!Number.isFinite(normalizedChannelId)) {
    return null;
  }

  const cachedDom = channelFaderDomCache.get(normalizedChannelId);

  if (
    cachedDom?.track?.isConnected
    && cachedDom.thumb?.isConnected
    && cachedDom.fill?.isConnected
    && cachedDom.value?.isConnected
  ) {
    return cachedDom;
  }

  const track = document.querySelector(`.fader-track[data-channel="${normalizedChannelId}"]`);

  if (!track) {
    channelFaderDomCache.delete(normalizedChannelId);
    return null;
  }

  return cacheChannelFaderDom(track);
}

function primeChannelFaderDomCache(container) {
  channelFaderDomCache.clear();
  container?.querySelectorAll?.('.fader-track[data-channel]')?.forEach((track) => {
    cacheChannelFaderDom(track);
  });
}

function getVolumeFromPointer(track, clientY, rectOverride = null) {
  const rect = rectOverride || track.getBoundingClientRect();
  const offsetY = clientY - rect.top;
  const volume = ((rect.height - offsetY) / rect.height) * 100;
  return clampVolume(volume);
}

function startFaderDrag(event) {
  const track = event.target.closest('.fader-track');

  if (!track) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  activeFaderDrag = {
    channelId: Number.parseInt(track.dataset.channel, 10),
    track,
    trackRect: track.getBoundingClientRect()
  };
  activeFaderDrag.track.classList.add('is-dragging');
  applyVolumeToChannel(activeFaderDrag.channelId, getVolumeFromPointer(
    track,
    event.clientY,
    activeFaderDrag.trackRect
  ), {
    interaction: 'drag'
  });
}

function handleFaderDrag(event) {
  if (!activeFaderDrag) {
    return;
  }

  applyVolumeToChannel(
    activeFaderDrag.channelId,
    getVolumeFromPointer(activeFaderDrag.track, event.clientY, activeFaderDrag.trackRect),
    {
      interaction: 'drag'
    }
  );
}

function stopFaderDrag() {
  if (!activeFaderDrag) {
    return;
  }

  const completedChannelId = activeFaderDrag.channelId;
  activeFaderDrag.track?.classList.remove('is-dragging');
  activeFaderDrag = null;
  window.flushDeferredMixerRenderRuntime?.();
  window.dispatchEvent(new CustomEvent('channel-fader-drag-end', {
    detail: {
      channelId: completedChannelId
    }
  }));
  window.profileActions?.saveRendererProfileToLocal?.();
}

function setupFaderDrag() {
  if (setupFaderDrag.initialized) {
    return;
  }

  document.addEventListener('mousedown', (event) => {
    if (!event.target.closest('.fader-track')) {
      return;
    }

    startFaderDrag(event);
  });

  document.addEventListener('mousemove', handleFaderDrag);
  document.addEventListener('mouseup', stopFaderDrag);
  setupFaderDrag.initialized = true;
}

function updateChannelFaderUi(channel) {
  const domRefs = getChannelFaderDom(channel.id);

  if (!domRefs) {
    return;
  }

  const outputVolume = getChannelDisplayedOutputVolume(channel);
  const channelSettings = getChannelRuntimeSettings(channel);
  const thumbBottom = `calc(${channel.volume}% - 25px)`;
  const fillHeight = `${channel.volume}%`;
  const valueText = formatVolumeValue(outputVolume, channelSettings);

  if (domRefs.thumb.style.bottom !== thumbBottom) {
    domRefs.thumb.style.bottom = thumbBottom;
  }

  if (domRefs.fill.style.height !== fillHeight) {
    domRefs.fill.style.height = fillHeight;
  }

  if (domRefs.value.textContent !== valueText) {
    domRefs.value.textContent = valueText;
  }
}

function updateFadersFromState() {
  getChannels().forEach(updateChannelFaderUi);
}

function refreshChannelOutputVolumes() {
  getChannels().forEach((channel) => {
    updateChannelFaderUi(channel);
    queueChannelVolumePush(channel);
  });
}

function triggerChannelPickupFlash(channelId) {
  const channelElement = document.querySelector(`.channel-strip[data-channel-id="${channelId}"]`);

  if (!channelElement) {
    return;
  }

  const previousTimerId = channelPickupFlashTimers.get(channelId);

  if (previousTimerId) {
    clearTimeout(previousTimerId);
  }

  channelElement.classList.remove('pickup-success');
  void channelElement.offsetWidth;
  channelElement.classList.add('pickup-success');

  const timerId = setTimeout(() => {
    channelElement.classList.remove('pickup-success');
    channelPickupFlashTimers.delete(channelId);
  }, CHANNEL_PICKUP_FLASH_DURATION_MS);

  channelPickupFlashTimers.set(channelId, timerId);
}

function setupChannelPickupUi() {
  if (channelPickupUiInitialized) {
    return;
  }

  window.addEventListener('midi:pickup', (event) => {
    triggerChannelPickupFlash(event.detail?.channelId);
  });

  channelPickupUiInitialized = true;
}

function getFaderMappingLabel(mapping) {
  if (!mapping) {
    return '';
  }

  const mappingType = mapping.type === 'pitchwheel' ? 'pitch_bend' : mapping.type;
  const displayChannel = (Number(mapping.channel) || 0) + 1;

  if (mappingType === 'control_change') {
    return t('channels.advancedControlChange', { control: mapping.control });
  }

  if (mappingType === 'control_change_14bit') {
    return t('channels.advancedControlChange14Bit', { control: mapping.control });
  }

  if (mappingType === 'nrpn') {
    return t('channels.advancedNrpn', {
      channel: displayChannel,
      parameterMsb: mapping.parameterMsb,
      parameterLsb: mapping.parameterLsb
    });
  }

  if (mappingType === 'rpn') {
    return t('channels.advancedRpn', {
      channel: displayChannel,
      parameterMsb: mapping.parameterMsb,
      parameterLsb: mapping.parameterLsb
    });
  }

  return t('channels.advancedPitchBend', { channel: displayChannel });
}

function renderAppOptions(selectedProcess) {
  const availableApps = typeof getAvailableAudioApps === 'function'
    ? getAvailableAudioApps()
    : [];
  const placeholderOption = !selectedProcess
    ? `<option value="" selected>${t('editor.noTargetAssigned')}</option>`
    : '';

  return `${placeholderOption}${availableApps
    .map((app) => `
      <option value="${app.process}" ${app.process === selectedProcess ? 'selected' : ''}>
        ${app.name}
      </option>
    `)
    .join('')}`;
}

function renderChannelButtonSlot(channel, button) {
  const className = typeof window.getChannelButtonClassName === 'function'
    ? window.getChannelButtonClassName(channel, button)
    : `channel-side-button ${button.active ? 'active' : ''}`;
  const bodyMarkup = typeof window.renderChannelButtonBodyMarkup === 'function'
    ? window.renderChannelButtonBodyMarkup(channel, button)
    : `
      <span class="channel-button-face">
        <span class="channel-button-main">
          <span class="button-icon">${button.icon}</span>
          <span class="button-label">${button.text}</span>
        </span>
      </span>
    `;

  return `
    <button class="${className}"
            type="button"
            data-channel-id="${channel.id}"
            data-button-id="${button.id}"
            onclick="toggleButton(${channel.id}, ${button.id})"
            ondblclick="configureButton(${channel.id}, ${button.id})">
      ${bodyMarkup}
    </button>
  `;
}

function getVisibleChannelButtons(channel) {
  return (Array.isArray(channel?.buttons) ? channel.buttons : []).slice(0, MAX_CHANNEL_BUTTONS);
}

function escapeChannelMarkup(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveChannelTitleIconTarget(channel) {
  if (window.channelTargeting?.getChannelTargetMode?.(channel) === window.CHANNEL_TARGET_MODES?.focus) {
    return null;
  }

  if (!channel?.showTargetIconInTitle) {
    return null;
  }

  const availableApps = getHudAvailableAudioApps();
  const requestedProcess = String(channel?.titleIconTargetProcess || '').trim();
  const explicitTargets = Array.isArray(channel?.targets)
    ? channel.targets
        .map((target) => {
          const process = String(target?.process || '').trim();
          const matchedApp = availableApps.find((application) => application.process === process);

          if (!process) {
            return null;
          }

          return {
            process,
            name: String(target?.name || matchedApp?.name || process).trim() || process,
            path: String(target?.path || matchedApp?.path || '').trim(),
            iconDataUrl: String(
              target?.iconDataUrl
              || matchedApp?.iconDataUrl
              || window.getCachedAudioAppIconDataUrl?.({
                process,
                path: String(target?.path || matchedApp?.path || '').trim()
              })
              || ''
            ).trim()
          };
        })
        .filter(Boolean)
    : [];

  const fallbackProcess = requestedProcess || explicitTargets[0]?.process || String(channel?.app || '').trim();

  if (!fallbackProcess) {
    return null;
  }

  const resolvedTarget = explicitTargets.find((target) => target.process === fallbackProcess)
    || getResolvedChannelHudTargets(channel).find((target) => target.process === fallbackProcess)
    || null;

  if (
    resolvedTarget
    && !resolvedTarget.iconDataUrl
    && resolvedTarget.path
    && typeof window.ensureAudioAppIconDataUrl === 'function'
  ) {
    void window.ensureAudioAppIconDataUrl(resolvedTarget, {
      reason: 'channel-title-icon'
    }).then((iconDataUrl) => {
      if (iconDataUrl) {
        window.requestDeferredMixerRenderRuntime?.();
      }
    }).catch((error) => {
      console.error('resolveChannelTitleIconTarget icon warmup error', error);
    });
  }

  return resolvedTarget;
}

function renderChannelTitleMarkup(channel, title) {
  if (channel?.icon && typeof window.renderChannelButtonIconMarkup === 'function') {
    return `
      <span class="channel-title-inner has-icon">
        ${window.renderChannelButtonIconMarkup({ icon: channel.icon }, 'channel-title-icon')}
        <span class="channel-title-text">${title}</span>
      </span>
    `;
  }

  const titleIconTarget = resolveChannelTitleIconTarget(channel);

  if (!titleIconTarget) {
    return `<span class="channel-title-text">${title}</span>`;
  }

  const iconMarkup = titleIconTarget.iconDataUrl
    ? `<span class="channel-title-icon has-image"><img class="channel-title-icon-image" src="${escapeChannelMarkup(titleIconTarget.iconDataUrl)}" alt="${escapeChannelMarkup(titleIconTarget.name || titleIconTarget.process || 'App')}"></span>`
    : '';

  if (!iconMarkup) {
    return `<span class="channel-title-text">${title}</span>`;
  }

  return `
    <span class="channel-title-inner has-icon">
      ${iconMarkup}
      <span class="channel-title-text">${title}</span>
    </span>
  `;
}

function getChannelButtonLayoutMode(channel) {
  const buttonCount = getVisibleChannelButtons(channel).length;

  if (buttonCount >= 3) {
    return 'side';
  }

  if (buttonCount >= 1) {
    return channel?.buttonPlacement === 'side' ? 'side' : 'inline';
  }

  return 'none';
}

function renderChannelButtons(channel, options = {}) {
  const buttons = getVisibleChannelButtons(channel);

  if (!buttons.length) {
    return '';
  }

  const layoutMode = options.layoutMode || getChannelButtonLayoutMode(channel);
  const className = options.className || '';

  return `
    <div class="channel-buttons-grid channel-buttons-grid--${layoutMode} channel-buttons-grid--count-${buttons.length}${className ? ` ${className}` : ''}">
      ${buttons.map((button) => renderChannelButtonSlot(channel, button)).join('')}
    </div>
  `;
}

function renderBindHint(channel) {
  return '';
}

function renderChannelConfigureButton(channel) {
  if (!channel || isChannelConfigured(channel)) {
    return '';
  }

  return `
    <div class="channel-configure-shell" data-channel-configure-shell-id="${channel.id}">
      <button
        class="btn channel-configure-button"
        type="button"
        data-channel-configure-id="${channel.id}"
        onclick="configureChannel(${channel.id})">
        ${t('channels.configure')}
      </button>
    </div>
  `;
}

function renderAddChannelStrip(options = {}) {
  const layoutEditModeEnabled = getChannelLayoutEditModeEnabled();
  const emptyState = Boolean(options.emptyState);

  return `
    <div class="add-channel-strip ${emptyState ? 'add-channel-strip--empty' : ''} ${layoutEditModeEnabled ? 'is-disabled' : ''}" ${layoutEditModeEnabled ? '' : 'onclick="createChannel()"'} >
      <div class="add-channel-plus">+</div>
    </div>
  `;
}

function renderMixerSpacer(layoutItem) {
  return `
    <div
      class="${getChannelLayoutItemClassName(layoutItem)}"
      data-layout-item-id="${layoutItem.id}"
      data-layout-item-type="${layoutItem.type}"
      data-layout-zone="${layoutItem.zone || window.LAYOUT_ZONES?.mixer || 'mixer'}"
      ${getChannelLayoutInteractionAttributes(layoutItem)}>
      <div class="layout-spacer layout-spacer--channel" data-layout-spacer-size="${layoutItem.size || 1}"></div>
      ${renderChannelLayoutEditOverlay(layoutItem, 'layout.itemTypes.spacer')}
      ${renderChannelLayoutItemActions(layoutItem)}
    </div>
  `;
}

function renderChannel(channel, layoutItem = null) {
  const title = channel.title || channel.appName || t('channels.unnamed');
  const mappingLabel = getAdvancedModeEnabled?.()
    ? getFaderMappingLabel(channel.faderMapping)
    : '';
  const outputVolume = getChannelDisplayedOutputVolume(channel);
  const resolvedLayoutItem = layoutItem || {
    id: `layout-channel-${channel.id}`,
    type: window.LAYOUT_ITEM_TYPES?.channel || 'channel',
    entityId: channel.id
  };

  const channelButtonLayoutMode = getChannelButtonLayoutMode(channel);
  const inlineButtonsMarkup = channelButtonLayoutMode === 'inline'
    ? renderChannelButtons(channel, { layoutMode: 'inline' })
    : '';
  const sideButtonsMarkup = channelButtonLayoutMode === 'side'
    ? renderChannelButtons(channel, { layoutMode: 'side' })
    : '';
  const volumeValueMarkup = `<div class="volume-value">${formatChannelVolume(outputVolume, channel)}</div>`;

  return `
    <div
      class="${getChannelLayoutItemClassName(resolvedLayoutItem)}"
      data-layout-item-id="${resolvedLayoutItem.id}"
      data-layout-item-type="${resolvedLayoutItem.type}"
      data-layout-zone="${resolvedLayoutItem.zone || window.LAYOUT_ZONES?.mixer || 'mixer'}"
      ${getChannelLayoutInteractionAttributes(resolvedLayoutItem)}>
      <div class="channel-strip channel-strip--${channelButtonLayoutMode}" data-channel-id="${channel.id}">
        <div class="channel-body">
          <div class="channel-title" title="${title}" ondblclick="editChannelTitle(${channel.id})">
            ${renderChannelTitleMarkup(channel, title)}
          </div>

          ${mappingLabel ? `<div class="fader-meta">${mappingLabel}</div>` : ''}

          <div class="channel-main channel-main--${channelButtonLayoutMode}">
            <div class="channel-primary-column">
              <div class="fader-column">
                <div class="fader-track" data-channel="${channel.id}">
                  <div class="fader-rail"></div>
                  <div class="fader-fill" style="height: ${channel.volume}%"></div>
                  <div class="fader-thumb" style="bottom: calc(${channel.volume}% - 25px)"></div>
                </div>
              </div>

              ${channelButtonLayoutMode === 'side'
                ? ''
                : `
                  <div class="channel-inline-footer">
                    ${volumeValueMarkup}
                    ${inlineButtonsMarkup}
                  </div>
                `}
            </div>

            ${sideButtonsMarkup
              ? `
                <div class="channel-secondary-column">
                  ${sideButtonsMarkup}
                  ${volumeValueMarkup}
                </div>
              `
              : ''}
          </div>
        </div>
      </div>
      ${renderChannelConfigureButton(channel)}
      ${renderChannelLayoutEditOverlay(resolvedLayoutItem, 'layout.itemTypes.channel')}
      ${renderChannelLayoutItemActions(resolvedLayoutItem)}
    </div>
  `;
}

function syncAddChannelStripHeight(container) {
  const firstChannel = container.querySelector('.channel-strip');
  const addStrip = container.querySelector('.add-channel-strip');

  if (firstChannel && addStrip) {
    addStrip.style.height = `${firstChannel.offsetHeight}px`;
  }
}

function triggerNewChannelFlash(container) {
  getChannels().forEach((channel) => {
    if (!channel.flashOnCreate || channelEntranceAnimatedIds.has(channel.id)) {
      return;
    }

    const channelElement = container.querySelector(
      `.channel-strip[data-channel-id="${channel.id}"]`
    );
    const configureShellElement = container.querySelector(
      `[data-channel-configure-shell-id="${channel.id}"]`
    );

    if (!channelElement) {
      return;
    }

    channelEntranceAnimatedIds.add(channel.id);
    channelElement.classList.add('flash');
    configureShellElement?.classList.add('is-entering');

    setTimeout(() => {
      channelElement.classList.remove('flash');
      configureShellElement?.classList.remove('is-entering');
      clearChannelFlashState?.(channel.id, { source: 'render' });
    }, 460);
  });
}

function renderMixer() {
  const container = document.getElementById('mixerContainer');
  const channels = getChannels();
  const layoutItems = getMixerLayoutItems();
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));

  if (!container) {
    return;
  }

  if (channels.length === 0 && layoutItems.length === 0) {
    channelAudioRuntimeState.clear();
    channelFaderDomCache.clear();
    container.innerHTML = `
      ${renderMixerLayoutInsertControl()}
      ${renderAddChannelStrip({ emptyState: true })}
    `;
    scheduleContentMetricsUpdate();
    return;
  }

  container.innerHTML = `
    ${layoutItems.map((layoutItem) => {
      if (layoutItem.type === (window.LAYOUT_ITEM_TYPES?.spacer || 'spacer')) {
        return renderMixerSpacer(layoutItem);
      }

      const channel = channelsById.get(layoutItem.entityId);
      return channel ? renderChannel(channel, layoutItem) : '';
    }).join('')}
    ${renderMixerLayoutInsertControl()}
    ${renderAddChannelStrip()}
  `;

  primeChannelFaderDomCache(container);
  setupFaderDrag();
  setupChannelPickupUi();
  enhanceCustomSelects?.(container);
  triggerNewChannelFlash(container);
  syncAddChannelStripHeight(container);
  scheduleContentMetricsUpdate();
}

function initChannelUiStateSync() {
  if (channelUiStateSyncInitialized || typeof subscribeAppState !== 'function') {
    return;
  }

  subscribeAppState((nextState, previousState, meta = {}) => {
    const channelsChanged = nextState.channels !== previousState.channels;
    const layoutChanged = nextState.layout !== previousState.layout;
    const layoutEditorChanged = !window.isLayoutEditorParked?.()
      && nextState.layoutEditor !== previousState.layoutEditor;

    if (!channelsChanged && !layoutChanged && !layoutEditorChanged) {
      return;
    }

    if (channelsChanged && !layoutChanged && !layoutEditorChanged && meta.type === 'channels/set-volume') {
      const channel = getChannelById(meta.channelId);

      if (channel) {
        updateChannelFaderUi(channel);
      }

      return;
    }

    if (channelsChanged && !layoutChanged && !layoutEditorChanged && meta.type === 'channels/clear-flash') {
      return;
    }

    if (channelsChanged) {
      channelAudioRuntimeState.clear();
    }

    renderMixer();
  });

  channelUiStateSyncInitialized = true;
}

window.applyChannelVolumeRuntime = function applyChannelVolumeRuntime(channelId, volume, meta = {}) {
  return applyVolumeToChannel(channelId, volume, { source: 'midi-runtime', ...meta });
};
window.isChannelFaderDragActiveRuntime = function isChannelFaderDragActiveRuntime() {
  return Boolean(activeFaderDrag);
};
window.createChannel = createChannel;
window.getChannelOutputVolumeRuntime = getChannelOutputVolume;
window.commitChannelAudioRuntimeVolumeRuntime = commitChannelAudioRuntimeVolume;
window.isChannelMuteHoldActiveRuntime = isChannelMuteHoldActive;
window.setChannelMuteHoldRuntime = setChannelMuteHoldState;
window.setChannelCommittedOutputVolumeRuntime = setChannelCommittedOutputVolume;
window.syncLinkedAppChannelsFromBindingVolumeRuntime = syncLinkedAppChannelsFromBindingVolume;
window.queueChannelVolumePushRuntime = queueChannelVolumePush;
window.resetChannelVolumePushRuntime = resetChannelVolumePushState;
window.emitChannelVolumeHudRuntime = emitChannelVolumeHud;
window.configureChannel = configureChannel;
