const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { spawn } = require('child_process');
const readline = require('readline');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(__dirname, 'scripts', 'process-list.ps1');
const FOCUSED_SCRIPT_PATH = path.join(__dirname, 'scripts', 'focused-application.ps1');
const WINDOWS_DIRECTORY = (process.env.WINDIR || 'C:\\Windows').toLowerCase();
const SYSTEM_PATH_PREFIXES = [
  path.join(WINDOWS_DIRECTORY, 'system32'),
  path.join(WINDOWS_DIRECTORY, 'syswow64'),
  path.join(WINDOWS_DIRECTORY, 'winsxs')
].map((entry) => entry.toLowerCase());
const IGNORED_PROCESS_NAMES = new Set([
  'idle',
  'system',
  'registry',
  'memory compression',
  'secure system'
]);

function parseJsonArray(stdout) {
  if (!stdout || !stdout.trim()) {
    return [];
  }

  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function isSystemPath(entryPath) {
  if (!entryPath) {
    return false;
  }

  const normalizedPath = entryPath.toLowerCase();
  return SYSTEM_PATH_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix));
}

function humanizeProcessName(processName) {
  const baseName = String(processName || '')
    .replace(/\.exe$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();

  if (!baseName) {
    return 'Unknown app';
  }

  return baseName.replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeProcess(rawProcess) {
  const processFile = String(rawProcess.Process || '').trim() || `${String(rawProcess.ProcessName || '').trim()}.exe`;
  const processName = String(rawProcess.ProcessName || '').trim();
  const executable = processFile || `${processName}.exe`;
  const executablePath = String(rawProcess.Path || '').trim();
  const mainWindowTitle = String(rawProcess.MainWindowTitle || '').trim();
  const processKey = executable.toLowerCase();

  return {
    process: executable,
    processKey,
    processName,
    path: executablePath,
    mainWindowTitle,
    hasWindow: Boolean(mainWindowTitle),
    pid: Number(rawProcess.Id) || 0,
    name: humanizeProcessName(executable)
  };
}

function shouldIncludeProcess(entry) {
  if (!entry.process || IGNORED_PROCESS_NAMES.has(entry.processName.toLowerCase())) {
    return false;
  }

  if (entry.hasWindow) {
    return true;
  }

  if (!entry.path) {
    return false;
  }

  return !isSystemPath(entry.path);
}

class ProcessCatalog {
  constructor(logFunction) {
    this._log = logFunction || (() => {});
    this._focusServerProcess = null;
    this._focusServerReadline = null;
    this._focusServerRequestId = 0;
    this._focusServerPending = new Map();
  }

  _resetFocusServerState(error = null) {
    if (this._focusServerReadline) {
      this._focusServerReadline.removeAllListeners();
      this._focusServerReadline.close();
      this._focusServerReadline = null;
    }

    const focusServerProcess = this._focusServerProcess;
    this._focusServerProcess = null;

    const pendingEntries = Array.from(this._focusServerPending.values());
    this._focusServerPending.clear();
    pendingEntries.forEach((entry) => {
      if (entry?.timeoutId) {
        clearTimeout(entry.timeoutId);
      }

      entry?.reject?.(error || new Error('focused-application-server-closed'));
    });

    if (!focusServerProcess) {
      return;
    }

    focusServerProcess.removeAllListeners();
    focusServerProcess.stdout?.removeAllListeners();
    focusServerProcess.stderr?.removeAllListeners();

    try {
      if (!focusServerProcess.killed) {
        focusServerProcess.kill();
      }
    } catch (killError) {
      this._log('focused-application-server kill error:', killError);
    }
  }

  _ensureFocusServerProcess() {
    if (this._focusServerProcess && !this._focusServerProcess.killed) {
      return this._focusServerProcess;
    }

    const focusServerProcess = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', FOCUSED_SCRIPT_PATH, '-Action', 'serve'],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );

    focusServerProcess.stdout.setEncoding('utf8');
    focusServerProcess.stderr.setEncoding('utf8');

    const rl = readline.createInterface({
      input: focusServerProcess.stdout,
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
        this._log('focused-application-server parse error:', error, normalizedLine);
        return;
      }

      const requestId = String(parsedMessage?.id || '').trim();
      const pending = this._focusServerPending.get(requestId);

      if (!pending) {
        return;
      }

      this._focusServerPending.delete(requestId);

      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }

      if (parsedMessage?.ok === false) {
        pending.reject(new Error(String(parsedMessage?.error || 'focused-application-server-error')));
        return;
      }

      pending.resolve(parsedMessage?.result || null);
    });

    focusServerProcess.stderr.on('data', (chunk) => {
      const message = String(chunk || '').trim();

      if (message) {
        this._log('focused-application-server stderr:', message);
      }
    });

    focusServerProcess.on('error', (error) => {
      this._log('focused-application-server error:', error);
      this._resetFocusServerState(error);
    });

    focusServerProcess.on('exit', (code, signal) => {
      const exitError = new Error(`focused-application-server-exit:${code ?? 'null'}:${signal ?? 'null'}`);
      this._log('focused-application-server exit:', { code, signal });
      this._resetFocusServerState(exitError);
    });

    this._focusServerProcess = focusServerProcess;
    this._focusServerReadline = rl;
    return focusServerProcess;
  }

  async _sendFocusServerRequest(payload = {}) {
    const focusServerProcess = this._ensureFocusServerProcess();
    const requestId = String(++this._focusServerRequestId);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this._focusServerPending.delete(requestId);
        reject(new Error(`focused-application-server-timeout:${payload?.action || 'get'}`));
      }, 3000);

      this._focusServerPending.set(requestId, {
        resolve,
        reject,
        timeoutId
      });

      try {
        focusServerProcess.stdin.write(`${JSON.stringify({ id: requestId, ...payload })}\n`);
      } catch (error) {
        clearTimeout(timeoutId);
        this._focusServerPending.delete(requestId);
        reject(error);
      }
    });
  }

  async listRunningApplications() {
    if (os.platform() !== 'win32') {
      return [];
    }

    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH],
        { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
      );

      const rawProcesses = parseJsonArray(stdout);
      const uniqueApplications = new Map();

      rawProcesses
        .map(normalizeProcess)
        .filter(shouldIncludeProcess)
        .forEach((entry) => {
          const existing = uniqueApplications.get(entry.processKey);

          if (existing) {
            existing.instanceCount += 1;

            if (!existing.mainWindowTitle && entry.mainWindowTitle) {
              existing.mainWindowTitle = entry.mainWindowTitle;
              existing.hasWindow = true;
            }

            return;
          }

          uniqueApplications.set(entry.processKey, {
            name: entry.name,
            process: entry.process,
            processName: entry.processName,
            path: entry.path,
            mainWindowTitle: entry.mainWindowTitle,
            hasWindow: entry.hasWindow,
            instanceCount: 1
          });
        });

      return Array.from(uniqueApplications.values())
        .sort((left, right) => {
          if (left.hasWindow !== right.hasWindow) {
            return left.hasWindow ? -1 : 1;
          }

          return left.name.localeCompare(right.name);
        });
    } catch (error) {
      this._log('list_running_applications error:', error);
      return [];
    }
  }

  async getFocusedApplication() {
    if (os.platform() !== 'win32') {
      return {
        success: false,
        error: 'unsupported-platform'
      };
    }

    try {
      const parsed = await this._sendFocusServerRequest({
        action: 'get'
      });

      return parsed && typeof parsed === 'object'
        ? parsed
        : { success: false, error: 'invalid-response' };
    } catch (error) {
      this._log('get_focused_application error:', error);
      return {
        success: false,
        error: 'focused-application-failed'
      };
    }
  }

  async prewarm() {
    try {
      await this.getFocusedApplication();
    } catch (error) {
      this._log('focused-application prewarm error:', error);
    }
  }

  shutdown() {
    this._resetFocusServerState(new Error('focused-application-server-shutdown'));
  }
}

module.exports = { ProcessCatalog };
