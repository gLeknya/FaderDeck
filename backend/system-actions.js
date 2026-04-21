const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

function normalizeFilePath(filePath = '') {
  const normalizedPath = String(filePath || '').trim();
  return normalizedPath ? path.resolve(normalizedPath) : '';
}

function fileExists(filePath = '') {
  try {
    return Boolean(filePath) && fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function runDetached(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        ...options
      });

      child.on('error', reject);
      child.unref();

      resolve({
        success: true,
        pid: child.pid || null
      });
    } catch (error) {
      reject(error);
    }
  });
}

class SystemActionManager {
  constructor(logFunction) {
    this._log = logFunction || (() => {});
  }

  async launchApplication(filePath = '') {
    const resolvedPath = normalizeFilePath(filePath);

    if (!fileExists(resolvedPath)) {
      return {
        success: false,
        error: 'file-not-found',
        path: resolvedPath
      };
    }

    this._log('launch_application', resolvedPath);

    return new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-WindowStyle',
          'Hidden',
          '-Command',
          `
$targetPath = $env:FADERDECK_TARGET_PATH

if ([string]::IsNullOrWhiteSpace($targetPath)) {
  exit 1
}

Start-Process -FilePath $targetPath | Out-Null
          `
        ],
        {
          windowsHide: true,
          env: {
            ...process.env,
            FADERDECK_TARGET_PATH: resolvedPath
          }
        },
        (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve({
            success: true,
            path: resolvedPath
          });
        }
      );
    });
  }

  async runUserScript(filePath = '') {
    const resolvedPath = normalizeFilePath(filePath);

    if (!fileExists(resolvedPath)) {
      return {
        success: false,
        error: 'file-not-found',
        path: resolvedPath
      };
    }

    const extension = path.extname(resolvedPath).toLowerCase();
    this._log('run_user_script', resolvedPath);

    if (extension === '.ps1') {
      return runDetached('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        resolvedPath
      ]);
    }

    if (extension === '.cmd' || extension === '.bat') {
      return runDetached('cmd.exe', ['/c', resolvedPath]);
    }

    if (extension === '.js' || extension === '.cjs' || extension === '.mjs') {
      return runDetached(process.execPath, [resolvedPath]);
    }

    if (extension === '.vbs' || extension === '.wsf') {
      return runDetached('wscript.exe', [resolvedPath]);
    }

    return this.launchApplication(resolvedPath);
  }

  async setProcessWindowVisibility(processName = '', visible = null, executablePath = '') {
    const normalizedProcessName = String(processName || '').trim();
    const normalizedExecutablePath = normalizeFilePath(executablePath);
    const visibilityMode = visible === null
      ? 'toggle'
      : (visible ? 'show' : 'hide');

    if (!normalizedProcessName && !normalizedExecutablePath) {
      return {
        success: false,
        error: 'missing-process'
      };
    }

    this._log('set_process_window_visibility', normalizedProcessName, visibilityMode);

    return new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-WindowStyle',
          'Hidden',
          '-Command',
          `
$processName = $env:FADERDECK_PROCESS_NAME
$executablePath = $env:FADERDECK_EXECUTABLE_PATH
$visibleMode = $env:FADERDECK_VISIBLE_MODE

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class FaderDeckWindowActions {
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
}
"@

function Get-ResolvedProcesses {
  $allProcesses = Get-Process -ErrorAction SilentlyContinue

  foreach ($candidate in $allProcesses) {
    $candidateName = ""
    $candidatePath = ""

    try {
      $candidateName = "$($candidate.ProcessName).exe"
    } catch {
    }

    try {
      $candidatePath = [string]$candidate.Path
    } catch {
    }

    $matchesName = -not [string]::IsNullOrWhiteSpace($processName) -and $candidateName -ieq $processName
    $matchesPath = -not [string]::IsNullOrWhiteSpace($executablePath) -and $candidatePath -ieq $executablePath

    if ($matchesName -or $matchesPath) {
      $candidate
    }
  }
}

function Get-WindowProcesses {
  @(Get-ResolvedProcesses | Where-Object { $_.MainWindowHandle -ne 0 })
}

function Get-VisibleWindowProcesses {
  @(Get-WindowProcesses | Where-Object { -not [FaderDeckWindowActions]::IsIconic($_.MainWindowHandle) })
}

$windowProcesses = Get-WindowProcesses
$wasRunning = $windowProcesses.Count -gt 0

if ($visibleMode -eq 'show' -and $windowProcesses.Count -eq 0 -and -not [string]::IsNullOrWhiteSpace($executablePath)) {
  try {
    Start-Process -FilePath $executablePath | Out-Null
    Start-Sleep -Milliseconds 550
    $windowProcesses = Get-WindowProcesses
  } catch {
  }
}

if ($visibleMode -eq 'toggle') {
  $visibleMode = if ((Get-VisibleWindowProcesses).Count -gt 0) { 'hide' } else { 'show' }
}

$handled = $false

if ($visibleMode -eq 'show') {
  foreach ($candidate in $windowProcesses) {
    [void][FaderDeckWindowActions]::ShowWindowAsync($candidate.MainWindowHandle, 9)
    [void][FaderDeckWindowActions]::SetForegroundWindow($candidate.MainWindowHandle)
    $handled = $true
  }
} elseif ($visibleMode -eq 'hide') {
  foreach ($candidate in $windowProcesses) {
    [void][FaderDeckWindowActions]::ShowWindowAsync($candidate.MainWindowHandle, 6)
    $handled = $true
  }
}

[Console]::Out.Write((@{
  success = $handled -or ($visibleMode -eq 'show' -and $windowProcesses.Count -gt 0)
  running = $windowProcesses.Count -gt 0
  visible = (Get-VisibleWindowProcesses).Count -gt 0
  mode = $visibleMode
  wasRunning = $wasRunning
} | ConvertTo-Json -Compress))
          `
        ],
        {
          windowsHide: true,
          env: {
            ...process.env,
            FADERDECK_PROCESS_NAME: normalizedProcessName,
            FADERDECK_EXECUTABLE_PATH: normalizedExecutablePath,
            FADERDECK_VISIBLE_MODE: visibilityMode
          }
        },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }

          try {
            const parsed = JSON.parse(String(stdout || '{}').trim() || '{}');
            resolve(parsed);
          } catch (parseError) {
            reject(parseError);
          }
        }
      );
    });
  }
}

module.exports = {
  SystemActionManager
};
