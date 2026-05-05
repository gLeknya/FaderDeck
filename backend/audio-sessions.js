const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(__dirname, 'scripts', 'audio-session.ps1');
const WORKER_SCRIPT_PATH = path.join(
  __dirname,
  'scripts',
  'audio-session-worker.ps1'
);
const SESSION_SNAPSHOT_CACHE_MS = 90;
const SESSION_SNAPSHOT_BACKGROUND_REFRESH_MS = 45;

const { PowerShellServer } = require('./powershell-server');

function parseJsonOutput(stdout) {
  if (!stdout || !stdout.trim()) {
    return null;
  }

  return JSON.parse(stdout);
}

class AudioSessionBridge extends PowerShellServer {
  constructor(logFunction) {
    super({
      log: logFunction || (() => {}),
      scriptPath: WORKER_SCRIPT_PATH,
      spawnArgs: [],
      requestTimeoutMs: 8000,
      responseSuccessKey: 'success',
      logPrefix: 'audio_session_worker',
      buffering: 'manual'
    });

    this._sessionSnapshot = {
      applications: [],
      fetchedAt: 0,
      refreshPromise: null
    };

    this._pendingRequestId = 0;
    this._pendingResolve = null;
    this._pendingReject = null;
    this._pendingTimeoutId = null;
  }

  /** @override — omit null-valued fields to match the worker's expectations */
  _writePayload(_stdin, id, action, options) {
    return {
      id,
      action,
      processName: options.processName || '',
      volume: typeof options.volume === 'number' ? options.volume : null,
      mute: typeof options.mute === 'boolean' ? options.mute : null,
      processNames: Array.isArray(options.processNames) ? options.processNames : []
    };
  }

  /**
   * @override — use 'success' instead of 'ok' for error detection.
   * Falls back to runWithScript when the worker is unavailable.
   */
  _onResponse(pending, parsedMessage) {
    if (parsedMessage?.success !== false) {
      pending.resolve(parsedMessage?.result ?? null);
    } else {
      pending.reject(
        new Error(
          String(parsedMessage?.error || 'Audio worker request failed')
        )
      );
    }
  }

  /** @override — audio-sessions does not pass '-Action serve' */
  _buildSpawnArgs() {
    return ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', this._scriptPath];
  }

  // ─── run() override with runWithScript fallback ──────────────────────────────

  /**
   * @override
   * Sends a request to the worker, falling back to runWithScript on error.
   */
  async run(action, options = {}) {
    try {
      return await super.run(action, options);
    } catch (error) {
      this._log('audio_session_worker error, fallback to execFile:', error);
      return this.runWithScript(action, options);
    }
  }

  // ─── Standalone one-shot script execution ───────────────────────────────────

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

  // ─── Session snapshot caching ─────────────────────────────────────────────

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

  async setVolumeBatch(entries = []) {
    if (!entries.length) {
      return { success: true, updatedCount: 0 };
    }

    try {
      const volumeMap = {};
      entries.forEach(([processName, volume]) => {
        volumeMap[processName] = volume;
      });

      return await this.run('SetVolumeBatch', { volumeMap });
    } catch (error) {
      this._log('audio_session_set_volume_batch error:', error);
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
    this.stopProcess('Audio worker shutdown');
  }
}

module.exports = { AudioSessionBridge };