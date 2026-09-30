use std::{fs, io::{Read, Write}, net::{TcpStream, SocketAddr}, path::PathBuf,
    os::windows::ffi::OsStrExt,
    sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, thread, time::{Duration, Instant}};
use tauri::{Manager, WebviewWindow, LogicalSize, PhysicalPosition};
use windows_sys::Win32::{Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE},
    System::{Threading::{CreateMutexW, CreateEventW, SetEvent, WaitForSingleObject, CreateProcessW, ResumeThread, TerminateProcess, GetExitCodeProcess, PROCESS_INFORMATION, STARTUPINFOW, CREATE_SUSPENDED, CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT},
    JobObjects::{CreateJobObjectW, SetInformationJobObject, AssignProcessToJobObject,
        JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE}},
    UI::{Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, MOD_CONTROL, MOD_SHIFT, MOD_NOREPEAT},
        WindowsAndMessaging::{PeekMessageW, MSG, PM_REMOVE, WM_HOTKEY}}};
use crate::{HitState, chat, resize, tray};

// Handles are stored as integers so shared state never transfers a borrowed pointer.
struct Handle(usize);
impl Handle { fn raw(&self) -> HANDLE { self.0 as HANDLE } }
impl Drop for Handle { fn drop(&mut self) { unsafe { CloseHandle(self.raw()); } } }
fn wide(value: &str) -> Vec<u16> { value.encode_utf16().chain(Some(0)).collect() }
pub struct Instance { _mutex: Handle, event: Handle }
impl Instance {
    pub fn acquire() -> std::io::Result<Option<Self>> {
        unsafe {
            let mutex = CreateMutexW(std::ptr::null(), 0, wide("Local\\3DLLM-Rust-Pet").as_ptr());
            if mutex.is_null() { return Err(std::io::Error::last_os_error()); }
            let existed = GetLastError() == ERROR_ALREADY_EXISTS;
            let mutex = Handle(mutex as usize);
            let event = CreateEventW(std::ptr::null(), 0, 0, wide("Local\\3DLLM-Rust-Pet-Show").as_ptr());
            if event.is_null() { return Err(std::io::Error::last_os_error()); }
            let event = Handle(event as usize);
            if existed { SetEvent(event.raw()); return Ok(None); }
            Ok(Some(Self { _mutex: mutex, event }))
        }
    }
    fn requested(&self) -> bool { unsafe { WaitForSingleObject(self.event.raw(), 0) == 0 } }
}
struct OwnedBackend { process: Handle, pid: u32, job: Option<Handle> }
impl OwnedBackend {
    fn status(&self) -> Result<Option<u32>,String> {
        if unsafe { WaitForSingleObject(self.process.raw(),0) } == 258 { return Ok(None); }
        let mut code=0;
        if unsafe { GetExitCodeProcess(self.process.raw(), &mut code) } == 0 {return Err(std::io::Error::last_os_error().to_string());}
        Ok(Some(code))
    }
}
impl Drop for OwnedBackend {
    fn drop(&mut self) {
        // Closing the job stops the entire owned tree, including the venv launcher.
        self.job.take();
        unsafe { TerminateProcess(self.process.raw(),1); WaitForSingleObject(self.process.raw(),2000); }
    }
}
pub struct Runtime {
    pub root: PathBuf,
    pub stop: AtomicBool,
    backend: Mutex<Option<OwnedBackend>>,
    log_lock: Mutex<()>,
    state_lock: Mutex<()>,
    state_file: PathBuf,
}
impl Runtime {
    pub fn new() -> Result<Self, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
        let root = exe.ancestors().chain(cwd.ancestors()).find(|p|
            p.join("run_server.py").is_file() && p.join("conf.yaml").is_file() && p.join("vrm_frontend/app.js").is_file())
            .ok_or("找不到项目目录：请将 exe 放在本项目 app 目录中")?.to_path_buf();
        let data = PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA unavailable")?).join("3D-LLM-Rust");
        Self::with_storage(root,data)
    }
    pub fn with_storage(root: PathBuf, data: PathBuf) -> Result<Self,String> {
        fs::create_dir_all(&data).map_err(|e| e.to_string())?;
        Ok(Self { root, stop: AtomicBool::new(false), backend: Mutex::new(None), log_lock: Mutex::new(()), state_lock: Mutex::new(()), state_file: data.join("pet-state.json") })
    }
    pub fn log(&self, text: &str) {
        let _lock = self.log_lock.lock().unwrap();
        let file = self.state_file.with_file_name("host.log");
        let line = format!("{:?} {}\n", std::time::SystemTime::now(), text.chars().take(8192).collect::<String>());
        if fs::metadata(&file).map(|m| m.len()).unwrap_or(0) + line.len() as u64 > 1024 * 1024 {
            let _ = fs::remove_file(file.with_extension("log.2"));
            let _ = fs::rename(file.with_extension("log.1"), file.with_extension("log.2"));
            let _ = fs::rename(&file, file.with_extension("log.1"));
        }
        if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(file) { let _ = f.write_all(line.as_bytes()); }
    }
    pub fn shutdown(&self) { self.stop.store(true, Ordering::SeqCst); self.backend.lock().unwrap().take(); }
    pub fn saved(&self) -> serde_json::Value {
        fs::read(&self.state_file).ok().and_then(|s| serde_json::from_slice(&s).ok()).unwrap_or(serde_json::Value::Null)
    }
    pub fn save(&self, state: &serde_json::Value) {
        let _lock = self.state_lock.lock().unwrap();
        let temp = self.state_file.with_extension("json.tmp");
        let result = fs::write(&temp, state.to_string()).and_then(|_| fs::rename(&temp, &self.state_file));
        if let Err(e) = result { self.log(&format!("save window state failed: {e}")); }
    }
    fn spawn_backend(&self) -> Result<(), String> {
        let python = self.root.join(".venv/Scripts/python.exe");
        if !python.is_file() { return Err("缺少项目 .venv/Scripts/python.exe；请先按后端安装文档配置环境".into()); }
        // The venv executable itself can launch another Python before -c runs.
        // Suspend it at creation, attach the job, then resume its primary thread.
        let mut command=wide(&format!("\"{}\" run_server.py",python.display()));
        let cwd:Vec<u16>=self.root.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut environment:std::collections::BTreeMap<std::ffi::OsString,std::ffi::OsString>=std::env::vars_os().collect();
        for (key,value) in [("PYTHONIOENCODING","utf-8"),("HF_HUB_OFFLINE","1"),("TRANSFORMERS_OFFLINE","1")] {environment.insert(key.into(),value.into());}
        let mut block=Vec::new();
        for (key,value) in environment {block.extend(key.encode_wide());block.push('=' as u16);block.extend(value.encode_wide());block.push(0);}
        block.push(0);
        unsafe {
            let mut startup:STARTUPINFOW=std::mem::zeroed();startup.cb=std::mem::size_of_val(&startup) as u32;
            let mut info:PROCESS_INFORMATION=std::mem::zeroed();
            if CreateProcessW(std::ptr::null(),command.as_mut_ptr(),std::ptr::null(),std::ptr::null(),0,
                CREATE_SUSPENDED|CREATE_NO_WINDOW|CREATE_UNICODE_ENVIRONMENT,block.as_ptr() as _,cwd.as_ptr(),&startup,&mut info)==0 {return Err(std::io::Error::last_os_error().to_string());}
            let mut backend=OwnedBackend {process:Handle(info.hProcess as usize),pid:info.dwProcessId,job:None};
            let primary_thread=Handle(info.hThread as usize);
            let job=CreateJobObjectW(std::ptr::null(),std::ptr::null());
            if job.is_null() {return Err(std::io::Error::last_os_error().to_string());}
            let job=Handle(job as usize);
            let mut limits:JOBOBJECT_EXTENDED_LIMIT_INFORMATION=std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(job.raw(),JobObjectExtendedLimitInformation,&limits as *const _ as _,std::mem::size_of_val(&limits) as u32)==0
                || AssignProcessToJobObject(job.raw(),backend.process.raw())==0 {return Err(std::io::Error::last_os_error().to_string());}
            backend.job=Some(job);
            let mut owned=self.backend.lock().unwrap();
            if self.stop.load(Ordering::SeqCst) {return Ok(());}
            if ResumeThread(primary_thread.raw())==u32::MAX {return Err(std::io::Error::last_os_error().to_string());}
            self.log(&format!("started backend pid={}",backend.pid));
            *owned=Some(backend);
        }
        Ok(())
    }
}
fn port_open() -> bool { TcpStream::connect_timeout(&"127.0.0.1:12393".parse::<SocketAddr>().unwrap(), Duration::from_millis(300)).is_ok() }
fn ready() -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&"127.0.0.1:12393".parse().unwrap(), Duration::from_millis(300)) else { return false; };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    if stream.write_all(b"GET /vrm/app.js HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").is_err() { return false; }
    let mut bytes = Vec::new();
    if stream.take(2_000_000).read_to_end(&mut bytes).is_err() { return false; }
    let text = String::from_utf8_lossy(&bytes);
    text.starts_with("HTTP/1.1 200") && text.contains("function initWebSocket()")
}
pub fn start_backend(window: WebviewWindow, runtime: Arc<Runtime>) {
    thread::spawn(move || {
        let reused = port_open();
        let result = (|| -> Result<(), String> {
            if !reused { runtime.spawn_backend()?; } else { runtime.log("reusing external backend; it will not be stopped on exit"); }
            let deadline = Instant::now() + Duration::from_secs(120);
            loop {
                if runtime.stop.load(Ordering::SeqCst) { return Ok(()); }
                if ready() { window.navigate("http://127.0.0.1:12393/vrm/".parse().unwrap()).map_err(|e| e.to_string())?; return Ok(()); }
                if let Some(owned) = runtime.backend.lock().unwrap().as_mut() {
                    if let Some(status) = owned.status()? { return Err(format!("后端启动失败（{status}），请查看项目 logs/backend_*.log")); }
                }
                if Instant::now() > deadline { return Err("等待后端就绪超时；请检查 12393 端口、配置和 logs/backend_*.log".into()); }
                thread::sleep(Duration::from_millis(500));
            }
        })();
        if let Err(error) = result {
            runtime.log(&error);
            if !reused { runtime.backend.lock().unwrap().take(); }
            let value = serde_json::to_string(&error).unwrap();
            let _ = window.eval(format!("document.getElementById('status').textContent={value};"));
        }
    });
}
pub fn restore(window: &WebviewWindow, runtime: &Runtime, hit: &HitState) -> tauri::Result<()> {
    let saved = runtime.saved();
    if let Some(size) = saved["size"].as_array() {
        if let (Some(w), Some(h)) = (size.first().and_then(|v| v.as_f64()), size.get(1).and_then(|v| v.as_f64())) {
            if (200.0..=4096.0).contains(&w) && (200.0..=4096.0).contains(&h) { window.set_size(LogicalSize::new(w,h))?; }
        }
    }
    if let Some(pos) = saved["position"].as_array() {
        if let (Some(x), Some(y)) = (pos.first().and_then(|v| v.as_i64()), pos.get(1).and_then(|v| v.as_i64())) {
            let size = window.outer_size()?;
            if window.available_monitors()?.iter().any(|m| {
                let area = m.work_area();
                x >= area.position.x as i64 && y >= area.position.y as i64 &&
                x + size.width as i64 <= area.position.x as i64 + area.size.width as i64 &&
                y + size.height as i64 <= area.position.y as i64 + area.size.height as i64
            }) { window.set_position(PhysicalPosition::new(x as i32,y as i32))?; }
            else { window.center()?; }
        }
    }
    hit.enabled.store(saved["passthrough"].as_bool().unwrap_or(true), Ordering::SeqCst);
    window.set_always_on_top(saved["onTop"].as_bool().unwrap_or(true))?;
    Ok(())
}
pub fn snapshot(window: &WebviewWindow, hit: &HitState) -> Option<serde_json::Value> {
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?.to_logical::<f64>(window.scale_factor().ok()?);
    Some(serde_json::json!({"position":[position.x,position.y],"size":[size.width,size.height],
        "passthrough":hit.enabled.load(Ordering::SeqCst),"onTop":window.is_always_on_top().ok()?}))
}
pub fn watch_host(window: WebviewWindow, hit: Arc<HitState>, runtime: Arc<Runtime>, instance: Instance) {
    thread::spawn(move || {
        let mut registered = Vec::new();
        for (id,key) in [(1,0x52),(2,0x53),(3,0x20)] {
            if unsafe { RegisterHotKey(std::ptr::null_mut(),id,MOD_CONTROL|MOD_SHIFT|MOD_NOREPEAT,key) } != 0 { registered.push(id); }
            else { runtime.log(&format!("global shortcut {id} unavailable: {}", std::io::Error::last_os_error())); }
        }
        let mut previous = None;
        let mut saved = None;
        while !runtime.stop.load(Ordering::SeqCst) {
            if instance.requested() { let _ = tray::show_avatar(&window, &hit); }
            let mut message: MSG = unsafe { std::mem::zeroed() };
            while unsafe { PeekMessageW(&mut message,std::ptr::null_mut(),WM_HOTKEY,WM_HOTKEY,PM_REMOVE) } != 0 {
                if hit.resizing.load(Ordering::SeqCst) {
                    if message.wParam==1 { if let Some(editor)=window.app_handle().get_webview_window("resize-frame") {let _=editor.close();} }
                    continue;
                }
                match message.wParam {
                    1 => { let avatar = window.clone(); let state = hit.clone(); tauri::async_runtime::spawn(async move { if let Err(e)=resize::begin(&avatar,&state) { avatar.app_handle().state::<Arc<Runtime>>().log(&format!("resize shortcut: {e}")); } }); },
                    2 => tray::open_settings(window.app_handle(),false),
                    3 => chat::toggle(window.app_handle()), _ => {}
                }
            }
            let next = snapshot(&window,&hit);
            if next.is_some() && next == previous && next != saved && !hit.resizing.load(Ordering::SeqCst) {
                runtime.save(next.as_ref().unwrap()); saved = next.clone();
            }
            previous = next;
            thread::sleep(Duration::from_millis(250));
        }
        for id in registered { unsafe { UnregisterHotKey(std::ptr::null_mut(),id); } }
    });
}

pub fn log(app: &tauri::AppHandle, message: &str) {
    if let Some(runtime)=app.try_state::<Arc<Runtime>>() {runtime.log(message);}
    else {eprintln!("{message}");}
}
