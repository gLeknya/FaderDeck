const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
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

const WINDOWS_PROCESS_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  '$items = Get-Process | Where-Object { $_.Id -gt 0 -and $_.ProcessName } | ForEach-Object {',
  '  [PSCustomObject]@{',
  "    Process = if ($_.Path) { [System.IO.Path]::GetFileName($_.Path) } else { \"$($_.ProcessName).exe\" }",
  '    ProcessName = $_.ProcessName',
  '    Path = $_.Path',
  '    MainWindowTitle = $_.MainWindowTitle',
  '    Id = $_.Id',
  '  }',
  '}',
  '$items | ConvertTo-Json -Compress'
].join('\n');

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
  }

  async listRunningApplications() {
    if (os.platform() !== 'win32') {
      return [];
    }

    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_PROCESS_SCRIPT],
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
}

module.exports = { ProcessCatalog };
