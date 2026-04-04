[CmdletBinding()]
param(
  [ValidateSet('GetSessions', 'SetVolume', 'SetMute')]
  [string]$Action = 'GetSessions',
  [string]$ProcessName = '',
  [double]$Volume = 100,
  [bool]$Mute = $false,
  [string]$ProcessNamesJson = '[]'
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

$typeName = 'FaderDeck.Audio.AudioSessionNative'

if (-not ($typeName -as [type])) {
  Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

namespace FaderDeck.Audio
{
    public sealed class AudioSessionSnapshot
    {
        public int ProcessId { get; set; }
        public string Process { get; set; }
        public string ProcessName { get; set; }
        public string MainWindowTitle { get; set; }
        public float Volume { get; set; }
        public bool Muted { get; set; }
    }

    internal enum EDataFlow
    {
        eRender,
        eCapture,
        eAll,
        EDataFlow_enum_count
    }

    internal enum ERole
    {
        eConsole,
        eMultimedia,
        eCommunications,
        ERole_enum_count
    }

    [ComImport]
    [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class MMDeviceEnumeratorComObject
    {
    }

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(EDataFlow dataFlow, int dwStateMask, out object ppDevices);
        int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppEndpoint);
        int GetDevice(string pwstrId, out IMMDevice ppDevice);
        int RegisterEndpointNotificationCallback(IntPtr pClient);
        int UnregisterEndpointNotificationCallback(IntPtr pClient);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice
    {
        int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        int OpenPropertyStore(int stgmAccess, out IntPtr ppProperties);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
        int GetState(out int pdwState);
    }

    [ComImport]
    [Guid("BFA971F1-4D5E-40BB-935E-967039BFBEE4")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionManager2
    {
        int GetAudioSessionControl(ref Guid audioSessionGuid, int streamFlags, out IntPtr sessionControl);
        int GetSimpleAudioVolume(ref Guid audioSessionGuid, int streamFlags, out IntPtr audioVolume);
        int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnum);
        int RegisterSessionNotification(IntPtr sessionNotification);
        int UnregisterSessionNotification(IntPtr sessionNotification);
        int RegisterDuckNotification(string sessionID, IntPtr duckNotification);
        int UnregisterDuckNotification(IntPtr duckNotification);
    }

    [ComImport]
    [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionEnumerator
    {
        int GetCount(out int sessionCount);
        int GetSession(int sessionIndex, out IAudioSessionControl session);
    }

    [ComImport]
    [Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionControl
    {
        int GetState(out int state);
        int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string value);
        int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);
        int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string value);
        int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);
        int GetGroupingParam(out Guid groupingId);
        int SetGroupingParam(ref Guid groupingId, ref Guid eventContext);
        int RegisterAudioSessionNotification(IntPtr client);
        int UnregisterAudioSessionNotification(IntPtr client);
    }

    [ComImport]
    [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionControl2
    {
        int GetState(out int state);
        int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string value);
        int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);
        int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string value);
        int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid eventContext);
        int GetGroupingParam(out Guid groupingId);
        int SetGroupingParam(ref Guid groupingId, ref Guid eventContext);
        int RegisterAudioSessionNotification(IntPtr client);
        int UnregisterAudioSessionNotification(IntPtr client);
        int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string value);
        int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string value);
        int GetProcessId(out uint processId);
        int IsSystemSoundsSession();
        int SetDuckingPreference(bool optOut);
    }

    [ComImport]
    [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface ISimpleAudioVolume
    {
        int SetMasterVolume(float level, ref Guid eventContext);
        int GetMasterVolume(out float level);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool isMuted, ref Guid eventContext);
        int GetMute(out bool isMuted);
    }

    public static class AudioSessionNative
    {
        private const int CLSCTX_ALL = 23;

        public static AudioSessionSnapshot[] GetSessions()
        {
            var results = new List<AudioSessionSnapshot>();
            var deviceEnumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            IMMDevice device;
            Marshal.ThrowExceptionForHR(deviceEnumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device));

            object managerObject;
            var managerGuid = typeof(IAudioSessionManager2).GUID;
            Marshal.ThrowExceptionForHR(device.Activate(ref managerGuid, CLSCTX_ALL, IntPtr.Zero, out managerObject));

            var manager = (IAudioSessionManager2)managerObject;
            IAudioSessionEnumerator sessionEnumerator;
            Marshal.ThrowExceptionForHR(manager.GetSessionEnumerator(out sessionEnumerator));

            int sessionCount;
            Marshal.ThrowExceptionForHR(sessionEnumerator.GetCount(out sessionCount));

            for (var index = 0; index < sessionCount; index++)
            {
                IAudioSessionControl sessionControl;
                Marshal.ThrowExceptionForHR(sessionEnumerator.GetSession(index, out sessionControl));

                var sessionControl2 = sessionControl as IAudioSessionControl2;
                var simpleAudioVolume = sessionControl as ISimpleAudioVolume;

                if (sessionControl2 == null || simpleAudioVolume == null)
                {
                    continue;
                }

                uint processId;
                Marshal.ThrowExceptionForHR(sessionControl2.GetProcessId(out processId));

                if (processId == 0)
                {
                    continue;
                }

                float volumeLevel;
                bool isMuted;
                Marshal.ThrowExceptionForHR(simpleAudioVolume.GetMasterVolume(out volumeLevel));
                Marshal.ThrowExceptionForHR(simpleAudioVolume.GetMute(out isMuted));

                results.Add(CreateSnapshot((int)processId, volumeLevel, isMuted));
            }

            return results.ToArray();
        }

        public static int SetVolume(string processName, float volumePercent)
        {
            return ApplyToProcess(processName, (simpleAudioVolume) =>
            {
                var context = Guid.Empty;
                Marshal.ThrowExceptionForHR(simpleAudioVolume.SetMasterVolume(volumePercent / 100f, ref context));
            });
        }

        public static int SetMute(string processName, bool mute)
        {
            return ApplyToProcess(processName, (simpleAudioVolume) =>
            {
                var context = Guid.Empty;
                Marshal.ThrowExceptionForHR(simpleAudioVolume.SetMute(mute, ref context));
            });
        }

        private static int ApplyToProcess(string processName, Action<ISimpleAudioVolume> operation)
        {
            var matchedSessions = 0;
            var target = NormalizeProcessName(processName);
            var deviceEnumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            IMMDevice device;
            Marshal.ThrowExceptionForHR(deviceEnumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device));

            object managerObject;
            var managerGuid = typeof(IAudioSessionManager2).GUID;
            Marshal.ThrowExceptionForHR(device.Activate(ref managerGuid, CLSCTX_ALL, IntPtr.Zero, out managerObject));

            var manager = (IAudioSessionManager2)managerObject;
            IAudioSessionEnumerator sessionEnumerator;
            Marshal.ThrowExceptionForHR(manager.GetSessionEnumerator(out sessionEnumerator));

            int sessionCount;
            Marshal.ThrowExceptionForHR(sessionEnumerator.GetCount(out sessionCount));

            for (var index = 0; index < sessionCount; index++)
            {
                IAudioSessionControl sessionControl;
                Marshal.ThrowExceptionForHR(sessionEnumerator.GetSession(index, out sessionControl));

                var sessionControl2 = sessionControl as IAudioSessionControl2;
                var simpleAudioVolume = sessionControl as ISimpleAudioVolume;

                if (sessionControl2 == null || simpleAudioVolume == null)
                {
                    continue;
                }

                uint processId;
                Marshal.ThrowExceptionForHR(sessionControl2.GetProcessId(out processId));

                if (processId == 0 || !ProcessMatches((int)processId, target))
                {
                    continue;
                }

                operation(simpleAudioVolume);
                matchedSessions += 1;
            }

            return matchedSessions;
        }

        private static AudioSessionSnapshot CreateSnapshot(int processId, float volumeLevel, bool isMuted)
        {
            var processExecutable = string.Empty;
            var processName = string.Empty;
            var windowTitle = string.Empty;

            try
            {
                var process = Process.GetProcessById(processId);
                processName = process.ProcessName ?? string.Empty;
                windowTitle = process.MainWindowTitle ?? string.Empty;

                try
                {
                    processExecutable = Path.GetFileName(process.MainModule.FileName);
                }
                catch
                {
                    processExecutable = processName + ".exe";
                }
            }
            catch
            {
                processExecutable = string.Empty;
            }

            return new AudioSessionSnapshot
            {
                ProcessId = processId,
                Process = processExecutable,
                ProcessName = processName,
                MainWindowTitle = windowTitle,
                Volume = volumeLevel * 100f,
                Muted = isMuted
            };
        }

        private static bool ProcessMatches(int processId, string targetProcessName)
        {
            try
            {
                var process = Process.GetProcessById(processId);
                var executable = string.Empty;

                try
                {
                    executable = Path.GetFileName(process.MainModule.FileName);
                }
                catch
                {
                    executable = process.ProcessName + ".exe";
                }

                if (string.Equals(NormalizeProcessName(executable), targetProcessName, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }

                return string.Equals(NormalizeProcessName(process.ProcessName), targetProcessName, StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
            }
        }

        private static string NormalizeProcessName(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return string.Empty;
            }

            var trimmedValue = value.Trim();
            return trimmedValue.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
                ? trimmedValue.Substring(0, trimmedValue.Length - 4)
                : trimmedValue;
        }
    }
}
"@
}

function ConvertTo-ProcessFilterMap {
  param([string[]]$Names)

  $filterMap = @{}

  foreach ($name in $Names) {
    if ([string]::IsNullOrWhiteSpace($name) -or $name -eq 'master') {
      continue
    }

    $trimmedName = $name.Trim()
    $filterMap[$trimmedName.ToLowerInvariant()] = $true

    if ($trimmedName.ToLowerInvariant().EndsWith('.exe')) {
      $filterMap[$trimmedName.Substring(0, $trimmedName.Length - 4).ToLowerInvariant()] = $true
      continue
    }

    $filterMap["$trimmedName.exe".ToLowerInvariant()] = $true
  }

  return $filterMap
}

function Group-Sessions {
  param(
    [object[]]$Sessions,
    [string[]]$ProcessNames = @()
  )

  $filterMap = ConvertTo-ProcessFilterMap -Names $ProcessNames
  $grouped = @{}

  foreach ($session in $Sessions) {
    if ([string]::IsNullOrWhiteSpace($session.Process)) {
      continue
    }

    $processKey = $session.Process.ToLowerInvariant()

    if ($filterMap.Count -gt 0 -and -not $filterMap.ContainsKey($processKey)) {
      continue
    }

    if (-not $grouped.ContainsKey($processKey)) {
      $grouped[$processKey] = [PSCustomObject]@{
        name = if ([string]::IsNullOrWhiteSpace($session.ProcessName)) { $session.Process } else { $session.ProcessName }
        process = $session.Process
        processName = $session.ProcessName
        mainWindowTitle = $session.MainWindowTitle
        sessionCount = 0
        volumeSum = 0.0
        mutedCount = 0
      }
    }

    $entry = $grouped[$processKey]
    $entry.sessionCount += 1
    $entry.volumeSum += [double]$session.Volume

    if ($session.Muted) {
      $entry.mutedCount += 1
    }

    if ([string]::IsNullOrWhiteSpace($entry.mainWindowTitle) -and -not [string]::IsNullOrWhiteSpace($session.MainWindowTitle)) {
      $entry.mainWindowTitle = $session.MainWindowTitle
    }
  }

  return $grouped.Values |
    ForEach-Object {
      [PSCustomObject]@{
        name = $_.name
        process = $_.process
        processName = $_.processName
        mainWindowTitle = $_.mainWindowTitle
        sessionCount = $_.sessionCount
        volume = [math]::Round($_.volumeSum / [math]::Max($_.sessionCount, 1), 3)
        muted = ($_.mutedCount -ge $_.sessionCount)
        hasAudioSession = $true
      }
    } |
    Sort-Object -Property name
}

try {
  $processNames = @()

  if (-not [string]::IsNullOrWhiteSpace($ProcessNamesJson)) {
    $parsedNames = ConvertFrom-Json -InputObject $ProcessNamesJson -ErrorAction SilentlyContinue

    if ($parsedNames -is [System.Array]) {
      $processNames = @($parsedNames)
    } elseif ($parsedNames) {
      $processNames = @($parsedNames)
    }
  }

  switch ($Action) {
    'GetSessions' {
      $sessions = [FaderDeck.Audio.AudioSessionNative]::GetSessions()
      $applications = @(Group-Sessions -Sessions $sessions -ProcessNames $processNames)

      [PSCustomObject]@{
        success = $true
        applications = $applications
      } | ConvertTo-Json -Compress -Depth 6
      exit 0
    }

    'SetVolume' {
      $updatedCount = [FaderDeck.Audio.AudioSessionNative]::SetVolume($ProcessName, [float]$Volume)

      [PSCustomObject]@{
        success = $true
        updatedCount = $updatedCount
        application = $null
      } | ConvertTo-Json -Compress -Depth 6
      exit 0
    }

    'SetMute' {
      $updatedCount = [FaderDeck.Audio.AudioSessionNative]::SetMute($ProcessName, $Mute)

      [PSCustomObject]@{
        success = $true
        updatedCount = $updatedCount
        application = $null
      } | ConvertTo-Json -Compress -Depth 6
      exit 0
    }
  }
} catch {
  [PSCustomObject]@{
    success = $false
    error = $_.Exception.Message
  } | ConvertTo-Json -Compress -Depth 6
  exit 1
}
