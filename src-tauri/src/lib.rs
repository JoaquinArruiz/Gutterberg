mod commands;
mod state;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::document::open_pdf,
            commands::layout::compute_layout,
            commands::export::export_document,
            commands::render::render_page,
            commands::render::render_region,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the PDF Card Editor");
}
