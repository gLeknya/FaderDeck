const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');

const { MidiMixerAPI } = require('./backend/api');

let mainWindow = null;
let api = null;

function ensureApi() {
  if (!api) {
    api = new MidiMixerAPI();
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

function createWindow() {
  ensureApi();

  mainWindow = new BrowserWindow({
    width: 1300,
    height: 800,
    minWidth: 800,
    minHeight: 600,
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
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'web', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    shutdownApi();
  });
}

function registerIpcHandlers() {
  ipcMain.handle('api:get_audio_applications', () => ensureApi().get_audio_applications());
  ipcMain.handle('api:set_app_volume', (_event, processName, volume) => (
    ensureApi().set_app_volume(processName, volume)
  ));
  ipcMain.handle('api:toggle_app_mute', (_event, processName) => (
    ensureApi().toggle_app_mute(processName)
  ));

  ipcMain.handle('api:save_profile', (_event, name, data) => ensureApi().save_profile(name, data));
  ipcMain.handle('api:load_profile', (_event, name) => ensureApi().load_profile(name));
  ipcMain.handle('api:list_profiles', () => ensureApi().list_profiles());
  ipcMain.handle('api:delete_profile', (_event, name) => ensureApi().delete_profile(name));

  ipcMain.handle('api:exit_app', () => {
    mainWindow?.close();
  });

  ipcMain.handle('window-control', (event, action) => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (!window) {
      return;
    }

    if (action === 'minimize') {
      window.minimize();
      return;
    }

    if (action === 'maximize') {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
      return;
    }

    if (action === 'close') {
      window.close();
    }
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  shutdownApi();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
