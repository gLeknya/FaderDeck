use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use image::{ImageBuffer, ImageFormat, Rgba};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::Cursor;
use std::sync::LazyLock;
use windows::core::PCWSTR;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC,
    BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

static ICON_CACHE: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn get_application_icon_data_url(file_path: &str) -> Option<String> {
    if file_path.is_empty() {
        return None;
    }

    {
        let cache = ICON_CACHE.lock();
        if let Some(cached) = cache.get(file_path) {
            return Some(cached.clone());
        }
    }

    let wide: Vec<u16> = file_path.encode_utf16().chain(std::iter::once(0)).collect();
    let mut shfi = SHFILEINFOW::default();

    unsafe {
        let result = SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut shfi),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        );

        if result == 0 || shfi.hIcon.0.is_null() {
            return None;
        }

        let hicon = shfi.hIcon;
        let data_url = icon_to_png_data_url(hicon);
        let _ = DestroyIcon(hicon);

        if let Some(ref url) = data_url {
            let mut cache = ICON_CACHE.lock();
            cache.insert(file_path.to_string(), url.clone());
        }

        data_url
    }
}

pub fn get_application_icons(file_paths: &[String]) -> HashMap<String, String> {
    let mut results = HashMap::new();
    for path in file_paths {
        if let Some(data_url) = get_application_icon_data_url(path) {
            results.insert(path.clone(), data_url);
        }
    }
    results
}

unsafe fn icon_to_png_data_url(hicon: HICON) -> Option<String> {
    let mut icon_info = ICONINFO::default();
    if GetIconInfo(hicon, &mut icon_info).is_err() {
        return None;
    }

    let hbm_color = icon_info.hbmColor;
    let hbm_mask = icon_info.hbmMask;

    if hbm_color.0.is_null() {
        if !hbm_mask.0.is_null() {
            let _ = DeleteObject(hbm_mask);
        }
        return None;
    }

    let mut bmp = BITMAP::default();
    if GetObjectW(
        hbm_color,
        std::mem::size_of::<BITMAP>() as i32,
        Some(&mut bmp as *mut _ as *mut _),
    ) == 0
    {
        let _ = DeleteObject(hbm_color);
        if !hbm_mask.0.is_null() {
            let _ = DeleteObject(hbm_mask);
        }
        return None;
    }

    let width = bmp.bmWidth;
    let height = bmp.bmHeight;
    if width <= 0 || height <= 0 {
        let _ = DeleteObject(hbm_color);
        if !hbm_mask.0.is_null() {
            let _ = DeleteObject(hbm_mask);
        }
        return None;
    }

    let hdc_screen = GetDC(None);
    let hdc_mem = CreateCompatibleDC(hdc_screen);

    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height, // top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };

    let buf_size = (width * height * 4) as usize;
    let mut bgra_buf = vec![0u8; buf_size];

    let lines = GetDIBits(
        hdc_mem,
        hbm_color,
        0,
        height as u32,
        Some(bgra_buf.as_mut_ptr() as *mut _),
        &mut bmi,
        DIB_RGB_COLORS,
    );

    let _ = DeleteDC(hdc_mem);
    let _ = ReleaseDC(None, hdc_screen);
    let _ = DeleteObject(hbm_color);
    if !hbm_mask.0.is_null() {
        let _ = DeleteObject(hbm_mask);
    }

    if lines == 0 {
        return None;
    }

    // Convert BGRA to RGBA & detect whether alpha channel is present
    let mut rgba_buf = vec![0u8; buf_size];
    let mut has_non_zero_alpha = false;

    for i in 0..(width * height) as usize {
        let b = bgra_buf[i * 4];
        let g = bgra_buf[i * 4 + 1];
        let r = bgra_buf[i * 4 + 2];
        let a = bgra_buf[i * 4 + 3];

        if a > 0 {
            has_non_zero_alpha = true;
        }

        rgba_buf[i * 4] = r;
        rgba_buf[i * 4 + 1] = g;
        rgba_buf[i * 4 + 2] = b;
        rgba_buf[i * 4 + 3] = a;
    }

    // If icon had 0 alpha across the entire buffer, set all alpha to 255
    if !has_non_zero_alpha {
        for i in 0..(width * height) as usize {
            rgba_buf[i * 4 + 3] = 255;
        }
    }

    let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_raw(width as u32, height as u32, rgba_buf)?;

    let mut png_bytes = Vec::new();
    let mut cursor = Cursor::new(&mut png_bytes);
    img.write_to(&mut cursor, ImageFormat::Png).ok()?;

    let encoded = BASE64.encode(&png_bytes);
    Some(format!("data:image/png;base64,{}", encoded))
}
