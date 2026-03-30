const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(__dirname, 'scripts', 'audio-session.ps1');

function parseJsonOutput(stdout) {
  if (!stdout || !stdout.trim()) {
    return null;
  }

  return JSON.parse(stdout);
}

class AudioSessionBridge {
  constructor(logFunction) {
    this._log = logFunction || (() => {});
  }

  async run(action, options = {}) {
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      SCRIPT_PATH,
      '-Action',
      action
    ];

    if (options.processName) {
      args.push('-ProcessName', options.processName);
    }

    if (typeof options.volume === 'number') {
      args.push('-Volume', String(options.volume));
    }

    if (typeof options.mute === 'boolean') {
      args.push('-Mute', options.mute ? 'true' : 'false');
    }

    if (Array.isArray(options.processNames)) {
      args.push('-ProcessNamesJson', JSON.stringify(options.processNames));
    }

    const { stdout } = await execFileAsync('powershell.exe', args, {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });

    return parseJsonOutput(stdout);
  }

  async listSessions(processNames = []) {
    try {
      const result = await this.run('GetSessions', { processNames });
      return Array.isArray(result?.applications) ? result.applications : [];
    } catch (error) {
      this._log('audio_session_list error:', error);
      return [];
    }
  }

  async setVolume(processName, volume) {
    try {
      return await this.run('SetVolume', { processName, volume });
    } catch (error) {
      this._log('audio_session_set_volume error:', error);
      return null;
    }
  }

  async setMute(processName, mute) {
    try {
      return await this.run('SetMute', { processName, mute });
    } catch (error) {
      this._log('audio_session_set_mute error:', error);
      return null;
    }
  }
}

module.exports = { AudioSessionBridge };
