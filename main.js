const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const path = require('path');

const { FaderDeckAPI } = require('./backend/api');

const WINDOW_CONTROL_CHANNEL = 'window-control';
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

function createMainWindow() {
  ensureApi();

  mainWindow = new BrowserWindow(WINDOW_OPTIONS);
  mainWindow.loadFile(path.join(__dirname, 'web', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
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
  shutdownApi();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
