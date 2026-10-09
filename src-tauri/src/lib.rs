mod commands;
mod keychain;
mod state;

#[cfg(target_os = "macos")]
use tauri::Emitter;
use tauri::Manager;

/// The project file among the command-line arguments (Windows and Linux pass the double-clicked file there).
fn project_arg(args: impl IntoIterator<Item = String>) -> Option<String> {
    args.into_iter()
        .skip(1)
        .find(|a| !a.starts_with('-') && a.to_lowercase().ends_with(".gtr"))
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // The system's name and version, for "Copy app info" in Preferences › Help.
        .plugin(tauri_plugin_os::init())
        // Opens the two About links in the browser; the capability allows exactly those URLs.
        .plugin(tauri_plugin_opener::init())
        // Restarts the app after an update.
        .plugin(tauri_plugin_process::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::app_info::app_info,
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
            commands::images::build_images_document,
            commands::images::plan_images,
            commands::images::probe_images,
            commands::layout::compute_layout,
            commands::licenses::license_texts,
            commands::opened::take_opened_file,
            commands::sheets::compute_cards,
            commands::sheets::compute_sheets,
            commands::sheets::validate_print,
            commands::sheets::export_print,
            commands::export::export_document,
            commands::export::validate_export,
            commands::render::render_page,
            commands::render::render_region,
        ])
        .setup(|app| {
            // Checks for a new version and installs it; the web side drives both from Preferences.
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            if let Some(path) = project_arg(std::env::args()) {
                app.state::<state::AppState>().file_opened(path);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Gutterberg");

    app.run(|handle, event| {
        // macOS hands a double-clicked file to the running app as an event, not as an argument.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &event {
            for path in urls.iter().filter_map(|u| u.to_file_path().ok()) {
                let path = path.to_string_lossy().into_owned();
                if let Some(path) = handle.state::<state::AppState>().file_opened(path) {
                    let _ = handle.emit("opened-file", path);
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (handle, event);
    });
}

#[cfg(test)]
mod tests {
    use super::project_arg;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn finds_the_project_file_after_the_program_name() {
        assert_eq!(
            project_arg(args(&["gutterberg", "/tmp/My Cards.GTR"])),
            Some("/tmp/My Cards.GTR".into())
        );
    }

    #[test]
    fn ignores_flags_other_files_and_the_program_itself() {
        assert_eq!(project_arg(args(&["/opt/app.gtr"])), None);
        assert_eq!(project_arg(args(&["gutterberg", "--x.gtr", "a.pdf"])), None);
        assert_eq!(project_arg(args(&["gutterberg"])), None);
    }
}
