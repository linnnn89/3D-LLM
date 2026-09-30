use std::sync::{atomic::Ordering, Arc};
use tauri::{LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::HitState;

pub fn begin(window: &WebviewWindow, state: &Arc<HitState>) -> tauri::Result<()> {
    if state.resizing.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let result = (|| -> tauri::Result<()> {
        let monitor = window.current_monitor()?.ok_or(tauri::Error::WindowNotFound)?;
        let scale = monitor.scale_factor();
        let work = monitor.work_area();
        let origin = work.position.to_logical::<f64>(scale);
        let work_size = work.size.to_logical::<f64>(scale);
        let position = window.outer_position()?.to_logical::<f64>(scale);
        let size = window.inner_size()?.to_logical::<f64>(scale);
        let init = format!(
            "window.dispatchEvent(new CustomEvent('__pet-resize-init', {{ detail: {{ \
             origin: {{x:{},y:{}}}, work: {{width:{},height:{}}}, \
             rect: {{x:{},y:{},width:{},height:{}}}, aspect:{}, minWidth:200 \
             }} }}));",
            origin.x, origin.y, work_size.width, work_size.height,
            position.x, position.y, size.width, size.height, size.width / size.height
        );
        window.eval("window.__petHost?.freeze();")?;
        // This editor alone covers the work area. The avatar keeps its size and framebuffer
        // while the user moves the virtual frame; one final resize applies on confirmation.
        let editor = WebviewWindowBuilder::new(
            window.app_handle(), "resize-frame", WebviewUrl::App("resize-frame.html".into()),
        )
        .title("调整桌宠大小")
        .position(origin.x, origin.y)
        .inner_size(work_size.width, work_size.height)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        .on_page_load(move |editor, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                if let Err(error) = editor.eval(&init)
                    .and_then(|_| editor.show()).and_then(|_| editor.set_focus()) {
                    crate::host::log(editor.app_handle(), &format!("resize editor initialization failed: {error}"));
                    let _ = editor.close();
                }
            }
        })
        .build()?;
        let avatar = window.clone();
        let state = state.clone();
        editor.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                state.resizing.store(false, Ordering::SeqCst);
                let _ = avatar.eval("window.__petHost?.resume();");
            }
        });
        Ok(())
    })();
    if result.is_err() {
        state.resizing.store(false, Ordering::SeqCst);
        let _ = window.eval("window.__petHost?.resume();");
    }
    result
}

#[tauri::command]
pub async fn finish_resize(window: WebviewWindow, rect: Option<Vec<f64>>) -> Result<(), String> {
    if window.label() != "resize-frame" {
        return Err("Only the resize editor can apply bounds".into());
    }
    if let Some(rect) = rect {
        if rect.len() != 4 || rect.iter().any(|value| !value.is_finite())
            || rect[2] < 200.0 || rect[3] < 1.0 || rect[2] > 32768.0 || rect[3] > 32768.0 {
            return Err("Invalid resize rectangle".into());
        }
        let avatar = window.app_handle().get_webview_window("avatar")
            .ok_or("Avatar window not found")?;
        let before_size = avatar.inner_size().map_err(|error| error.to_string())?;
        let before_position = avatar.outer_position().map_err(|error| error.to_string())?;
        avatar.set_size(LogicalSize::new(rect[2].round(), rect[3].round()))
            .map_err(|error| error.to_string())?;
        if let Err(error) = avatar.set_position(LogicalPosition::new(rect[0].round(), rect[1].round())) {
            let _ = avatar.set_size(before_size);
            let _ = avatar.set_position(before_position);
            return Err(error.to_string());
        }
    }
    window.close().map_err(|error| error.to_string())
}
