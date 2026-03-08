// backend/api.js
const path = require('path');
const os = require('os');

const { AudioManager } = require('./audio');
const { ProfileManager } = require('./profiles');

class MidiMixerAPI {
  constructor() {
    this.debug_log = true;
    this._log = this._log.bind(this);

    const profilesPath = path.join(os.homedir(), '.midi_mixer', 'profiles');
    this.profile_mgr = new ProfileManager(profilesPath, this._log);
    this.audio_mgr = new AudioManager(this._log);
  }

  _log(...args) {
    if (this.debug_log) {
      console.log('[FaderDeck]', ...args);
    }
  }

  // Audio
  get_audio_applications() {
    return this.audio_mgr.list_applications();
  }

  set_app_volume(process_name, volume) {
    return this.audio_mgr.set_volume(process_name, volume);
  }

  toggle_app_mute(process_name) {
    return this.audio_mgr.toggle_mute(process_name);
  }

  // Profiles
  save_profile(name, data) {
    return this.profile_mgr.save(name, data);
  }

  load_profile(name) {
    return this.profile_mgr.load(name);
  }

  list_profiles() {
    return this.profile_mgr.list_profiles();
  }

  delete_profile(name) {
    return this.profile_mgr.delete(name);
  }

  shutdown() {
    // пока ничего
  }
}

module.exports = { MidiMixerAPI };
