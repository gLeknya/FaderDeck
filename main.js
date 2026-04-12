const { app, BrowserWindow, ipcMain, Menu, dialog, shell, screen } = require('electron');
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
    sandbox: false
  }
};

let mainWindow = null;
let volumeHudWindow = null;
let volumeHudReadyPromise = null;
let volumeHudHideTimer = null;
let volumeHudHideCommitTimer = null;
let mainWindowStateSaveTimer = null;
let api = null;
const logger = createLogger('main');

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

  const windowState = await resolveMainWindowState();

  mainWindow = new BrowserWindow(buildMainWindowOptions(windowState));
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
    return { success: true, isOpen: false };
  }

  window.webContents.openDevTools({ mode: 'detach' });
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
  registerIpcInvokeHandlers(ipcMain, {
    get_audio_applications: () => ensureApi().getAudioApplications(),
    list_running_applications: () => ensureApi().listRunningApplications(),
    get_audio_states: (_event, processNames) => ensureApi().getAudioStates(processNames),
    set_app_volume: (_event, processName, volume) => ensureApi().setAppVolume(processName, volume),
    toggle_app_mute: (_event, processName) => ensureApi().toggleAppMute(processName),
    set_app_mute: (_event, processName, muted) => ensureApi().setAppMute(processName, muted),
    send_key: (_event, key, targetHint) => ensureApi().sendKey(key, targetHint),
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
    toggle_devtools: (event) => toggleDevTools(getEventWindow(event)),
    exit_app: () => {
      mainWindow?.close();
    },
    windowControl: (event, action) => handleWindowControl(getEventWindow(event), action)
  });

  registerIpcSendHandlers(ipcMain, {
    show_volume_hud: (_event, payload) => {
      void showVolumeHud(payload);
    }
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
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
