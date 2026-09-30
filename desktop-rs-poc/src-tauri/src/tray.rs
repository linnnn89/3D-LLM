use std::sync::{atomic::Ordering, Arc, Mutex};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

use crate::{resize, HitState};

pub struct PetMenu(pub Menu<tauri::Wry>);

struct CharacterEntries {
    options: Vec<[String; 2]>,
    items: Vec<CheckMenuItem<tauri::Wry>>,
    active: String,
    connected: bool,
}

pub struct CharacterMenu {
    submenu: Submenu<tauri::Wry>,
    entries: Mutex<CharacterEntries>,
}

#[tauri::command]
pub fn sync_character_menu(
    window: WebviewWindow,
    menu: tauri::State<'_, CharacterMenu>,
    options: Vec<[String; 2]>,
    active: String,
    connected: bool,
) -> Result<(), String> {
    if window.label() != "avatar" {
        return Err("Only the avatar can synchronize characters".into());
    }
    let mut entries = menu.entries.lock().map_err(|error| error.to_string())?;
    let result = (|| -> tauri::Result<()> {
        if entries.options != options {
            // Reuse the same submenu object in the tray and the avatar popup.
            while menu.submenu.remove_at(0)?.is_some() {}
            entries.items.clear();
            for [file, label] in &options {
                let item = CheckMenuItem::with_id(window.app_handle(),
                    format!("switch-character:{file}"), label, connected, file == &active, None::<&str>)?;
                menu.submenu.append(&item)?;
                entries.items.push(item);
            }
            entries.options = options;
        }
        entries.active = active;
        entries.connected = connected;
        for (option, item) in entries.options.iter().zip(&entries.items) {
            item.set_checked(option[0] == entries.active)?;
            item.set_enabled(connected)?;
        }
        menu.submenu.set_enabled(connected && !entries.items.is_empty())?;
        Ok(())
    })();
    result.map_err(|error| error.to_string())
}

fn switch_character(window: &WebviewWindow, file: &str) -> tauri::Result<()> {
    let menu = window.app_handle().state::<CharacterMenu>();
    let entries = menu.entries.lock().unwrap();
    // Native check items toggle on click; only the backend confirmation may move
    // the current-character mark, including when a request fails or is delayed.
    for (option, item) in entries.options.iter().zip(&entries.items) {
        item.set_checked(option[0] == entries.active)?;
    }
    if entries.connected && file != entries.active
        && entries.options.iter().any(|option| option[0] == file)
    {
        let file_json = serde_json::to_string(file)?;
        window.eval(format!("window.__petCharacters?.switchTo({file_json});"))?;
    }
    Ok(())
}

pub fn open_settings(app: &AppHandle, character: bool) {
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
            crate::host::log(&app, &format!("settings window failed: {error}"));
        }
    });
}

pub fn install(
    app: &tauri::App,
    window: &WebviewWindow,
    state: Arc<HitState>,
) -> tauri::Result<()> {
    let chat = MenuItem::with_id(app, "chat", "聊天… (Ctrl+Shift+Space)", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "显示角色", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "隐藏角色", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "全局设置…", true, None::<&str>)?;
    let character = MenuItem::with_id(app, "character", "角色设置…", true, None::<&str>)?;
    let small = MenuItem::with_id(app, "small", "小 (340×500)", true, None::<&str>)?;
    let medium = MenuItem::with_id(app, "medium", "中 (520×760)", true, None::<&str>)?;
    let large = MenuItem::with_id(app, "large", "大 (700×1000)", true, None::<&str>)?;
    let sizes = Submenu::with_items(app, "角色大小", true, &[&small, &medium, &large])?;
    let loading = MenuItem::new(app, "角色清单载入中…", false, None::<&str>)?;
    let characters = Submenu::with_items(app, "切换角色", false, &[&loading])?;
    app.manage(CharacterMenu {
        submenu: characters.clone(),
        entries: Mutex::new(CharacterEntries {
            options: Vec::new(), items: Vec::new(), active: String::new(), connected: false,
        }),
    });
    let passthrough =
        CheckMenuItem::with_id(app, "passthrough", "点击穿透", true, state.enabled.load(Ordering::SeqCst), None::<&str>)?;
    let on_top = CheckMenuItem::with_id(app, "on-top", "始终置顶", true, window.is_always_on_top()?, None::<&str>)?;
    let center = MenuItem::with_id(app, "center", "恢复模型居中（默认视角与比例）", true, None::<&str>)?;
    let resize = MenuItem::with_id(app, "resize", "自由调整大小…", true, None::<&str>)?;
    let help = MenuItem::with_id(app, "mouse-help", "左键拖动窗口 · Alt+拖动视角 · 滚轮缩放", false, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", "重新加载角色页面", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &chat,
            &show,
            &hide,
            &characters,
            &sizes,
            &resize,
            &passthrough,
            &on_top,
            &center,
            &help,
            &separator,
            &settings,
            &character,
            &reload,
            &quit,
        ],
    )?;
    app.manage(PetMenu(menu.clone()));
    let window = window.clone();
    TrayIconBuilder::with_id("pet-tray")
        .icon(tauri::include_image!("icons/icon.ico"))
        .tooltip("3D LLM Rust 桌宠 — 点击打开控制菜单")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| {
            // Keep the live avatar unchanged while its virtual frame is being edited.
            if state.resizing.load(Ordering::SeqCst) && event.id.as_ref() != "quit" {
                let character_menu = app.state::<CharacterMenu>();
                let entries = character_menu.entries.lock().unwrap();
                for (option, item) in entries.options.iter().zip(&entries.items) {
                    let _ = item.set_checked(option[0] == entries.active);
                }
                // Native check items toggle before the callback. Keep their visual state
                // consistent with the unapplied preferences while the editor is active.
                let _ = passthrough.set_checked(state.enabled.load(Ordering::SeqCst));
                if let Ok(enabled) = window.is_always_on_top() {
                    let _ = on_top.set_checked(enabled);
                }
                if let Some(editor) = app.get_webview_window("resize-frame") {
                    let _ = editor.set_focus();
                }
                return;
            }
            let result = (|| -> tauri::Result<()> {
                if let Some(file) = event.id.as_ref().strip_prefix("switch-character:") {
                    return switch_character(&window, file);
                }
                match event.id.as_ref() {
                    "chat" => crate::chat::open(app),
                    "show" => show_avatar(&window, &state)?,
                    "hide" => {
                        window.eval("window.__petHost?.freeze('hidden');")?;
                        window.hide()?;
                    }
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
                    "center" => window.eval("window.__petHost?.resetView();")?,
                    "resize" => {
                        let avatar = window.clone();
                        let state = state.clone();
                        // WebView2 window creation must leave the native menu callback first.
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) = resize::begin(&avatar, &state) {
                                crate::host::log(avatar.app_handle(), &format!("resize editor failed: {error}"));
                            }
                        });
                    }
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
                app.state::<Arc<crate::host::Runtime>>().log(&format!("tray action {} failed: {error}", event.id.as_ref()));
            }
        })
        .build(app)?;
    Ok(())
}

pub fn show_avatar(window: &WebviewWindow, state: &HitState) -> tauri::Result<()> {
    window.set_ignore_cursor_events(false)?;
    state.ignoring.store(false, Ordering::SeqCst);
    window.unminimize()?;
    window.show()?;
    window.eval("window.__petHost?.resume('hidden');")?;
    Ok(())
}
