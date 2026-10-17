//! The command line says the app's version (`src-tauri/Cargo.toml`), the one a release bumps, so there is no second
//! version number to keep in step.

fn main() {
    let manifest = concat!(env!("CARGO_MANIFEST_DIR"), "/../../src-tauri/Cargo.toml");
    println!("cargo:rerun-if-changed={manifest}");
    let text = std::fs::read_to_string(manifest).expect("src-tauri/Cargo.toml");
    let version = text
        .lines()
        .find_map(|l| l.strip_prefix("version = \"")?.strip_suffix('"'))
        .expect("a version in src-tauri/Cargo.toml");
    println!("cargo:rustc-env=GUTTERBERG_VERSION={version}");
}
