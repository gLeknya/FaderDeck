const { app, BrowserWindow, ipcMain, Menu, Tray, dialog, shell, screen } = require('electron');
const path = require('path');

const { FaderDeckAPI } = require('./backend/api');
const {
  DEFAULT_MAIN_WINDOW_STATE,
  getMainWindowState,
  saveMainWindowState
} = require('./backend/app-store');
const { createLogger } = require('./backend/logger');
const {
  registerIpcInvokeHandlers,
  registerIpcSendHandlers
} = require('./shared/ipc-contract');
const VOLUME_HUD_UPDATE_CHANNEL = 'volume-hud:update';
const VOLUME_HUD_VISIBILITY_CHANNEL = 'volume-hud:visibility';
const VOLUME_HUD_HIDE_DELAY_MS = 1350;
const VOLUME_HUD_HIDE_ANIMATION_MS = 180;
const VOLUME_HUD_WINDOW_MARGIN = 32;
const VOLUME_HUD_WINDOW_SIZES = Object.freeze({
  horizontal: Object.freeze({
    width: 340,
    height: 132
  }),
  vertical: Object.freeze({
    width: 210,
    height: 258
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
const VOLUME_HUD_ORIENTATIONS = new Set([
  'horizontal',
  'vertical'
]);
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
let mainWindowStateSaveTimer = null;
let api = null;
let tray = null;
let isQuitting = false;
let closeToTrayEnabled = true;
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
  'pick_profile_file',
  'pick_action_file'
]);
const SUPPRESSED_IPC_LOG_METHODS = new Set([
  'get_audio_states',
  'get_media_session_state',
  'list_media_sessions'
]);

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
    const sample = value.slice(0, 6).map((entry) => summarizeLogValue(entry, depth + 1));

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

function logIpcMessage(methodName, phase, payload, level = getIpcLoggerMethod(methodName)) {
  if (SUPPRESSED_IPC_LOG_METHODS.has(methodName)) {
    return;
  }

  const loggerMethod = typeof logger[level] === 'function' ? logger[level] : logger.info;
  loggerMethod(`[ipc:${phase}] ${methodName}`, payload);
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
    logIpcMessage(methodName, 'send', {
      args: summarizeLogValue(args)
    }, 'debug');

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
    title: String(payload?.title || '').trim().slice(0, 120),
    subtitle: String(payload?.subtitle || '').trim().slice(0, 160),
    valueText: String(payload?.valueText || '').trim().slice(0, 32),
    iconDataUrl: typeof payload?.iconDataUrl === 'string' ? payload.iconDataUrl : '',
    source: String(payload?.source || '').trim(),
    volume: Math.max(0, Math.min(100, Number(payload?.volume) || 0)),
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
  return VOLUME_HUD_WINDOW_SIZES[presentation.orientation] || VOLUME_HUD_WINDOW_SIZES.horizontal;
}

function getVolumeHudBounds(presentation = {}) {
  const fallbackDisplay = screen.getPrimaryDisplay();
  const referenceDisplay = (
    mainWindow && !mainWindow.isDestroyed()
      ? screen.getDisplayMatching(mainWindow.getBounds())
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  ) || fallbackDisplay;
  const workArea = referenceDisplay.workArea;
  const size = getVolumeHudWindowSize(presentation);
  const isTopAligned = presentation.position.startsWith('top-');
  const isLeftAligned = presentation.position.endsWith('-left');
  const isRightAligned = presentation.position.endsWith('-right');
  let x = Math.round(workArea.x + ((workArea.width - size.width) / 2));
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
  volumeHudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  volumeHudWindow.setIgnoreMouseEvents(true, { forward: true });
  volumeHudWindow.setFocusable(false);
  volumeHudWindow.removeMenu();
  volumeHudWindow.loadFile(path.join(__dirname, 'web', 'overlay', 'volume-hud.html'));

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

function scheduleVolumeHudHide() {
  clearVolumeHudTimers();

  volumeHudHideTimer = setTimeout(() => {
    if (!volumeHudWindow || volumeHudWindow.isDestroyed()) {
      return;
    }

    volumeHudWindow.webContents.send(VOLUME_HUD_VISIBILITY_CHANNEL, { visible: false });

    volumeHudHideCommitTimer = setTimeout(() => {
      if (volumeHudWindow && !volumeHudWindow.isDestroyed()) {
        volumeHudWindow.hide();
      }
    }, VOLUME_HUD_HIDE_ANIMATION_MS);
  }, VOLUME_HUD_HIDE_DELAY_MS);
}

async function showVolumeHud(payload = {}) {
  const normalizedPayload = normalizeVolumeHudPayload(payload);
  const presentation = normalizedPayload.presentation;

  if (
    !presentation.enabled
    || (
      !presentation.showIcon
      && !presentation.showTitle
      && !presentation.showSubtitle
      && !presentation.showPercent
      && !presentation.showMeter
    )
    || (!normalizedPayload.title && !normalizedPayload.valueText)
  ) {
    return { success: false };
  }

  const window = await ensureVolumeHudWindow();

  if (!window || window.isDestroyed()) {
    return { success: false };
  }

  clearVolumeHudTimers();
  window.setBounds(getVolumeHudBounds(presentation), false);
  window.webContents.send(VOLUME_HUD_UPDATE_CHANNEL, normalizedPayload);

  if (!window.isVisible()) {
    window.showInactive();
  }

  window.webContents.send(VOLUME_HUD_VISIBILITY_CHANNEL, { visible: true });
  scheduleVolumeHudHide();

  return { success: true };
}

async function createMainWindow() {
  ensureApi();
  ensureTray();

  const windowState = await resolveMainWindowState();

  mainWindow = new BrowserWindow(buildMainWindowOptions(windowState));
  attachRendererConsoleIsolation(mainWindow);
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
  registerIpcInvokeHandlers(ipcMain, Object.fromEntries(
    Object.entries({
    get_audio_applications: () => ensureApi().getAudioApplications(),
    list_running_applications: () => ensureApi().listRunningApplications(),
    get_audio_states: (_event, processNames) => ensureApi().getAudioStates(processNames),
    set_app_volume: (_event, processName, volume) => ensureApi().setAppVolume(processName, volume),
    toggle_app_mute: (_event, processName) => ensureApi().toggleAppMute(processName),
    set_app_mute: (_event, processName, muted) => ensureApi().setAppMute(processName, muted),
    send_key: (_event, key, targetHint) => ensureApi().sendKey(key, targetHint),
    list_audio_devices: (_event, flow) => ensureApi().listAudioDevices(flow),
    set_default_audio_device: (_event, deviceId, flow) => ensureApi().setDefaultAudioDevice(deviceId, flow),
    launch_app: (_event, filePath) => ensureApi().launchApp(filePath),
    run_user_script: (_event, filePath) => ensureApi().runUserScript(filePath),
    set_process_window_visibility: (_event, processName, visible, executablePath) => (
      ensureApi().setProcessWindowVisibility(processName, visible, executablePath)
    ),
    set_media_option: (_event, command, enabled, targetAppId) => ensureApi().setMediaOption(command, enabled, targetAppId),
    send_media_transport: (_event, command, targetAppId) => ensureApi().sendMediaTransport(command, targetAppId),
    list_media_sessions: () => ensureApi().listMediaSessions(),
    get_media_session_state: (_event, targetAppId) => ensureApi().getMediaSessionState(targetAppId),
    set_media_repeat_mode: (_event, mode, targetAppId) => ensureApi().setMediaRepeatMode(mode, targetAppId),
    save_profile: (_event, name, data) => ensureApi().saveProfile(name, data),
    load_profile: (_event, name) => ensureApi().loadProfile(name),
    list_profiles: () => ensureApi().listProfiles(),
    delete_profile: (_event, name) => ensureApi().deleteProfile(name),
    rename_profile: (_event, fromName, toName) => ensureApi().renameProfile(fromName, toName),
    import_profile: (_event, filePath, options) => ensureApi().importProfile(filePath, options),
    get_profile_template: (_event, options) => ensureApi().getProfileTemplate(options),
    get_profiles_directory: () => ensureApi().getProfilesDirectory(),
    get_application_icons: async (_event, applicationPaths = []) => {
      const icons = {};
      const uniquePaths = Array.isArray(applicationPaths)
        ? [...new Set(applicationPaths.filter((entry) => typeof entry === 'string' && entry.trim()))]
        : [];

      await Promise.all(uniquePaths.map(async (applicationPath) => {
        try {
          const icon = await app.getFileIcon(applicationPath, { size: 'normal' });

          if (icon && !icon.isEmpty()) {
            icons[applicationPath] = icon.toDataURL();
          }
        } catch {
          // Some processes do not expose a retrievable shell icon; skip them silently.
        }
      }));

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
      const normalizedMode = String(mode || 'app').trim().toLowerCase();
      const filters = normalizedMode === 'script'
        ? [
          { name: 'Scripts', extensions: ['ps1', 'cmd', 'bat', 'js', 'cjs', 'mjs', 'vbs', 'wsf'] },
          { name: 'All Files', extensions: ['*'] }
        ]
        : [
          { name: 'Applications', extensions: ['exe', 'lnk', 'cmd', 'bat', 'appref-ms'] },
          { name: 'All Files', extensions: ['*'] }
        ];
      const result = await dialog.showOpenDialog(window, {
        title: normalizedMode === 'script' ? 'Select script' : 'Select application',
        properties: ['openFile'],
        filters
      });

      return {
        success: !result.canceled,
        canceled: result.canceled,
        filePath: result.filePaths?.[0] || null
      };
    },
    toggle_devtools: (event) => toggleDevTools(getEventWindow(event)),
    set_close_to_tray_enabled: (_event, enabled) => setCloseToTrayEnabled(enabled),
    exit_app: () => {
      quitApplication();
    },
    windowControl: (event, action) => handleWindowControl(getEventWindow(event), action)
    }).map(([methodName, handler]) => [methodName, createLoggedInvokeHandler(methodName, handler)])
  ));

  registerIpcSendHandlers(ipcMain, Object.fromEntries(
    Object.entries({
    show_volume_hud: (_event, payload) => {
      void showVolumeHud(payload);
    }
    }).map(([methodName, handler]) => [methodName, createLoggedSendHandler(methodName, handler)])
  ));
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  ensureTray();
  registerIpcHandlers();
  await createMainWindow();
  logger.info('application ready');
}).catch((error) => {
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
  shutdownApi();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});
