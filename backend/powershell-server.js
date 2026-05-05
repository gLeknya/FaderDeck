/**
 * PowerShellServer — shared lifecycle management for long-running PowerShell
 * worker processes that speak JSON over stdin/stdout.
 *
 * Subclasses (AudioDeviceManager, ProcessCatalog, AudioSessionBridge) all follow
 * the same pattern: lazy spawn, JSON request/response over readline (or manual
 * buffer), timeout, crash recovery.  This class extracts that wiring so it lives
 * in one place.
 */

const { spawn } = require('child_process');
const readline = require('readline');

const DEFAULT_REQUEST_TIMEOUT_MS = 8000;

/**
 * @typedef {Object}  PowerShellServerOptions
 * @property {Function}           log                        Logging function (level, ...args).
 * @property {string}             scriptPath                 Absolute path to the .ps1 worker script.
 * @property {string[]}          [spawnArgs=[]]             Extra args appended after the script path.
 *                                                         audio-sessions passes [] here; audio-devices
 *                                                         and processes pass ['-Action','serve'].
 * @property {number}             [requestTimeoutMs]         Timeout for each request (default 8000).
 * @property {'ok'|'success'}     [responseSuccessKey]       Which field on the parsed JSON marks a
 *                                                         successful response.  Default 'ok'.
 * @property {string}             [logPrefix]                Prepended to all log output.
 * @property {'readline'|'manual'}[buffering]                How to collect lines from stdout.
 *                                                         Default 'readline'.  audio-sessions uses
 *                                                         'manual' because it needs to handle binary
 *                                                         output.
 * @property {Function}           [fallbackRun]               Optional async fn (action, payload) used as
 *                                                         a fallback when the server process is
 *                                                         unavailable.  audio-sessions passes
 *                                                         runWithScript here.
 */

/**
 * @typedef {Object}  PendingRequest
 * @property {Function} resolve   Promise resolve callback.
 * @property {Function} reject    Promise reject callback.
 * @property {number}  timeoutId  Node.js timeout handle — cleared on response or reset.
 */

class PowerShellServer {
  /**
   * @param {PowerShellServerOptions} options
   */
  constructor(options) {
    if (!options?.scriptPath) {
      throw new Error('PowerShellServer: scriptPath is required');
    }

    /** @type {Function} */
    this._log = options.log || (() => {});

    /** @type {string} */
    this._scriptPath = options.scriptPath;

    /** @type {string[]} */
    this._spawnArgs = Array.isArray(options.spawnArgs) ? options.spawnArgs : [];

    /** @type {number} */
    this._requestTimeoutMs =
      typeof options.requestTimeoutMs === 'number'
        ? options.requestTimeoutMs
        : DEFAULT_REQUEST_TIMEOUT_MS;

    /** @type {'ok'|'success'} */
    this._responseSuccessKey = options.responseSuccessKey || 'ok';

    /** @type {string} */
    this._logPrefix = options.logPrefix || 'powershell-server';

    /** @type {'readline'|'manual'} */
    this._buffering = options.buffering || 'readline';

    /** @type {Function|undefined} */
    this._fallbackRun = options.fallbackRun;

    // --- protected state ---------------------------------------------------
    /** @type {import('child_process').ChildProcess|null} */
    this._process = null;

    /** @type {readline.Interface|null} */
    this._readlineInterface = null;

    /** @type {string} */
    this._buffer = '';

    /** @type {number} */
    this._requestId = 0;

    /** @type {Map<string, PendingRequest>} */
    this._pending = new Map();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Lazily start the worker process.  Returns the existing handle if the process
   * is already running.
   *
   * @returns {import('child_process').ChildProcess}
   */
  ensureProcess() {
    if (this._process && !this._process.killed) {
      return this._process;
    }

    const proc = spawn('powershell.exe', this._buildSpawnArgs(), {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');

    if (this._buffering === 'manual') {
      this._attachManualBufferHandlers(proc);
    } else {
      this._attachReadlineHandlers(proc);
    }

    proc.on('error', (error) => {
      this._log(`${this._logPrefix} error:`, error);
      this._resetState(error);
    });

    proc.on('exit', (code, signal) => {
      const exitError = new Error(
        `${this._logPrefix}-exit:${code ?? 'null'}:${signal ?? 'null'}`
      );
      this._log(`${this._logPrefix} exit:`, { code, signal });
      this._resetState(exitError);
    });

    this._process = proc;
    return proc;
  }

  /**
   * Tear down the worker process and reject all pending requests.
   *
   * @param {string|Error} [reason]
   */
  stopProcess(reason) {
    const proc = this._process;

    if (!proc) {
      return;
    }

    this._process = null;
    this._clearBuffering();

    // Reject pending requests with a consistent error shape.
    const workerError =
      reason instanceof Error
        ? reason
        : new Error(String(reason || `${this._logPrefix}-stopped`));

    const pending = Array.from(this._pending.values());
    this._pending.clear();
    pending.forEach((entry) => {
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
      entry.reject(workerError);
    });

    proc.removeAllListeners();
    proc.stdout?.removeAllListeners();
    proc.stderr?.removeAllListeners();

    try {
      if (!proc.killed) proc.kill();
    } catch (e) {
      this._log(`${this._logPrefix} kill error:`, e);
    }
  }

  /** Convenience: stopProcess('shutdown'). */
  shutdown() {
    this.stopProcess(`${this._logPrefix}-shutdown`);
  }

  // -------------------------------------------------------------------------
  // Request / response
  // -------------------------------------------------------------------------

  /**
   * Send a JSON-serialised payload to the worker and wait for the matching
   * response.  The payload is merged with an auto-incremented request `id`.
   *
   * @param {string} action   The action name passed to the worker.
   * @param {object} [payload={}]  Extra fields merged into the JSON payload.
   * @returns {Promise<unknown>}
   */
  async run(action, payload = {}) {
    try {
      const proc = this.ensureProcess();
      const requestId = String(++this._requestId);

      const promise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          if (this._pending.has(requestId)) {
            this._pending.delete(requestId);
          }
          reject(
            new Error(`${this._logPrefix}-timeout:${action || 'unknown'}`)
          );
        }, this._requestTimeoutMs);

        this._pending.set(requestId, { resolve, reject, timeoutId });
      });

      const json = JSON.stringify({ id: requestId, action, ...payload });
      proc.stdin.write(json + '\n');

      return await promise;
    } catch (error) {
      this._log(`${this._logPrefix} run error, trying fallback:`, error);
      if (this._fallbackRun) {
        return this._fallbackRun(action, payload);
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Protected override points
  // -------------------------------------------------------------------------

  /**
   * Build the full spawn argument array for the worker process.
   * Override to customise the argument list (e.g. when no `-Action serve` is needed).
   *
   * @returns {string[]}
   * @protected
   */
  _buildSpawnArgs() {
    return [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      this._scriptPath,
      ...this._spawnArgs
    ];
  }

  /**
   * Parse a single line of stdout into a response object.
   * audio-sessions overrides this to also check for `success === false`.
   *
   * @param {string} line  A trimmed, non-empty line from stdout.
   * @returns {{ id: string, [key: string]: unknown }}
   * @throws {Error} When the line cannot be parsed as JSON.
   * @protected
   */
  _parseLine(line) {
    return JSON.parse(line);
  }

  /**
   * Resolve or reject a pending request based on a parsed response.
   * Calls _isSuccess() to check the appropriate success key.
   *
   * @param {PendingRequest} pending
   * @param {object}         parsedMessage
   * @protected
   */
  _onResponse(pending, parsedMessage) {
    if (this._isSuccess(parsedMessage)) {
      pending.resolve(parsedMessage.result ?? null);
    } else {
      pending.reject(
        new Error(
          String(
            parsedMessage?.error || parsedMessage?.Error || `${this._logPrefix}-error`
          )
        )
      );
    }
  }

  /**
   * Check whether a parsed response represents a successful result.
   *
   * @param {object} parsedMessage
   * @returns {boolean}
   * @protected
   */
  _isSuccess(parsedMessage) {
    const key = this._responseSuccessKey;
    return parsedMessage[key] !== false;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Readline-based line collection (used when buffering === 'readline').
   * @param {import('child_process').ChildProcess} proc
   * @private
   */
  _attachReadlineHandlers(proc) {
    const rl = readline.createInterface({
      input: proc.stdout,
      crlfDelay: Infinity
    });

    rl.on('line', (rawLine) => {
      const line = String(rawLine || '').trim();
      if (!line) return;

      let parsedMessage;
      try {
        parsedMessage = this._parseLine(line);
      } catch (e) {
        this._log(`${this._logPrefix} parse error:`, e, line);
        return;
      }

      const requestId = String(parsedMessage?.id || '').trim();
      const pending = this._pending.get(requestId);
      if (!pending) return;

      this._pending.delete(requestId);
      if (pending.timeoutId) clearTimeout(pending.timeoutId);

      this._onResponse(pending, parsedMessage);
    });

    proc.stderr.on('data', (chunk) => {
      const msg = String(chunk || '').trim();
      if (msg) this._log(`${this._logPrefix} stderr:`, msg);
    });

    this._readlineInterface = rl;
  }

  /**
   * Manual buffer-based line collection (used when buffering === 'manual').
   * Subclasses may override _parseLine; this method calls it for each complete
   * line found in the growing buffer.
   *
   * @param {import('child_process').ChildProcess} proc
   * @private
   */
  _attachManualBufferHandlers(proc) {
    proc.stdout.on('data', (chunk) => {
      this._buffer += chunk;

      while (true) {
        const nl = this._buffer.indexOf('\n');
        if (nl === -1) break;

        const line = this._buffer.slice(0, nl).trim();
        this._buffer = this._buffer.slice(nl + 1);

        if (!line) continue;

        let parsedMessage;
        try {
          parsedMessage = this._parseLine(line);
        } catch (e) {
          this._log(`${this._logPrefix} parse error:`, e, line);
          continue;
        }

        const requestId = String(parsedMessage?.id || '').trim();
        const pending = this._pending.get(requestId);
        if (!pending) continue;

        this._pending.delete(requestId);
        if (pending.timeoutId) clearTimeout(pending.timeoutId);

        this._onResponse(pending, parsedMessage);
      }
    });

    proc.stderr.on('data', (chunk) => {
      const msg = String(chunk || '').trim();
      if (msg) this._log(`${this._logPrefix} stderr:`, msg);
    });
  }

  /**
   * Tear down buffering resources without killing the process.
   * Called by _resetState() and stopProcess().
   *
   * @private
   */
  _clearBuffering() {
    if (this._readlineInterface) {
      this._readlineInterface.removeAllListeners();
      this._readlineInterface.close();
      this._readlineInterface = null;
    }
    this._buffer = '';
  }

  /**
   * Internal full reset — called by the 'error' and 'exit' handlers.
   * Tears down buffering, kills the process, and rejects all pending requests.
   *
   * @param {Error} [error]
   * @private
   */
  _resetState(error) {
    const proc = this._process;
    this._process = null;
    this._clearBuffering();

    const pending = Array.from(this._pending.values());
    this._pending.clear();
    pending.forEach((entry) => {
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
      entry.reject(error || new Error(`${this._logPrefix}-closed`));
    });

    if (!proc) return;

    proc.removeAllListeners();
    proc.stdout?.removeAllListeners();
    proc.stderr?.removeAllListeners();

    try {
      if (!proc.killed) proc.kill();
    } catch (e) {
      this._log(`${this._logPrefix} kill error:`, e);
    }
  }
}

module.exports = { PowerShellServer };
