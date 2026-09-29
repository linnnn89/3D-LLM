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
show/hide, three size presets, click-through and always-on-top switches, centering,
page reload, global/character settings, and exit. Settings reuse the existing
backend pages in separate normal windows; saving requires the real Python API.
Window preferences are session-only in this POC. Electron's chat window, framing
presets, freeform resize overlay, and global shortcuts have not been migrated yet.

If PowerShell cannot find Cargo, add the per-user Rust tools to this shell first:
`$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"`.
The Tauri capability grants the local `127.0.0.1:12393` origin only the
`set_hit_state` command. Tauri checks this remote page by origin, so the
capability cannot narrow the grant to `/vrm/` alone.

This is experimental. Do not use it as the production desktop host until WebGL
transparency and precise click-through pass the Windows device tests described in
the migration plan, including VRM/PMX, hide/show, DPI, monitor changes, and sleep.
