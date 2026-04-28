const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const SCRIPT_PATH = path.join(__dirname, 'scripts', 'audio-device.ps1');
const SERVER_REQUEST_TIMEOUT_MS = 8000;

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
    this._serverProcess = null;
    this._serverReadline = null;
    this._serverRequestId = 0;
    this._serverPending = new Map();
  }

  _resetServerState(error = null) {
    if (this._serverReadline) {
      this._serverReadline.removeAllListeners();
      this._serverReadline.close();
      this._serverReadline = null;
    }

    if (this._serverProcess) {
      this._serverProcess.removeAllListeners();
      this._serverProcess = null;
    }

    const pendingEntries = Array.from(this._serverPending.values());
    this._serverPending.clear();
    pendingEntries.forEach((entry) => {
      if (entry?.timeoutId) {
        clearTimeout(entry.timeoutId);
      }

      entry?.reject?.(error || new Error('audio-device-server-closed'));
    });
  }

  _ensureServerProcess() {
    if (this._serverProcess && !this._serverProcess.killed) {
      return this._serverProcess;
    }

    const serverProcess = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        SCRIPT_PATH,
        '-Action',
        'serve'
      ],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );

    serverProcess.stdout.setEncoding('utf8');
    serverProcess.stderr.setEncoding('utf8');

    const rl = readline.createInterface({
      input: serverProcess.stdout,
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      const normalizedLine = String(line || '').trim();

      if (!normalizedLine) {
        return;
      }

      let parsedMessage;
      try {
        parsedMessage = JSON.parse(normalizedLine);
      } catch (error) {
        this._log('audio-device-server parse error', error, normalizedLine);
        return;
      }

      const requestId = String(parsedMessage?.id || '').trim();
      const pending = this._serverPending.get(requestId);

      if (!pending) {
        return;
      }

      this._serverPending.delete(requestId);

      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }

      if (parsedMessage?.ok === false) {
        pending.reject(new Error(String(parsedMessage?.error || 'audio-device-server-error')));
        return;
      }

      pending.resolve(parsedMessage?.result);
    });

    serverProcess.stderr.on('data', (chunk) => {
      const message = String(chunk || '').trim();

      if (message) {
        this._log('audio-device-server stderr', message);
      }
    });

    serverProcess.on('error', (error) => {
      this._log('audio-device-server error', error);
      this._resetServerState(error);
    });

    serverProcess.on('exit', (code, signal) => {
      const exitError = new Error(`audio-device-server-exit:${code ?? 'null'}:${signal ?? 'null'}`);
      this._log('audio-device-server exit', { code, signal });
      this._resetServerState(exitError);
    });

    this._serverProcess = serverProcess;
    this._serverReadline = rl;
    return serverProcess;
  }

  async _sendServerCommand(payload = {}) {
    const serverProcess = this._ensureServerProcess();
    const requestId = String(++this._serverRequestId);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this._serverPending.delete(requestId);
        reject(new Error(`audio-device-server-timeout:${payload?.action || 'unknown'}`));
      }, SERVER_REQUEST_TIMEOUT_MS);

      this._serverPending.set(requestId, {
        resolve,
        reject,
        timeoutId
      });

      try {
        serverProcess.stdin.write(`${JSON.stringify({ id: requestId, ...payload })}\n`);
      } catch (error) {
        clearTimeout(timeoutId);
        this._serverPending.delete(requestId);
        reject(error);
      }
    });
  }

  async listDevices(flow = 'all') {
    const normalizedFlow = normalizeFlow(flow);
    const parsed = await this._sendServerCommand({
      action: 'list',
      flow: normalizedFlow
    });
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
    return await this._sendServerCommand({
      action: 'set-default',
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

    this._log('set_audio_device_volume', normalizedFlow, normalizedDeviceId, volume);
    return await this._sendServerCommand({
      action: 'set-volume',
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

    this._log('set_audio_device_mute', normalizedFlow, normalizedDeviceId, muted);
    return await this._sendServerCommand({
      action: 'set-mute',
      flow: normalizedFlow,
      deviceId: normalizedDeviceId,
      muted: Boolean(muted)
    });
  }
}

module.exports = {
  AudioDeviceManager
};
