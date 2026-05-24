const path = require('path');

// Handle asar unpacking in production
function getScriptPath(scriptName) {
  const basePath = path.join(__dirname, 'scripts', scriptName);
  
  // Check if we're in asar
  if (basePath.includes('app.asar')) {
    // Use unpacked path
    return basePath.replace('app.asar', 'app.asar.unpacked');
  }
  
  return basePath;
}

const SCRIPT_PATH = getScriptPath('audio-device.ps1');
const { PowerShellServer } = require('./powershell-server');

function normalizeFlow(flow = '') {
  const normalized = String(flow || '')
    .trim()
    .toLowerCase();

  if (normalized === 'output' || normalized === 'render') {
    return 'output';
  }

  if (normalized === 'input' || normalized === 'capture') {
    return 'input';
  }

  return 'all';
}

class AudioDeviceManager extends PowerShellServer {
  constructor(logFunction) {
    super({
      log: logFunction || (() => {}),
      scriptPath: SCRIPT_PATH,
      spawnArgs: ['-Action', 'serve'],
      requestTimeoutMs: 8000,
      responseSuccessKey: 'ok',
      logPrefix: 'audio-device-server',
      buffering: 'readline'
    });
  }

  async listDevices(flow = 'all') {
    const normalizedFlow = normalizeFlow(flow);
    const parsed = await this.run('list', { flow: normalizedFlow });
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
    return await this.run('set-default', {
      flow: normalizedFlow,
      deviceId: normalizedDeviceId
    });
  }

  async setVolume(deviceId = '', volume = 100, flow = 'all') {
    const normalizedDeviceId = String(deviceId || '').trim();
    const normalizedFlow = normalizeFlow(flow);

    if (!normalizedDeviceId) {
      return {
        success: false,
        error: 'missing-device-id'
      };
    }

    this._log(
      'set_audio_device_volume',
      normalizedFlow,
      normalizedDeviceId,
      volume
    );
    return await this.run('set-volume', {
      flow: normalizedFlow,
      deviceId: normalizedDeviceId,
      volume: Number(volume)
    });
  }

  async setMute(deviceId = '', muted = false, flow = 'all') {
    const normalizedDeviceId = String(deviceId || '').trim();
    const normalizedFlow = normalizeFlow(flow);

    if (!normalizedDeviceId) {
      return {
        success: false,
        error: 'missing-device-id'
      };
    }

    this._log(
      'set_audio_device_mute',
      normalizedFlow,
      normalizedDeviceId,
      muted
    );
    return await this.run('set-mute', {
      flow: normalizedFlow,
      deviceId: normalizedDeviceId,
      muted: Boolean(muted)
    });
  }
}

module.exports = {
  AudioDeviceManager
};