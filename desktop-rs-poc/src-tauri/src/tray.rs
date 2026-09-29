use std::sync::{atomic::Ordering, Arc};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

use crate::HitState;

fn open_settings(app: &AppHandle, character: bool) {
    let app = app.clone();
    // WebView2 creation must not block the main thread's native menu callback.
    tauri::async_runtime::spawn(async move {
        let result = (|| -> Result<(), Box<dyn std::error::Error>> {
            let (label, title, path) = if character {
                ("character-settings", "角色设置", "character.html")
            } else {
                ("global-settings", "全局设置", "settings.html")
            };
            if let Some(window) = app.get_webview_window(label) {
                window.unminimize()?;
                window.show()?;
                window.set_focus()?;
            } else {
                let url = format!("http://127.0.0.1:12393/vrm/{path}").parse()?;
                WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
                    .title(title)
                    .inner_size(960.0, 720.0)
                    .center()
                    .build()?;
            }
            Ok(())
        })();
        if let Err(error) = result {
            eprintln!("settings window failed: {error}");
        }
    });
}

pub fn install(
    app: &tauri::App,
    window: &WebviewWindow,
    state: Arc<HitState>,
) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示角色", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "隐藏角色", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "全局设置…", true, None::<&str>)?;
    let character = MenuItem::with_id(app, "character", "角色设置…", true, None::<&str>)?;
    let small = MenuItem::with_id(app, "small", "小 (340×500)", true, None::<&str>)?;
    let medium = MenuItem::with_id(app, "medium", "中 (520×760)", true, None::<&str>)?;
    let large = MenuItem::with_id(app, "large", "大 (700×1000)", true, None::<&str>)?;
    let sizes = Submenu::with_items(app, "角色大小", true, &[&small, &medium, &large])?;
    let passthrough =
        CheckMenuItem::with_id(app, "passthrough", "点击穿透", true, true, None::<&str>)?;
    let on_top = CheckMenuItem::with_id(app, "on-top", "始终置顶", true, true, None::<&str>)?;
    let center = MenuItem::with_id(app, "center", "回到屏幕中央", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", "重新加载角色页面", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &hide,
            &sizes,
            &passthrough,
            &on_top,
            &center,
            &separator,
            &settings,
            &character,
            &reload,
            &quit,
        ],
    )?;
    let window = window.clone();
    TrayIconBuilder::with_id("pet-tray")
        .icon(tauri::include_image!("icons/icon.ico"))
        .tooltip("3D LLM Rust 桌宠 — 点击打开控制菜单")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| {
            let result = (|| -> tauri::Result<()> {
                match event.id.as_ref() {
                    "show" => {
                        window.set_ignore_cursor_events(false)?;
                        state.ignoring.store(false, Ordering::SeqCst);
                        window.unminimize()?;
                        window.show()?;
                    }
                    "hide" => window.hide()?,
                    "small" => window.set_size(LogicalSize::new(340.0, 500.0))?,
                    "medium" => window.set_size(LogicalSize::new(520.0, 760.0))?,
                    "large" => window.set_size(LogicalSize::new(700.0, 1000.0))?,
                    "passthrough" => {
                        let enabled = passthrough.is_checked()?;
                        if let Err(error) = window.set_ignore_cursor_events(false) {
                            passthrough.set_checked(state.enabled.load(Ordering::SeqCst))?;
                            return Err(error);
                        }
                        state.ignoring.store(false, Ordering::SeqCst);
                        state.enabled.store(enabled, Ordering::SeqCst);
                    }
                    "on-top" => {
                        if let Err(error) = window.set_always_on_top(on_top.is_checked()?) {
                            on_top.set_checked(window.is_always_on_top()?)?;
                            return Err(error);
                        }
                    }
                    "center" => window.center()?,
                    "settings" => open_settings(app, false),
                    "character" => open_settings(app, true),
                    "reload" => {
                        window.set_ignore_cursor_events(false)?;
                        state.ignoring.store(false, Ordering::SeqCst);
                        window.reload()?;
                    }
                    "quit" => app.exit(0),
                    _ => {}
                }
                Ok(())
            })();
            if let Err(error) = result {
                eprintln!("tray action {} failed: {error}", event.id.as_ref());
            }
        })
        .build(app)?;
    Ok(())
}
