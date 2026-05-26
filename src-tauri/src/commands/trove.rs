use tauri::State;
use log::{info, error};

use crate::db::DbState;
use crate::ecs::{
    component::create_component, EntityId, WorldSnapshot, WorldState,
};

pub fn open_trove_impl(
    w: &mut crate::ecs::World,
    conn: &rusqlite::Connection,
    path: &str,
) -> Result<(), String> {
    w.clear();
    info!("World cleared");

    let mut file_count = 0;
    let mut dir_count = 0;

    let mut queue = std::collections::VecDeque::new();
    queue.push_back((std::path::PathBuf::from(path), None));

    while let Some((dir_path, parent_id)) = queue.pop_front() {
        let entries = std::fs::read_dir(&dir_path).map_err(|e| {
            error!("Failed to read directory {}: {}", dir_path.display(), e);
            format!("Failed to read directory: {}", e)
        })?;

        let mut paths = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|e| {
                error!("Failed to read entry: {}", e);
                e.to_string()
            })?;
            paths.push(entry.path());
        }

        // Sort paths alphabetically to keep scanning order stable within each directory
        paths.sort();

        for path in paths {
            let entity = w.create_entity();
            if let Some(pid) = parent_id {
                w.parent_ids.insert(entity, pid);
            }

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

                queue.push_back((path, Some(entity)));
            }
        }
    }

    info!("Processed {} files and {} directories", file_count, dir_count);

    // Persist
    w.save(conn).map_err(|e| {
        error!("Failed to save world: {}", e);
        format!("Failed to save world: {}", e)
    })?;
    info!("World saved successfully");

    Ok(())
}

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
    let conn = db.0.lock().map_err(|e| {
        error!("Failed to lock db: {}", e);
        e.to_string()
    })?;
    open_trove_impl(&mut w, &conn, &path)
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
    use tempdir::TempDir;

    #[test]
    fn test_open_trove_populates_world() {
        let temp_dir = TempDir::new("test_trove").unwrap();
        let file_path = temp_dir.path().join("test.png");
        std::fs::File::create(&file_path).unwrap();

        let mut world = crate::ecs::World::new();
        // Place database outside temp_dir so it is not scanned as an entity
        let db_path = temp_dir.path().parent().unwrap().join("test_populates.db");
        let conn = crate::db::init_db(&db_path).unwrap();

        let path = temp_dir.path().to_string_lossy().to_string();
        let result = open_trove_impl(&mut world, &conn, &path);
        assert!(result.is_ok());

        assert!(!world.entities.is_empty());
        // Check if renderFile component is added
        let has_render = world.components.values().any(|comps| comps.iter().any(|c| c.component_type() == "renderFile"));
        assert!(has_render);
    }

    #[test]
    fn test_open_trove_recursive_hierarchy() {
        let temp_dir = TempDir::new("test_trove_recursive").unwrap();
        
        // Create root file
        let root_file = temp_dir.path().join("root_file.txt");
        std::fs::File::create(&root_file).unwrap();

        // Create subfolder
        let sub_dir = temp_dir.path().join("sub_folder");
        std::fs::create_dir(&sub_dir).unwrap();

        // Create nested file in subfolder
        let nested_file = sub_dir.join("nested_file.txt");
        std::fs::File::create(&nested_file).unwrap();

        let mut world = crate::ecs::World::new();
        // Place database outside temp_dir so it is not scanned as an entity
        let db_path = temp_dir.path().parent().unwrap().join("test_recursive.db");
        let conn = crate::db::init_db(&db_path).unwrap();

        let path = temp_dir.path().to_string_lossy().to_string();
        let result = open_trove_impl(&mut world, &conn, &path);
        assert!(result.is_ok());

        // Assertions:
        // Check that we created 3 entities (root_file, sub_folder, nested_file)
        assert_eq!(world.entities.len(), 3);

        // Find the sub_folder entity
        let sub_folder_id = world.components.iter().find(|(_, comps)| {
            comps.iter().any(|c| {
                c.component_type() == "grid"
            })
        }).map(|(id, _)| *id).expect("Subfolder grid entity not found");

        // Find the nested_file entity
        let nested_file_id = world.components.iter().find(|(_, comps)| {
            comps.iter().any(|c| {
                if c.component_type() == "renderFile" {
                    if let serde_json::Value::Object(map) = c.settings() {
                        if let Some(serde_json::Value::String(path)) = map.get("targetPath") {
                            return path.contains("nested_file.txt");
                        }
                    }
                }
                false
            })
        }).map(|(id, _)| *id).expect("Nested file entity not found");

        // Verify parent-child relationship in World
        assert_eq!(world.parent_ids.get(&nested_file_id), Some(&sub_folder_id));
    }
}
