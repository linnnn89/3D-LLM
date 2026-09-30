'use strict';

// Exercise the renderer in the project's existing Chromium runtime. Native Tauri
// commands are captured at the IPC boundary; this does not certify Windows moves.
const path = require('node:path');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(path.join(__dirname, '../desktop/node_modules/electron/dist/electron.exe'),
    [__filename], { env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const { app, BrowserWindow } = require('electron');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'vrm_frontend/app.js'), 'utf8');
const clickInteraction = source.slice(source.indexOf('function initClickInteraction()'), source.indexOf('// --- 5. WebSocket'));
const renderLoop = source.slice(source.indexOf('const renderPauseReasons'), source.indexOf("window.addEventListener('DOMContentLoaded'"));
const resetCamera = source.slice(source.indexOf('function resetCamera()'), source.indexOf('// --- 7. Microphone'));
const server = http.createServer((request, response) => {
  const routes = {
    '/three.js': 'vrm_frontend/libs/three.module.js',
    '/controls.js': 'vrm_frontend/libs/OrbitControls.js',
    '/resize.html': 'desktop-rs-poc/ui/resize-frame.html'
  };
  const file = routes[request.url];
  if (!file) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'text/javascript');
  response.end(fs.readFileSync(path.join(root, file)));
});
let port;
const ready = (async () => {
  await app.whenReady();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
})();
app.on('window-all-closed', () => {});
let failed = false;
after(() => {
  server.close();
  setTimeout(() => app.exit(failed ? 1 : 0), 100);
});

async function viewport() {
  await ready;
  const window = new BrowserWindow({ show: false, width: 600, height: 800,
    webPreferences: { backgroundThrottling: false } });
  const firstPaint = new Promise(resolve => window.once('ready-to-show', resolve));
  await window.loadURL(`http://127.0.0.1:${port}/resize.html`);
  await firstPaint;
  await window.webContents.executeJavaScript(`(async () => {
    document.body.innerHTML = '<div id="canvas-container"><canvas style="width:600px;height:800px"></canvas></div><button id="btn-reset-cam"></button>';
    const map = document.createElement('script'); map.type = 'importmap';
    map.textContent = JSON.stringify({imports:{three:'/three.js'}}); document.head.appendChild(map);
    const THREE = await import('/three.js');
    const { OrbitControls } = await import('/controls.js');
    const renderer = {domElement:document.querySelector('canvas'),render(){ window.frames++; }};
    window.frames=0;
    const scene={}; const clock=new THREE.Clock(); const clampFrameDelta=(d,max)=>Math.min(d,max);
    let ws=null; const sendTextMessage=()=>{},interruptSpeech=()=>{};
    const camera = new THREE.PerspectiveCamera(30, 600/800, 0.1, 20);
    camera.position.set(0,1.36,1.25);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0,1.30,0); controls.enableDamping = true; controls.update();
    Object.assign(window, {camera,controls,calls:[],clicks:0});
    window.inputTrace = [];
    for (const type of ['pointerdown','pointerup','contextmenu','blur']) window.addEventListener(type,
      event => inputTrace.push({type,button:event.button,alt:event.altKey,x:event.clientX,y:event.clientY,target:event.target.tagName}),true);
    window.__TAURI__ = {core:{invoke:async (command,args) => window.calls.push({command,args})}};
    const currentAdapter = null, currentVrm = null;
    const clickMouse = new THREE.Vector2(), clickRaycaster = new THREE.Raycaster();
    const handleModelClick = () => window.clicks++;
    ${clickInteraction}
    ${resetCamera}
    ${renderLoop}
    animate();
    initClickInteraction();
    document.getElementById('btn-reset-cam').onclick = resetCamera;
  })()`);
  await window.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, 'avatar-bridge.js'), 'utf8'));
  window.show(); window.focus(); window.webContents.focus();
  // Wait for the replacement canvas to reach the compositor before sending input.
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  return window;
}
const heldButtons = new WeakMap();
async function input(window, type, x, y, button = 'left', modifiers = []) {
  // Electron requires a focused BrowserWindow for sendInputEvent (official contract).
  window.show(); window.focus(); window.webContents.focus();
  await new Promise(resolve => setTimeout(resolve, 30));
  if (type === 'mouseDown') {
    window.webContents.sendInputEvent({type:'mouseMove',x,y});
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  if (type === 'mouseMove' && heldButtons.has(window)) {
    modifiers = [...modifiers, `${heldButtons.get(window)}buttondown`];
  }
  const bounds = window.getContentBounds();
  window.webContents.sendInputEvent({ type, x, y, globalX: bounds.x + x, globalY: bounds.y + y,
    button, modifiers, clickCount: 1 });
  if (type === 'mouseDown') heldButtons.set(window, button);
  if (type === 'mouseUp') heldButtons.delete(window);
  await new Promise(resolve => setTimeout(resolve, 20));
}
async function scenario(body) {
  try { await body(); } catch (error) { failed = true; console.error(error); throw error; }
}

test('left click interacts; left drag moves only the host; Alt orbits; right click opens menu', () => scenario(async () => {
  const window = await viewport();
  try {
    await input(window, 'mouseDown', 250, 250);
    await input(window, 'mouseUp', 250, 250);
    assert.equal(await window.webContents.executeJavaScript('window.clicks'), 1,
      JSON.stringify(await window.webContents.executeJavaScript('({trace:inputTrace,calls,focus:document.hasFocus()})')));
    const before = await window.webContents.executeJavaScript('camera.position.toArray()');
    await input(window, 'mouseDown', 250, 250);
    await input(window, 'mouseMove', 290, 280);
    await input(window, 'mouseMove', 320, 300);
    await input(window, 'mouseUp', 320, 300);
    const dragged = await window.webContents.executeJavaScript('({clicks,position:camera.position.toArray(),calls,enabled:controls.enabled})');
    assert.equal(dragged.clicks, 1);
    assert.deepEqual(dragged.position, before);
    assert.equal(dragged.calls.filter(call => call.command === 'start_avatar_drag').length, 1);
    assert.equal(dragged.enabled, true);
    await input(window, 'mouseDown', 250, 250, 'left', ['alt']);
    await input(window, 'mouseMove', 350, 280, 'left', ['alt']);
    await input(window, 'mouseUp', 350, 280, 'left', ['alt']);
    assert.notDeepEqual(await window.webContents.executeJavaScript('camera.position.toArray()'), before);
    assert.equal(await window.webContents.executeJavaScript('window.clicks'), 1);
    await input(window, 'mouseDown', 250, 250, 'right');
    await input(window, 'mouseUp', 250, 250, 'right');
    assert.equal(await window.webContents.executeJavaScript('calls.filter(call => call.command === "open_pet_menu").length'), 1);
    assert.equal(await window.webContents.executeJavaScript('window.clicks'), 1);
    const popup = await window.webContents.executeJavaScript(`(async () => {
      calls.length = 0;
      let dismiss, probes = 0;
      window.__TAURI__.core.invoke = (command,args) => {
        calls.push({command,args});
        return command === 'open_pet_menu' ? new Promise(resolve => { dismiss = resolve; }) : Promise.resolve();
      };
      const canvas = document.querySelector('canvas');
      const countProbe = () => probes++;
      canvas.addEventListener('pointermove', countProbe);
      const open = () => canvas.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true}));
      const hover = () => window.dispatchEvent(new CustomEvent('desktop-bridge', {detail:{type:'avatar.hit_state',hit:false}}));
      const probe = () => window.dispatchEvent(new CustomEvent('__pet-pointer', {detail:{x:250,y:250}}));
      open(); hover(); probe(); open();
      const during = {menus:calls.filter(c=>c.command==='open_pet_menu').length,
        hitUpdates:calls.filter(c=>c.command==='set_hit_state').length,probes};
      dismiss();
      await new Promise(resolve => setTimeout(resolve,0));
      hover(); probe();
      canvas.removeEventListener('pointermove', countProbe);
      return {during,after:{hitUpdates:calls.filter(c=>c.command==='set_hit_state').length,probes}};
    })()`);
    assert.deepEqual(popup.during, {menus:1,hitUpdates:0,probes:0});
    assert.ok(popup.after.hitUpdates >= 1);
    assert.equal(popup.after.probes, 1);
  } finally { window.destroy(); }
}));

test('reset restores camera target, orientation and zoom with no residual damping drift', () => scenario(async () => {
  const window = await viewport();
  try {
    await input(window, 'mouseDown', 250, 250, 'left', ['alt']);
    await input(window, 'mouseMove', 350, 300, 'left', ['alt']);
    await input(window, 'mouseUp', 350, 300, 'left', ['alt']);
    const result = await window.webContents.executeJavaScript(`(() => {
      controls.target.set(1,2,3); camera.zoom = 2;
      window.__petHost.resetView();
      for (let i = 0; i < 60; i++) controls.update();
      return {position:camera.position.toArray(), target:controls.target.toArray(), zoom:camera.zoom, damping:controls.enableDamping};
    })()`);
    result.position.forEach((value, index) => assert.ok(Math.abs(value - [0,1.36,1.25][index]) < 1e-10));
    assert.deepEqual(result.target, [0,1.3,0]);
    assert.equal(result.zoom, 1);
    assert.equal(result.damping, true);
    const animation = await window.webContents.executeJavaScript(`(async () => {
      const original=requestAnimationFrame;
      window.__petHost.freeze('hidden'); window.__petHost.freeze('resize');
      const before=window.frames;
      let unrelated=0; requestAnimationFrame(()=>unrelated++);
      await new Promise(resolve=>setTimeout(resolve,40));
      const paused=window.frames===before;
      window.__petHost.resume('resize');
      await new Promise(resolve=>setTimeout(resolve,40));
      const stillPaused=window.frames===before;
      window.__petHost.resume('hidden');
      await new Promise(resolve=>setTimeout(resolve,40));
      return {paused,stillPaused,resumed:window.frames>before,unrelated,untouched:original===requestAnimationFrame};
    })()`);
    assert.deepEqual(animation, {paused:true,stillPaused:true,resumed:true,unrelated:1,untouched:true});
  } finally { window.destroy(); }
}));

test('virtual frame keeps aspect on negative-origin monitor and commits only on confirmation; Escape cancels', () => scenario(async () => {
  await ready;
  const window = new BrowserWindow({ show: false, width: 1920, height: 1040 });
  try {
    await window.loadURL(`http://127.0.0.1:${port}/resize.html`);
    const initialize = `window.dispatchEvent(new CustomEvent('__pet-resize-init', {detail:{origin:{x:-1920,y:80},work:{width:1920,height:1040},rect:{x:-1700,y:200,width:520,height:760},aspect:520/760,minWidth:200}}));`;
    await window.webContents.executeJavaScript(`window.calls=[];window.__TAURI__={core:{invoke:async(command,args)=>calls.push({command,args})}};${initialize}`);
    await input(window, 'mouseDown', 220, 120);
    await input(window, 'mouseMove', 285, 215);
    await input(window, 'mouseUp', 285, 215);
    assert.equal(await window.webContents.executeJavaScript('calls.length'), 0);
    await window.webContents.executeJavaScript('document.getElementById("btn-ok").click()');
    const applied = await window.webContents.executeJavaScript('calls[0]');
    assert.equal(applied.command, 'finish_resize');
    applied.args.rect.forEach((value, index) => assert.ok(Math.abs(value - [-1635,295,455,665][index]) < 1e-8));
    await window.loadURL(`http://127.0.0.1:${port}/resize.html`);
    await window.webContents.executeJavaScript(`window.calls=[];window.__TAURI__={core:{invoke:async(command,args)=>calls.push({command,args})}};${initialize}`);
    window.show(); window.focus(); window.webContents.focus();
    await new Promise(resolve => setTimeout(resolve, 50));
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(await window.webContents.executeJavaScript('calls'), [{command:'finish_resize',args:{rect:null}}]);
  } finally { window.destroy(); }
}));
