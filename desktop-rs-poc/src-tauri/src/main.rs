#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod tray;
mod resize;
mod host;
mod chat;

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
    stopped: AtomicBool,
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
            if state.stopped.load(Ordering::SeqCst) { break; }
            let active = window.is_visible().unwrap_or(false);
            thread::sleep(Duration::from_millis(if active { 33 } else { 250 }));
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
                crate::host::log(window.app_handle(), &format!("pointer probe failed: {error}"));
                break;
            }
        }
    });
}

fn main() {
    let instance = match host::Instance::acquire() {
        Ok(Some(instance)) => instance, Ok(None) => return,
        Err(error) => { eprintln!("single instance failed: {error}"); return; }
    };
    let runtime = match host::Runtime::new() {
        Ok(runtime) => Arc::new(runtime),
        Err(error) => { unsafe { windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(std::ptr::null_mut(),
            error.encode_utf16().chain(Some(0)).collect::<Vec<_>>().as_ptr(),
            "桌宠启动失败".encode_utf16().chain(Some(0)).collect::<Vec<_>>().as_ptr(),0); } return; }
    };
    let state = Arc::new(HitState {
        ignoring: AtomicBool::new(false),
        enabled: AtomicBool::new(true),
        dragging: AtomicBool::new(false),
        resizing: AtomicBool::new(false),
        menu_open: AtomicBool::new(false),
        stopped: AtomicBool::new(false),
    });
    let exit_runtime = runtime.clone();
    let exit_state = state.clone();
    let app = tauri::Builder::default()
        .manage(state.clone())
        .manage(runtime.clone())
        .manage(chat::ChatState::default())
        .invoke_handler(tauri::generate_handler![
            set_hit_state, start_avatar_drag, open_pet_menu, resize::finish_resize, tray::sync_character_menu, chat::chat_snapshot, chat::chat_action, chat::sync_chat
        ])
        .setup(move |app| {
            let window = WebviewWindowBuilder::new(app, "avatar", WebviewUrl::App("startup.html".into()))
                .title("3D LLM Rust 桌宠")
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
                    if window.url().map(|url| url.host_str() != Some("127.0.0.1")).unwrap_or(true) { return; }
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
                        crate::host::log(window.app_handle(), &format!("pet overlay injection failed: {error}"));
                    }
                    let bridge = include_str!("../../avatar-bridge.js");
                    if let Err(error) = window.eval(bridge) {
                        window.app_handle().state::<Arc<host::Runtime>>().log(&format!("bridge injection failed: {error}"));
                    }
                    if !window.is_visible().unwrap_or(false) { let _ = window.eval("window.__petHost?.freeze('hidden');"); }

                })
                .build()?;
            host::restore(&window, &runtime, &state)?;
            let avatar = window.clone();
            let destroyed_state = state.clone();
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) { destroyed_state.stopped.store(true, Ordering::SeqCst); }
            });
            tray::install(app, &window, state.clone())?;
            host::watch_host(window.clone(), state.clone(), runtime.clone(), instance);
            host::start_backend(window.clone(), runtime.clone());
            watch_cursor(avatar, state.clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tauri host failed");
    app.run(move |app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(window)=app.get_webview_window("avatar") {
                if let Some(snapshot)=host::snapshot(&window,&exit_state) { exit_runtime.save(&snapshot); }
            }
            exit_state.stopped.store(true,Ordering::SeqCst);
            exit_runtime.shutdown();
        }
    });
}
