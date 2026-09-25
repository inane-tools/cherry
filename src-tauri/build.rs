fn main() {
    // The frontend is embedded from `../dist` at compile time, but Cargo does
    // not watch it — so `cargo build` after a frontend change kept shipping the
    // old UI (which is exactly how a stale payload masked a real bug). Watching
    // the built index + assets makes a frontend build dirty the crate again.
    println!("cargo:rerun-if-changed=../dist/index.html");
    println!("cargo:rerun-if-changed=../dist/assets");
    tauri_build::build()
}
