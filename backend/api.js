const os = require('os');
const path = require('path');

const { AudioManager } = require('./audio');
const { sendKey } = require('./keyboard');
const { createLogger } = require('./logger');
const { ProfileManager } = require('./profiles');

const DEFAULT_PROFILES_PATH = path.join(os.homedir(), '.midi_mixer', 'profiles');

class FaderDeckAPI {
  constructor({ debug = true, profilesPath = DEFAULT_PROFILES_PATH, logger } = {}) {
    this.debugEnabled = debug;
    this.logger = logger || createLogger('api');
    this.log = this.log.bind(this);

    this.profileManager = new ProfileManager(profilesPath, this.log);
    this.audioManager = new AudioManager(this.log);
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
