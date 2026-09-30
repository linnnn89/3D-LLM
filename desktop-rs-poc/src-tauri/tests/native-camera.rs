// Real WebView2/VRM regression, kept hidden so it does not take over the desktop.
use std::{sync::mpsc, thread, time::Duration};
use tauri::{LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

fn eval(window: &WebviewWindow, script: &str) -> serde_json::Value {
    let (tx, rx) = mpsc::channel();
    window.eval_with_callback(script, move |value| { let _ = tx.send(value); }).unwrap();
    serde_json::from_str(&rx.recv_timeout(Duration::from_secs(5)).unwrap()).unwrap()
}

fn wait_for(window: &WebviewWindow, expression: &str) {
    for _ in 0..160 {
        if eval(window, expression) == true { return; }
        thread::sleep(Duration::from_millis(250));
    }
    panic!("Timed out: {expression}. Start the Python server and make the local VRM assets available.");
}

fn verify(window: &WebviewWindow) {
    let css = serde_json::to_string(include_str!("../../../desktop/pet-overlay.css")).unwrap();
    wait_for(window, "Boolean(window.currentAdapter && window.activeMotionClips?.idle)");
    window.eval(format!("const style=document.createElement('style');style.textContent={css};document.head.appendChild(style);")).unwrap();
    // The host reset uses this production bridge; unrelated host IPC is disabled
    // because this test window only exercises rendering, not tray or hit testing.
    window.eval("window.__TAURI__.core.invoke=()=>Promise.resolve();").unwrap();
    window.eval(include_str!("../../avatar-bridge.js")).unwrap();

    for (name, id) in [("由比滨结衣", "zh_yuigahama_yui_01"), ("雷电将军", "zh_raiden_shogun_01")] {
        window.eval(format!("window.applyCharacterUI({});", serde_json::to_string(name).unwrap())).unwrap();
        wait_for(window, &format!("window.currentAdapter?.characterId === {} && Boolean(window.activeMotionClips?.idle)", serde_json::to_string(id).unwrap()));
        window.eval("window.currentAdapter.mixer.stopAllAction();window.playIdleMotion();").unwrap();
        thread::sleep(Duration::from_millis(600));
        for (width, height) in [(520.0,760.0),(340.0,500.0),(700.0,1000.0)] {
            window.set_size(LogicalSize::new(width,height)).unwrap();
            // WebView2 updates the window metrics before dispatching resize to
            // the renderer. Observe the camera and framebuffer after that event.
            wait_for(window, &format!("innerWidth === {width} && innerHeight === {height} && Math.abs(window.camera.aspect - {width}/{height}) < 1e-6 && window.renderer.getSize(new THREE.Vector2()).x === {width}"));
            window.eval("controls.target.set(1,2,3);camera.position.set(1,2,4);camera.zoom=2;camera.updateProjectionMatrix();window.__petHost.resetView();").unwrap();
            let result = eval(window, r#"(()=>{try{
                const vrm=currentAdapter.vrm, hips=vrm.humanoid.getNormalizedBoneNode('hips');
                const clip=window.activeMotionClips.idle, track=clip.tracks.find(t=>t.name===`${hips.name}.position`);
                const rest=vrm.humanoid.normalizedRestPose.hips.position;
                const projections=[];
                for(let i=0;i<12;i++){
                    currentAdapter.mixer.setTime(i*clip.duration/12);vrm.update(0);scene.updateMatrixWorld(true);camera.updateMatrixWorld();
                    const head=currentAdapter.resolveBone('head').getWorldPosition(new THREE.Vector3());projections.push(head.project(camera).x);
                }
                renderer.render(scene,camera);
                const gl=renderer.getContext(), buffer=[gl.drawingBufferWidth,gl.drawingBufferHeight];
                const pixels=new Uint8Array(buffer[0]*buffer[1]*4);gl.readPixels(0,0,...buffer,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
                return {id:currentAdapter.characterId,first:Array.from(track.values.slice(0,3)),rest,projections,
                    target:controls.target.toArray(),zoom:camera.zoom,aspect:camera.aspect,
                    window:[innerWidth,innerHeight],buffer,viewport:Array.from(gl.getParameter(gl.VIEWPORT)),
                    hasPixels:pixels.some((v,i)=>i%4===3&&v>127),dpr:renderer.getPixelRatio()};
            }catch(e){return {error:String(e)}}})()"#);
            assert!(result.get("error").is_none(), "{result}");
            assert_eq!(result["id"], id);
            for axis in [0,2] {
                assert!((result["first"][axis].as_f64().unwrap()-result["rest"][axis].as_f64().unwrap()).abs()<1e-6, "Fixed idle placement: {result}");
            }
            assert!(result["projections"].as_array().unwrap().iter().all(|x| x.as_f64().unwrap().abs()<0.20), "Head outside center 20% band: {result}");
            assert_eq!(result["target"], serde_json::json!([0,1.3,0]));
            assert_eq!(result["zoom"],1);
            assert!((result["aspect"].as_f64().unwrap()-width/height).abs()<1e-6, "Resize not synchronized: {result}");
            assert_eq!(result["viewport"][2],result["buffer"][0]);
            assert_eq!(result["viewport"][3],result["buffer"][1]);
            assert_eq!(result["hasPixels"],true);
            println!("PASS {id} {width}x{height} DPR {} head projection {}",result["dpr"],result["projections"]);
        }
    }
}

fn main() {
    tauri::Builder::default().setup(|app| {
        let window = WebviewWindowBuilder::new(app, "avatar", WebviewUrl::External("http://127.0.0.1:12393/vrm/".parse()?))
            .inner_size(520.0,760.0).visible(false).transparent(true).decorations(false).shadow(false).build()?;
        thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| verify(&window)));
            if result.is_err() { std::process::exit(1); }
            window.app_handle().exit(0);
        });
        Ok(())
    }).run(tauri::generate_context!()).unwrap();
}
