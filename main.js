const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  dialog,
  shell,
  screen
} = require('electron');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const packageMetadata = require('./package.json');

const { FaderDeckAPI } = require('./backend/api');
const {
  DEFAULT_MAIN_WINDOW_STATE,
  getMainWindowState,
  saveMainWindowState,
  touchAppVersion
} = require('./backend/app-store');
const { createLogger } = require('./backend/logger');
const {
  registerIpcInvokeHandlers,
  registerIpcSendHandlers
} = require('./shared/ipc-contract');
const VOLUME_HUD_UPDATE_CHANNEL = 'volume-hud:update';
const VOLUME_HUD_VISIBILITY_CHANNEL = 'volume-hud:visibility';
const DEBUG_PANEL_UPDATE_CHANNEL = 'debug-panel:update';
const DEBUG_PANEL_REFRESH_MS = 1500;
// PowerShell-backed lookups (audio devices, media sessions) are slow round
// trips. Refresh them once every Nth fast tick instead of every cycle to keep
// the panel cheap. With FAST=1500ms and N=4 the slow data refreshes ~every 6s.
const DEBUG_PANEL_SLOW_REFRESH_TICKS = 4;
const APP_FOCUS_STATE_CHANNEL = 'app:focus-state';
const VOLUME_HUD_HIDE_DELAY_MS = 1350;
const VOLUME_HUD_HIDE_ANIMATION_MS = 180;
const VOLUME_HUD_WINDOW_MARGIN = 32;
const VOLUME_HUD_WINDOW_SIZES = Object.freeze({
  horizontal: Object.freeze({
    width: 328,
    height: 126
  }),
  vertical: Object.freeze({
    width: 194,
    height: 242
  })
});
const VOLUME_HUD_POSITIONS = new Set([
  'bottom-center',
  'bottom-left',
  'bottom-right',
  'top-center',
  'top-left',
  'top-right'
]);
const VOLUME_HUD_ORIENTATIONS = new Set(['horizontal', 'vertical']);
const WINDOW_OPTIONS = {
  width: 1400,
  height: 800,
  minWidth: 980,
  minHeight: 640,
  resizable: true,
  frame: false,
  titleBarStyle: 'hidden',
  titleBarOverlay: false,
  icon: path.join(__dirname, 'assets', 'favicon.png'),
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    backgroundThrottling: false
  }
};

let mainWindow = null;
let volumeHudWindow = null;
let volumeHudReadyPromise = null;
let volumeHudHideTimer = null;
let volumeHudHideCommitTimer = null;
let debugPanelWindow = null;
let debugPanelReadyPromise = null;
let debugPanelRefreshTimer = null;
let debugPanelPendingRefresh = null;
let mainWindowStateSaveTimer = null;
let api = null;
let tray = null;
let isQuitting = false;
let closeToTrayEnabled = true;
let appHasFocus = false; // true when any FaderDeck-owned window or its devtools is focused
const logger = createLogger('main');
const IPC_QUERY_METHODS = new Set([
  'get_audio_applications',
  'list_running_applications',
  'get_audio_states',
  'list_audio_devices',
  'list_media_sessions',
  'list_profiles',
  'get_profile_template',
  'get_profiles_directory',
  'get_application_icons',
  'get_app_info',
  'check_for_updates',
  'pick_profile_file',
  'pick_action_file'
]);
const SUPPRESSED_IPC_LOG_METHODS = new Set([
  'get_audio_states',
  'list_audio_devices',
  'get_media_session_state',
  'list_media_sessions'
]);
const APPLICATION_ICON_CACHE_VERSION = 'v1';
const STORAGE_ROOT_DIR_NAME = '.faderdeck';
const UPDATE_CHECK_TIMEOUT_MS = 8000;
const VALID_RELEASE_CHANNELS = new Set(['s', 'b', 'x']);
const DEFAULT_BUG_REPORT_URL =
  packageMetadata.bugs?.url || packageMetadata.homepage || '';
const GITHUB_REPOSITORY_SLUG = parseGitHubRepositorySlug(
  packageMetadata.repository?.url ||
    packageMetadata.homepage ||
    DEFAULT_BUG_REPORT_URL
);
const DEFAULT_RELEASES_URL = GITHUB_REPOSITORY_SLUG
  ? `https://github.com/${GITHUB_REPOSITORY_SLUG}/releases`
  : packageMetadata.homepage || DEFAULT_BUG_REPORT_URL || '';
const applicationIconDataUrlCache = new Map();
let applicationIconCacheDirectory = '';
let appInfo = createAppInfo(null);

function parseGitHubRepositorySlug(value) {
  const normalizedValue = String(value || '')
    .trim()
    .replace(/^git\+/i, '')
    .replace(/\.git$/i, '');

  if (!normalizedValue) {
    return '';
  }

  try {
    const parsedUrl = new URL(normalizedValue);

    if (parsedUrl.hostname.toLowerCase() !== 'github.com') {
      return '';
    }

    const [owner, repository] = parsedUrl.pathname
      .split('/')
      .filter(Boolean)
      .slice(0, 2);

    return owner && repository ? `${owner}/${repository}` : '';
  } catch {
    const slugMatch = normalizedValue.match(
      /github\.com[:/](?<owner>[^/]+)\/(?<repository>[^/]+)$/i
    );

    if (!slugMatch?.groups?.owner || !slugMatch?.groups?.repository) {
      return '';
    }

    return `${slugMatch.groups.owner}/${slugMatch.groups.repository}`;
  }
}

function normalizeReleaseChannel(value, fallback = 's') {
  const normalizedValue = String(value || fallback)
    .trim()
    .toLowerCase()
    .slice(0, 1);

  return VALID_RELEASE_CHANNELS.has(normalizedValue)
    ? normalizedValue
    : fallback;
}

function parseSemverDescriptor(value) {
  const versionMatch = String(value || '').match(/(\d+)\.(\d+)\.(\d+)/);

  if (!versionMatch) {
    return null;
  }

  return {
    version: `${versionMatch[1]}.${versionMatch[2]}.${versionMatch[3]}`,
    parts: versionMatch.slice(1, 4).map((entry) => Number.parseInt(entry, 10))
  };
}

function formatReleaseStamp(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return '';
  }

  return `${String(parsedDate.getFullYear()).slice(-2)}${
    parsedDate.getMonth() + 1
  }${parsedDate.getDate()}`;
}

function createReleaseDescriptor({ channel = 's', version = '', stamp = '' }) {
  const semverDescriptor = parseSemverDescriptor(version);

  if (!semverDescriptor) {
    return null;
  }

  const numericStamp = Number.parseInt(String(stamp || '').trim(), 10);

  return Object.freeze({
    channel: normalizeReleaseChannel(channel),
    version: semverDescriptor.version,
    parts: semverDescriptor.parts,
    stamp: Number.isFinite(numericStamp) ? numericStamp : 0
  });
}

function getCurrentReleaseDescriptor() {
  return createReleaseDescriptor({
    channel: packageMetadata.releaseChannel || 's',
    version: app.getVersion() || packageMetadata.version || '',
    stamp: formatReleaseStamp(packageMetadata.releaseDate)
  });
}

function formatDisplayVersionFromDescriptor(releaseDescriptor) {
  if (!releaseDescriptor) {
    return '';
  }

  const versionPrefix =
    releaseDescriptor.channel === 's' ? '' : releaseDescriptor.channel;
  const versionLabel = `${versionPrefix}${releaseDescriptor.version}`;

  return releaseDescriptor.stamp
    ? `${versionLabel}:${releaseDescriptor.stamp}`
    : versionLabel;
}

function getToolbarReleaseBadgeLabel(channel) {
  const normalizedChannel = normalizeReleaseChannel(channel);

  if (normalizedChannel === 'b') {
    return 'beta';
  }

  if (normalizedChannel === 'x') {
    return '+';
  }

  return '';
}

function compareSemverParts(leftParts = [], rightParts = []) {
  for (let index = 0; index < 3; index += 1) {
    const leftValue = Number(leftParts[index] || 0);
    const rightValue = Number(rightParts[index] || 0);

    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

function compareReleaseDescriptors(leftDescriptor, rightDescriptor) {
  if (!leftDescriptor && !rightDescriptor) {
    return 0;
  }

  if (!leftDescriptor) {
    return -1;
  }

  if (!rightDescriptor) {
    return 1;
  }

  const semverComparison = compareSemverParts(
    leftDescriptor.parts,
    rightDescriptor.parts
  );

  if (semverComparison !== 0) {
    return semverComparison;
  }

  if (leftDescriptor.stamp !== rightDescriptor.stamp) {
    return leftDescriptor.stamp - rightDescriptor.stamp;
  }

  const releaseChannelPriority = Object.freeze({
    b: 0,
    s: 1,
    x: 2
  });

  return (
    (releaseChannelPriority[leftDescriptor.channel] ?? 0) -
    (releaseChannelPriority[rightDescriptor.channel] ?? 0)
  );
}

function parseReleaseDescriptorFromText(value, fallbackChannel = 's') {
  const normalizedValue = String(value || '')
    .trim()
    .replace(/^refs\/tags\//i, '')
    .replace(/^v(?=\d)/i, '');
  const releaseMatch = normalizedValue.match(
    /([sbx])?(\d+\.\d+\.\d+)(?::(\d+))?/i
  );

  if (!releaseMatch) {
    return null;
  }

  return createReleaseDescriptor({
    channel: releaseMatch[1] || fallbackChannel,
    version: releaseMatch[2],
    stamp: releaseMatch[3] || ''
  });
}

function normalizeGitHubReleaseDescriptor(release) {
  if (!release || release.draft) {
    return null;
  }

  const fallbackChannel = release.prerelease ? 'b' : 's';
  const descriptor =
    parseReleaseDescriptorFromText(release.tag_name, fallbackChannel) ||
    parseReleaseDescriptorFromText(release.name, fallbackChannel);

  if (!descriptor) {
    return null;
  }

  const publishedReleaseStamp = Number.parseInt(
    formatReleaseStamp(release.published_at),
    10
  );

  return Object.freeze({
    ...descriptor,
    stamp:
      descriptor.stamp ||
      (Number.isFinite(publishedReleaseStamp) ? publishedReleaseStamp : 0),
    releaseUrl:
      typeof release.html_url === 'string' && release.html_url.trim()
        ? release.html_url.trim()
        : DEFAULT_RELEASES_URL,
    publishedAt:
      typeof release.published_at === 'string' ? release.published_at : null
  });
}

async function fetchGitHubReleases() {
  if (!GITHUB_REPOSITORY_SLUG) {
    return [];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    UPDATE_CHECK_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPOSITORY_SLUG}/releases?per_page=12`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'FaderDeck'
        },
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub releases request failed (${response.status})`);
    }

    const releases = await response.json();

    return Array.isArray(releases) ? releases : [];
  } finally {
    clearTimeout(timeoutId);
  }
}

async function checkForUpdates(options = {}) {
  const checkedAt = new Date().toISOString();
  const includeBeta = options?.includeBeta === true;

  if (!GITHUB_REPOSITORY_SLUG) {
    return {
      success: false,
      checkedAt,
      updateAvailable: false,
      latestVersion: null,
      latestReleaseChannel: null,
      releaseUrl: DEFAULT_RELEASES_URL,
      error: 'GitHub repository is not configured'
    };
  }

  try {
    const releases = await fetchGitHubReleases();
    let latestReleaseDescriptor = null;

    releases.forEach((release) => {
      if (release?.draft || (!includeBeta && release?.prerelease)) {
        return;
      }

      const normalizedRelease = normalizeGitHubReleaseDescriptor(release);

      if (
        normalizedRelease &&
        (!latestReleaseDescriptor ||
          compareReleaseDescriptors(
            normalizedRelease,
            latestReleaseDescriptor
          ) > 0)
      ) {
        latestReleaseDescriptor = normalizedRelease;
      }
    });

    const currentReleaseDescriptor = getCurrentReleaseDescriptor();

    return {
      success: true,
      checkedAt,
      updateAvailable:
        compareReleaseDescriptors(
          latestReleaseDescriptor,
          currentReleaseDescriptor
        ) > 0,
      latestVersion: latestReleaseDescriptor
        ? formatDisplayVersionFromDescriptor(latestReleaseDescriptor)
        : null,
      latestReleaseChannel: latestReleaseDescriptor?.channel || null,
      releaseUrl: latestReleaseDescriptor?.releaseUrl || DEFAULT_RELEASES_URL,
      error: null
    };
  } catch (error) {
    logger.warn('update check failed', error);

    return {
      success: false,
      checkedAt,
      updateAvailable: false,
      latestVersion: null,
      latestReleaseChannel: null,
      releaseUrl: DEFAULT_RELEASES_URL,
      error:
        error?.name === 'AbortError'
          ? 'Update check timed out'
          : error?.message || 'Update check failed'
    };
  }
}

function createAppInfo(lastUpdatedAt) {
  const releaseDescriptor = getCurrentReleaseDescriptor();
  const releaseChannel = releaseDescriptor?.channel || 's';

  return Object.freeze({
    version: formatDisplayVersionFromDescriptor(releaseDescriptor),
    releaseChannel,
    releaseBadgeLabel: getToolbarReleaseBadgeLabel(releaseChannel),
    updatedAt: typeof lastUpdatedAt === 'string' ? lastUpdatedAt : null,
    bugReportUrl: DEFAULT_BUG_REPORT_URL,
    releasesUrl: DEFAULT_RELEASES_URL
  });
}

function parseSupportedExternalUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    const parsedUrl = new URL(value);

    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:'
      ? parsedUrl
      : null;
  } catch {
    return null;
  }
}

async function openExternalAppUrl(targetUrl) {
  const supportedUrl = parseSupportedExternalUrl(targetUrl);

  if (!supportedUrl) {
    return {
      success: false,
      error: 'Unsupported URL'
    };
  }

  await shell.openExternal(supportedUrl.toString());

  return { success: true };
}

async function initializeAppInfo() {
  const nextAppInfo = createAppInfo(null);
  const appMeta = await touchAppVersion(nextAppInfo.version);

  appInfo = createAppInfo(appMeta?.lastUpdatedAt || null);

  return appInfo;
}

function trimLogString(value, maxLength = 140) {
  const normalized = String(value ?? '');

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

function summarizeLogValue(value, depth = 0) {
  if (value == null) {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      code: value.code || undefined
    };
  }

  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      return `[data-url:${value.length}]`;
    }

    return trimLogString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const sample = value
      .slice(0, 6)
      .map((entry) => summarizeLogValue(entry, depth + 1));

    if (value.length > sample.length) {
      sample.push(`...+${value.length - sample.length} more`);
    }

    return sample;
  }

  if (Buffer.isBuffer(value)) {
    return `[buffer:${value.length}]`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);

    if (depth >= 2) {
      return `{${keys.slice(0, 8).join(', ')}}`;
    }

    const summary = {};

    keys.slice(0, 8).forEach((key) => {
      if (key === 'iconDataUrl') {
        summary[key] = '[data-url]';
        return;
      }

      summary[key] = summarizeLogValue(value[key], depth + 1);
    });

    if (keys.length > 8) {
      summary.__moreKeys = keys.length - 8;
    }

    return summary;
  }

  return String(value);
}

function getIpcLoggerMethod(methodName) {
  return IPC_QUERY_METHODS.has(methodName) ? 'debug' : 'info';
}

function logIpcMessage(
  methodName,
  phase,
  payload,
  level = getIpcLoggerMethod(methodName)
) {
  if (SUPPRESSED_IPC_LOG_METHODS.has(methodName)) {
    return;
  }

  const loggerMethod =
    typeof logger[level] === 'function' ? logger[level] : logger.info;
  loggerMethod(`[ipc:${phase}] ${methodName}`, payload);
}

function getApplicationIconCacheDirectory() {
  if (!applicationIconCacheDirectory) {
    // Keep extracted app icons in a writable assets cache that survives restarts.
    applicationIconCacheDirectory = path.join(
      os.homedir(),
      STORAGE_ROOT_DIR_NAME,
      'assets',
      'application-icons'
    );
  }

  return applicationIconCacheDirectory;
}

async function ensureApplicationIconCacheDirectory() {
  const iconCacheDirectory = getApplicationIconCacheDirectory();
  await fs.mkdir(iconCacheDirectory, { recursive: true });
  return iconCacheDirectory;
}

function getNormalizedApplicationIconCacheKey(applicationPath = '') {
  const normalizedInputPath = String(applicationPath || '').trim();

  if (!normalizedInputPath) {
    return '';
  }

  return path.normalize(normalizedInputPath).toLowerCase();
}

async function getApplicationIconCacheFilePath(applicationPath = '') {
  const normalizedApplicationPath =
    getNormalizedApplicationIconCacheKey(applicationPath);

  if (!normalizedApplicationPath) {
    return '';
  }

  let cacheSignature = '';

  try {
    const stats = await fs.stat(applicationPath);
    cacheSignature = `${Math.round(stats.mtimeMs)}:${stats.size}`;
  } catch {
    // Keep the path-only cache key when file metadata cannot be read.
  }

  const cacheHash = crypto
    .createHash('sha1')
    .update(
      `${APPLICATION_ICON_CACHE_VERSION}:${normalizedApplicationPath}:${cacheSignature}`
    )
    .digest('hex');
  const iconCacheDirectory = await ensureApplicationIconCacheDirectory();

  return path.join(iconCacheDirectory, `${cacheHash}.png`);
}

function convertPngBufferToDataUrl(pngBuffer) {
  if (!Buffer.isBuffer(pngBuffer) || !pngBuffer.length) {
    return '';
  }

  return `data:image/png;base64,${pngBuffer.toString('base64')}`;
}

async function readCachedApplicationIconDataUrl(applicationPath = '') {
  try {
    const cacheFilePath =
      await getApplicationIconCacheFilePath(applicationPath);

    if (!cacheFilePath) {
      return '';
    }

    if (applicationIconDataUrlCache.has(cacheFilePath)) {
      return applicationIconDataUrlCache.get(cacheFilePath) || '';
    }

    const pngBuffer = await fs.readFile(cacheFilePath);
    const cachedDataUrl = convertPngBufferToDataUrl(pngBuffer);

    if (cachedDataUrl) {
      applicationIconDataUrlCache.set(cacheFilePath, cachedDataUrl);
    }

    return cachedDataUrl;
  } catch {
    return '';
  }
}

async function writeCachedApplicationIconDataUrl(
  applicationPath = '',
  icon = null
) {
  if (!icon || typeof icon.isEmpty !== 'function' || icon.isEmpty()) {
    return '';
  }

  const pngBuffer = icon.toPNG();
  const iconDataUrl = convertPngBufferToDataUrl(pngBuffer);

  if (!iconDataUrl) {
    return '';
  }

  try {
    const cacheFilePath =
      await getApplicationIconCacheFilePath(applicationPath);

    if (!cacheFilePath) {
      return iconDataUrl;
    }

    await fs.writeFile(cacheFilePath, pngBuffer);
    applicationIconDataUrlCache.set(cacheFilePath, iconDataUrl);
  } catch {
    // Falling back to the in-memory data URL keeps icon rendering working
    // even if the persistent cache cannot be written for some reason.
  }

  return iconDataUrl;
}

function createLoggedInvokeHandler(methodName, handler) {
  return async (event, ...args) => {
    logIpcMessage(methodName, 'invoke', {
      args: summarizeLogValue(args)
    });

    try {
      const result = await handler(event, ...args);
      logIpcMessage(methodName, 'result', summarizeLogValue(result));
      return result;
    } catch (error) {
      logger.error(`[ipc:error] ${methodName}`, summarizeLogValue(error));
      throw error;
    }
  };
}

function createLoggedSendHandler(methodName, handler) {
  return (event, ...args) => {
    logIpcMessage(
      methodName,
      'send',
      {
        args: summarizeLogValue(args)
      },
      'debug'
    );

    try {
      return handler(event, ...args);
    } catch (error) {
      logger.error(`[ipc:error] ${methodName}`, summarizeLogValue(error));
      throw error;
    }
  };
}

function attachRendererConsoleIsolation(window, label = 'renderer') {
  if (!window?.webContents) {
    return;
  }

  window.webContents.on('console-message', (event) => {
    if (typeof event?.preventDefault === 'function') {
      event.preventDefault();
    }
  });

  logger.debug(`attached ${label} console isolation`);
}

// ── App focus tracking ────────────────────────────────────────────────
// Reports whether any FaderDeck-owned window (main, debug panel, volume HUD)
// or its DevTools currently has focus. The renderer uses this to skip the
// expensive PowerShell foreground-window lookup whenever the OS-level focused
// app is just FaderDeck itself.

function isFaderDeckOwnedWindow(window) {
  if (!window || typeof window.isDestroyed !== 'function' || window.isDestroyed()) {
    return false;
  }

  return (
    window === mainWindow ||
    window === debugPanelWindow ||
    window === volumeHudWindow
  );
}

function computeAppHasFocus() {
  for (const candidate of [mainWindow, debugPanelWindow, volumeHudWindow]) {
    if (!candidate || candidate.isDestroyed()) {
      continue;
    }

    if (typeof candidate.isFocused === 'function' && candidate.isFocused()) {
      return true;
    }

    if (
      candidate.webContents &&
      typeof candidate.webContents.isDevToolsFocused === 'function' &&
      candidate.webContents.isDevToolsFocused()
    ) {
      return true;
    }
  }

  const focusedWindow = BrowserWindow.getFocusedWindow();
  return isFaderDeckOwnedWindow(focusedWindow);
}

function broadcastAppFocusState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(APP_FOCUS_STATE_CHANNEL, {
    hasFocus: appHasFocus
  });
}

function recomputeAppHasFocus() {
  const next = computeAppHasFocus();
  if (next === appHasFocus) {
    return;
  }

  appHasFocus = next;
  broadcastAppFocusState();
}

function attachAppFocusTrackingForWindow(window) {
  if (!window || typeof window.on !== 'function') {
    return;
  }

  window.on('focus', recomputeAppHasFocus);
  window.on('blur', recomputeAppHasFocus);

  if (window.webContents) {
    window.webContents.on('devtools-focused', recomputeAppHasFocus);
    window.webContents.on('devtools-closed', recomputeAppHasFocus);
  }
}

function ensureApi() {
  if (!api) {
    api = new FaderDeckAPI();
  }

  return api;
}

function shutdownApi() {
  if (!api) {
    return;
  }

  logger.info('shutdown api');
  api.shutdown();
  api = null;
}

function getTrayIconPath() {
  return path.join(__dirname, 'assets', 'favicon.png');
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    logger.info('show main window requested without active window');
    void createMainWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
  logger.info('main window shown');
}

function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.hide();
  logger.info('main window hidden to tray');
}

function setCloseToTrayEnabled(value) {
  closeToTrayEnabled = value !== false;
  logger.info('close-to-tray setting updated', {
    enabled: closeToTrayEnabled
  });

  return {
    success: true,
    closeToTrayEnabled
  };
}

function quitApplication() {
  isQuitting = true;
  logger.info('quit application requested');
  app.quit();
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Open FaderDeck',
      click: () => {
        showMainWindow();
      }
    },
    {
      type: 'separator'
    },
    {
      label: 'Exit',
      click: () => {
        quitApplication();
      }
    }
  ]);
}

function ensureTray() {
  if (tray && !tray.isDestroyed?.()) {
    return tray;
  }

  tray = new Tray(getTrayIconPath());
  tray.setToolTip('FaderDeck');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => {
    logger.info('tray icon clicked');
    showMainWindow();
  });

  return tray;
}

function clearMainWindowStateSaveTimer() {
  if (!mainWindowStateSaveTimer) {
    return;
  }

  clearTimeout(mainWindowStateSaveTimer);
  mainWindowStateSaveTimer = null;
}

async function persistMainWindowState(window = mainWindow) {
  if (!window || window.isDestroyed()) {
    return;
  }

  try {
    await saveMainWindowState(window);
  } catch (error) {
    logger.warn('failed to persist main window state', error);
  }
}

function scheduleMainWindowStateSave(window = mainWindow) {
  clearMainWindowStateSaveTimer();

  if (!window || window.isDestroyed()) {
    return;
  }

  mainWindowStateSaveTimer = setTimeout(() => {
    void persistMainWindowState(window);
  }, 150);
}

async function resolveMainWindowState() {
  try {
    return await getMainWindowState();
  } catch (error) {
    logger.warn('failed to load persisted main window state', error);
    return DEFAULT_MAIN_WINDOW_STATE;
  }
}

function buildMainWindowOptions(windowState = DEFAULT_MAIN_WINDOW_STATE) {
  const windowOptions = {
    ...WINDOW_OPTIONS,
    width: windowState.width,
    height: windowState.height
  };

  if (Number.isFinite(windowState.x) && Number.isFinite(windowState.y)) {
    windowOptions.x = windowState.x;
    windowOptions.y = windowState.y;
  }

  return windowOptions;
}

function clearVolumeHudTimers() {
  if (volumeHudHideTimer) {
    clearTimeout(volumeHudHideTimer);
    volumeHudHideTimer = null;
  }

  if (volumeHudHideCommitTimer) {
    clearTimeout(volumeHudHideCommitTimer);
    volumeHudHideCommitTimer = null;
  }
}

function destroyVolumeHudWindow() {
  clearVolumeHudTimers();

  if (!volumeHudWindow || volumeHudWindow.isDestroyed()) {
    volumeHudWindow = null;
    volumeHudReadyPromise = null;
    return;
  }

  volumeHudWindow.destroy();
  volumeHudWindow = null;
  volumeHudReadyPromise = null;
}

function normalizeVolumeHudPayload(payload = {}) {
  const presentation = normalizeVolumeHudPresentation(payload?.presentation);

  return {
    channelId: Number.parseInt(payload?.channelId, 10) || null,
    title: String(payload?.title || '')
      .trim()
      .slice(0, 120),
    subtitle: String(payload?.subtitle || '')
      .trim()
      .slice(0, 160),
    valueText: String(payload?.valueText || '')
      .trim()
      .slice(0, 32),
    iconDataUrl:
      typeof payload?.iconDataUrl === 'string' ? payload.iconDataUrl : '',
    source: String(payload?.source || '').trim(),
    volume: Math.max(0, Math.min(100, Number(payload?.volume) || 0)),
    muted: Boolean(payload?.muted),
    presentation
  };
}

function normalizeVolumeHudPresentation(presentation = {}) {
  const position = VOLUME_HUD_POSITIONS.has(presentation?.position)
    ? presentation.position
    : 'bottom-center';
  const orientation = VOLUME_HUD_ORIENTATIONS.has(presentation?.orientation)
    ? presentation.orientation
    : 'horizontal';

  return {
    enabled: presentation?.enabled !== false,
    position,
    orientation,
    showIcon: presentation?.showIcon !== false,
    showTitle: presentation?.showTitle !== false,
    showSubtitle: presentation?.showSubtitle !== false,
    showPercent: presentation?.showPercent !== false,
    showMeter: presentation?.showMeter !== false
  };
}

function getVolumeHudWindowSize(presentation = {}) {
  return (
    VOLUME_HUD_WINDOW_SIZES[presentation.orientation] ||
    VOLUME_HUD_WINDOW_SIZES.horizontal
  );
}

function getVolumeHudBounds(presentation = {}) {
  const fallbackDisplay = screen.getPrimaryDisplay();
  const referenceDisplay =
    (mainWindow && !mainWindow.isDestroyed()
      ? screen.getDisplayMatching(mainWindow.getBounds())
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())) ||
    fallbackDisplay;
  const workArea = referenceDisplay.workArea;
  const size = getVolumeHudWindowSize(presentation);
  const isTopAligned = presentation.position.startsWith('top-');
  const isLeftAligned = presentation.position.endsWith('-left');
  const isRightAligned = presentation.position.endsWith('-right');
  let x = Math.round(workArea.x + (workArea.width - size.width) / 2);
  let y = isTopAligned
    ? workArea.y + VOLUME_HUD_WINDOW_MARGIN
    : workArea.y + workArea.height - size.height - VOLUME_HUD_WINDOW_MARGIN;

  if (isLeftAligned) {
    x = workArea.x + VOLUME_HUD_WINDOW_MARGIN;
  } else if (isRightAligned) {
    x = workArea.x + workArea.width - size.width - VOLUME_HUD_WINDOW_MARGIN;
  }

  return {
    width: size.width,
    height: size.height,
    x: Math.round(x),
    y: Math.round(y)
  };
}

function createVolumeHudWindow() {
  if (volumeHudWindow && !volumeHudWindow.isDestroyed()) {
    return volumeHudWindow;
  }

  volumeHudWindow = new BrowserWindow({
    width: VOLUME_HUD_WINDOW_SIZES.horizontal.width,
    height: VOLUME_HUD_WINDOW_SIZES.horizontal.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    roundedCorners: false,
    thickFrame: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  volumeHudWindow.setAlwaysOnTop(true, 'screen-saver');
  volumeHudWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true
  });
  volumeHudWindow.setIgnoreMouseEvents(true, { forward: true });
  volumeHudWindow.setFocusable(false);
  volumeHudWindow.removeMenu();
  volumeHudWindow.loadFile(
    path.join(__dirname, 'web', 'overlay', 'volume-hud.html')
  );

  volumeHudReadyPromise = new Promise((resolve) => {
    volumeHudWindow.webContents.once('did-finish-load', () => {
      resolve(volumeHudWindow);
    });
  });

  volumeHudWindow.on('closed', () => {
    clearVolumeHudTimers();
    volumeHudWindow = null;
    volumeHudReadyPromise = null;
  });

  return volumeHudWindow;
}

async function ensureVolumeHudWindow() {
  const window = createVolumeHudWindow();
  await volumeHudReadyPromise;
  return window;
}

async function showVolumeHud(payload) {
  const normalized = normalizeVolumeHudPayload(payload);
  if (!normalized.presentation.enabled) {
    return;
  }
  const win = await ensureVolumeHudWindow();
  if (win.isDestroyed()) {
    return;
  }

  win.webContents.send(VOLUME_HUD_UPDATE_CHANNEL, normalized);
  win.show();
  clearVolumeHudTimers();
  if (VOLUME_HUD_HIDE_DELAY_MS > 0) {
    volumeHudHideTimer = setTimeout(() => {
      hideVolumeHud();
    }, VOLUME_HUD_HIDE_DELAY_MS);
  }
}

function hideVolumeHud() {
  clearVolumeHudTimers();
  if (volumeHudWindow && !volumeHudWindow.isDestroyed()) {
    volumeHudWindow.hide();
  }
}

// ── Debug Panel ────────────────────────────────────────────────────────

function createDebugPanelWindow() {
  if (debugPanelWindow && !debugPanelWindow.isDestroyed()) {
    return debugPanelWindow;
  }

  debugPanelWindow = new BrowserWindow({
    width: 440,
    height: 700,
    minWidth: 360,
    minHeight: 320,
    show: false,
    frame: false,
    transparent: false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    skipTaskbar: false,
    focusable: true,
    hasShadow: true,
    backgroundColor: '#0c0c0c',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  debugPanelWindow.removeMenu();
  attachAppFocusTrackingForWindow(debugPanelWindow);
  debugPanelWindow.loadFile(
    path.join(__dirname, 'web', 'overlay', 'debug-panel.html')
  );

  debugPanelReadyPromise = new Promise((resolve) => {
    debugPanelWindow.webContents.once('did-finish-load', () => {
      resolve(debugPanelWindow);
    });
  });

  debugPanelWindow.on('closed', () => {
    clearDebugPanelTimer();
    debugPanelWindow = null;
    debugPanelReadyPromise = null;
    recomputeAppHasFocus();
  });

  return debugPanelWindow;
}

async function ensureDebugPanelWindow() {
  const win = createDebugPanelWindow();
  await debugPanelReadyPromise;
  return win;
}

function clearDebugPanelTimer() {
  if (debugPanelRefreshTimer !== null) {
    clearInterval(debugPanelRefreshTimer);
    debugPanelRefreshTimer = null;
  }
  if (debugPanelPendingRefresh !== null) {
    clearTimeout(debugPanelPendingRefresh);
    debugPanelPendingRefresh = null;
  }
}

// Cached results of the slow PowerShell calls so that fast ticks reuse them
// without paying the round-trip cost. Refreshed every
// DEBUG_PANEL_SLOW_REFRESH_TICKS calls to buildDebugPanelPayload (or on the
// very first call after the panel is shown).
let debugPanelSlowCache = {
  audioDevices: [],
  audioDevicesAt: 0,
  mediaSessions: [],
  mediaSessionsAt: 0,
  focusedApp: null,
  focusedAppAt: 0
};
let debugPanelTickCounter = 0;

function resetDebugPanelSlowCache() {
  debugPanelSlowCache = {
    audioDevices: [],
    audioDevicesAt: 0,
    mediaSessions: [],
    mediaSessionsAt: 0,
    focusedApp: null,
    focusedAppAt: 0
  };
  debugPanelTickCounter = 0;
}

async function refreshDebugPanelSlowData() {
  const now = Date.now();
  // Always stamp the cache time so a failure (e.g. PowerShell not present on
  // this OS) doesn't fall through and force the slow refresh on every tick.
  debugPanelSlowCache.audioDevicesAt = now;
  debugPanelSlowCache.mediaSessionsAt = now;
  try {
    const response = await ensureApi().listAudioDevices('all');
    if (Array.isArray(response)) {
      debugPanelSlowCache.audioDevices = response;
    } else if (response && Array.isArray(response.devices)) {
      debugPanelSlowCache.audioDevices = response.devices;
    } else {
      debugPanelSlowCache.audioDevices = [];
    }
  } catch (err) {
    logger.debug('debug panel listAudioDevices failed', err);
  }
  try {
    const response = await ensureApi().listMediaSessions();
    if (Array.isArray(response)) {
      debugPanelSlowCache.mediaSessions = response;
    } else if (response && Array.isArray(response.sessions)) {
      debugPanelSlowCache.mediaSessions = response.sessions;
    } else {
      debugPanelSlowCache.mediaSessions = [];
    }
  } catch (err) {
    logger.debug('debug panel listMediaSessions failed', err);
  }
  // Skip the foreground-window lookup when any FaderDeck window already owns
  // focus — the result would just be FaderDeck itself, and the lookup itself
  // is a relatively expensive PowerShell round trip.
  if (!appHasFocus) {
    try {
      const fa = await ensureApi().getFocusedApplication();
      if (fa && fa.success === true && fa.application && typeof fa.application === 'object') {
        debugPanelSlowCache.focusedApp = { ...fa.application };
        debugPanelSlowCache.focusedAppAt = now;
      }
    } catch (err) {
      logger.debug('debug panel getFocusedApplication failed', err);
    }
  } else {
    debugPanelSlowCache.focusedApp = null;
    debugPanelSlowCache.focusedAppAt = 0;
  }
}

async function buildDebugPanelPayload() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    logger.warn('buildDebugPanelPayload: no main window');
    return null;
  }

  // Single round trip into the renderer: combine appState snapshot, audio
  // runtime, channel/standalone button polling flags, and live MIDI runtime
  // into one executeJavaScript call. This is much cheaper than 4 separate
  // IPC round trips per tick (which is what we did before).
  let probe = null;
  try {
    probe = await mainWindow.webContents.executeJavaScript(
      `(() => {
        const out = { state: null, audio: null, channelFadersActive: false, standaloneButtonsActive: false, midi: null };
        try {
          if (typeof window.getAppState === 'function') {
            out.state = JSON.parse(JSON.stringify(window.getAppState()));
          }
        } catch (e) { /* ignore */ }
        try {
          if (typeof window.getAudioRuntimeState === 'function') {
            out.audio = JSON.parse(JSON.stringify(window.getAudioRuntimeState()));
          }
        } catch (e) { /* ignore */ }
        try {
          if (typeof window.channelButtonRuntime?.getPollingActive === 'function') {
            out.channelFadersActive = !!window.channelButtonRuntime.getPollingActive();
          }
        } catch (e) { /* ignore */ }
        try {
          if (typeof window.standaloneButtonRuntime?.getPollingActive === 'function') {
            out.standaloneButtonsActive = !!window.standaloneButtonRuntime.getPollingActive();
          }
        } catch (e) { /* ignore */ }
        try {
          const svc = window.midiService;
          if (svc && typeof svc.getState === 'function') {
            const st = svc.getState() || {};
            const inputs = Array.isArray(st.inputs)
              ? st.inputs.map((i) => ({ id: i.id || '', name: i.name || '', manufacturer: i.manufacturer || '', state: i.state || '' }))
              : [];
            const outputs = typeof svc.getOutputs === 'function'
              ? svc.getOutputs().map((o) => ({ id: o.id || '', name: o.name || '', manufacturer: o.manufacturer || '', state: o.state || '' }))
              : [];
            const selectedId = typeof svc.getSelectedInputId === 'function' ? svc.getSelectedInputId() : '';
            const selectedName = typeof svc.getSelectedInputName === 'function' ? svc.getSelectedInputName() : '';
            out.midi = {
              supported: st.supported === true,
              accessReady: st.accessReady === true,
              scanning: st.scanning === true,
              error: st.error ? String(st.error.message || st.error) : null,
              inputs,
              outputs,
              selectedInput: selectedId ? { id: selectedId, name: selectedName || '' } : null
            };
          }
        } catch (e) { /* ignore */ }
        return out;
      })()`,
      true
    );
  } catch (err) {
    logger.warn('debug panel renderer probe failed', err);
  }

  const stateSnapshot = probe?.state || null;
  const runtimeSnapshot = probe?.audio || null;
  const channelFadersActive = !!probe?.channelFadersActive;
  const standaloneButtonsActive = !!probe?.standaloneButtonsActive;
  const midiRuntime = probe?.midi || null;

  const mem = process.memoryUsage();
  const now = Date.now();

  // Refresh PowerShell-backed data only every Nth tick (or on the first tick
  // after the panel was opened, when the cache is empty).
  const slowDue =
    debugPanelTickCounter % DEBUG_PANEL_SLOW_REFRESH_TICKS === 0 ||
    debugPanelSlowCache.audioDevicesAt === 0;
  debugPanelTickCounter += 1;
  if (slowDue) {
    await refreshDebugPanelSlowData();
  }

  const audioDevicesData = debugPanelSlowCache.audioDevices;
  const mediaSessionsData = debugPanelSlowCache.mediaSessions;
  const focusedAppData = debugPanelSlowCache.focusedApp
    ? { ...debugPanelSlowCache.focusedApp, fetchedAt: debugPanelSlowCache.focusedAppAt }
    : null;

  // Channels in the renderer store don't have a `binding` object — they have
  // `targetMode` ('apps' | 'devices' | 'focus') and a `targets` array of
  // `{ name, process }` entries. Surface those so the debug panel actually
  // shows what each channel is bound to.
  const serializableChannels = Array.isArray(stateSnapshot?.channels)
    ? stateSnapshot.channels.map((ch) => ({
        id: ch?.id ?? null,
        name: ch?.name ?? null,
        volume: typeof ch?.volume === 'number' ? ch.volume : null,
        muted: typeof ch?.muted === 'boolean' ? ch.muted : false,
        targetMode: typeof ch?.targetMode === 'string' ? ch.targetMode : null,
        targets: Array.isArray(ch?.targets)
          ? ch.targets.map((t) => ({
              name: typeof t?.name === 'string' ? t.name : '',
              process: typeof t?.process === 'string' ? t.process : ''
            }))
          : [],
        deviceTargetsCount: Array.isArray(ch?.deviceTargets) ? ch.deviceTargets.length : 0,
        focusExcludedCount: Array.isArray(ch?.focusExcludedTargets) ? ch.focusExcludedTargets.length : 0,
        buttonsCount: Array.isArray(ch?.buttons) ? ch.buttons.length : 0
      }))
    : [];

  const serializableApps = Array.isArray(runtimeSnapshot?.apps)
    ? runtimeSnapshot.apps.map((a) => ({
        name: a?.name ?? null,
        process: a?.process ?? null,
        volume: typeof a?.volume === 'number' ? a.volume : null,
        muted: typeof a?.muted === 'boolean' ? a.muted : false,
        hasAudioSession: typeof a?.hasAudioSession === 'boolean' ? a.hasAudioSession : false,
        sessionCount: typeof a?.sessionCount === 'number' ? a.sessionCount : 0
      }))
    : [];

  return {
    emittedAt: now,
    updateSequence: now,
    memory: {
      rss: typeof mem.rss === 'number' ? mem.rss : 0,
      heapUsed: typeof mem.heapUsed === 'number' ? mem.heapUsed : 0,
      heapTotal: typeof mem.heapTotal === 'number' ? mem.heapTotal : 0
    },
    app: {
      version: typeof packageMetadata.version === 'string' ? packageMetadata.version : '',
      uptime: typeof process.uptime === 'function' ? Math.round(process.uptime() * 1000) : 0,
      locale: typeof app.getLocale === 'function' ? app.getLocale() : '',
      platform: typeof process.platform === 'string' ? process.platform : '',
      electronVersion: typeof process.versions?.electron === 'string' ? process.versions.electron : ''
    },
    settings: {
      developerMode: stateSnapshot?.ui?.settings?.developerMode === true,
      advancedMode: stateSnapshot?.ui?.settings?.advancedMode === true,
      faderInterpolationEnabled: stateSnapshot?.ui?.settings?.faderInterpolationEnabled === true,
      softTakeoverEnabled: stateSnapshot?.ui?.settings?.softTakeoverEnabled === true,
      softTakeoverThreshold: typeof stateSnapshot?.ui?.settings?.softTakeoverThreshold === 'number'
        ? stateSnapshot.ui.settings.softTakeoverThreshold : 5,
      volumeHudEnabled: stateSnapshot?.ui?.settings?.volumeHudEnabled !== false,
      closeToTrayEnabled: stateSnapshot?.ui?.settings?.closeToTrayEnabled !== false,
      autoUpdateEnabled: stateSnapshot?.ui?.settings?.autoUpdateEnabled !== false
    },
    channels: serializableChannels,
    audioApps: serializableApps,
    audioAppsAt: runtimeSnapshot ? now : 0,
    audioDevices: audioDevicesData,
    audioDevicesAt: audioDevicesData.length ? now : 0,
    mediaSessions: mediaSessionsData,
    mediaSessionsAt: mediaSessionsData.length ? now : 0,
    runtime: {
      audioAppsCount: serializableApps.length,
      audioAppsRefreshing: runtimeSnapshot?.refreshing === true,
      lastAudioRefreshAt: typeof runtimeSnapshot?.lastRefreshAt === 'number' ? runtimeSnapshot.lastRefreshAt : 0,
      focusedApp: focusedAppData?.name ?? null,
      focusedAppAt: focusedAppData?.fetchedAt ?? 0,
      channelFadersActive,
      standaloneButtonsActive
    },
    midi: midiRuntime || {
      supported: false,
      accessReady: false,
      scanning: false,
      error: null,
      inputs: [],
      outputs: [],
      selectedInput: null
    },
    rawState: stateSnapshot || {}
  };
}

async function sendDebugPanelUpdate() {
  if (!debugPanelWindow || debugPanelWindow.isDestroyed()) {
    return;
  }
  // Don't burn CPU building the payload if nobody can see the panel
  // (window hidden, minimized, or fully occluded by something else).
  if (!debugPanelWindow.isVisible() || debugPanelWindow.isMinimized()) {
    return;
  }

  try {
    const payload = await buildDebugPanelPayload();
    if (payload && !debugPanelWindow.isDestroyed()) {
      debugPanelWindow.webContents.send(DEBUG_PANEL_UPDATE_CHANNEL, payload);
      logger.debug('debug panel update sent', { emittedAt: payload.emittedAt, channels: payload.channels?.length, apps: payload.audioApps?.length });
    } else {
      logger.warn('debug panel update skipped, no payload');
    }
  } catch (error) {
    logger.warn('debug panel update error', error);
  }
}

async function showDebugPanel() {
  const win = await ensureDebugPanelWindow();
  if (win.isDestroyed()) return;

  win.show();
  win.focus();

  clearDebugPanelTimer();
  resetDebugPanelSlowCache();
  debugPanelRefreshTimer = setInterval(() => {
    sendDebugPanelUpdate();
  }, DEBUG_PANEL_REFRESH_MS);

  await sendDebugPanelUpdate();
}

async function hideDebugPanel() {
  clearDebugPanelTimer();
  if (debugPanelWindow && !debugPanelWindow.isDestroyed()) {
    debugPanelWindow.hide();
  }
}

function destroyDebugPanelWindow() {
  clearDebugPanelTimer();
  if (debugPanelWindow && !debugPanelWindow.isDestroyed()) {
    debugPanelWindow.destroy();
  }
  debugPanelWindow = null;
  debugPanelReadyPromise = null;
}

async function createMainWindow() {
  clearVolumeHudTimers();
  ensureApi();
  ensureTray();

  const windowState = await resolveMainWindowState();

  mainWindow = new BrowserWindow(buildMainWindowOptions(windowState));
  attachRendererConsoleIsolation(mainWindow);
  attachAppFocusTrackingForWindow(mainWindow);
  mainWindow.webContents.on('did-finish-load', () => {
    recomputeAppHasFocus();
    broadcastAppFocusState();
  });
  mainWindow.loadFile(path.join(__dirname, 'web', 'index.html'));

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.on('resize', () => {
    scheduleMainWindowStateSave(mainWindow);
  });

  mainWindow.on('move', () => {
    scheduleMainWindowStateSave(mainWindow);
  });

  mainWindow.on('maximize', () => {
    scheduleMainWindowStateSave(mainWindow);
  });

  mainWindow.on('unmaximize', () => {
    scheduleMainWindowStateSave(mainWindow);
  });

  mainWindow.on('close', (event) => {
    if (isQuitting || !closeToTrayEnabled) {
      logger.info('main window close accepted', {
        isQuitting,
        closeToTrayEnabled
      });
      return;
    }

    event.preventDefault();
    logger.info('main window close intercepted and redirected to tray');
    hideMainWindow();
  });

  mainWindow.on('closed', () => {
    clearMainWindowStateSaveTimer();
    mainWindow = null;
    destroyVolumeHudWindow();
    shutdownApi();
  });
}

function toggleDevTools(window) {
  if (!window) {
    return { success: false };
  }

  if (window.webContents.isDevToolsOpened()) {
    window.webContents.closeDevTools();
    logger.info('devtools closed');
    return { success: true, isOpen: false };
  }

  window.webContents.openDevTools({ mode: 'detach' });
  logger.info('devtools opened');
  return { success: true, isOpen: true };
}

function getEventWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function handleWindowControl(window, action) {
  if (!window) {
    return;
  }

  switch (action) {
    case 'minimize':
      window.minimize();
      return;

    case 'maximize':
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
      return;

    case 'close':
      window.close();
      return;

    default:
      return;
  }
}

function registerIpcHandlers() {
  registerIpcInvokeHandlers(
    ipcMain,
    Object.fromEntries(
      Object.entries({
        get_audio_applications: () => ensureApi().getAudioApplications(),
        list_running_applications: () => ensureApi().listRunningApplications(),
        get_audio_states: (_event, processNames) =>
          ensureApi().getAudioStates(processNames),
        set_app_volume: (_event, processName, volume) =>
          ensureApi().setAppVolume(processName, volume),
        toggle_app_mute: (_event, processName) =>
          ensureApi().toggleAppMute(processName),
        set_app_mute: (_event, processName, muted) =>
          ensureApi().setAppMute(processName, muted),
        send_key: (_event, key, targetHint) =>
          ensureApi().sendKey(key, targetHint),
        list_audio_devices: (_event, flow) =>
          ensureApi().listAudioDevices(flow),
        set_audio_device_volume: (_event, deviceId, volume, flow) =>
          ensureApi().setAudioDeviceVolume(deviceId, volume, flow),
        set_audio_device_mute: (_event, deviceId, muted, flow) =>
          ensureApi().setAudioDeviceMute(deviceId, muted, flow),
        set_default_audio_device: (_event, deviceId, flow) =>
          ensureApi().setDefaultAudioDevice(deviceId, flow),
        get_focused_application: () => ensureApi().getFocusedApplication(),
        launch_app: (_event, filePath) => ensureApi().launchApp(filePath),
        run_user_script: (_event, filePath) =>
          ensureApi().runUserScript(filePath),
        set_process_window_visibility: (
          _event,
          processName,
          visible,
          executablePath
        ) =>
          ensureApi().setProcessWindowVisibility(
            processName,
            visible,
            executablePath
          ),
        set_media_option: (_event, command, enabled, targetAppId) =>
          ensureApi().setMediaOption(command, enabled, targetAppId),
        send_media_transport: (_event, command, targetAppId) =>
          ensureApi().sendMediaTransport(command, targetAppId),
        list_media_sessions: () => ensureApi().listMediaSessions(),
        get_media_session_state: (_event, targetAppId) =>
          ensureApi().getMediaSessionState(targetAppId),
        set_media_repeat_mode: (_event, mode, targetAppId) =>
          ensureApi().setMediaRepeatMode(mode, targetAppId),
        save_profile: (_event, name, data) =>
          ensureApi().saveProfile(name, data),
        load_profile: (_event, name) => ensureApi().loadProfile(name),
        list_profiles: () => ensureApi().listProfiles(),
        delete_profile: (_event, name) => ensureApi().deleteProfile(name),
        rename_profile: (_event, fromName, toName) =>
          ensureApi().renameProfile(fromName, toName),
        import_profile: (_event, filePath, options) =>
          ensureApi().importProfile(filePath, options),
        get_profile_template: (_event, options) =>
          ensureApi().getProfileTemplate(options),
        get_profiles_directory: () => ensureApi().getProfilesDirectory(),
        get_app_info: () => appInfo,
        check_for_updates: (_event, options) => checkForUpdates(options),
        get_application_icons: async (_event, applicationPaths = []) => {
          const icons = {};
          const uniquePaths = Array.isArray(applicationPaths)
            ? [
                ...new Set(
                  applicationPaths.filter(
                    (entry) => typeof entry === 'string' && entry.trim()
                  )
                )
              ]
            : [];

          await Promise.all(
            uniquePaths.map(async (applicationPath) => {
              try {
                const cachedIconDataUrl =
                  await readCachedApplicationIconDataUrl(applicationPath);

                if (cachedIconDataUrl) {
                  icons[applicationPath] = cachedIconDataUrl;
                  return;
                }

                const icon = await app.getFileIcon(applicationPath, {
                  size: 'normal'
                });
                const iconDataUrl = await writeCachedApplicationIconDataUrl(
                  applicationPath,
                  icon
                );

                if (iconDataUrl) {
                  icons[applicationPath] = iconDataUrl;
                }
              } catch {
                // Some processes do not expose a retrievable shell icon; skip them silently.
              }
            })
          );

          return {
            success: true,
            icons
          };
        },
        open_profiles_folder: async () => {
          const { path: profilesPath } = ensureApi().getProfilesDirectory();
          await shell.openPath(profilesPath);
          return { success: true, path: profilesPath };
        },
        show_profile_in_folder: async (_event, profilePath) => {
          if (profilePath) {
            shell.showItemInFolder(profilePath);
          }
          return { success: true };
        },
        pick_profile_file: async (event) => {
          const window = getEventWindow(event) || mainWindow;
          const result = await dialog.showOpenDialog(window, {
            title: 'Import profile',
            properties: ['openFile'],
            filters: [
              { name: 'JSON Profiles', extensions: ['json'] },
              { name: 'All Files', extensions: ['*'] }
            ]
          });

          return {
            success: !result.canceled,
            canceled: result.canceled,
            filePath: result.filePaths?.[0] || null
          };
        },
        pick_action_file: async (event, mode = 'app') => {
          const window = getEventWindow(event) || mainWindow;
          const normalizedMode = String(mode || 'app')
            .trim()
            .toLowerCase();
          const filters =
            normalizedMode === 'script'
              ? [
                  {
                    name: 'Scripts',
                    extensions: [
                      'ps1',
                      'cmd',
                      'bat',
                      'js',
                      'cjs',
                      'mjs',
                      'vbs',
                      'wsf'
                    ]
                  },
                  { name: 'All Files', extensions: ['*'] }
                ]
              : [
                  {
                    name: 'Applications',
                    extensions: ['exe', 'lnk', 'cmd', 'bat', 'appref-ms']
                  },
                  { name: 'All Files', extensions: ['*'] }
                ];
          const result = await dialog.showOpenDialog(window, {
            title:
              normalizedMode === 'script'
                ? 'Select script'
                : 'Select application',
            properties: ['openFile'],
            filters
          });

          return {
            success: !result.canceled,
            canceled: result.canceled,
            filePath: result.filePaths?.[0] || null
          };
        },
        open_external_url: (_event, targetUrl) => openExternalAppUrl(targetUrl),
        toggle_devtools: (event) => toggleDevTools(getEventWindow(event)),
        notify_developer_mode_changed: () => {
          // Developer-mode features are now gated on the value snapshotted
          // at app startup — a live toggle persists the new value but does
          // not change runtime behavior until the next launch. The renderer
          // shows a toast on enable; nothing for the main process to do here.
          return { success: true };
        },
        toggle_debug_panel: async () => {
          const wasVisible =
            debugPanelWindow &&
            !debugPanelWindow.isDestroyed() &&
            debugPanelWindow.isVisible();

          if (wasVisible) {
            hideDebugPanel();
          } else {
            await showDebugPanel();
          }
          return { success: true, visible: !wasVisible };
        },
        set_close_to_tray_enabled: (_event, enabled) =>
          setCloseToTrayEnabled(enabled),
        exit_app: () => {
          quitApplication();
        },
        windowControl: (event, action) =>
          handleWindowControl(getEventWindow(event), action)
      }).map(([methodName, handler]) => [
        methodName,
        createLoggedInvokeHandler(methodName, handler)
      ])
    )
  );

  registerIpcSendHandlers(
    ipcMain,
    Object.fromEntries(
      Object.entries({
        show_volume_hud: (_event, payload) => {
          void showVolumeHud(payload);
        }
      }).map(([methodName, handler]) => [
        methodName,
        createLoggedSendHandler(methodName, handler)
      ])
    )
  );

  // The debug panel's close button uses a dedicated channel that lives outside
  // the IPC contract because the overlay preload talks to main directly.
  // Register it on ipcMain by hand so the X button actually closes the window.
  ipcMain.on(
    'debug-panel:close',
    createLoggedSendHandler('debug-panel:close', () => {
      void hideDebugPanel();
    })
  );
}

app
  .whenReady()
  .then(async () => {
    Menu.setApplicationMenu(null);
    await initializeAppInfo();
    ensureTray();
    registerIpcHandlers();
    await createMainWindow();
    logger.info('application ready');
  })
  .catch((error) => {
    logger.error('application bootstrap failed', error);
    throw error;
  });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});

app.on('window-all-closed', () => {
  clearMainWindowStateSaveTimer();
  destroyVolumeHudWindow();
  destroyDebugPanelWindow();
  shutdownApi();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});
