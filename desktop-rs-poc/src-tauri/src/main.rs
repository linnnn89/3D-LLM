#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{WebviewUrl, WebviewWindowBuilder};
use windows_sys::Win32::Foundation::POINT;
use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

struct HitState {
    ignoring: AtomicBool,
}

#[tauri::command]
fn set_hit_state(window: tauri::WebviewWindow, state: tauri::State<'_, Arc<HitState>>, hit: bool) {
    let ignore = !hit;
    if state.ignoring.swap(ignore, Ordering::SeqCst) != ignore {
        if let Err(error) = window.set_ignore_cursor_events(ignore) {
            eprintln!("cursor ignore failed: {error}");
        }
    }
}

fn watch_cursor(window: tauri::WebviewWindow, state: Arc<HitState>) {
    thread::spawn(move || {
        let mut last = None;
        loop {
            thread::sleep(Duration::from_millis(33));
            if !state.ignoring.load(Ordering::SeqCst) {
                last = None;
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
                last = None;
                continue;
            }
            if last == Some((x, y)) {
                continue;
            }
            last = Some((x, y));
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
                .always_on_top(true)
                .on_page_load(|window, payload| {
                    if payload.event() != tauri::webview::PageLoadEvent::Finished {
                        return;
                    }
                    let bridge = r#"
                      window.addEventListener('desktop-bridge', (event) => {
                        const value = event.detail;
                        if (value?.type === 'avatar.hit_state' && typeof value.hit === 'boolean') {
                          window.__TAURI__.core.invoke('set_hit_state', { hit: value.hit });
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
            watch_cursor(window, state.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauri POC failed");
}
