use windows::core::{Interface, GUID, HRESULT, PCWSTR, IUnknown};
use windows::Win32::Media::Audio::ERole;
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

pub const CLSID_POLICY_CONFIG_VISTA: GUID = GUID::from_u128(0x294935ce_f637_4e7c_a41b_ab255460b862);

pub fn set_default_endpoint_native(device_id: PCWSTR, role: ERole) -> windows::core::Result<()> {
    unsafe {
        let unknown: IUnknown = CoCreateInstance(&CLSID_POLICY_CONFIG_VISTA, None, CLSCTX_ALL)?;
        let vtbl = *(Interface::as_raw(&unknown) as *const *const usize);
        // Slot 12 is SetDefaultEndpoint (0..2 IUnknown, 3..11 other policy methods)
        let set_default_endpoint_fn: unsafe extern "system" fn(*mut std::ffi::c_void, PCWSTR, ERole) -> HRESULT =
            std::mem::transmute(*vtbl.add(12));
        let hr = set_default_endpoint_fn(Interface::as_raw(&unknown), device_id, role);
        hr.ok()
    }
}
