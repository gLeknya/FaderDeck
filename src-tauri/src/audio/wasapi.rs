use windows::core::Result;
use windows::Win32::Media::Audio::Endpoints::{IAudioEndpointVolume, IAudioMeterInformation};
use windows::Win32::Media::Audio::{
    eConsole, eRender, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

pub fn ensure_com() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

pub fn get_default_device_enumerator() -> Result<IMMDeviceEnumerator> {
    ensure_com();
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
}

pub fn get_default_render_device() -> Result<IMMDevice> {
    let enumerator = get_default_device_enumerator()?;
    unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole) }
}

pub fn get_master_endpoint_volume() -> Result<IAudioEndpointVolume> {
    let device = get_default_render_device()?;
    unsafe { device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) }
}

pub fn get_master_meter_information() -> Result<IAudioMeterInformation> {
    let device = get_default_render_device()?;
    unsafe { device.Activate::<IAudioMeterInformation>(CLSCTX_ALL, None) }
}

pub fn get_master_volume() -> Result<f64> {
    let endpoint = get_master_endpoint_volume()?;
    let level = unsafe { endpoint.GetMasterVolumeLevelScalar()? };
    Ok((level as f64 * 100.0).clamp(0.0, 100.0))
}

pub fn set_master_volume(volume: f64) -> Result<()> {
    let endpoint = get_master_endpoint_volume()?;
    let scalar = (volume / 100.0).clamp(0.0, 1.0) as f32;
    unsafe { endpoint.SetMasterVolumeLevelScalar(scalar, std::ptr::null()) }
}

pub fn get_master_mute() -> Result<bool> {
    let endpoint = get_master_endpoint_volume()?;
    let muted = unsafe { endpoint.GetMute()? };
    Ok(muted.as_bool())
}

pub fn set_master_mute(muted: bool) -> Result<()> {
    let endpoint = get_master_endpoint_volume()?;
    unsafe { endpoint.SetMute(muted, std::ptr::null()) }
}

pub fn get_master_peak() -> f32 {
    if let Ok(meter) = get_master_meter_information() {
        if let Ok(peak) = unsafe { meter.GetPeakValue() } {
            return peak.clamp(0.0, 1.0);
        }
    }
    0.0
}
