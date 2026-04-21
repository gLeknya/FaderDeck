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

const MEDIA_APP_COMMANDS = Object.freeze({
  MediaNextTrack: 11,
  MediaPreviousTrack: 12,
  MediaStop: 13,
  MediaPlayPause: 14,
  MediaPlay: 46,
  MediaPause: 47,
  MediaFastForward: 49,
  MediaRewind: 50
});
const MEDIA_VIRTUAL_KEY_CODES = Object.freeze({
  MediaNextTrack: 0xB0,
  MediaPreviousTrack: 0xB1,
  MediaStop: 0xB2,
  MediaPlayPause: 0xB3
});
const MEDIA_COMMAND_DEBOUNCE_MS = 260;
const mediaCommandRuntimeState = {
  byKey: new Map()
};

function shouldSuppressMediaCommand(commandKey = '') {
  const normalizedKey = String(commandKey || '').trim();

  if (!normalizedKey) {
    return false;
  }

  const now = Date.now();
  const lastTimestamp = Number(mediaCommandRuntimeState.byKey.get(normalizedKey)) || 0;

  if (now - lastTimestamp < MEDIA_COMMAND_DEBOUNCE_MS) {
    return true;
  }

  mediaCommandRuntimeState.byKey.set(normalizedKey, now);
  return false;
}

function normalizeKeyCommand(key = '') {
  const normalizedKey = String(key ?? '').trim();

  if (!normalizedKey) {
    return null;
  }

  if (Number.isInteger(MEDIA_APP_COMMANDS[normalizedKey])) {
    return {
      kind: 'media',
      key: normalizedKey,
      appCommand: MEDIA_APP_COMMANDS[normalizedKey],
      virtualKey: Number.isInteger(MEDIA_VIRTUAL_KEY_CODES[normalizedKey])
        ? MEDIA_VIRTUAL_KEY_CODES[normalizedKey]
        : null
    };
  }

  if (NAMED_KEY_TOKENS[normalizedKey]) {
    return {
      kind: 'sendkeys',
      key: normalizedKey,
      token: NAMED_KEY_TOKENS[normalizedKey]
    };
  }

  if (/^F([1-9]|1[0-2])$/i.test(normalizedKey)) {
    return {
      kind: 'sendkeys',
      key: normalizedKey,
      token: `{${normalizedKey.toUpperCase()}}`
    };
  }

  if (SPECIAL_CHARACTER_TOKENS[normalizedKey]) {
    return {
      kind: 'sendkeys',
      key: normalizedKey,
      token: SPECIAL_CHARACTER_TOKENS[normalizedKey]
    };
  }

  if (/^[A-Za-z0-9]$/.test(normalizedKey)) {
    return {
      kind: 'sendkeys',
      key: normalizedKey,
      token: normalizedKey.length === 1 ? normalizedKey : normalizedKey.toUpperCase()
    };
  }

  if (normalizedKey.length === 1) {
    return {
      kind: 'sendkeys',
      key: normalizedKey,
      token: normalizedKey
    };
  }

  return null;
}

function sendKey(key, targetHint = '') {
  const command = normalizeKeyCommand(key);

  if (!command) {
    return Promise.resolve({
      success: false,
      error: 'invalid-key'
    });
  }

  if (command.kind === 'media' && shouldSuppressMediaCommand(command.key)) {
    return Promise.resolve({
      success: true,
      suppressed: true,
      key: String(command.key ?? key ?? '').trim(),
      targetHint: String(targetHint ?? '').trim()
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
$mediaAppCommand = $env:FADERDECK_MEDIA_APPCOMMAND
$mediaVirtualKey = $env:FADERDECK_MEDIA_VK

$shell = New-Object -ComObject WScript.Shell

if (-not [string]::IsNullOrWhiteSpace($targetHint)) {
  try {
    [void]$shell.AppActivate($targetHint)
    Start-Sleep -Milliseconds 70
  } catch {
  }
}

if (-not [string]::IsNullOrWhiteSpace($mediaAppCommand)) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class FaderDeckNativeKeyboard {
  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessageW(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);
}
"@

  if (-not [string]::IsNullOrWhiteSpace($mediaVirtualKey)) {
    $vk = [byte][int]$mediaVirtualKey
    [FaderDeckNativeKeyboard]::keybd_event($vk, 0, 0, 0)
    Start-Sleep -Milliseconds 18
    [FaderDeckNativeKeyboard]::keybd_event($vk, 0, 2, 0)
    exit 0
  }

  $message = 0x0319
  $lParam = [IntPtr](([int]$mediaAppCommand) -shl 16)
  $broadcast = [IntPtr]0xffff
  [void][FaderDeckNativeKeyboard]::SendMessageW($broadcast, $message, [IntPtr]::Zero, $lParam)
  exit 0
}

if ([string]::IsNullOrWhiteSpace($sendValue)) {
  exit 1
}

Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait($sendValue)
        `
      ],
      {
        windowsHide: true,
        env: {
          ...process.env,
          FADERDECK_SENDKEY: command.kind === 'sendkeys' ? command.token : '',
          FADERDECK_TARGET_HINT: String(targetHint ?? '').trim(),
          FADERDECK_MEDIA_APPCOMMAND: command.kind === 'media'
            ? String(command.appCommand)
            : '',
          FADERDECK_MEDIA_VK: command.kind === 'media' && Number.isInteger(command.virtualKey)
            ? String(command.virtualKey)
            : ''
        }
      },
      (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({
          success: true,
          key: String(command.key ?? key ?? '').trim(),
          targetHint: String(targetHint ?? '').trim()
        });
      }
    );
  });
}

module.exports = {
  sendKey
};
