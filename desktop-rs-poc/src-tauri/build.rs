fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&[
                "set_hit_state", "start_avatar_drag", "open_pet_menu", "finish_resize", "sync_character_menu",
            ])),
    )
    .expect("Tauri build configuration failed");

    // Tauri embeds its Common Controls v6 manifest in binaries only. The real
    // WebView2 test needs the same resource, otherwise TaskDialogIndirect fails
    // during Windows DLL loading before the test can start.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let resource = std::path::Path::new(&std::env::var("OUT_DIR").unwrap())
            .join("resource.lib");
        println!("cargo:rustc-link-arg-tests={}", resource.display());
    }
}
