//! Taskbar thumbnail toolbar: the media controls shown in the window's taskbar
//! preview (prev / play-pause / next).
//!
//! Windows requires the app to add these itself via
//! `ITaskbarList3::ThumbBarAddButtons`; the SMTC integration only covers the
//! Action Center media card and the hardware media keys. Button clicks arrive
//! as `WM_COMMAND`/`THBN_CLICKED`, so the window proc is subclassed and the
//! clicks are forwarded as the same `media-key://…` events the rest of the app
//! already handles.
//!
//! Everything here is best-effort: if COM, GDI or the subclass fails, the app
//! carries on (the toolbar simply doesn't appear).

#![cfg(target_os = "windows")]

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::OnceLock;

use tauri::{AppHandle, Emitter, Manager};
use windows::core::w;
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateBitmap, CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject,
    DrawTextW, GetDC, HGDIOBJ, ReleaseDC, SelectObject, SetBkMode, SetTextColor, ANTIALIASED_QUALITY,
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DEFAULT_PITCH,
    DIB_RGB_COLORS, DT_CENTER, DT_SINGLELINE, DT_VCENTER, OUT_TT_PRECIS, TRANSPARENT,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::UI::Shell::{
    ITaskbarList3, TaskbarList, THUMBBUTTON, THBF_ENABLED, THB_FLAGS, THB_ICON, THB_TOOLTIP,
    THBN_CLICKED,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallWindowProcW, CreateIconIndirect, DefWindowProcW, SetWindowLongPtrW, WM_COMMAND,
    GWLP_WNDPROC, HICON, ICONINFO, WNDPROC,
};

const BTN_PREV: u32 = 1;
const BTN_PLAY: u32 = 2;
const BTN_NEXT: u32 = 3;
const ICON_PX: i32 = 16;

// Segoe Fluent Icons / Segoe MDL2 Assets glyphs.
const GLYPH_PREV: u16 = 0xE892;
const GLYPH_PLAY: u16 = 0xE768;
const GLYPH_PAUSE: u16 = 0xE769;
const GLYPH_NEXT: u16 = 0xE893;

struct SharedTaskbar(ITaskbarList3);
// The toolbar is only touched from the main/command threads.
unsafe impl Send for SharedTaskbar {}
unsafe impl Sync for SharedTaskbar {}

static TASKBAR: OnceLock<SharedTaskbar> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();
static ORIGINAL_PROC: AtomicIsize = AtomicIsize::new(0);
static LAST_PLAYING: AtomicBool = AtomicBool::new(false);

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if msg == WM_COMMAND {
        let id = (wparam.0 & 0xFFFF) as u32;
        let code = ((wparam.0 >> 16) & 0xFFFF) as u32;
        if code == THBN_CLICKED {
            let event = match id {
                BTN_PREV => Some("media-key://prev"),
                BTN_PLAY => Some("media-key://playpause"),
                BTN_NEXT => Some("media-key://next"),
                _ => None,
            };
            if let (Some(event), Some(app)) = (event, APP.get()) {
                let _ = app.emit(event, ());
            }
        }
    }

    let original = ORIGINAL_PROC.load(Ordering::SeqCst);
    if original != 0 {
        let proc: WNDPROC = std::mem::transmute(original);
        return CallWindowProcW(proc, hwnd, msg, wparam, lparam);
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

/// Draw a Segoe glyph into a 16x16 icon. GDI never writes alpha, so it is
/// derived from the drawn pixels (a hard cutout — enough at 16px).
unsafe fn glyph_icon(glyph: u16) -> windows::core::Result<HICON> {
    let screen = GetDC(None);
    let mem = CreateCompatibleDC(Some(screen));

    let bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: ICON_PX,
            biHeight: -ICON_PX, // top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        bmiColors: [Default::default(); 1],
    };
    let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
    let dib = CreateDIBSection(Some(screen), &bmi, DIB_RGB_COLORS, &mut bits, None, 0)?;
    let old_bitmap = SelectObject(mem, HGDIOBJ(dib.0));

    let font = CreateFontW(
        -14,
        0,
        0,
        0,
        400,
        0,
        0,
        0,
        DEFAULT_CHARSET,
        OUT_TT_PRECIS,
        CLIP_DEFAULT_PRECIS,
        ANTIALIASED_QUALITY,
        DEFAULT_PITCH.0 as u32,
        w!("Segoe Fluent Icons"),
    );
    let old_font = SelectObject(mem, HGDIOBJ(font.0));
    SetBkMode(mem, TRANSPARENT);
    SetTextColor(mem, COLORREF(0x00FF_FFFF));

    let mut text = [glyph];
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: ICON_PX,
        bottom: ICON_PX,
    };
    DrawTextW(mem, &mut text, &mut rect, DT_CENTER | DT_VCENTER | DT_SINGLELINE);

    let pixels = bits as *mut u32;
    for index in 0..(ICON_PX * ICON_PX) as isize {
        let pixel = *pixels.offset(index);
        if pixel & 0x00FF_FFFF != 0 {
            *pixels.offset(index) = 0xFF00_0000 | (pixel & 0x00FF_FFFF);
        }
    }

    // A 32-bit colour bitmap carries its own alpha; the mask is unused but
    // required, so give it an all-zero (opaque) buffer.
    let mask_bits = [0u8; 32];
    let mask = CreateBitmap(
        ICON_PX,
        ICON_PX,
        1,
        1,
        Some(mask_bits.as_ptr() as *const core::ffi::c_void),
    );
    let info = ICONINFO {
        fIcon: true.into(),
        xHotspot: 0,
        yHotspot: 0,
        hbmMask: mask,
        hbmColor: dib,
    };
    let icon = CreateIconIndirect(&info);

    SelectObject(mem, old_font);
    SelectObject(mem, old_bitmap);
    let _ = DeleteObject(HGDIOBJ(font.0));
    let _ = DeleteDC(mem);
    ReleaseDC(None, screen);

    icon
}

fn make_button(id: u32, icon: HICON, tooltip: &str) -> THUMBBUTTON {
    let mut button = THUMBBUTTON {
        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
        iId: id,
        iBitmap: 0,
        hIcon: icon,
        szTip: [0; 260],
        dwFlags: THBF_ENABLED,
    };
    for (slot, ch) in button.szTip.iter_mut().zip(tooltip.encode_utf16()) {
        *slot = ch;
    }
    button
}

fn main_hwnd(app: &AppHandle) -> Result<HWND, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not created yet".to_string())?;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    Ok(HWND(hwnd.0 as *mut core::ffi::c_void))
}

/// Add the thumbnail toolbar and start listening for its clicks.
pub fn install(app: &AppHandle) -> Result<(), String> {
    let hwnd = main_hwnd(app)?;

    let taskbar: ITaskbarList3 =
        unsafe { CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER) }
            .map_err(|e| e.to_string())?;
    unsafe { taskbar.HrInit().map_err(|e| e.to_string())? };

    let icons = unsafe {
        [
            glyph_icon(GLYPH_PREV).map_err(|e| e.to_string())?,
            glyph_icon(GLYPH_PLAY).map_err(|e| e.to_string())?,
            glyph_icon(GLYPH_NEXT).map_err(|e| e.to_string())?,
        ]
    };
    let buttons = [
        make_button(BTN_PREV, icons[0], "Previous"),
        make_button(BTN_PLAY, icons[1], "Play / Pause"),
        make_button(BTN_NEXT, icons[2], "Next"),
    ];
    unsafe { taskbar.ThumbBarAddButtons(hwnd, &buttons).map_err(|e| e.to_string())? };

    let _ = APP.set(app.clone());
    let _ = TASKBAR.set(SharedTaskbar(taskbar));

    // Subclass so THBN_CLICKED reaches us; everything else is forwarded.
    let previous = unsafe {
        SetWindowLongPtrW(hwnd, GWLP_WNDPROC, window_proc as *const () as isize)
    };
    if previous != 0 {
        ORIGINAL_PROC.store(previous, Ordering::SeqCst);
    }
    Ok(())
}

/// Swap the middle button between play and pause.
pub fn set_playing(playing: bool) {
    if LAST_PLAYING.swap(playing, Ordering::SeqCst) == playing {
        return;
    }
    let (Some(app), Some(taskbar)) = (APP.get(), TASKBAR.get()) else {
        return;
    };
    let Ok(hwnd) = main_hwnd(app) else {
        return;
    };
    let glyph = if playing { GLYPH_PAUSE } else { GLYPH_PLAY };
    let Ok(icon) = (unsafe { glyph_icon(glyph) }) else {
        return;
    };
    let button = make_button(BTN_PLAY, icon, "Play / Pause");
    let _ = unsafe { taskbar.0.ThumbBarUpdateButtons(hwnd, &[button]) };
}
