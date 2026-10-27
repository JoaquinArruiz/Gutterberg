mod app_log;
mod commands;
mod data_dirs;
mod keychain;
mod state;
mod store;

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
    // Before the web view exists: it opens its storage in the (renamed) data folder.
    data_dirs::migrate();
    app_log::init();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // The system's name and version, for "Copy app info" in Preferences › Help.
        .plugin(tauri_plugin_os::init())
        // Opens the two About links in the browser; the capability allows exactly those URLs.
        .plugin(tauri_plugin_opener::init())
        // Restarts the app after an update.
        .plugin(tauri_plugin_process::init())
        // Disable default browser shortcuts
        .plugin(tauri_plugin_prevent_default::init())
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
            commands::ai::ai_estimate_pairing,
            commands::ai::ai_pair_backs,
            commands::ai::ai_test_connection,
            commands::ai::ai_list_models,
            commands::calibration::save_calibration_sheet,
            commands::detect::detect_pieces,
            commands::detect::page_edges,
            commands::document::open_pdf,
            commands::document::close_pdf,
            commands::project::open_project,
            commands::project::save_project_file,
            commands::project::hash_file,
            commands::project::file_exists,
            commands::project::find_beside_project,
            commands::project::write_project_readme,
            commands::recovery::write_recovery,
            commands::recovery::clear_recovery,
            commands::recovery::find_recovery,
            commands::images::build_images_document,
            commands::images::plan_images,
            commands::images::probe_images,
            commands::layout::compute_layout,
            commands::licenses::license_texts,
            commands::log::read_log,
            commands::opened::take_opened_file,
            commands::sheets::compute_cards,
            commands::sheets::compute_sheets,
            commands::sheets::validate_print,
            commands::sheets::export_print,
            commands::export::export_document,
            commands::export::validate_export,
            commands::render::render_page,
            commands::render::render_region,
            commands::render::render_piece_region,
            commands::render::edge_colors,
        ])
        .setup(|app| {
            // Checks for a new version and installs it; the web side drives both from Preferences. A Store copy is
            // updated by the Store, so it has no updater.
            #[cfg(desktop)]
            if !store::is_store_install() {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            if let Some(path) = project_arg(std::env::args()) {
                app.state::<state::AppState>().file_opened(path);
            }
            app_log::line("info", "ready: the app is set up");
            Ok(())
        })
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            app_log::line("error", &format!("could not start: {e}"));
            eprintln!("Gutterberg: could not start: {e}");
            std::process::exit(1)
        });

    app.run(|handle, event| {
        // The end of the story, for a log that says how a run stopped.
        match &event {
            tauri::RunEvent::Ready => app_log::line("info", "running: the window is up"),
            tauri::RunEvent::ExitRequested { code, .. } => {
                app_log::line("info", &format!("exit requested (code {code:?})"))
            }
            tauri::RunEvent::Exit => app_log::line("info", "exit"),
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed,
                ..
            } => app_log::line("info", &format!("window {label}: closing")),
            _ => {}
        }
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
        let _ = handle;
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
