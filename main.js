// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const { MidiMixerAPI } = require('./backend/api');

let mainWindow = null;
let api = null;

function createWindow() {
  api = new MidiMixerAPI();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    resizable: true,
    icon: path.join(__dirname, 'assets', 'favicon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'web', 'index.html'));

  mainWindow.on('closed', () => {
    api.shutdown();
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  api.shutdown();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ---- IPC API (аналог Python MidiMixerAPI) ----

// Audio
ipcMain.handle('api:get_audio_applications', () => api.get_audio_applications());
ipcMain.handle('api:set_app_volume', (e, proc, vol) => api.set_app_volume(proc, vol));
ipcMain.handle('api:toggle_app_mute', (e, proc) => api.toggle_app_mute(proc));

// Profiles
ipcMain.handle('api:save_profile', (e, name, data) => api.save_profile(name, data));
ipcMain.handle('api:load_profile', (e, name) => api.load_profile(name));
ipcMain.handle('api:list_profiles', () => api.list_profiles());
ipcMain.handle('api:delete_profile', (e, name) => api.delete_profile(name));

// Misc
ipcMain.handle('api:exit_app', () => {
  if (mainWindow) mainWindow.close();
});
