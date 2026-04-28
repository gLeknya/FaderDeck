param(
  [string]$Action = 'list',
  [string]$Flow = 'all',
  [string]$DeviceId = '',
  [double]$Volume = 100,
  [bool]$Muted = $false
)

[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$source = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace FaderDeckAudioDevices {
  public enum EDataFlow {
    eRender = 0,
    eCapture = 1,
    eAll = 2
  }

  public enum ERole {
    eConsole = 0,
    eMultimedia = 1,
    eCommunications = 2
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct PROPERTYKEY {
    public Guid fmtid;
    public int pid;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct PROPVARIANT {
    [FieldOffset(0)]
    public ushort vt;

    [FieldOffset(8)]
    public IntPtr pointerValue;

    public string GetStringValue() {
      if (vt == 31 && pointerValue != IntPtr.Zero) {
        return Marshal.PtrToStringUni(pointerValue);
      }

      if (vt == 30 && pointerValue != IntPtr.Zero) {
        return Marshal.PtrToStringAnsi(pointerValue);
      }

      return string.Empty;
    }
  }

  [ComImport]
  [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IPropertyStore {
    int GetCount(out int propertyCount);
    int GetAt(int propertyIndex, out PROPERTYKEY key);
    int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
    int SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
    int Commit();
  }

  [ComImport]
  [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IMMDevice {
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    int OpenPropertyStore(int stgmAccess, out IPropertyStore properties);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetState(out int state);
  }

  [ComImport]
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr notify);
    int UnregisterControlChangeNotify(IntPtr notify);
    int GetChannelCount(out uint channelCount);
    int SetMasterVolumeLevel(float levelDb, ref Guid eventContext);
    int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
    int GetMasterVolumeLevel(out float levelDb);
    int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint channelNumber, float levelDb, ref Guid eventContext);
    int SetChannelVolumeLevelScalar(uint channelNumber, float level, ref Guid eventContext);
    int GetChannelVolumeLevel(uint channelNumber, out float levelDb);
    int GetChannelVolumeLevelScalar(uint channelNumber, out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
    int GetMute(out bool mute);
    int GetVolumeStepInfo(out uint step, out uint stepCount);
    int VolumeStepUp(ref Guid eventContext);
    int VolumeStepDown(ref Guid eventContext);
    int QueryHardwareSupport(out uint hardwareSupportMask);
    int GetVolumeRange(out float volumeMindB, out float volumeMaxdB, out float volumeIncrementdB);
  }

  [ComImport]
  [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IAudioMeterInformation {
    int GetPeakValue(out float peak);
    int GetMeteringChannelCount(out uint channelCount);
    int GetChannelsPeakValues(uint channelCount, [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 0)] float[] peakValues);
    int QueryHardwareSupport(out uint hardwareSupportMask);
  }

  [ComImport]
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IMMDeviceCollection {
    int GetCount(out uint count);
    int Item(uint index, out IMMDevice device);
  }

  [ComImport]
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(EDataFlow dataFlow, int dwStateMask, out IMMDeviceCollection devices);
    int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice endpoint);
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    int RegisterEndpointNotificationCallback(IntPtr client);
    int UnregisterEndpointNotificationCallback(IntPtr client);
  }

  [ComImport]
  [Guid("294935CE-F637-4E7C-A41B-AB255460B862")]
  internal class PolicyConfigVistaClient {
  }

  [ComImport]
  [Guid("568B9108-44BF-40B4-9006-86AFE5B5A620")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IPolicyConfigVista {
    int GetMixFormat();
    int GetDeviceFormat();
    int SetDeviceFormat();
    int GetProcessingPeriod();
    int SetProcessingPeriod();
    int GetShareMode();
    int SetShareMode();
    int GetPropertyValue();
    int SetPropertyValue();
    int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, ERole role);
    int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int visible);
  }

  [ComImport]
  [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  internal class MMDeviceEnumeratorComObject {
  }

  public class AudioDeviceInfo {
    public string id { get; set; }
    public string name { get; set; }
    public string flow { get; set; }
    public bool isDefault { get; set; }
    public float volume { get; set; }
    public bool muted { get; set; }
    public float peak { get; set; }
    public float peakLevel { get; set; }
  }

  public static class AudioDeviceBridge {
    private const int DEVICE_STATE_ACTIVE = 0x00000001;
    private const int STGM_READ = 0x00000000;
    private const int CLSCTX_ALL = 23;

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PROPVARIANT pvar);

    private static PROPERTYKEY FriendlyNameKey = new PROPERTYKEY {
      fmtid = new Guid(0xa45c254e, 0xdf1c, 0x4efd, 0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0),
      pid = 14
    };

    private static IMMDeviceEnumerator CreateEnumerator() {
      return (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
    }

    private static string ReadFriendlyName(IMMDevice device) {
      IPropertyStore propertyStore = null;
      PROPVARIANT value = default(PROPVARIANT);

      try {
        Marshal.ThrowExceptionForHR(device.OpenPropertyStore(STGM_READ, out propertyStore));
        Marshal.ThrowExceptionForHR(propertyStore.GetValue(ref FriendlyNameKey, out value));
        return value.GetStringValue() ?? string.Empty;
      } finally {
        try {
          PropVariantClear(ref value);
        } catch {
        }

        if (propertyStore != null) {
          Marshal.ReleaseComObject(propertyStore);
        }
      }
    }

    private static string GetDefaultDeviceId(IMMDeviceEnumerator enumerator, EDataFlow flow) {
      IMMDevice device = null;

      try {
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(flow, ERole.eMultimedia, out device));
        string deviceId;
        Marshal.ThrowExceptionForHR(device.GetId(out deviceId));
        return deviceId ?? string.Empty;
      } catch {
        return string.Empty;
      } finally {
        if (device != null) {
          Marshal.ReleaseComObject(device);
        }
      }
    }

    private static IAudioEndpointVolume GetEndpointVolume(IMMDevice device) {
      object endpointObject = null;
      var endpointGuid = typeof(IAudioEndpointVolume).GUID;

      try {
        Marshal.ThrowExceptionForHR(device.Activate(ref endpointGuid, CLSCTX_ALL, IntPtr.Zero, out endpointObject));
        return (IAudioEndpointVolume)endpointObject;
      } catch {
        if (endpointObject != null) {
          Marshal.ReleaseComObject(endpointObject);
        }

        return null;
      }
    }

    private static IAudioMeterInformation GetAudioMeter(IMMDevice device) {
      object meterObject = null;
      var meterGuid = typeof(IAudioMeterInformation).GUID;

      try {
        Marshal.ThrowExceptionForHR(device.Activate(ref meterGuid, CLSCTX_ALL, IntPtr.Zero, out meterObject));
        return (IAudioMeterInformation)meterObject;
      } catch {
        if (meterObject != null) {
          Marshal.ReleaseComObject(meterObject);
        }

        return null;
      }
    }

    private static void ReadEndpointState(IMMDevice device, AudioDeviceInfo info) {
      var endpointVolume = GetEndpointVolume(device);
      var audioMeter = GetAudioMeter(device);

      if (endpointVolume == null && audioMeter == null) {
        info.volume = 100f;
        info.muted = false;
        info.peak = 0f;
        info.peakLevel = 0f;
        return;
      }

      try {
        float level = 1f;
        bool isMuted = false;
        float peak = 0f;

        if (endpointVolume != null) {
          Marshal.ThrowExceptionForHR(endpointVolume.GetMasterVolumeLevelScalar(out level));
          Marshal.ThrowExceptionForHR(endpointVolume.GetMute(out isMuted));
        }

        if (audioMeter != null) {
          Marshal.ThrowExceptionForHR(audioMeter.GetPeakValue(out peak));
        }

        info.volume = (float)Math.Round(level * 100f, 3);
        info.muted = isMuted;
        info.peak = (float)Math.Round(Math.Max(0f, Math.Min(1f, peak)), 6);
        info.peakLevel = info.muted
          ? 0f
          : (float)Math.Round(Math.Max(0f, Math.Min(1f, peak)) * level, 6);
      } finally {
        if (endpointVolume != null) {
          Marshal.ReleaseComObject(endpointVolume);
        }

        if (audioMeter != null) {
          Marshal.ReleaseComObject(audioMeter);
        }
      }
    }

    private static IMMDevice GetDeviceById(string deviceId) {
      var enumerator = CreateEnumerator();
      IMMDevice device = null;

      try {
        Marshal.ThrowExceptionForHR(enumerator.GetDevice(deviceId, out device));
        return device;
      } finally {
        if (enumerator != null) {
          Marshal.ReleaseComObject(enumerator);
        }
      }
    }

    private static IEnumerable<EDataFlow> ResolveFlows(string flowFilter) {
      var normalized = (flowFilter ?? string.Empty).Trim().ToLowerInvariant();

      if (normalized == "output" || normalized == "render") {
        yield return EDataFlow.eRender;
        yield break;
      }

      if (normalized == "input" || normalized == "capture") {
        yield return EDataFlow.eCapture;
        yield break;
      }

      yield return EDataFlow.eRender;
      yield return EDataFlow.eCapture;
    }

    private static string ToFlowLabel(EDataFlow flow) {
      return flow == EDataFlow.eRender ? "output" : "input";
    }

    public static AudioDeviceInfo[] ListDevices(string flowFilter) {
      var enumerator = CreateEnumerator();
      var devices = new List<AudioDeviceInfo>();

      try {
        foreach (var flow in ResolveFlows(flowFilter)) {
          IMMDeviceCollection collection = null;
          var defaultDeviceId = GetDefaultDeviceId(enumerator, flow);

          try {
            Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, out collection));
            uint count = 0;
            Marshal.ThrowExceptionForHR(collection.GetCount(out count));

            for (uint index = 0; index < count; index++) {
              IMMDevice device = null;

              try {
                Marshal.ThrowExceptionForHR(collection.Item(index, out device));
                string deviceId;
                Marshal.ThrowExceptionForHR(device.GetId(out deviceId));

                devices.Add(new AudioDeviceInfo {
                  id = deviceId ?? string.Empty,
                  name = ReadFriendlyName(device),
                  flow = ToFlowLabel(flow),
                  isDefault = string.Equals(deviceId, defaultDeviceId, StringComparison.OrdinalIgnoreCase)
                });
                ReadEndpointState(device, devices[devices.Count - 1]);
              } finally {
                if (device != null) {
                  Marshal.ReleaseComObject(device);
                }
              }
            }
          } finally {
            if (collection != null) {
              Marshal.ReleaseComObject(collection);
            }
          }
        }

        return devices.ToArray();
      } finally {
        if (enumerator != null) {
          Marshal.ReleaseComObject(enumerator);
        }
      }
    }

    public static void SetDefaultDevice(string deviceId) {
      var policyConfig = (IPolicyConfigVista)new PolicyConfigVistaClient();

      Marshal.ThrowExceptionForHR(policyConfig.SetDefaultEndpoint(deviceId, ERole.eConsole));
      Marshal.ThrowExceptionForHR(policyConfig.SetDefaultEndpoint(deviceId, ERole.eMultimedia));
      Marshal.ThrowExceptionForHR(policyConfig.SetDefaultEndpoint(deviceId, ERole.eCommunications));

      if (policyConfig != null) {
        Marshal.ReleaseComObject(policyConfig);
      }
    }

    public static void SetVolume(string deviceId, float volumePercent) {
      var device = GetDeviceById(deviceId);
      var endpointVolume = GetEndpointVolume(device);

      if (endpointVolume == null) {
        if (device != null) {
          Marshal.ReleaseComObject(device);
        }

        throw new InvalidOperationException("endpoint-volume-unavailable");
      }

      try {
        var context = Guid.Empty;
        var normalized = Math.Max(0f, Math.Min(100f, volumePercent)) / 100f;
        Marshal.ThrowExceptionForHR(endpointVolume.SetMasterVolumeLevelScalar(normalized, ref context));
      } finally {
        Marshal.ReleaseComObject(endpointVolume);

        if (device != null) {
          Marshal.ReleaseComObject(device);
        }
      }
    }

    public static void SetMute(string deviceId, bool mute) {
      var device = GetDeviceById(deviceId);
      var endpointVolume = GetEndpointVolume(device);

      if (endpointVolume == null) {
        if (device != null) {
          Marshal.ReleaseComObject(device);
        }

        throw new InvalidOperationException("endpoint-volume-unavailable");
      }

      try {
        var context = Guid.Empty;
        Marshal.ThrowExceptionForHR(endpointVolume.SetMute(mute, ref context));
      } finally {
        Marshal.ReleaseComObject(endpointVolume);

        if (device != null) {
          Marshal.ReleaseComObject(device);
        }
      }
    }
  }
}
"@

if (-not ("FaderDeckAudioDevices.AudioDeviceBridge" -as [type])) {
  Add-Type -TypeDefinition $source -Language CSharp
}

function Invoke-AudioDeviceAction {
  param(
    [string]$RequestedAction = 'list',
    [string]$RequestedFlow = 'all',
    [string]$RequestedDeviceId = '',
    [double]$RequestedVolume = 100,
    [bool]$RequestedMuted = $false
  )

  if ($RequestedAction -eq 'set-default') {
    [FaderDeckAudioDevices.AudioDeviceBridge]::SetDefaultDevice($RequestedDeviceId)
    return [pscustomobject]@{
      success = $true
      deviceId = $RequestedDeviceId
      flow = $RequestedFlow
    }
  }

  if ($RequestedAction -eq 'set-volume') {
    [FaderDeckAudioDevices.AudioDeviceBridge]::SetVolume($RequestedDeviceId, [float]$RequestedVolume)
    return [pscustomobject]@{
      success = $true
      deviceId = $RequestedDeviceId
      flow = $RequestedFlow
      volume = [math]::Round([double]$RequestedVolume, 3)
    }
  }

  if ($RequestedAction -eq 'set-mute') {
    [FaderDeckAudioDevices.AudioDeviceBridge]::SetMute($RequestedDeviceId, [bool]$RequestedMuted)
    return [pscustomobject]@{
      success = $true
      deviceId = $RequestedDeviceId
      flow = $RequestedFlow
      muted = [bool]$RequestedMuted
    }
  }

  return [FaderDeckAudioDevices.AudioDeviceBridge]::ListDevices($RequestedFlow)
}

if ($Action -eq 'serve') {
  while (($line = [Console]::In.ReadLine()) -ne $null) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }

    $requestId = ''

    try {
      $request = $line | ConvertFrom-Json -ErrorAction Stop
      $requestId = [string]$request.id
      $result = Invoke-AudioDeviceAction `
        -RequestedAction ([string]$request.action) `
        -RequestedFlow ([string]$request.flow) `
        -RequestedDeviceId ([string]$request.deviceId) `
        -RequestedVolume ([double]$request.volume) `
        -RequestedMuted ([bool]$request.muted)

      [Console]::Out.WriteLine(([pscustomobject]@{
        id = $requestId
        ok = $true
        result = $result
      } | ConvertTo-Json -Compress -Depth 8))
    } catch {
      [Console]::Out.WriteLine(([pscustomobject]@{
        id = $requestId
        ok = $false
        error = ($_.Exception.Message | Out-String).Trim()
      } | ConvertTo-Json -Compress -Depth 8))
    }

    [Console]::Out.Flush()
  }

  exit 0
}

Invoke-AudioDeviceAction `
  -RequestedAction $Action `
  -RequestedFlow $Flow `
  -RequestedDeviceId $DeviceId `
  -RequestedVolume $Volume `
  -RequestedMuted $Muted | ConvertTo-Json -Compress -Depth 4
