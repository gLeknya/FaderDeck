const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(__dirname, 'scripts', 'audio-device.ps1');

function normalizeFlow(flow = '') {
  const normalized = String(flow || '').trim().toLowerCase();

  if (normalized === 'output' || normalized === 'render') {
    return 'output';
  }

  if (normalized === 'input' || normalized === 'capture') {
    return 'input';
  }

  return 'all';
}

class AudioDeviceManager {
  constructor(logFunction) {
    this._log = logFunction || (() => {});
  }

  async listDevices(flow = 'all') {
    const normalizedFlow = normalizeFlow(flow);
    this._log('list_audio_devices', normalizedFlow);

    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        SCRIPT_PATH,
        '-Action',
        'list',
        '-Flow',
        normalizedFlow
      ],
      {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf8'
      }
    );

    const parsed = JSON.parse(String(stdout || '[]').trim() || '[]');
    const devices = Array.isArray(parsed) ? parsed : [parsed];

    return {
      success: true,
      flow: normalizedFlow,
      devices
    };
  }

  async setDefaultDevice(deviceId = '', flow = 'all') {
    const normalizedDeviceId = String(deviceId || '').trim();
    const normalizedFlow = normalizeFlow(flow);

    if (!normalizedDeviceId) {
      return {
        success: false,
        error: 'missing-device-id'
      };
    }

    this._log('set_default_audio_device', normalizedFlow, normalizedDeviceId);

    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        SCRIPT_PATH,
        '-Action',
        'set-default',
        '-Flow',
        normalizedFlow,
        '-DeviceId',
        normalizedDeviceId
      ],
      {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf8'
      }
    );

    return JSON.parse(String(stdout || '{}').trim() || '{}');
  }
}

module.exports = {
  AudioDeviceManager
};
