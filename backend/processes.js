const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(__dirname, 'scripts', 'process-list.ps1');
const FOCUSED_SCRIPT_PATH = path.join(
  __dirname,
  'scripts',
  'focused-application.ps1'
);
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

const { PowerShellServer } = require('./powershell-server');
const nativeFocus = require('./native-focus');
const nativeProcesses = require('./native-processes');

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
  return SYSTEM_PATH_PREFIXES.some((prefix) =>
    normalizedPath.startsWith(prefix)
  );
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
  const processFile =
    String(rawProcess.Process || '').trim() ||
    `${String(rawProcess.ProcessName || '').trim()}.exe`;
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
  if (
    !entry.process ||
    IGNORED_PROCESS_NAMES.has(entry.processName.toLowerCase())
  ) {
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
    this._focusServer = new PowerShellServer({
      log: this._log,
      scriptPath: FOCUSED_SCRIPT_PATH,
      spawnArgs: ['-Action', 'serve'],
      requestTimeoutMs: 3000,
      responseSuccessKey: 'ok',
      logPrefix: 'focused-application-server',
      buffering: 'readline'
    });
  }

  async listRunningApplications() {
    if (os.platform() !== 'win32') {
      return [];
    }

    // Try native implementation first
    if (nativeProcesses.isAvailable()) {
      const start = Date.now();
      try {
        const result = await nativeProcesses.listProcesses();
        const latency = Date.now() - start;
        this._log(`[native:process] listRunningApplications completed in ${latency}ms`);
        
        if (result && Array.isArray(result)) {
          return result;
        }
      } catch (error) {
        const latency = Date.now() - start;
        this._log(`[native:process] listRunningApplications failed after ${latency}ms:`, error);
        this._log('[native:process] Falling back to PowerShell');
      }
    }

    // PowerShell fallback
    try {
      const start = Date.now();
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH],
        { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
      );

      const latency = Date.now() - start;
      this._log(`[powershell:process] listRunningApplications completed in ${latency}ms`);

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

      return Array.from(uniqueApplications.values()).sort((left, right) => {
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

    // Try native implementation first
    if (nativeFocus.isAvailable()) {
      const start = Date.now();
      try {
        const result = await nativeFocus.getFocusedWindow();
        const latency = Date.now() - start;
        this._log(`[native:focus] getFocusedApplication completed in ${latency}ms`);
        
        if (result) {
          return result;
        }
      } catch (error) {
        const latency = Date.now() - start;
        this._log(`[native:focus] getFocusedApplication failed after ${latency}ms:`, error);
        this._log('[native:focus] Falling back to PowerShell');
      }
    }

    // PowerShell fallback
    try {
      const start = Date.now();
      const parsed = await this._focusServer.run('get', {});
      const latency = Date.now() - start;
      this._log(`[powershell:focus] getFocusedApplication completed in ${latency}ms`);

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
    this._log('[ProcessCatalog] Prewarming...');
    this._log(`[ProcessCatalog] Native focus available: ${nativeFocus.isAvailable()}`);
    this._log(`[ProcessCatalog] Native processes available: ${nativeProcesses.isAvailable()}`);
    
    try {
      await this.getFocusedApplication();
    } catch (error) {
      this._log('focused-application prewarm error:', error);
    }
  }

  shutdown() {
    this._focusServer.shutdown();
  }
}

module.exports = { ProcessCatalog };