const IPC_METHODS = Object.freeze({
  get_audio_applications: Object.freeze({
    channel: 'api:get_audio_applications',
    transport: 'invoke'
  }),
  list_running_applications: Object.freeze({
    channel: 'api:list_running_applications',
    transport: 'invoke'
  }),
  get_audio_states: Object.freeze({
    channel: 'api:get_audio_states',
    transport: 'invoke'
  }),
  set_app_volume: Object.freeze({
    channel: 'api:set_app_volume',
    transport: 'invoke'
  }),
  toggle_app_mute: Object.freeze({
    channel: 'api:toggle_app_mute',
    transport: 'invoke'
  }),
  set_app_mute: Object.freeze({
    channel: 'api:set_app_mute',
    transport: 'invoke'
  }),
  send_key: Object.freeze({
    channel: 'api:send_key',
    transport: 'invoke'
  }),
  list_audio_devices: Object.freeze({
    channel: 'api:list_audio_devices',
    transport: 'invoke'
  }),
  set_default_audio_device: Object.freeze({
    channel: 'api:set_default_audio_device',
    transport: 'invoke'
  }),
  launch_app: Object.freeze({
    channel: 'api:launch_app',
    transport: 'invoke'
  }),
  run_user_script: Object.freeze({
    channel: 'api:run_user_script',
    transport: 'invoke'
  }),
  set_process_window_visibility: Object.freeze({
    channel: 'api:set_process_window_visibility',
    transport: 'invoke'
  }),
  set_media_option: Object.freeze({
    channel: 'api:set_media_option',
    transport: 'invoke'
  }),
  send_media_transport: Object.freeze({
    channel: 'api:send_media_transport',
    transport: 'invoke'
  }),
  list_media_sessions: Object.freeze({
    channel: 'api:list_media_sessions',
    transport: 'invoke'
  }),
  get_media_session_state: Object.freeze({
    channel: 'api:get_media_session_state',
    transport: 'invoke'
  }),
  set_media_repeat_mode: Object.freeze({
    channel: 'api:set_media_repeat_mode',
    transport: 'invoke'
  }),
  save_profile: Object.freeze({
    channel: 'api:save_profile',
    transport: 'invoke'
  }),
  load_profile: Object.freeze({
    channel: 'api:load_profile',
    transport: 'invoke'
  }),
  list_profiles: Object.freeze({
    channel: 'api:list_profiles',
    transport: 'invoke'
  }),
  delete_profile: Object.freeze({
    channel: 'api:delete_profile',
    transport: 'invoke'
  }),
  rename_profile: Object.freeze({
    channel: 'api:rename_profile',
    transport: 'invoke'
  }),
  import_profile: Object.freeze({
    channel: 'api:import_profile',
    transport: 'invoke'
  }),
  get_profile_template: Object.freeze({
    channel: 'api:get_profile_template',
    transport: 'invoke'
  }),
  get_profiles_directory: Object.freeze({
    channel: 'api:get_profiles_directory',
    transport: 'invoke'
  }),
  get_application_icons: Object.freeze({
    channel: 'api:get_application_icons',
    transport: 'invoke'
  }),
  open_profiles_folder: Object.freeze({
    channel: 'api:open_profiles_folder',
    transport: 'invoke'
  }),
  show_profile_in_folder: Object.freeze({
    channel: 'api:show_profile_in_folder',
    transport: 'invoke'
  }),
  pick_profile_file: Object.freeze({
    channel: 'api:pick_profile_file',
    transport: 'invoke'
  }),
  pick_action_file: Object.freeze({
    channel: 'api:pick_action_file',
    transport: 'invoke'
  }),
  show_volume_hud: Object.freeze({
    channel: 'api:show_volume_hud',
    transport: 'send'
  }),
  toggle_devtools: Object.freeze({
    channel: 'api:toggle_devtools',
    transport: 'invoke'
  }),
  set_close_to_tray_enabled: Object.freeze({
    channel: 'api:set_close_to_tray_enabled',
    transport: 'invoke'
  }),
  exit_app: Object.freeze({
    channel: 'api:exit_app',
    transport: 'invoke'
  }),
  windowControl: Object.freeze({
    channel: 'window-control',
    transport: 'invoke'
  })
});

const IPC_CHANNELS = Object.freeze(
  Object.fromEntries(
    Object.entries(IPC_METHODS).map(([methodName, descriptor]) => [methodName, descriptor.channel])
  )
);

function buildPreloadApi(transport) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(IPC_METHODS).map(([methodName, descriptor]) => {
        const runner = descriptor.transport === 'send'
          ? transport.send
          : transport.invoke;

        return [
          methodName,
          (...args) => runner(descriptor.channel, ...args)
        ];
      })
    )
  );
}

function registerIpcInvokeHandlers(ipcMain, handlers = {}) {
  Object.entries(IPC_METHODS).forEach(([methodName, descriptor]) => {
    if (descriptor.transport !== 'invoke') {
      return;
    }

    const handler = handlers[methodName];

    if (typeof handler === 'function') {
      ipcMain.handle(descriptor.channel, handler);
    }
  });
}

function registerIpcSendHandlers(ipcMain, handlers = {}) {
  Object.entries(IPC_METHODS).forEach(([methodName, descriptor]) => {
    if (descriptor.transport !== 'send') {
      return;
    }

    const handler = handlers[methodName];

    if (typeof handler === 'function') {
      ipcMain.on(descriptor.channel, handler);
    }
  });
}

module.exports = {
  IPC_METHODS,
  IPC_CHANNELS,
  buildPreloadApi,
  registerIpcInvokeHandlers,
  registerIpcSendHandlers
};
