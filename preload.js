// preload.js
const { contextBridge, ipcRenderer } = require('electron');

const api = {
  // Audio
  get_audio_applications: () => ipcRenderer.invoke('api:get_audio_applications'),
  set_app_volume: (process, volume) =>
    ipcRenderer.invoke('api:set_app_volume', process, volume),
  toggle_app_mute: (process) =>
    ipcRenderer.invoke('api:toggle_app_mute', process),

  // Profiles
  save_profile: (name, data) => ipcRenderer.invoke('api:save_profile', name, data),
  load_profile: (name) => ipcRenderer.invoke('api:load_profile', name),
  list_profiles: () => ipcRenderer.invoke('api:list_profiles'),
  delete_profile: (name) => ipcRenderer.invoke('api:delete_profile', name),

  // Exit
  exit_app: () => ipcRenderer.invoke('api:exit_app'),
  windowControl: (action) => ipcRenderer.invoke('window-control', action)
};

// Эмуляция pywebview: window.pywebview.api
contextBridge.exposeInMainWorld('pywebview', { api });
