#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod tray;
mod resize;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use windows_sys::Win32::Foundation::POINT;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

struct HitState {
    ignoring: AtomicBool,
    enabled: AtomicBool,
    dragging: AtomicBool,
    resizing: AtomicBool,
    menu_open: AtomicBool,
}

#[tauri::command]
fn set_hit_state(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<HitState>>,
    hit: bool,
) -> Result<(), String> {
    if state.dragging.load(Ordering::SeqCst)
        || state.resizing.load(Ordering::SeqCst)
        || state.menu_open.load(Ordering::SeqCst)
    {
        return Ok(());
    }
    let ignore = state.enabled.load(Ordering::SeqCst) && !hit;
    if state.ignoring.load(Ordering::SeqCst) != ignore {
        window
            .set_ignore_cursor_events(ignore)
            .map_err(|error| error.to_string())?;
        state.ignoring.store(ignore, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
async fn start_avatar_drag(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<HitState>>,
) -> Result<(), String> {
    if window.label() != "avatar" || state.resizing.load(Ordering::SeqCst) {
        return Err("Avatar is not available for dragging".into());
    }
    // A delayed WebView IPC must not start a move loop after the button was released.
    if unsafe { GetAsyncKeyState(VK_LBUTTON as i32) } >= 0 {
        return Ok(());
    }
    window.set_ignore_cursor_events(false).map_err(|error| error.to_string())?;
    state.ignoring.store(false, Ordering::SeqCst);
    state.dragging.store(true, Ordering::SeqCst);
    if let Err(error) = window.start_dragging() {
        state.dragging.store(false, Ordering::SeqCst);
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
async fn open_pet_menu(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<HitState>>,
) -> Result<(), String> {
    if window.label() != "avatar" {
        return Err("Only the avatar can open the pet menu".into());
    }
    let menu = window.app_handle().state::<tray::PetMenu>();
    if state.menu_open.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    // The popup belongs to the avatar HWND. Keep that owner interactive until
    // Windows' modal menu loop returns, even when the cursor leaves the model.
    let result = (|| {
        window.set_ignore_cursor_events(false)?;
        state.ignoring.store(false, Ordering::SeqCst);
        window.popup_menu(&menu.0)
    })();
    state.menu_open.store(false, Ordering::SeqCst);
    result.map_err(|error| error.to_string())
}

fn watch_cursor(window: tauri::WebviewWindow, state: Arc<HitState>) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_millis(33));
            if state.dragging.load(Ordering::SeqCst) {
                if unsafe { GetAsyncKeyState(VK_LBUTTON as i32) } < 0 {
                    continue;
                }
                state.dragging.store(false, Ordering::SeqCst);
                // Native move loops may consume pointerup, so release the renderer's press too.
                let _ = window.eval("window.dispatchEvent(new Event('blur'));");
            }
            if state.resizing.load(Ordering::SeqCst) || state.menu_open.load(Ordering::SeqCst) {
                continue;
            }
            if !state.ignoring.load(Ordering::SeqCst) || !window.is_visible().unwrap_or(false) {
                continue;
            }
            let (Ok(position), Ok(size), Ok(scale)) = (
                window.outer_position(),
                window.inner_size(),
                window.scale_factor(),
            ) else {
                break;
            };
            let mut cursor = POINT { x: 0, y: 0 };
            if unsafe { GetCursorPos(&mut cursor) } == 0 {
                continue;
            }
            let x = cursor.x - position.x;
            let y = cursor.y - position.y;
            if x < 0 || y < 0 || x >= size.width as i32 || y >= size.height as i32 {
                continue;
            }
            // Repeat stationary coordinates: the renderer throttles pointer events,
            // so the last movement may have been dropped before reaching raycasting.
            let script = format!(
                "window.dispatchEvent(new CustomEvent('__pet-pointer', {{detail: {{x: {}, y: {}}}}}));",
                x as f64 / scale,
                y as f64 / scale
            );
            if let Err(error) = window.eval(script) {
                eprintln!("pointer probe failed: {error}");
                break;
            }
        }
    });
}

fn main() {
    let state = Arc::new(HitState {
        ignoring: AtomicBool::new(false),
        enabled: AtomicBool::new(true),
        dragging: AtomicBool::new(false),
        resizing: AtomicBool::new(false),
        menu_open: AtomicBool::new(false),
    });
    tauri::Builder::default()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            set_hit_state, start_avatar_drag, open_pet_menu, resize::finish_resize, tray::sync_character_menu
        ])
        .setup(move |app| {
            let url = "http://127.0.0.1:12393/vrm/".parse()?;
            let window = WebviewWindowBuilder::new(app, "avatar", WebviewUrl::External(url))
                .title("3D LLM Rust POC")
                .inner_size(520.0, 760.0)
                .transparent(true)
                .decorations(false)
                // Windows adds a visible border to undecorated windows with shadows.
                .shadow(false)
                .always_on_top(true)
                .on_page_load(|window, payload| {
                    if payload.event() != tauri::webview::PageLoadEvent::Finished {
                        return;
                    }
                    let overlay = format!(
                        r#"(() => {{
                          let style = document.getElementById('__pet-overlay');
                          if (!style) {{
                            style = document.createElement('style');
                            style.id = '__pet-overlay';
                            document.head.appendChild(style);
                          }}
                          style.textContent = {:?};
                        }})();"#,
                        include_str!("../../../desktop/pet-overlay.css")
                    );
                    if let Err(error) = window.eval(overlay) {
                        eprintln!("pet overlay injection failed: {error}");
                    }
                    let bridge = include_str!("../../avatar-bridge.js");
                    if let Err(error) = window.eval(bridge) {
                        eprintln!("bridge injection failed: {error}");
                    }
                })
                .build()?;
            tray::install(app, &window, state.clone())?;
            watch_cursor(window, state.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauri POC failed");
}
