const { execFile } = require('child_process');
const { sendKey } = require('./keyboard');

const REPEAT_MODES = Object.freeze({
  off: 'None',
  on: 'List',
  list: 'List',
  track: 'Track'
});
const MEDIA_TRANSPORT_COMMANDS = Object.freeze({
  next: 'next',
  previous: 'previous',
  play: 'play',
  pause: 'pause',
  toggle: 'toggle',
  stop: 'stop',
  rewind: 'rewind',
  fastForward: 'fast-forward'
});
const WINRT_MEDIA_SCRIPT_HELPERS = String.raw`
Add-Type -AssemblyName System.Runtime.WindowsRuntime

function Invoke-WinRtAsyncOperation {
  param(
    [Parameter(Mandatory = $true)]$Operation,
    [Type]$ResultType = $null
  )

  if ($null -eq $ResultType) {
    return [System.WindowsRuntimeSystemExtensions]::AsTask($Operation).GetAwaiter().GetResult()
  }

  $genericAsTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.IsGenericMethodDefinition -and
      $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1

  $asTask = $genericAsTask.MakeGenericMethod($ResultType)
  $task = $asTask.Invoke($null, @($Operation))
  return $task.GetAwaiter().GetResult()
}

function Get-MediaSessionManager {
  $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $managerResultType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  return Invoke-WinRtAsyncOperation ($managerType::RequestAsync()) $managerResultType
}

function Find-MediaSession {
  param(
    [Parameter(Mandatory = $true)]$Manager,
    [string]$TargetAppId = ''
  )

  if ([string]::IsNullOrWhiteSpace($TargetAppId)) {
    return $Manager.GetCurrentSession()
  }

  foreach ($candidate in @($Manager.GetSessions())) {
    if ([string]::Equals([string]$candidate.SourceAppUserModelId, $TargetAppId, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $candidate
    }
  }

  return $null
}

function Get-MediaSessionLabel {
  param($Session)

  $appId = [string]$Session.SourceAppUserModelId

  if ([string]::IsNullOrWhiteSpace($appId)) {
    return ''
  }

  if ($appId -match '([^\\\/!]+\.exe)$') {
    return $Matches[1]
  }

  if ($appId -match '([^!]+)!') {
    return $Matches[1]
  }

  if ($appId -match '([^\\\/]+)$') {
    return $Matches[1]
  }

  return $appId
}
`;
const MEDIA_OPTION_DEBOUNCE_MS = 260;
const mediaOptionRuntimeState = {
  byKey: new Map()
};

function shouldSuppressMediaRequest(actionKey = '') {
  const normalizedKey = String(actionKey || '').trim();

  if (!normalizedKey) {
    return false;
  }

  const now = Date.now();
  const lastTimestamp =
    Number(mediaOptionRuntimeState.byKey.get(normalizedKey)) || 0;

  if (now - lastTimestamp < MEDIA_OPTION_DEBOUNCE_MS) {
    return true;
  }

  mediaOptionRuntimeState.byKey.set(normalizedKey, now);
  return false;
}

function normalizeMediaOptionCommand(command = '') {
  const normalized = String(command || '')
    .trim()
    .toLowerCase();

  if (normalized === 'shuffle' || normalized === 'repeat') {
    return normalized;
  }

  return '';
}

function normalizeRepeatMode(mode = '') {
  const normalized = String(mode || '')
    .trim()
    .toLowerCase();

  if (normalized === 'off' || normalized === 'none') {
    return REPEAT_MODES.off;
  }

  if (normalized === 'track' || normalized === 'single') {
    return REPEAT_MODES.track;
  }

  if (
    normalized === 'list' ||
    normalized === 'playlist' ||
    normalized === 'on'
  ) {
    return REPEAT_MODES.list;
  }

  return '';
}

function normalizeMediaTransportCommand(command = '') {
  const normalized = String(command || '')
    .trim()
    .toLowerCase();

  if (
    normalized === 'next' ||
    normalized === 'next-track' ||
    normalized === 'skip-next'
  ) {
    return MEDIA_TRANSPORT_COMMANDS.next;
  }

  if (
    normalized === 'previous' ||
    normalized === 'previous-track' ||
    normalized === 'skip-previous'
  ) {
    return MEDIA_TRANSPORT_COMMANDS.previous;
  }

  if (normalized === 'play') {
    return MEDIA_TRANSPORT_COMMANDS.play;
  }

  if (normalized === 'pause') {
    return MEDIA_TRANSPORT_COMMANDS.pause;
  }

  if (
    normalized === 'toggle' ||
    normalized === 'play-pause' ||
    normalized === 'toggle-play-pause'
  ) {
    return MEDIA_TRANSPORT_COMMANDS.toggle;
  }

  if (normalized === 'stop') {
    return MEDIA_TRANSPORT_COMMANDS.stop;
  }

  if (normalized === 'rewind') {
    return MEDIA_TRANSPORT_COMMANDS.rewind;
  }

  if (
    normalized === 'fast-forward' ||
    normalized === 'fastforward' ||
    normalized === 'forward'
  ) {
    return MEDIA_TRANSPORT_COMMANDS.fastForward;
  }

  return '';
}

function normalizeMediaTargetAppId(targetAppId = '') {
  return String(targetAppId || '').trim();
}

function getMediaTransportFallbackKey(command = '') {
  const normalized = normalizeMediaTransportCommand(command);

  if (normalized === MEDIA_TRANSPORT_COMMANDS.next) {
    return 'MediaNextTrack';
  }

  if (normalized === MEDIA_TRANSPORT_COMMANDS.previous) {
    return 'MediaPreviousTrack';
  }

  if (normalized === MEDIA_TRANSPORT_COMMANDS.stop) {
    return 'MediaStop';
  }

  if (
    normalized === MEDIA_TRANSPORT_COMMANDS.play ||
    normalized === MEDIA_TRANSPORT_COMMANDS.pause ||
    normalized === MEDIA_TRANSPORT_COMMANDS.toggle
  ) {
    return 'MediaPlayPause';
  }

  if (normalized === MEDIA_TRANSPORT_COMMANDS.rewind) {
    return 'MediaRewind';
  }

  if (normalized === MEDIA_TRANSPORT_COMMANDS.fastForward) {
    return 'MediaFastForward';
  }

  return '';
}

class MediaControlManager {
  constructor(logFunction) {
    this._log = logFunction || (() => {});
  }

  async getMediaSessionState(targetAppId = '') {
    const normalizedTargetAppId = normalizeMediaTargetAppId(targetAppId);
    this._log('get_media_session_state', normalizedTargetAppId || 'current');

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
${WINRT_MEDIA_SCRIPT_HELPERS}

$targetAppId = $env:FADERDECK_MEDIA_TARGET_APP_ID
$manager = Get-MediaSessionManager
$session = Find-MediaSession $manager $targetAppId

if ($null -eq $session) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  [Console]::WriteLine((@{
    success = $true
    hasSession = $false
    targetAppId = $targetAppId
    playbackStatus = 'Closed'
    shuffleActive = $false
    repeatMode = 'None'
  } | ConvertTo-Json -Compress))
  exit 0
}

$playbackInfo = $session.GetPlaybackInfo()
$repeatMode = if ($null -ne $playbackInfo.AutoRepeatMode) { $playbackInfo.AutoRepeatMode.ToString() } else { 'None' }
$shuffleActive = if ($null -ne $playbackInfo.IsShuffleActive) { [bool]$playbackInfo.IsShuffleActive } else { $false }
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::WriteLine((@{
  success = $true
  hasSession = $true
  targetAppId = [string]$session.SourceAppUserModelId
  playbackStatus = $playbackInfo.PlaybackStatus.ToString()
  shuffleActive = $shuffleActive
  repeatMode = $repeatMode
} | ConvertTo-Json -Compress))
          `
        ],
        {
          windowsHide: true,
          encoding: 'utf8',
          env: {
            ...process.env,
            FADERDECK_MEDIA_TARGET_APP_ID: normalizedTargetAppId
          }
        },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }

          try {
            const parsed = JSON.parse(String(stdout || '').trim() || '{}');
            resolve({
              success: parsed.success !== false,
              hasSession: Boolean(parsed.hasSession),
              targetAppId: String(parsed.targetAppId || normalizedTargetAppId),
              playbackStatus: String(parsed.playbackStatus || 'Closed'),
              shuffleActive: Boolean(parsed.shuffleActive),
              repeatMode: String(parsed.repeatMode || 'None')
            });
          } catch (parseError) {
            reject(parseError);
          }
        }
      );
    });
  }

  async listMediaSessions() {
    this._log('list_media_sessions');

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
${WINRT_MEDIA_SCRIPT_HELPERS}

$manager = Get-MediaSessionManager
$currentSession = $manager.GetCurrentSession()
$sessionMap = @{}

foreach ($session in @($manager.GetSessions())) {
  $appId = [string]$session.SourceAppUserModelId

  if ([string]::IsNullOrWhiteSpace($appId)) {
    continue
  }

  if ($sessionMap.ContainsKey($appId)) {
    continue
  }

  $playback = $session.GetPlaybackInfo()
  $sessionMap[$appId] = [PSCustomObject]@{
    appId = $appId
    label = Get-MediaSessionLabel $session
    playbackStatus = $playback.PlaybackStatus.ToString()
    isCurrent = $false
  }
}

if ($null -ne $currentSession) {
  $currentAppId = [string]$currentSession.SourceAppUserModelId

  if (-not [string]::IsNullOrWhiteSpace($currentAppId) -and $sessionMap.ContainsKey($currentAppId)) {
    $sessionMap[$currentAppId].isCurrent = $true
  }
}

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::WriteLine((@{
  success = $true
  sessions = @($sessionMap.Values)
} | ConvertTo-Json -Depth 5 -Compress))
          `
        ],
        {
          windowsHide: true,
          encoding: 'utf8'
        },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }

          try {
            const parsed = JSON.parse(String(stdout || '').trim() || '{}');
            const sessions = Array.isArray(parsed.sessions)
              ? parsed.sessions
              : [];

            resolve({
              success: parsed.success !== false,
              sessions: sessions
                .map((session) => ({
                  appId: String(session?.appId || '').trim(),
                  label: String(session?.label || session?.appId || '').trim(),
                  playbackStatus: String(session?.playbackStatus || 'Closed'),
                  isCurrent: Boolean(session?.isCurrent)
                }))
                .filter((session) => session.appId)
            });
          } catch (parseError) {
            reject(parseError);
          }
        }
      );
    });
  }

  async setMediaOption(command = '', enabled = true, targetAppId = '') {
    const normalizedCommand = normalizeMediaOptionCommand(command);
    const normalizedTargetAppId = normalizeMediaTargetAppId(targetAppId);

    if (!normalizedCommand) {
      return {
        success: false,
        error: 'invalid-command'
      };
    }

    if (
      shouldSuppressMediaRequest(`${normalizedCommand}:${Boolean(enabled)}`)
    ) {
      return {
        success: true,
        suppressed: true,
        command: normalizedCommand,
        enabled: Boolean(enabled)
      };
    }

    this._log(
      'set_media_option',
      normalizedCommand,
      Boolean(enabled),
      normalizedTargetAppId || 'current'
    );

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
${WINRT_MEDIA_SCRIPT_HELPERS}

$command = $env:FADERDECK_MEDIA_OPTION
$enabled = $env:FADERDECK_MEDIA_OPTION_ENABLED -eq 'true'
$targetAppId = $env:FADERDECK_MEDIA_TARGET_APP_ID
$manager = Get-MediaSessionManager
$session = Find-MediaSession $manager $targetAppId

if ($null -eq $session) {
  throw 'No active media session'
}

if ($command -eq 'shuffle') {
  [void][System.WindowsRuntimeSystemExtensions]::AsTask($session.TryChangeShuffleActiveAsync($enabled)).GetAwaiter().GetResult()
} elseif ($command -eq 'repeat') {
  $repeatMode = if ($enabled) { [Windows.Media.MediaPlaybackAutoRepeatMode]::List } else { [Windows.Media.MediaPlaybackAutoRepeatMode]::None }
  [void][System.WindowsRuntimeSystemExtensions]::AsTask($session.TryChangeAutoRepeatModeAsync($repeatMode)).GetAwaiter().GetResult()
} else {
  throw "Unsupported media option: $command"
}
          `
        ],
        {
          windowsHide: true,
          env: {
            ...process.env,
            FADERDECK_MEDIA_OPTION: normalizedCommand,
            FADERDECK_MEDIA_OPTION_ENABLED: String(Boolean(enabled)),
            FADERDECK_MEDIA_TARGET_APP_ID: normalizedTargetAppId
          }
        },
        (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve({
            success: true,
            command: normalizedCommand,
            enabled: Boolean(enabled),
            targetAppId: normalizedTargetAppId
          });
        }
      );
    });
  }

  async setMediaRepeatMode(mode = 'off', targetAppId = '') {
    const normalizedMode = normalizeRepeatMode(mode);
    const normalizedTargetAppId = normalizeMediaTargetAppId(targetAppId);

    if (!normalizedMode) {
      return {
        success: false,
        error: 'invalid-repeat-mode'
      };
    }

    if (shouldSuppressMediaRequest(`repeat-mode:${normalizedMode}`)) {
      return {
        success: true,
        suppressed: true,
        repeatMode: normalizedMode
      };
    }

    this._log(
      'set_media_repeat_mode',
      normalizedMode,
      normalizedTargetAppId || 'current'
    );

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
${WINRT_MEDIA_SCRIPT_HELPERS}

$repeatMode = $env:FADERDECK_MEDIA_REPEAT_MODE
$targetAppId = $env:FADERDECK_MEDIA_TARGET_APP_ID
$manager = Get-MediaSessionManager
$session = Find-MediaSession $manager $targetAppId

if ($null -eq $session) {
  throw 'No active media session'
}

$targetMode = switch ($repeatMode) {
  'Track' { [Windows.Media.MediaPlaybackAutoRepeatMode]::Track; break }
  'List' { [Windows.Media.MediaPlaybackAutoRepeatMode]::List; break }
  default { [Windows.Media.MediaPlaybackAutoRepeatMode]::None; break }
}

[void][System.WindowsRuntimeSystemExtensions]::AsTask($session.TryChangeAutoRepeatModeAsync($targetMode)).GetAwaiter().GetResult()
          `
        ],
        {
          windowsHide: true,
          env: {
            ...process.env,
            FADERDECK_MEDIA_REPEAT_MODE: normalizedMode,
            FADERDECK_MEDIA_TARGET_APP_ID: normalizedTargetAppId
          }
        },
        (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve({
            success: true,
            repeatMode: normalizedMode,
            targetAppId: normalizedTargetAppId
          });
        }
      );
    });
  }

  async sendMediaTransportCommand(command = '', targetAppId = '') {
    const normalizedCommand = normalizeMediaTransportCommand(command);
    const normalizedTargetAppId = normalizeMediaTargetAppId(targetAppId);

    if (!normalizedCommand) {
      return {
        success: false,
        error: 'invalid-transport-command'
      };
    }

    if (shouldSuppressMediaRequest(`transport:${normalizedCommand}`)) {
      return {
        success: true,
        suppressed: true,
        command: normalizedCommand
      };
    }

    this._log(
      'send_media_transport',
      normalizedCommand,
      normalizedTargetAppId || 'global'
    );

    if (!normalizedTargetAppId) {
      const globalMediaKey = getMediaTransportFallbackKey(normalizedCommand);

      if (!globalMediaKey) {
        return {
          success: false,
          command: normalizedCommand,
          error: 'unsupported-global-command'
        };
      }

      try {
        const response = await sendKey(globalMediaKey, '');
        return {
          success: Boolean(response?.success),
          command: normalizedCommand,
          global: true,
          fallback: true,
          fallbackKey: globalMediaKey,
          error: response?.success ? '' : 'global-media-key-failed'
        };
      } catch (error) {
        return {
          success: false,
          command: normalizedCommand,
          global: true,
          fallback: true,
          fallbackKey: globalMediaKey,
          error: error?.message || 'global-media-key-failed'
        };
      }
    }

    const fallbackToSystemMediaKey = async (fallbackReason = '') => {
      const fallbackKey = getMediaTransportFallbackKey(normalizedCommand);

      if (!fallbackKey) {
        return {
          success: false,
          command: normalizedCommand,
          error: fallbackReason || 'fallback-unavailable'
        };
      }

      try {
        const fallbackResponse = await sendKey(fallbackKey, '');
        return {
          success: Boolean(fallbackResponse?.success),
          command: normalizedCommand,
          fallback: true,
          fallbackKey,
          error: fallbackResponse?.success
            ? ''
            : fallbackReason || 'fallback-failed'
        };
      } catch (fallbackError) {
        return {
          success: false,
          command: normalizedCommand,
          fallback: true,
          fallbackKey,
          error: fallbackReason || fallbackError?.message || 'fallback-failed'
        };
      }
    };

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
${WINRT_MEDIA_SCRIPT_HELPERS}
$command = $env:FADERDECK_MEDIA_TRANSPORT_COMMAND
$targetAppId = $env:FADERDECK_MEDIA_TARGET_APP_ID
$manager = Get-MediaSessionManager
$session = Find-MediaSession $manager $targetAppId

if ($null -eq $session) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  [Console]::WriteLine((@{
    success = $false
    hasSession = $false
    targetAppId = $targetAppId
    command = $command
    error = 'no-active-media-session'
  } | ConvertTo-Json -Compress))
  exit 0
}

$result = switch ($command) {
  'next' { [System.WindowsRuntimeSystemExtensions]::AsTask($session.TrySkipNextAsync()).GetAwaiter().GetResult(); break }
  'previous' { [System.WindowsRuntimeSystemExtensions]::AsTask($session.TrySkipPreviousAsync()).GetAwaiter().GetResult(); break }
  'play' { [System.WindowsRuntimeSystemExtensions]::AsTask($session.TryPlayAsync()).GetAwaiter().GetResult(); break }
  'pause' { [System.WindowsRuntimeSystemExtensions]::AsTask($session.TryPauseAsync()).GetAwaiter().GetResult(); break }
  'toggle' { [System.WindowsRuntimeSystemExtensions]::AsTask($session.TryTogglePlayPauseAsync()).GetAwaiter().GetResult(); break }
  'stop' { [System.WindowsRuntimeSystemExtensions]::AsTask($session.TryStopAsync()).GetAwaiter().GetResult(); break }
  'rewind' { [System.WindowsRuntimeSystemExtensions]::AsTask($session.TryRewindAsync()).GetAwaiter().GetResult(); break }
  'fast-forward' { [System.WindowsRuntimeSystemExtensions]::AsTask($session.TryFastForwardAsync()).GetAwaiter().GetResult(); break }
  default { $false; break }
}

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::WriteLine((@{
  success = [bool]$result
  hasSession = $true
  targetAppId = [string]$session.SourceAppUserModelId
  command = $command
} | ConvertTo-Json -Compress))
          `
        ],
        {
          windowsHide: true,
          encoding: 'utf8',
          env: {
            ...process.env,
            FADERDECK_MEDIA_TRANSPORT_COMMAND: normalizedCommand,
            FADERDECK_MEDIA_TARGET_APP_ID: normalizedTargetAppId
          }
        },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }

          try {
            const parsed = JSON.parse(String(stdout || '').trim() || '{}');
            const normalizedResponse = {
              success: parsed.success !== false,
              hasSession: Boolean(parsed.hasSession),
              targetAppId: String(parsed.targetAppId || normalizedTargetAppId),
              command: String(parsed.command || normalizedCommand),
              error: parsed.error ? String(parsed.error) : ''
            };

            if (normalizedResponse.success) {
              resolve(normalizedResponse);
              return;
            }

            if (normalizedTargetAppId) {
              resolve(normalizedResponse);
              return;
            }

            fallbackToSystemMediaKey(normalizedResponse.error)
              .then((fallbackResponse) =>
                resolve({
                  ...normalizedResponse,
                  ...fallbackResponse
                })
              )
              .catch((fallbackError) => reject(fallbackError));
          } catch (parseError) {
            reject(parseError);
          }
        }
      );
    });
  }
}

module.exports = {
  MediaControlManager,
  REPEAT_MODES
};
