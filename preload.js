const { contextBridge, ipcRenderer } = require('electron');

const WINDOW_CONTROL_CHANNEL = 'window-control';

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

const api = Object.freeze({
  get_audio_applications: () => invoke('api:get_audio_applications'),
  list_running_applications: () => invoke('api:list_running_applications'),
  get_audio_states: (processNames) => invoke('api:get_audio_states', processNames),
  set_app_volume: (processName, volume) => invoke('api:set_app_volume', processName, volume),
  toggle_app_mute: (processName) => invoke('api:toggle_app_mute', processName),
  save_profile: (name, data) => invoke('api:save_profile', name, data),
  load_profile: (name) => invoke('api:load_profile', name),
  list_profiles: () => invoke('api:list_profiles'),
  delete_profile: (name) => invoke('api:delete_profile', name),
  rename_profile: (fromName, toName) => invoke('api:rename_profile', fromName, toName),
  import_profile: (filePath, options) => invoke('api:import_profile', filePath, options),
  get_profile_template: (options) => invoke('api:get_profile_template', options),
  get_profiles_directory: () => invoke('api:get_profiles_directory'),
  get_application_icons: (applicationPaths) => invoke('api:get_application_icons', applicationPaths),
  open_profiles_folder: () => invoke('api:open_profiles_folder'),
  show_profile_in_folder: (profilePath) => invoke('api:show_profile_in_folder', profilePath),
  pick_profile_file: () => invoke('api:pick_profile_file'),
  toggle_devtools: () => invoke('api:toggle_devtools'),
  exit_app: () => invoke('api:exit_app'),
  windowControl: (action) => invoke(WINDOW_CONTROL_CHANNEL, action)
});

const legacyPywebviewBridge = Object.freeze({ api });

contextBridge.exposeInMainWorld('faderDeck', api);
contextBridge.exposeInMainWorld('pywebview', legacyPywebviewBridge);
