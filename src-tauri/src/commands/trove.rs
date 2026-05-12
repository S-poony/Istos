use tauri::State;
use log::{info, error};

use crate::db::DbState;
use crate::ecs::{
    component::create_component, EntityId, WorldSnapshot, WorldState,
};

/// Opens a trove folder and populates the world with entities.
#[tauri::command]
pub fn open_trove(
    world: State<'_, WorldState>,
    db: State<'_, DbState>,
    path: String,
) -> Result<(), String> {
    info!("Opening trove at path: {}", path);
    let mut w = world.0.lock().map_err(|e| {
        error!("Failed to lock world: {}", e);
        e.to_string()
    })?;
    w.clear();
    info!("World cleared");

    // Scan the folder
    let entries = std::fs::read_dir(&path).map_err(|e| {
        error!("Failed to read directory {}: {}", path, e);
        format!("Failed to read directory: {}", e)
    })?;

    let mut file_count = 0;
    let mut dir_count = 0;
    for entry in entries {
        let entry = entry.map_err(|e| {
            error!("Failed to read entry: {}", e);
            e.to_string()
        })?;
        let path = entry.path();
        let entity = w.create_entity();

        if path.is_file() {
            // Add renderFile component for any file
            let component = create_component("renderFile", serde_json::json!({
                "targetPath": path.to_string_lossy(),
                "scale": 1.0,
                "position": {"x": 0, "y": 0}
            })).ok_or_else(|| {
                error!("Failed to create renderFile component for {}", path.display());
                "Failed to create renderFile component".to_string()
            })?;
            w.add_component(entity, component);
            file_count += 1;
        } else if path.is_dir() {
            // Add grid component
            let component = create_component("grid", serde_json::json!({
                "columns": 3,
                "gap": 10
            })).ok_or_else(|| {
                error!("Failed to create grid component for dir {}", path.display());
                "Failed to create grid component".to_string()
            })?;
            w.add_component(entity, component);

            // Add renderFile component so the folder is visible
            let render_component = create_component("renderFile", serde_json::json!({
                "targetPath": path.to_string_lossy(),
                "scale": 1.0,
                "position": {"x": 0, "y": 0}
            })).ok_or_else(|| {
                error!("Failed to create renderFile component for dir {}", path.display());
                "Failed to create renderFile component".to_string()
            })?;
            w.add_component(entity, render_component);

            dir_count += 1;
        }
    }
    info!("Processed {} files and {} directories", file_count, dir_count);

    // Persist
    let conn = db.0.lock().map_err(|e| {
        error!("Failed to lock db: {}", e);
        e.to_string()
    })?;
    w.save(&conn).map_err(|e| {
        error!("Failed to save world: {}", e);
        format!("Failed to save world: {}", e)
    })?;
    info!("World saved successfully");

    Ok(())
}

/// Returns the full world state to the frontend.
#[tauri::command]
pub fn get_world_state(
    world: State<'_, WorldState>,
) -> Result<WorldSnapshot, String> {
    let w = world.0.lock().map_err(|e| e.to_string())?;
    let snapshot = WorldSnapshot::from(&*w);
    Ok(snapshot)
}

/// Adds a component to an entity.
#[tauri::command]
pub fn add_component(
    world: State<'_, WorldState>,
    db: State<'_, DbState>,
    entity_id: u64,
    component_type: String,
    settings: serde_json::Value,
) -> Result<(), String> {
    let mut w = world.0.lock().map_err(|e| e.to_string())?;

    if !w.entities.contains(&EntityId::new(entity_id)) {
        return Err(format!("Entity {} not found", entity_id));
    }

    let component =
        create_component(&component_type, settings).ok_or_else(|| {
            format!("Unknown component type: {}", component_type)
        })?;

    w.add_component(EntityId::new(entity_id), component);

    // Persist
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    w.save(&conn).map_err(|e| e.to_string())?;

    Ok(())
}

/// Removes a component from an entity.
#[tauri::command]
pub fn remove_component(
    world: State<'_, WorldState>,
    db: State<'_, DbState>,
    entity_id: u64,
    component_type: String,
) -> Result<(), String> {
    let mut w = world.0.lock().map_err(|e| e.to_string())?;
    w.remove_component(&EntityId::new(entity_id), &component_type);

    // Persist
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    w.save(&conn).map_err(|e| e.to_string())?;

    Ok(())
}

/// Updates the settings of a component on an entity.
#[tauri::command]
pub fn update_component_settings(
    world: State<'_, WorldState>,
    db: State<'_, DbState>,
    entity_id: u64,
    component_type: String,
    settings: serde_json::Value,
) -> Result<(), String> {
    let mut w = world.0.lock().map_err(|e| e.to_string())?;
    let eid = EntityId::new(entity_id);

    if let Some(comps) = w.components.get_mut(&eid) {
        for comp in comps.iter_mut() {
            if comp.component_type() == component_type {
                comp.update_settings(settings.clone());
            }
        }
    }

    // Persist
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    w.save(&conn).map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use rusqlite::Connection;
    use tempdir::TempDir;

    #[test]
    fn test_open_trove_populates_world() {
        let temp_dir = TempDir::new("test_trove").unwrap();
        let file_path = temp_dir.path().join("test.png");
        std::fs::File::create(&file_path).unwrap();

        let world = WorldState(Mutex::new(crate::ecs::World::new()));
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_db(&std::path::Path::new(":memory:")).unwrap(); // Wait, no
        // For in-memory, init_db with a dummy path? Wait, init_db opens the path.
        // Better to use a temp file.
        let db_path = temp_dir.path().join("test.db");
        let conn = crate::db::init_db(&db_path).unwrap();
        let db = DbState(Mutex::new(conn));

        let path = temp_dir.path().to_string_lossy().to_string();
        let result = open_trove(world, db, path);
        assert!(result.is_ok());

        let w = world.0.lock().unwrap();
        assert!(!w.entities.is_empty());
        // Check if renderFile component is added
        let has_render = w.components.values().any(|comps| comps.iter().any(|c| c.component_type() == "renderFile"));
        assert!(has_render);
    }
}
