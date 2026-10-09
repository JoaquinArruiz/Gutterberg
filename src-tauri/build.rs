use std::fs;

fn main() {
    // The pdfium build the app is made with is pinned in one place, `scripts/fetch-pdfium.sh` (tag="chromium/8086");
    // "Copy app info" in Preferences › Help reports it.
    let script = "../scripts/fetch-pdfium.sh";
    println!("cargo:rerun-if-changed={script}");
    let build = fs::read_to_string(script)
        .ok()
        .and_then(|text| {
            text.lines()
                .find_map(|l| l.trim().strip_prefix("tag=\"chromium/"))
                .and_then(|rest| rest.split('"').next().map(str::to_owned))
        })
        .unwrap_or_default();
    println!("cargo:rustc-env=PDFIUM_BUILD={build}");
    tauri_build::build()
}
