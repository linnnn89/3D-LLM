# Rust / Tauri 2 desktop pet POC

The Rust host loads the existing Python server's `/vrm/` page at
`http://127.0.0.1:12393/vrm/`. Run `app/桌宠-Rust.exe` inside this repository,
or `cargo run` from `desktop-rs-poc/src-tauri`. The host resolves the repository
from its executable directory (then working directory), reuses a ready backend,
or starts the existing `.venv/Scripts/python.exe`. HTTP readiness checks the
renderer script before navigating; startup waits up to 120 seconds and displays
errors in the startup window. No environment installation is performed. Host-started
Python runs offline for Hugging Face assets; install required models separately.
Python stderr is not copied into a second host file. Backend details use
`logs/backend_*.log`; failures before logger initialization may require starting
`run_server.py` in a terminal for diagnostics.

A Windows named mutex prevents duplicate hosts. Starting again requests the
existing avatar to show. A Windows Job Object owns only the backend started by
this host and its descendants; exiting releases them. An externally started
backend remains running. This does not replace the Electron startup shortcut.

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
Window position, size, click-through and always-on-top are saved after stable
changes to `%LOCALAPPDATA%/3D-LLM-Rust/pet-state.json`. Saved positions are restored
only when the full window fits a current monitor work area; otherwise it is centered.
Rust does not read or overwrite Electron's preferences.

“聊天…” opens the shared `desktop/chat.html` UI, bundled by the Tauri build.
Its Tauri adapter relays text, PCM microphone blocks and interruption through the
avatar's existing WebSocket, and relays display/status events back to the chat
window. No second conversation connection is created. The host keeps at most
300 display messages in memory. Hide, blur auto-hide and close stop microphone
capture. Collapse and pin are session preferences. The chat window is 400×240,
collapsible to 400×58. Chat and resize capabilities are local-only.

Global shortcuts: Ctrl+Shift+Space toggles chat; Ctrl+Shift+R opens the resize
frame (press again to cancel); Ctrl+Shift+S opens settings. Shortcut conflicts
are recorded in the bounded host log; tray actions remain available.
Electron's bust/half/full framing presets and desktop corner-docking action
are still not migrated. The avatar remains focusable and present in Alt+Tab;
no claim of non-activation is made.

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
The renderer's own animation loop pauses while the frame is open. Hidden and
resize pauses have independent reasons: leaving resize does not resume a hidden
avatar. Show resumes the hidden reason, resets the frame delta and preserves the
WebSocket/audio conversation. The host no longer replaces global
`requestAnimationFrame`; unrelated page callbacks continue. Hidden cursor probing
backs off to 250 ms, visible probing uses 33 ms, and destruction/exit stops it.
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

Bridge contracts are in `protocol/desktop-bridge.schema.json`. `avatar.ready`
announces the versioned API; `__petRenderer.snapshot()` reports scene readiness,
connection and pause reasons. `resetView`, `setPaused` and `send` return explicit
results. The host's `__petHost` delegates to these methods rather than hidden DOM
buttons. Display relay deliberately excludes encoded audio payloads.

Logging policy: entry points configure Loguru once, INFO normally and DEBUG only
with `run_server.py --verbose`. Exception local-variable dumps are disabled.
Backend/explicit-upgrade logs rotate at 2 MB; closed files are retained up to
14 days and a 20 MB budget, checked at startup/rotation. The active file can add
approximately 2 MB. Legacy `debug_*`, `upgrade_*` files and manually redirected
probe logs are left intact. Chat history and backups are not log-cleanup targets.
Rust's sparse host diagnostics use `%LOCALAPPDATA%/3D-LLM-Rust/host.log` with
1 MB rotation and two backups. Electron writes asynchronously with 2 MB rotation
and three backups, and drains Python stdout/stderr without duplicating their
contents. Chat history still lives in the repository `chat_history/` directory;
it is not part of the Documents storage migration.

`cargo test --release --locked --test native-host` runs real WebView2 startup,
single-instance, state persistence, independent pause reasons and shared chat UI
native IPC scenarios. It uses a temporary host state directory and hidden WebView2/chat test windows,
without acquiring foreground focus. It replaces renderer sending for the test text, so it does not
make LLM requests or validate real ASR/TTS. Run with no Rust pet already open.
