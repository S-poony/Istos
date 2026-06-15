pub mod commands;
pub mod db;
pub mod ecs;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let _app_handle = app.handle().clone();
            let db_path = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir")
                .join("deskshell.db");

            // Ensure the data directory exists
            std::fs::create_dir_all(db_path.parent().unwrap()).ok();

            // Initialize database
            let conn = db::init_db(&db_path).expect("failed to initialize database");

            // Load or create world
            let world = ecs::World::load_or_create(&conn);

            // Store connection and world in app state
            app.manage(db::DbState(std::sync::Mutex::new(conn)));
            app.manage(ecs::WorldState(std::sync::Mutex::new(world)));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::trove::open_trove,
            commands::trove::get_world_state,
            commands::trove::add_component,
            commands::trove::remove_component,
            commands::trove::update_component_settings,
            commands::trove::reorder_children,
            commands::trove::move_entity,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
