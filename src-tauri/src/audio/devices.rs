use super::policy_config::set_default_endpoint_native;
use super::types::{AudioDevice, DeviceListResult};
use super::wasapi::{ensure_com, get_default_device_enumerator};
use windows::core::{Interface, Result, GUID, PCWSTR};
use windows::Win32::Foundation::BOOL;
use windows::Win32::Media::Audio::Endpoints::{IAudioEndpointVolume, IAudioMeterInformation};
use windows::Win32::Media::Audio::{
    eAll, eCapture, eCommunications, eConsole, eMultimedia, eRender,
    IMMDevice, IMMEndpoint, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::{CLSCTX_ALL, STGM_READ};

const PKEY_DEVICE_FRIENDLY_NAME: windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY =
    windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY {
        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
        pid: 14,
    };

fn get_device_friendly_name(device: &IMMDevice) -> String {
    unsafe {
        let store = match device.OpenPropertyStore(STGM_READ) {
            Ok(s) => s,
            Err(_) => return String::new(),
        };

        if let Ok(propvar) = store.GetValue(&PKEY_DEVICE_FRIENDLY_NAME) {
            let name = propvar.to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    String::new()
}

pub fn list_audio_devices(flow: &str) -> DeviceListResult {
    ensure_com();
    let normalized_flow = flow.trim().to_lowercase();
    let data_flow = match normalized_flow.as_str() {
        "output" | "render" => eRender,
        "input" | "capture" => eCapture,
        _ => eAll,
    };

    let enumerator = match get_default_device_enumerator() {
        Ok(e) => e,
        Err(_) => {
            return DeviceListResult {
                success: false,
                flow: normalized_flow,
                devices: Vec::new(),
            }
        }
    };

    let default_render_id = unsafe {
        enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .ok()
            .and_then(|d| d.GetId().ok())
            .map(|id| {
                let s = id.to_string().unwrap_or_default();
                windows::Win32::System::Com::CoTaskMemFree(Some(id.as_ptr() as *const _));
                s
            })
            .unwrap_or_default()
    };

    let default_capture_id = unsafe {
        enumerator
            .GetDefaultAudioEndpoint(eCapture, eConsole)
            .ok()
            .and_then(|d| d.GetId().ok())
            .map(|id| {
                let s = id.to_string().unwrap_or_default();
                windows::Win32::System::Com::CoTaskMemFree(Some(id.as_ptr() as *const _));
                s
            })
            .unwrap_or_default()
    };

    let collection = match unsafe { enumerator.EnumAudioEndpoints(data_flow, DEVICE_STATE_ACTIVE) } {
        Ok(c) => c,
        Err(_) => {
            return DeviceListResult {
                success: false,
                flow: normalized_flow,
                devices: Vec::new(),
            }
        }
    };

    let count = unsafe { collection.GetCount().unwrap_or(0) };
    let mut devices = Vec::new();

    for i in 0..count {
        let device = match unsafe { collection.Item(i) } {
            Ok(d) => d,
            Err(_) => continue,
        };

        let id = unsafe {
            match device.GetId() {
                Ok(raw_id) => {
                    let s = raw_id.to_string().unwrap_or_default();
                    windows::Win32::System::Com::CoTaskMemFree(Some(raw_id.as_ptr() as *const _));
                    s
                }
                Err(_) => continue,
            }
        };

        let name = get_device_friendly_name(&device);

        let device_flow = if let Ok(endpoint) = device.cast::<IMMEndpoint>() {
            if let Ok(flow_val) = unsafe { endpoint.GetDataFlow() } {
                if flow_val == eCapture {
                    "input"
                } else {
                    "output"
                }
            } else {
                "output"
            }
        } else {
            "output"
        };

        let is_default = if device_flow == "output" {
            !default_render_id.is_empty() && id == default_render_id
        } else {
            !default_capture_id.is_empty() && id == default_capture_id
        };

        let mut volume = 100.0f64;
        let mut muted = false;
        if let Ok(vol_ctl) = unsafe { device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) } {
            if let Ok(v) = unsafe { vol_ctl.GetMasterVolumeLevelScalar() } {
                volume = (v as f64 * 100.0).clamp(0.0, 100.0);
            }
            if let Ok(m) = unsafe { vol_ctl.GetMute() } {
                muted = m.as_bool();
            }
        }

        let mut peak = 0.0f32;
        if let Ok(meter) = unsafe { device.Activate::<IAudioMeterInformation>(CLSCTX_ALL, None) } {
            if let Ok(p) = unsafe { meter.GetPeakValue() } {
                peak = p.clamp(0.0, 1.0);
            }
        }

        devices.push(AudioDevice {
            id,
            name: if name.is_empty() { "Audio Device".to_string() } else { name },
            flow: device_flow.to_string(),
            is_default,
            volume,
            muted,
            peak,
            peak_level: peak,
        });
    }

    DeviceListResult {
        success: true,
        flow: normalized_flow,
        devices,
    }
}

pub fn set_default_audio_device(device_id: &str, _flow: &str) -> Result<()> {
    ensure_com();
    let wide: Vec<u16> = device_id.encode_utf16().chain(std::iter::once(0)).collect();
    let pcwstr = PCWSTR(wide.as_ptr());

    let _ = set_default_endpoint_native(pcwstr, eConsole);
    let _ = set_default_endpoint_native(pcwstr, eMultimedia);
    let _ = set_default_endpoint_native(pcwstr, eCommunications);

    super::sessions::invalidate_session_manager_cache();

    Ok(())
}

pub fn set_audio_device_volume(device_id: &str, volume: f64) -> Result<()> {
    ensure_com();
    let enumerator = get_default_device_enumerator()?;
    let wide: Vec<u16> = device_id.encode_utf16().chain(std::iter::once(0)).collect();
    let pcwstr = PCWSTR(wide.as_ptr());

    let device = unsafe { enumerator.GetDevice(pcwstr)? };
    let endpoint_volume = unsafe { device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)? };
    let scalar = (volume / 100.0).clamp(0.0, 1.0) as f32;
    unsafe { endpoint_volume.SetMasterVolumeLevelScalar(scalar, std::ptr::null()) }
}

pub fn set_audio_device_mute(device_id: &str, muted: bool) -> Result<()> {
    ensure_com();
    let enumerator = get_default_device_enumerator()?;
    let wide: Vec<u16> = device_id.encode_utf16().chain(std::iter::once(0)).collect();
    let pcwstr = PCWSTR(wide.as_ptr());

    let device = unsafe { enumerator.GetDevice(pcwstr)? };
    let endpoint_volume = unsafe { device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)? };
    unsafe { endpoint_volume.SetMute(BOOL::from(muted), std::ptr::null()) }
}
