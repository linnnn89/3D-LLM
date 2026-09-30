# Rust / Tauri 2 desktop pet POC

This experiment loads the existing Python server's `/vrm/` page at
`http://127.0.0.1:12393/vrm/`. Start that server separately before running the POC.
The POC does not start or alter Python and does not replace `desktop/`.

From `desktop-rs-poc/src-tauri`, run `cargo run`. The single transparent,
always-on-top window receives explicit `avatar.hit_state` events from the renderer.
When it ignores cursor events, a Windows cursor watcher probes the renderer with
synthetic pointer moves so raycasting can turn interaction back on. Probes repeat
even when the cursor stops, so the renderer's throttling cannot discard the final
position permanently. The host embeds `desktop/pet-overlay.css` at build time and
applies it after each page load to clear the page background and hide the web UI.

The notification-area icon opens a native menu on left or right click. It provides
show/hide, three size presets, click-through and always-on-top switches, model-view reset,
page reload, global/character settings, and exit. Settings reuse the existing
backend pages in separate normal windows; saving requires the real Python API.
Window preferences are session-only in this POC. Electron's chat window, framing
presets and global shortcuts have not been migrated yet.

The tray and right-click menu share a “切换角色” submenu populated from the
backend's existing character list. It sends switch-config over the avatar's
existing WebSocket. The current-character check mark changes only after the
backend confirms the configuration; the submenu is disabled while disconnected.

Mouse controls in the borderless avatar window:

- Short left click: the existing character interaction.
- Left drag (6 px threshold): move the desktop window; it does not orbit the camera.
- Alt + left drag: orbit the model. Mouse wheel: zoom the model view.
- Right click: open the same native control menu as the tray.

While the right-click menu is open, the avatar remains interactive and pauses
hit-state updates and synthetic pointer probes. Selecting an item or dismissing
the menu releases that protection and resumes the normal click-through behavior.

“恢复模型居中（默认视角与比例）” resets the model's camera target, zoom,
and orientation inside the current window. The window's desktop position and size
remain unchanged. It reuses the renderer's reset-camera action, including clearing
pending OrbitControls damping; it does not reload the character or conversation.

The VRM idle clip removes the supplied animation's fixed X/Z placement when
retargeting to each character's rest hips. Relative sway and vertical breathing
remain intact, so the idle animation cannot undo a centered default camera by
continually moving the model to the left. One-shot motion translations are preserved.

“自由调整大小…” opens a separate transparent virtual frame on the avatar's current
monitor. Drag its corners to scale with the current aspect ratio, or drag the frame
to move it. Enter/确认 applies once; Escape/取消 closes without changing the avatar.
The avatar's animation loop is paused while the frame is open and resumes on exit.
The editor temporarily receives input over that monitor's work area. It uses local
bundled assets and a separate capability: the remote avatar page cannot apply bounds.

Renderer regression checks (no additional packages):
`node --test desktop-rs-poc/character-menu.test.cjs` verifies the backend list,
confirmed selection, failed switch, and disconnection without opening any UI.
`node desktop-rs-poc/interaction.test.cjs` from the repository root (uses the existing
`desktop/node_modules/electron` runtime and briefly shows its test windows).
Native verification still requires `cargo build --locked` and the actual Windows
app: drag outside its original bounds, test reset after pan/zoom, and confirm/cancel
the resize frame, including on a secondary monitor with a different DPI.

With the Python server running, `cargo test --release --locked --test native-camera`
from `desktop-rs-poc/src-tauri` checks the installed WebView2 with real local VRM
models and idle motion, window size changes, and view reset. Its window stays hidden.

If PowerShell cannot find Cargo, add the per-user Rust tools to this shell first:
`$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"`.
The avatar capability grants the local `127.0.0.1:12393` origin only hit-state,
native drag, context-menu, and character-menu synchronization commands. The bundled resize editor has its own
local capability for applying bounds. Tauri checks the remote page by origin, so the
capability cannot narrow the grant to `/vrm/` alone.

This is experimental. Do not use it as the production desktop host until WebGL
transparency and precise click-through pass the Windows device tests described in
the migration plan, including VRM/PMX, hide/show, DPI, monitor changes, and sleep.
