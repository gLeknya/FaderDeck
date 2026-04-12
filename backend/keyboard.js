const { execFile } = require('child_process');

const NAMED_KEY_TOKENS = Object.freeze({
  Enter: '{ENTER}',
  Return: '{ENTER}',
  Escape: '{ESC}',
  Esc: '{ESC}',
  Tab: '{TAB}',
  Space: ' ',
  ArrowUp: '{UP}',
  ArrowDown: '{DOWN}',
  ArrowLeft: '{LEFT}',
  ArrowRight: '{RIGHT}',
  Delete: '{DELETE}',
  Backspace: '{BACKSPACE}',
  Home: '{HOME}',
  End: '{END}',
  PageUp: '{PGUP}',
  PageDown: '{PGDN}',
  Insert: '{INSERT}'
});

const SPECIAL_CHARACTER_TOKENS = Object.freeze({
  '+': '{+}',
  '^': '{^}',
  '%': '{%}',
  '~': '{~}',
  '(': '{(}',
  ')': '{)}',
  '[': '{[}',
  ']': '{]}',
  '{': '{{}',
  '}': '{}}'
});

function normalizeKeyToken(key = '') {
  const normalizedKey = String(key ?? '').trim();

  if (!normalizedKey) {
    return '';
  }

  if (NAMED_KEY_TOKENS[normalizedKey]) {
    return NAMED_KEY_TOKENS[normalizedKey];
  }

  if (/^F([1-9]|1[0-2])$/i.test(normalizedKey)) {
    return `{${normalizedKey.toUpperCase()}}`;
  }

  if (SPECIAL_CHARACTER_TOKENS[normalizedKey]) {
    return SPECIAL_CHARACTER_TOKENS[normalizedKey];
  }

  if (/^[A-Za-z0-9]$/.test(normalizedKey)) {
    return normalizedKey.length === 1 ? normalizedKey : normalizedKey.toUpperCase();
  }

  return normalizedKey.length === 1 ? normalizedKey : '';
}

function sendKey(key, targetHint = '') {
  const token = normalizeKeyToken(key);

  if (!token) {
    return Promise.resolve({
      success: false,
      error: 'invalid-key'
    });
  }

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
$sendValue = $env:FADERDECK_SENDKEY
$targetHint = $env:FADERDECK_TARGET_HINT

if ([string]::IsNullOrWhiteSpace($sendValue)) {
  exit 1
}

$shell = New-Object -ComObject WScript.Shell

if (-not [string]::IsNullOrWhiteSpace($targetHint)) {
  try {
    [void]$shell.AppActivate($targetHint)
    Start-Sleep -Milliseconds 70
  } catch {
  }
}

Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait($sendValue)
        `
      ],
      {
        windowsHide: true,
        env: {
          ...process.env,
          FADERDECK_SENDKEY: token,
          FADERDECK_TARGET_HINT: String(targetHint ?? '').trim()
        }
      },
      (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({
          success: true,
          key: String(key ?? '').trim(),
          targetHint: String(targetHint ?? '').trim()
        });
      }
    );
  });
}

module.exports = {
  sendKey
};
