// Native WebView2 / host integration. No LLM request or microphone capture.
#[path="../src/host.rs"] mod host;
#[path="../src/chat.rs"] mod chat;
#[path="../src/tray.rs"] mod tray;
#[path="../src/resize.rs"] mod resize;
use std::{path::PathBuf,sync::{Arc, atomic::{AtomicBool,Ordering},mpsc}, thread,time::Duration};
use tauri::{Manager,WebviewWindow,WebviewUrl,WebviewWindowBuilder,LogicalSize,PhysicalPosition};
struct HitState { ignoring:AtomicBool,enabled:AtomicBool,dragging:AtomicBool,resizing:AtomicBool,menu_open:AtomicBool }
fn eval(window:&WebviewWindow,script:&str)->serde_json::Value {
    let(tx,rx)=mpsc::channel();window.eval_with_callback(script,move|value|{let _=tx.send(value);}).unwrap();
    serde_json::from_str(&rx.recv_timeout(Duration::from_secs(10)).unwrap()).unwrap()
}
fn wait(window:&WebviewWindow, expression:&str) {
    for _ in 0..480 {if eval(window,expression)==true{return;}thread::sleep(Duration::from_millis(250));}
    panic!("Timeout waiting for {expression}");
}
fn temp_for_reuse()->std::path::PathBuf {std::env::temp_dir().join(format!("pet-host-test-{}-reuse",std::process::id()))}
fn main(){
    let external=std::net::TcpStream::connect("127.0.0.1:12393").is_ok();
    let temp=std::env::temp_dir().join(format!("pet-host-test-{}",std::process::id()));
    let runtime=Arc::new(host::Runtime::with_storage(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap(),temp.clone()).unwrap());
    let hit=Arc::new(HitState{ignoring:AtomicBool::new(false),enabled:AtomicBool::new(true),dragging:AtomicBool::new(false),resizing:AtomicBool::new(false),menu_open:AtomicBool::new(false)});
    let instance=host::Instance::acquire().unwrap().expect("Close existing Rust pet before native host test");
    assert!(host::Instance::acquire().unwrap().is_none(),"Second instance must not own backend/windows");
    let rt=runtime.clone();let hs=hit.clone();
    let app=tauri::Builder::default().manage(runtime.clone()).manage(hit.clone()).manage(chat::ChatState::default())
        .invoke_handler(tauri::generate_handler![chat::chat_snapshot,chat::chat_action,chat::sync_chat,tray::sync_character_menu,resize::finish_resize])
        .setup(move|app|{
            let window=WebviewWindowBuilder::new(app,"avatar",WebviewUrl::App("startup.html".into()))
                .visible(false).inner_size(520.0,760.0).on_page_load(|window,payload|{
                    if payload.event()==tauri::webview::PageLoadEvent::Finished && window.url().unwrap().host_str()==Some("127.0.0.1") {
                        // Cursor commands are outside this host-lifecycle regression.
                        let _=window.eval("const originalInvoke=window.__TAURI__.core.invoke;window.__TAURI__.core.invoke=(cmd,args)=>cmd==='set_hit_state'?Promise.resolve():originalInvoke(cmd,args);");
                        let _=window.eval(include_str!("../../avatar-bridge.js"));
                    }
                }).build()?;
            tray::install(app,&window,hs.clone())?;
            let _instance = instance;
            // Background test must not consume the second-instance show request.
            app.manage(_instance);
            host::start_backend(window.clone(),rt.clone());
            let rt=rt.clone();let hs=hs.clone();
            thread::spawn(move||{
                let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
                    wait(&window,"window.__petHost?.ready().ready && window.__petHost.ready().connected && Boolean(window.currentAdapter)");
                    println!("PASS backend HTTP readiness and live renderer WebSocket");
                    window.set_size(LogicalSize::new(340.0,500.0)).unwrap();window.set_position(PhysicalPosition::new(150,180)).unwrap();
                    hs.enabled.store(false,Ordering::SeqCst);window.set_always_on_top(false).unwrap();
                    let snapshot=host::snapshot(&window,&hs).unwrap();rt.save(&snapshot);
                    window.set_size(LogicalSize::new(520.0,760.0)).unwrap();hs.enabled.store(true,Ordering::SeqCst);
                    host::restore(&window,&rt,&hs).unwrap();
                    assert_eq!(host::snapshot(&window,&hs).unwrap(),snapshot);println!("PASS persisted size, position and menu preferences");
                    window.eval("window.__petHost.freeze('hidden');window.__petHost.freeze('resize');").unwrap();
                    assert_eq!(eval(&window,"window.__petHost.ready().paused.length"),2);
                    window.eval("window.__petHost.resume('resize');").unwrap();
                    assert_eq!(eval(&window,"window.__petHost.ready().paused"),serde_json::json!(["hidden"]));
                    window.eval("window.__petHost.resume('hidden');").unwrap();println!("PASS independent pause reasons and resume");
                    let app=window.app_handle().clone();chat::open_with_visibility(&app,false);
                    let chat=loop {if let Some(chat)=app.get_webview_window("chat"){break chat;}thread::sleep(Duration::from_millis(50));};
                    wait(&chat,"Boolean(window.petChat && document.getElementById('input'))");
                    println!("BACKGROUND_UI pid={} hwnd=0x{:X}",std::process::id(),chat.hwnd().unwrap().0 as usize);
                    std::fs::write(rt.root.join("desktop-rs-poc/src-tauri/target/native-host-ui.json"),
                        serde_json::json!({"pid":std::process::id(),"hwnd":format!("0x{:X}",chat.hwnd().unwrap().0 as usize)}).to_string()).unwrap();
                    if std::env::var_os("PET_HOST_BACKGROUND_INSPECT").is_some() {thread::sleep(Duration::from_secs(45));}
                    // A native IPC round trip uses an isolated renderer send recorder.
                    window.eval("window.sent=[];window.__petRenderer.send=message=>{window.sent.push(message);return {ok:true};};").unwrap();
                    chat.eval("document.getElementById('input').value='native-host-regression';document.getElementById('btn-send').click();").unwrap();
                    wait(&window,"window.sent?.length===1");
                    assert_eq!(eval(&window,"window.sent[0].type"),"text-input");
                    assert_eq!(eval(&window,"window.sent[0].text"),"native-host-regression");
                    window.eval("window.dispatchEvent(new CustomEvent('desktop-bridge',{detail:{type:'avatar.chat',message:{type:'full-text',text:'native-reply'}}}));").unwrap();
                    wait(&chat,"document.getElementById('log').textContent.includes('native-reply')");
                    chat.eval("document.getElementById('btn-collapse').click();").unwrap();
                    for _ in 0..40 {if (chat.inner_size().unwrap().to_logical::<f64>(chat.scale_factor().unwrap()).height-58.0).abs()<=1.0/chat.scale_factor().unwrap() {break;}thread::sleep(Duration::from_millis(50));}
                    assert!((chat.inner_size().unwrap().to_logical::<f64>(chat.scale_factor().unwrap()).height-58.0).abs()<=1.0/chat.scale_factor().unwrap());
                    chat.eval("window.stoppedTracks=0;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>new Promise(resolve=>window.resolveMic=resolve)}});document.getElementById('btn-mic').click();document.getElementById('btn-hide').click();setTimeout(()=>resolveMic({getTracks:()=>[{stop(){window.stoppedTracks++;}}]}),500);").unwrap();
                    wait(&chat,"window.stoppedTracks===1");
                    println!("PASS pending microphone capture released after hide (isolated media stub)");
                    for _ in 0..40 {if !chat.is_visible().unwrap(){break;}thread::sleep(Duration::from_millis(50));}
                    assert!(!chat.is_visible().unwrap());
                    println!("PASS native chat input, single-viewport relay, reply, collapse and hide");
                    let reused=Arc::new(host::Runtime::with_storage(rt.root.clone(),temp_for_reuse()).unwrap());
                    host::start_backend(window.clone(),reused.clone());
                    thread::sleep(Duration::from_millis(1200));
                    reused.shutdown();
                    assert!(std::net::TcpStream::connect("127.0.0.1:12393").is_ok(),"Reused backend must survive secondary host shutdown");
                    println!("PASS reused backend preserved on secondary host shutdown");
                    app.exit(0);
                }));
                if result.is_err(){rt.shutdown();std::process::exit(1);}
            });Ok(())
        }).build(tauri::generate_context!()).unwrap();
    app.run(move|_,event|{if matches!(event,tauri::RunEvent::Exit){runtime.shutdown();}});
    if !external {
        assert!(std::net::TcpStream::connect("127.0.0.1:12393").is_err(),"Owned backend must stop with the host");
        println!("PASS owned backend port released on exit");
    } else {
        assert!(std::net::TcpStream::connect("127.0.0.1:12393").is_ok(),"Reused backend must remain running");
        println!("PASS externally started backend preserved on exit");
    }
    thread::sleep(Duration::from_millis(300));
    std::fs::remove_dir_all(temp).unwrap();
}
