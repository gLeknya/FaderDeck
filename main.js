const { app, BrowserWindow, ipcMain, Menu, dialog, shell, screen } = require('electron');
const path = require('path');

const { FaderDeckAPI } = require('./backend/api');

const WINDOW_CONTROL_CHANNEL = 'window-control';
const SHOW_VOLUME_HUD_CHANNEL = 'api:show_volume_hud';
const VOLUME_HUD_UPDATE_CHANNEL = 'volume-hud:update';
const VOLUME_HUD_VISIBILITY_CHANNEL = 'volume-hud:visibility';
const VOLUME_HUD_HIDE_DELAY_MS = 1350;
const VOLUME_HUD_HIDE_ANIMATION_MS = 180;
const VOLUME_HUD_WINDOW_WIDTH = 320;
const VOLUME_HUD_WINDOW_HEIGHT = 132;
const WINDOW_OPTIONS = {
  width: 1400,
  height: 760,
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
    nodeIntegration: false
  }
};

let mainWindow = null;
let volumeHudWindow = null;
let volumeHudReadyPromise = null;
let volumeHudHideTimer = null;
let volumeHudHideCommitTimer = null;
let api = null;

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

  api.shutdown();
  api = null;
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
  return {
    channelId: Number.parseInt(payload?.channelId, 10) || null,
    title: String(payload?.title || '').trim().slice(0, 120),
    subtitle: String(payload?.subtitle || '').trim().slice(0, 160),
    valueText: String(payload?.valueText || '').trim().slice(0, 32),
    iconDataUrl: typeof payload?.iconDataUrl === 'string' ? payload.iconDataUrl : '',
    source: String(payload?.source || '').trim(),
    volume: Math.max(0, Math.min(100, Number(payload?.volume) || 0))
  };
}

function getVolumeHudBounds() {
  const fallbackDisplay = screen.getPrimaryDisplay();
  const referenceDisplay = (
    mainWindow && !mainWindow.isDestroyed()
      ? screen.getDisplayMatching(mainWindow.getBounds())
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  ) || fallbackDisplay;
  const workArea = referenceDisplay.workArea;

  return {
    width: VOLUME_HUD_WINDOW_WIDTH,
    height: VOLUME_HUD_WINDOW_HEIGHT,
    x: Math.round(workArea.x + ((workArea.width - VOLUME_HUD_WINDOW_WIDTH) / 2)),
    y: Math.round(workArea.y + workArea.height - VOLUME_HUD_WINDOW_HEIGHT - 52)
  };
}

function createVolumeHudWindow() {
  if (volumeHudWindow && !volumeHudWindow.isDestroyed()) {
    return volumeHudWindow;
  }

  volumeHudWindow = new BrowserWindow({
    width: VOLUME_HUD_WINDOW_WIDTH,
    height: VOLUME_HUD_WINDOW_HEIGHT,
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

  if (!normalizedPayload.title && !normalizedPayload.valueText) {
    return { success: false };
  }

  const window = await ensureVolumeHudWindow();

  if (!window || window.isDestroyed()) {
    return { success: false };
  }

  clearVolumeHudTimers();
  window.setBounds(getVolumeHudBounds(), false);
  window.webContents.send(VOLUME_HUD_UPDATE_CHANNEL, normalizedPayload);

  if (!window.isVisible()) {
    window.showInactive();
  }

  window.webContents.send(VOLUME_HUD_VISIBILITY_CHANNEL, { visible: true });
  scheduleVolumeHudHide();

  return { success: true };
}

function createMainWindow() {
  ensureApi();

  mainWindow = new BrowserWindow(WINDOW_OPTIONS);
  mainWindow.loadFile(path.join(__dirname, 'web', 'index.html'));

  mainWindow.on('closed', () => {
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
  const handlers = {
    'api:get_audio_applications': () => ensureApi().getAudioApplications(),
    'api:list_running_applications': () => ensureApi().listRunningApplications(),
    'api:get_audio_states': (_event, processNames) => ensureApi().getAudioStates(processNames),
    'api:set_app_volume': (_event, processName, volume) => ensureApi().setAppVolume(processName, volume),
    'api:toggle_app_mute': (_event, processName) => ensureApi().toggleAppMute(processName),
    'api:save_profile': (_event, name, data) => ensureApi().saveProfile(name, data),
    'api:load_profile': (_event, name) => ensureApi().loadProfile(name),
    'api:list_profiles': () => ensureApi().listProfiles(),
    'api:delete_profile': (_event, name) => ensureApi().deleteProfile(name),
    'api:rename_profile': (_event, fromName, toName) => ensureApi().renameProfile(fromName, toName),
    'api:import_profile': (_event, filePath, options) => ensureApi().importProfile(filePath, options),
    'api:get_profile_template': (_event, options) => ensureApi().getProfileTemplate(options),
    'api:get_profiles_directory': () => ensureApi().getProfilesDirectory(),
    'api:get_application_icons': async (_event, applicationPaths = []) => {
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
        } catch (_error) {
          // Some processes do not expose a retrievable shell icon; skip them silently.
        }
      }));

      return {
        success: true,
        icons
      };
    },
    'api:open_profiles_folder': async () => {
      const { path: profilesPath } = ensureApi().getProfilesDirectory();
      await shell.openPath(profilesPath);
      return { success: true, path: profilesPath };
    },
    'api:show_profile_in_folder': async (_event, profilePath) => {
      if (profilePath) {
        shell.showItemInFolder(profilePath);
      }
      return { success: true };
    },
    'api:pick_profile_file': async (event) => {
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
    'api:toggle_devtools': (event) => toggleDevTools(getEventWindow(event)),
    'api:exit_app': () => {
      mainWindow?.close();
    },
    [WINDOW_CONTROL_CHANNEL]: (event, action) => handleWindowControl(getEventWindow(event), action)
  };

  Object.entries(handlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, handler);
  });

  ipcMain.on(SHOW_VOLUME_HUD_CHANNEL, (_event, payload) => {
    void showVolumeHud(payload);
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpcHandlers();
  createMainWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on('window-all-closed', () => {
  destroyVolumeHudWindow();
  shutdownApi();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
