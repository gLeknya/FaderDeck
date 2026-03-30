const { contextBridge, ipcRenderer } = require('electron');

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

const api = Object.freeze({
  get_audio_applications: () => invoke('api:get_audio_applications'),
  set_app_volume: (processName, volume) => invoke('api:set_app_volume', processName, volume),
  toggle_app_mute: (processName) => invoke('api:toggle_app_mute', processName),

  save_profile: (name, data) => invoke('api:save_profile', name, data),
  load_profile: (name) => invoke('api:load_profile', name),
  list_profiles: () => invoke('api:list_profiles'),
  delete_profile: (name) => invoke('api:delete_profile', name),

  toggle_devtools: () => invoke('api:toggle_devtools'),
  exit_app: () => invoke('api:exit_app'),
  windowControl: (action) => invoke('window-control', action)
});

contextBridge.exposeInMainWorld('pywebview', { api });
