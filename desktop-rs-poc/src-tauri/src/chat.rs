use std::sync::Mutex;
use tauri::{Emitter, Manager, WebviewWindow, WebviewWindowBuilder, WebviewUrl, LogicalSize};
use serde_json::{Value, json};
pub struct ChatState(pub Mutex<Value>);
impl Default for ChatState { fn default() -> Self { Self(Mutex::new(json!({"entries":[],"status":"连接中…","connected":false,"collapsed":false,"autoHide":true}))) } }
fn check(window: &WebviewWindow) -> Result<(), String> { if window.label()=="chat" {Ok(())} else {Err("Only chat can perform this action".into())} }
#[tauri::command]
pub fn chat_snapshot(window: WebviewWindow, state: tauri::State<'_,ChatState>) -> Result<Value,String> {
    check(&window)?; Ok(state.0.lock().map_err(|e|e.to_string())?.clone())
}
#[tauri::command]
pub fn chat_action(window: WebviewWindow, state: tauri::State<'_,ChatState>, action: String, payload: Value) -> Result<(),String> {
    check(&window)?;
    match action.as_str() {
        "hide" => { window.emit("chat-hidden",()).map_err(|e|e.to_string())?; window.hide().map_err(|e|e.to_string())?; },
        "autoHide" => { state.0.lock().unwrap()["autoHide"]=json!(payload.as_bool().ok_or("Expected boolean")?); },
        "collapsed" => { let flag=payload.as_bool().ok_or("Expected boolean")?;
            window.set_size(LogicalSize::new(400.0,if flag {58.0} else {240.0})).map_err(|e|e.to_string())?;
            state.0.lock().unwrap()["collapsed"]=json!(flag); },
        "send" => {
            if state.0.lock().unwrap()["connected"] != true { return Err("后端未连接，消息未发送".into()); }
            let kind=payload["type"].as_str().ok_or("Invalid chat payload")?;
            match kind {
                "text-input" => { let text=payload["text"].as_str().ok_or("Expected text")?; if text.trim().is_empty() || text.len()>16000 {return Err("Invalid text length".into());} },
                "mic-audio-data" => {let samples=payload["audio"].as_array().ok_or("Expected audio samples")?;
                    if samples.is_empty() || samples.len()>8192 || samples.iter().any(|s| s.as_f64().map(|v| !v.is_finite() || v.abs()>1.0).unwrap_or(true)) {return Err("Invalid audio block".into());}},
                "mic-audio-end" | "interrupt-signal" => {}, _ => return Err("Unsupported chat message".into())
            }
            let avatar=window.app_handle().get_webview_window("avatar").ok_or("Avatar unavailable")?;
            avatar.eval(format!("window.__petRenderer?.send({});",payload)).map_err(|e|e.to_string())?;
            if kind=="text-input" { append(window.app_handle(),json!({"role":"user","text":payload["text"]}),false); }
        }, _ => return Err("Unknown chat action".into())
    }
    Ok(())
}
fn append(app: &tauri::AppHandle, entry: Value, emit: bool) {
    let state=app.state::<ChatState>(); let mut state=state.0.lock().unwrap();
    let entries=state["entries"].as_array_mut().unwrap();
    if entries.last().map(|v| v["role"]==entry["role"] && v["text"]==entry["text"]).unwrap_or(false) {return;}
    entries.push(entry.clone()); if entries.len()>300 {entries.remove(0);}
    if emit {let _=app.emit_to("chat","chat-append",entry);}
}
#[tauri::command]
pub fn sync_chat(window: WebviewWindow, message: Value) -> Result<(),String> {
    if window.label()!="avatar" {return Err("Only avatar can relay messages".into());}
    let app=window.app_handle(); let kind=message["type"].as_str().unwrap_or("");
    let text=message["text"].as_str().unwrap_or("");
    if kind=="desktop-connected" || kind=="desktop-disconnected" {app.state::<ChatState>().0.lock().unwrap()["connected"]=json!(kind=="desktop-connected");}
    let mut status=None;
    match kind {
        "full-text" if text=="Thinking..." => status=Some("思考中…"),
        "full-text" if !text.is_empty() && text!="Connection established" => {append(app,json!({"role":"ai","text":text}),true);status=Some("回复中…");},
        "user-input-transcription" if !text.is_empty() => append(app,json!({"role":"user","text":text}),true),
        "audio" => {if let Some(text)=message["display_text"]["text"].as_str() {append(app,json!({"role":"ai","text":text}),true);} status=Some("说话中…");},
        "control" if text=="conversation-chain-start" => status=Some("思考中…"),
        "control" if text=="conversation-chain-end" => status=Some("就绪"),
        "desktop-connected" => status=Some("就绪"),
        "desktop-disconnected" => status=Some("已断开"),
        "error" => {status=Some("出错"); if !text.is_empty() {append(app,json!({"role":"system","text":text}),true);}}, _=>{}
    }
    if let Some(status)=status {app.state::<ChatState>().0.lock().unwrap()["status"]=json!(status);let _=app.emit_to("chat","chat-status",status);}
    Ok(())
}
pub fn open(app: &tauri::AppHandle) { open_with_visibility(app,true); }
pub(crate) fn open_with_visibility(app: &tauri::AppHandle, visible: bool) {
    let app=app.clone();
    tauri::async_runtime::spawn(async move {
        let result=(|| -> tauri::Result<()> {
            if let Some(window)=app.get_webview_window("chat") {if visible {window.show()?;window.set_focus()?;}return Ok(());}
            let window=WebviewWindowBuilder::new(&app,"chat",WebviewUrl::App("chat.html".into()))
                .visible(visible).title("桌宠聊天").inner_size(400.0,240.0).decorations(false).always_on_top(true)
                .initialization_script(include_str!("../../chat-bridge.js")).build()?;
            let chat=window.clone();
            window.on_window_event(move |event| {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {api.prevent_close();let _=chat.emit("chat-hidden",());let _=chat.hide();},
                    tauri::WindowEvent::Focused(false) => {
                        if chat.app_handle().state::<ChatState>().0.lock().unwrap()["autoHide"].as_bool().unwrap_or(true) {let _=chat.emit("chat-hidden",());let _=chat.hide();}
                    }, _=>{}
                }
            });
            window.center()?;if visible {window.set_focus()?;} Ok(())
        })();
        if let Err(e)=result {app.state::<std::sync::Arc<crate::host::Runtime>>().log(&format!("chat window failed: {e}"));}
    });
}

pub fn toggle(app: &tauri::AppHandle) {
    if let Some(window)=app.get_webview_window("chat") {
        if window.is_visible().unwrap_or(false) {let _=window.emit("chat-hidden",());let _=window.hide();return;}
    }
    open(app);
}
