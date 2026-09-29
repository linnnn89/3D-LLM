#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod tray;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{WebviewUrl, WebviewWindowBuilder};
use windows_sys::Win32::Foundation::POINT;
use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

struct HitState {
    ignoring: AtomicBool,
    enabled: AtomicBool,
}

#[tauri::command]
fn set_hit_state(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<HitState>>,
    hit: bool,
) -> Result<(), String> {
    let ignore = state.enabled.load(Ordering::SeqCst) && !hit;
    if state.ignoring.load(Ordering::SeqCst) != ignore {
        window
            .set_ignore_cursor_events(ignore)
            .map_err(|error| error.to_string())?;
        state.ignoring.store(ignore, Ordering::SeqCst);
    }
    Ok(())
}

fn watch_cursor(window: tauri::WebviewWindow, state: Arc<HitState>) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_millis(33));
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
    });
    tauri::Builder::default()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![set_hit_state])
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
                    let bridge = r#"
                      window.addEventListener('desktop-bridge', (event) => {
                        const value = event.detail;
                        if (value?.type === 'avatar.hit_state' && typeof value.hit === 'boolean') {
                          window.__TAURI__.core.invoke('set_hit_state', { hit: value.hit })
                            .catch(error => console.error('Hit-state bridge failed:', error));
                        }
                      });
                      window.addEventListener('__pet-pointer', (event) => {
                        const canvas = document.querySelector('#canvas-container canvas');
                        if (canvas) canvas.dispatchEvent(new PointerEvent('pointermove', {
                          clientX: event.detail.x, clientY: event.detail.y, bubbles: true
                        }));
                      });
                    "#;
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
