fn main() {
    // A debug build (cargo test, tauri dev) runs outside the app bundle, where Contents/Frameworks holds Sparkle.framework.
    // Let it load the copy scripts/sparkle.mjs put in this folder. A release build finds it in the bundle only.
    if std::env::var("PROFILE").as_deref() == Ok("debug") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", env!("CARGO_MANIFEST_DIR"));
    }
    tauri_build::build()
}
