// backend/audio.js

class AudioManager {
  constructor(log_func) {
    this._log = log_func || (() => {});
    this._masterVolume = 100;
    this._muted = false;
  }

  list_applications() {
    // Пока возвращаем только master + фиктивные приложения
    const apps = [
      {
        name: 'System volume',
        process: 'master',
        volume: this._muted ? 0 : this._masterVolume,
        muted: this._muted
      },
      {
        name: 'Chrome',
        process: 'chrome.exe',
        volume: 100,
        muted: false
      },
      {
        name: 'Spotify',
        process: 'spotify.exe',
        volume: 100,
        muted: false
      },
      {
        name: 'Discord',
        process: 'discord.exe',
        volume: 100,
        muted: false
      },
      {
        name: 'OBS Studio',
        process: 'obs64.exe',
        volume: 100,
        muted: false
      },
      {
        name: 'VLC',
        process: 'vlc.exe',
        volume: 100,
        muted: false
      }
    ];

    return { applications: apps };
  }

  set_volume(process_name, volume) {
    // Реально ничего не трогаем, только логируем
    this._log('set_volume', process_name, volume);
    if (process_name === 'master') {
      this._masterVolume = Math.max(0, Math.min(100, volume));
      if (this._masterVolume === 0) this._muted = true;
      else this._muted = false;
    }
    return { success: true, volume };
  }

  toggle_mute(process_name) {
    this._log('toggle_mute', process_name);
    if (process_name === 'master') {
      this._muted = !this._muted;
    }
    return { success: true, muted: this._muted };
  }
}

module.exports = { AudioManager };
