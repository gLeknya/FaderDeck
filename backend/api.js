const fs = require('fs');
const os = require('os');
const path = require('path');

const { AudioManager } = require('./audio');
const { AudioDeviceManager } = require('./audio-devices');
const { MediaControlManager } = require('./media-control');
const { sendKey } = require('./keyboard');
const { createLogger } = require('./logger');
const { ProcessCatalog } = require('./processes');
const { ProfileManager } = require('./profiles');
const { SystemActionManager } = require('./system-actions');

const STORAGE_ROOT_DIR_NAME = '.faderdeck';
const LEGACY_STORAGE_ROOT_DIR_NAME = '.midi_mixer';
const DEFAULT_STORAGE_ROOT = path.join(os.homedir(), STORAGE_ROOT_DIR_NAME);
const LEGACY_STORAGE_ROOT = path.join(os.homedir(), LEGACY_STORAGE_ROOT_DIR_NAME);
const DEFAULT_PROFILES_PATH = path.join(DEFAULT_STORAGE_ROOT, 'profiles');

function migrateLegacyStorageRoot(log = () => {}) {
  if (!fs.existsSync(LEGACY_STORAGE_ROOT) || fs.existsSync(DEFAULT_STORAGE_ROOT)) {
    return;
  }

  try {
    fs.renameSync(LEGACY_STORAGE_ROOT, DEFAULT_STORAGE_ROOT);
    log('migrate_storage_root', LEGACY_STORAGE_ROOT, '->', DEFAULT_STORAGE_ROOT);
  } catch (error) {
    log('migrate_storage_root error:', error);
  }
}

class FaderDeckAPI {
  constructor({ debug = true, profilesPath = DEFAULT_PROFILES_PATH, logger } = {}) {
    this.debugEnabled = debug;
    this.logger = logger || createLogger('api');
    this.log = this.log.bind(this);

    if (profilesPath === DEFAULT_PROFILES_PATH) {
      migrateLegacyStorageRoot(this.log);
    }

    this.profileManager = new ProfileManager(profilesPath, this.log);
    this.audioManager = new AudioManager(this.log);
    this.audioDeviceManager = new AudioDeviceManager(this.log);
    this.processCatalog = new ProcessCatalog(this.log);
    this.systemActionManager = new SystemActionManager(this.log);
    this.mediaControlManager = new MediaControlManager(this.log);
    void this.processCatalog.prewarm?.();
  }

  log(...args) {
    if (this.debugEnabled) {
      this.logger.info(...args);
    }
  }

  getAudioApplications() {
    return this.audioManager.listApplications();
  }

  listRunningApplications() {
    return this.audioManager.getApplicationCatalog();
  }

  getAudioStates(processNames) {
    return this.audioManager.getAudioStates(processNames);
  }

  setAppVolume(processName, volume) {
    return this.audioManager.setVolume(processName, volume);
  }

  toggleAppMute(processName) {
    return this.audioManager.toggleMute(processName);
  }

  setAppMute(processName, muted) {
    return this.audioManager.setMute(processName, muted);
  }

  sendKey(key, targetHint = '') {
    return sendKey(key, targetHint);
  }

  listAudioDevices(flow = 'all') {
    return this.audioDeviceManager.listDevices(flow);
  }

  setDefaultAudioDevice(deviceId, flow = 'all') {
    return this.audioDeviceManager.setDefaultDevice(deviceId, flow);
  }

  setAudioDeviceVolume(deviceId, volume, flow = 'all') {
    return this.audioDeviceManager.setVolume(deviceId, volume, flow);
  }

  setAudioDeviceMute(deviceId, muted, flow = 'all') {
    return this.audioDeviceManager.setMute(deviceId, muted, flow);
  }

  getFocusedApplication() {
    return this.processCatalog.getFocusedApplication();
  }

  launchApp(filePath) {
    return this.systemActionManager.launchApplication(filePath);
  }

  runUserScript(filePath) {
    return this.systemActionManager.runUserScript(filePath);
  }

  setProcessWindowVisibility(processName, visible = null, executablePath = '') {
    return this.systemActionManager.setProcessWindowVisibility(processName, visible, executablePath);
  }

  setMediaOption(command, enabled = true, targetAppId = '') {
    return this.mediaControlManager.setMediaOption(command, enabled, targetAppId);
  }

  sendMediaTransport(command, targetAppId = '') {
    return this.mediaControlManager.sendMediaTransportCommand(command, targetAppId);
  }

  getMediaSessionState(targetAppId = '') {
    return this.mediaControlManager.getMediaSessionState(targetAppId);
  }

  setMediaRepeatMode(mode = 'off', targetAppId = '') {
    return this.mediaControlManager.setMediaRepeatMode(mode, targetAppId);
  }

  listMediaSessions() {
    return this.mediaControlManager.listMediaSessions();
  }

  saveProfile(name, data) {
    return this.profileManager.save(name, data);
  }

  loadProfile(name) {
    return this.profileManager.load(name);
  }

  listProfiles() {
    return this.profileManager.listProfiles();
  }

  deleteProfile(name) {
    return this.profileManager.deleteProfile(name);
  }

  renameProfile(fromName, toName) {
    return this.profileManager.renameProfile(fromName, toName);
  }

  importProfile(filePath, options) {
    return this.profileManager.importProfile(filePath, options);
  }

  getProfileTemplate(options) {
    return {
      success: true,
      profile: this.profileManager.getProfileTemplate(options)
    };
  }

  getProfilesDirectory() {
    return {
      success: true,
      path: this.profileManager.getProfilesDirectory()
    };
  }

  shutdown() {
    this.logger.info('shutdown');
    this.audioManager.shutdown();
    this.processCatalog.shutdown?.();
  }

  get_audio_applications() {
    return this.getAudioApplications();
  }

  set_app_volume(processName, volume) {
    return this.setAppVolume(processName, volume);
  }

  list_running_applications() {
    return this.listRunningApplications();
  }

  get_audio_states(processNames) {
    return this.getAudioStates(processNames);
  }

  toggle_app_mute(processName) {
    return this.toggleAppMute(processName);
  }

  set_app_mute(processName, muted) {
    return this.setAppMute(processName, muted);
  }

  send_key(key, targetHint = '') {
    return this.sendKey(key, targetHint);
  }

  list_audio_devices(flow = 'all') {
    return this.listAudioDevices(flow);
  }

  set_default_audio_device(deviceId, flow = 'all') {
    return this.setDefaultAudioDevice(deviceId, flow);
  }

  set_audio_device_volume(deviceId, volume, flow = 'all') {
    return this.setAudioDeviceVolume(deviceId, volume, flow);
  }

  set_audio_device_mute(deviceId, muted, flow = 'all') {
    return this.setAudioDeviceMute(deviceId, muted, flow);
  }

  get_focused_application() {
    return this.getFocusedApplication();
  }

  launch_app(filePath) {
    return this.launchApp(filePath);
  }

  run_user_script(filePath) {
    return this.runUserScript(filePath);
  }

  set_process_window_visibility(processName, visible = null, executablePath = '') {
    return this.setProcessWindowVisibility(processName, visible, executablePath);
  }

  set_media_option(command, enabled = true, targetAppId = '') {
    return this.mediaControlManager.setMediaOption(command, enabled, targetAppId);
  }

  send_media_transport(command, targetAppId = '') {
    return this.mediaControlManager.sendMediaTransportCommand(command, targetAppId);
  }

  get_media_session_state(targetAppId = '') {
    return this.mediaControlManager.getMediaSessionState(targetAppId);
  }

  set_media_repeat_mode(mode = 'off', targetAppId = '') {
    return this.mediaControlManager.setMediaRepeatMode(mode, targetAppId);
  }

  list_media_sessions() {
    return this.listMediaSessions();
  }

  save_profile(name, data) {
    return this.saveProfile(name, data);
  }

  load_profile(name) {
    return this.loadProfile(name);
  }

  list_profiles() {
    return this.listProfiles();
  }

  delete_profile(name) {
    return this.deleteProfile(name);
  }

  rename_profile(fromName, toName) {
    return this.renameProfile(fromName, toName);
  }

  import_profile(filePath, options) {
    return this.importProfile(filePath, options);
  }

  get_profile_template(options) {
    return this.getProfileTemplate(options);
  }

  get_profiles_directory() {
    return this.getProfilesDirectory();
  }
}

module.exports = {
  FaderDeckAPI,
  MidiMixerAPI: FaderDeckAPI
};
