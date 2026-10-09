mod commands;
mod keychain;
mod state;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Opens the two About links in the browser; the capability allows exactly those URLs.
        .plugin(tauri_plugin_opener::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::ai::ai_delete_key,
            commands::ai::ai_detect_pieces,
            commands::ai::ai_estimate,
            commands::ai::ai_key_status,
            commands::ai::ai_set_enabled,
            commands::ai::ai_set_key,
            commands::ai::ai_sort_pages,
            commands::ai::ai_test_connection,
            commands::detect::detect_pieces,
            commands::document::open_pdf,
            commands::document::close_pdf,
            commands::project::open_project,
            commands::project::save_project_file,
            commands::project::hash_file,
            commands::project::file_exists,
            commands::layout::compute_layout,
            commands::sheets::compute_cards,
            commands::sheets::compute_sheets,
            commands::sheets::validate_print,
            commands::sheets::export_print,
            commands::export::export_document,
            commands::export::validate_export,
            commands::render::render_page,
            commands::render::render_region,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the PDF Card Editor");
}
