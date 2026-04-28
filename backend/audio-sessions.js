const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(__dirname, 'scripts', 'audio-session.ps1');
const WORKER_SCRIPT_PATH = path.join(
  __dirname,
  'scripts',
  'audio-session-worker.ps1'
);
const WORKER_REQUEST_TIMEOUT_MS = 8000;
const SESSION_SNAPSHOT_CACHE_MS = 90;
const SESSION_SNAPSHOT_BACKGROUND_REFRESH_MS = 45;

function parseJsonOutput(stdout) {
  if (!stdout || !stdout.trim()) {
    return null;
  }

  return JSON.parse(stdout);
}

class AudioSessionBridge {
  constructor(logFunction) {
    this._log = logFunction || (() => {});
    this._worker = null;
    this._workerBuffer = '';
    this._requestId = 0;
    this._pendingRequests = new Map();
    this._sessionSnapshot = {
      applications: [],
      fetchedAt: 0,
      refreshPromise: null
    };
  }

  createWorkerError(reason = 'Audio worker unavailable') {
    return reason instanceof Error ? reason : new Error(String(reason));
  }

  rejectPendingRequests(error) {
    const workerError = this.createWorkerError(error);

    for (const pendingRequest of this._pendingRequests.values()) {
      clearTimeout(pendingRequest.timeoutId);
      pendingRequest.reject(workerError);
    }

    this._pendingRequests.clear();
  }

  stopWorker(reason = 'Audio worker stopped') {
    const worker = this._worker;

    if (!worker) {
      return;
    }

    this._worker = null;
    this._workerBuffer = '';
    this.rejectPendingRequests(reason);

    worker.removeAllListeners();
    worker.stdout?.removeAllListeners();
    worker.stderr?.removeAllListeners();

    try {
      if (!worker.killed) {
        worker.kill();
      }
    } catch (error) {
      this._log('audio_session_worker kill error:', error);
    }
  }

  async runWithScript(action, options = {}) {
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

  attachWorkerHandlers(worker) {
    worker.stdout.setEncoding('utf8');
    worker.stderr.setEncoding('utf8');

    worker.stdout.on('data', (chunk) => {
      this._workerBuffer += chunk;

      while (true) {
        const newlineIndex = this._workerBuffer.indexOf('\n');

        if (newlineIndex === -1) {
          break;
        }

        const line = this._workerBuffer.slice(0, newlineIndex).trim();
        this._workerBuffer = this._workerBuffer.slice(newlineIndex + 1);

        if (!line) {
          continue;
        }

        let message;

        try {
          message = JSON.parse(line);
        } catch (error) {
          this._log('audio_session_worker_parse error:', error, line);
          continue;
        }

        const pendingRequest = this._pendingRequests.get(message.id);

        if (!pendingRequest) {
          continue;
        }

        clearTimeout(pendingRequest.timeoutId);
        this._pendingRequests.delete(message.id);

        if (message.success === false) {
          pendingRequest.reject(
            new Error(message.error || 'Audio worker request failed')
          );
          continue;
        }

        pendingRequest.resolve(message.result ?? null);
      }
    });

    worker.stdin.on('error', (error) => {
      this._log('audio_session_worker stdin error:', error);
      this.stopWorker(error);
    });

    worker.stderr.on('data', (chunk) => {
      const text = String(chunk || '').trim();

      if (text) {
        this._log('audio_session_worker stderr:', text);
      }
    });

    worker.on('error', (error) => {
      this._log('audio_session_worker process error:', error);
      this.stopWorker(error);
    });

    worker.on('exit', (code, signal) => {
      const error = new Error(
        `Audio worker exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
      );

      if (this._worker === worker) {
        this.rejectPendingRequests(error);
      }

      this._worker = null;
      this._workerBuffer = '';
    });
  }

  ensureWorker() {
    if (this._worker && !this._worker.killed) {
      return this._worker;
    }

    const worker = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WORKER_SCRIPT_PATH],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );

    this._worker = worker;
    this.attachWorkerHandlers(worker);
    return worker;
  }

  async run(action, options = {}) {
    try {
      const worker = this.ensureWorker();
      const requestId = ++this._requestId;
      const payload = {
        id: requestId,
        action,
        processName: options.processName || '',
        volume: typeof options.volume === 'number' ? options.volume : null,
        mute: typeof options.mute === 'boolean' ? options.mute : null,
        processNames: Array.isArray(options.processNames)
          ? options.processNames
          : []
      };

      const responsePromise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          this.stopWorker(
            new Error(`Audio worker request timeout for action "${action}"`)
          );
        }, WORKER_REQUEST_TIMEOUT_MS);

        this._pendingRequests.set(requestId, { resolve, reject, timeoutId });
      });

      worker.stdin.write(`${JSON.stringify(payload)}\n`, 'utf8');
      return await responsePromise;
    } catch (error) {
      this._log('audio_session_worker error, fallback to execFile:', error);
      return this.runWithScript(action, options);
    }
  }

  filterSessionApplications(applications = [], processNames = []) {
    const normalizedFilters = [
      ...new Set(
        (Array.isArray(processNames) ? processNames : [])
          .map((processName) =>
            String(processName || '')
              .trim()
              .toLowerCase()
          )
          .filter(Boolean)
      )
    ];

    if (!normalizedFilters.length) {
      return Array.isArray(applications) ? applications.slice() : [];
    }

    const filterSet = new Set(normalizedFilters);
    return (Array.isArray(applications) ? applications : []).filter(
      (application) =>
        filterSet.has(
          String(application?.process || '')
            .trim()
            .toLowerCase()
        )
    );
  }

  patchCachedSessionApplications(processName, patch = {}) {
    const normalizedProcessName = String(processName || '')
      .trim()
      .toLowerCase();

    if (
      !normalizedProcessName ||
      !Array.isArray(this._sessionSnapshot.applications)
    ) {
      return;
    }

    this._sessionSnapshot.applications = this._sessionSnapshot.applications.map(
      (application) => {
        if (
          String(application?.process || '')
            .trim()
            .toLowerCase() !== normalizedProcessName
        ) {
          return application;
        }

        return {
          ...application,
          ...patch
        };
      }
    );
  }

  async refreshSessionSnapshot(options = {}) {
    if (!options?.force && this._sessionSnapshot.refreshPromise) {
      return this._sessionSnapshot.refreshPromise;
    }

    this._sessionSnapshot.refreshPromise = this.run('GetSessions', {
      processNames: []
    })
      .then((result) => {
        this._sessionSnapshot.applications = Array.isArray(result?.applications)
          ? result.applications
          : [];
        this._sessionSnapshot.fetchedAt = Date.now();
        return this._sessionSnapshot.applications.slice();
      })
      .finally(() => {
        this._sessionSnapshot.refreshPromise = null;
      });

    return this._sessionSnapshot.refreshPromise;
  }

  async listSessions(processNames = []) {
    try {
      const now = Date.now();
      const hasSnapshot =
        Array.isArray(this._sessionSnapshot.applications) &&
        this._sessionSnapshot.applications.length > 0;
      const snapshotAge = hasSnapshot
        ? now - this._sessionSnapshot.fetchedAt
        : Number.POSITIVE_INFINITY;

      if (hasSnapshot && snapshotAge < SESSION_SNAPSHOT_CACHE_MS) {
        if (snapshotAge >= SESSION_SNAPSHOT_BACKGROUND_REFRESH_MS) {
          void this.refreshSessionSnapshot().catch((error) => {
            this._log('audio_session_background_refresh error:', error);
          });
        }

        return this.filterSessionApplications(
          this._sessionSnapshot.applications,
          processNames
        );
      }

      if (this._sessionSnapshot.refreshPromise && hasSnapshot) {
        return this.filterSessionApplications(
          this._sessionSnapshot.applications,
          processNames
        );
      }

      const applications = await this.refreshSessionSnapshot({ force: true });
      return this.filterSessionApplications(applications, processNames);
    } catch (error) {
      this._log('audio_session_list error:', error);
      return [];
    }
  }

  async setVolume(processName, volume) {
    try {
      const result = await this.run('SetVolume', { processName, volume });
      this.patchCachedSessionApplications(processName, {
        volume: Number.isFinite(Number(volume)) ? Number(volume) : undefined,
        muted: Number(volume) <= 0
      });
      return result;
    } catch (error) {
      this._log('audio_session_set_volume error:', error);
      return null;
    }
  }

  async setMute(processName, mute) {
    try {
      const result = await this.run('SetMute', { processName, mute });
      this.patchCachedSessionApplications(processName, {
        muted: Boolean(mute)
      });
      return result;
    } catch (error) {
      this._log('audio_session_set_mute error:', error);
      return null;
    }
  }

  async prewarm() {
    try {
      await this.refreshSessionSnapshot({ force: true });
    } catch (error) {
      this._log('audio_session_prewarm error:', error);
    }
  }

  shutdown() {
    this.stopWorker('Audio worker shutdown');
  }
}

module.exports = { AudioSessionBridge };
