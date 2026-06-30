use tauri::State;
use log::{info, error};

use crate::db::DbState;
use crate::ecs::{
    component::create_component, EntityId, WorldSnapshot, WorldState,
};
use std::path::PathBuf;

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

        // Sort paths: directories first (alphabetically), then files (alphabetically)
        paths.sort_by(|a, b| {
            let a_is_dir = a.is_dir();
            let b_is_dir = b.is_dir();
            
            if a_is_dir && !b_is_dir {
                std::cmp::Ordering::Less
            } else if !a_is_dir && b_is_dir {
                std::cmp::Ordering::Greater
            } else {
                let a_name = a.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                let b_name = b.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                a_name.cmp(&b_name)
            }
        });

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

    // Save trove path
    crate::db::save_trove_path(conn, path).map_err(|e| {
        error!("Failed to save trove path: {}", e);
        format!("Failed to save trove path: {}", e)
    })?;

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

/// Reorders the children of a grid entity.
#[tauri::command]
pub fn reorder_children(
    world: State<'_, WorldState>,
    db: State<'_, DbState>,
    parent_entity_id: u64,
    ordered_ids: Vec<u64>,
) -> Result<(), String> {
    let mut w = world.0.lock().map_err(|e| e.to_string())?;
    let parent_eid = EntityId::new(parent_entity_id);
    if parent_entity_id != 0 && !w.entities.contains(&parent_eid) {
        return Err(format!("Parent entity {} not found", parent_entity_id));
    }

    // Validate that all ordered_ids are actual children
    let actual_children: Vec<u64> = if parent_entity_id == 0 {
        w.entities.all()
            .filter(|eid| !w.parent_ids.contains_key(eid))
            .map(|eid| eid.0)
            .collect()
    } else {
        w.components.iter()
            .filter_map(|(eid, _)| {
                if w.parent_ids.get(eid) == Some(&parent_eid) {
                    Some(eid.0)
                } else {
                    None
                }
            })
            .collect()
    };

    for &oid in &ordered_ids {
        if !actual_children.contains(&oid) {
            return Err(format!("Entity {} is not a child of {}", oid, parent_entity_id));
        }
    }

    // Update ordering: if parent is 0 (root), store in config; otherwise update grid component
    if parent_entity_id == 0 {
        let order_json = serde_json::to_string(&ordered_ids).unwrap_or_default();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::save_root_order(&conn, &order_json).map_err(|e| e.to_string())?;
    } else {
        if let Some(comps) = w.components.get_mut(&parent_eid) {
            for comp in comps.iter_mut() {
                if comp.component_type() == "grid" {
                    let mut settings = comp.settings();
                    if let serde_json::Value::Object(ref mut map) = settings {
                        map.insert("order".to_string(), serde_json::json!(ordered_ids));
                    }
                    comp.update_settings(settings);
                    break;
                }
            }
        }
    }

    // Persist
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    w.save(&conn).map_err(|e| e.to_string())?;

    Ok(())
}

/// Moves an entity to a new parent (and moves the underlying file on disk).
#[tauri::command]
pub fn move_entity(
    world: State<'_, WorldState>,
    db: State<'_, DbState>,
    entity_id: u64,
    new_parent_id: u64,
) -> Result<(), String> {
    let mut w = world.0.lock().map_err(|e| e.to_string())?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let eid = EntityId::new(entity_id);
    let new_pid = EntityId::new(new_parent_id);

    if !w.entities.contains(&eid) {
        return Err(format!("Entity {} not found", entity_id));
    }
    if new_parent_id != 0 && !w.entities.contains(&new_pid) {
        return Err(format!("New parent entity {} not found", new_parent_id));
    }

    // Get the entity's current path from renderFile component
    let entity_path: Option<PathBuf> = w.components.get(&eid).and_then(|comps| {
        comps.iter().find_map(|c| {
            if c.component_type() == "renderFile" {
                if let serde_json::Value::Object(map) = c.settings() {
                    map.get("targetPath").and_then(|v| v.as_str()).map(PathBuf::from)
                } else {
                    None
                }
            } else {
                None
            }
        })
    });

    // Get the new parent's directory path
    let parent_path: Option<PathBuf> = if new_parent_id == 0 {
        crate::db::load_trove_path(&conn)
            .map_err(|e| e.to_string())?
            .map(PathBuf::from)
    } else {
        w.components.get(&new_pid).and_then(|comps| {
            comps.iter().find_map(|c| {
                if c.component_type() == "renderFile" {
                    if let serde_json::Value::Object(map) = c.settings() {
                        map.get("targetPath").and_then(|v| v.as_str()).map(PathBuf::from)
                    } else {
                        None
                    }
                } else {
                    None
                }
            })
        })
    };

    // Move the actual file on disk
    if let (Some(src), Some(dest_dir)) = (&entity_path, &parent_path) {
        if src.exists() {
            let file_name = src.file_name().ok_or_else(|| "Source path has no file name".to_string())?;
            let dest = if dest_dir.is_dir() {
                dest_dir.join(file_name)
            } else {
                // If the parent's renderFile path is a file, use its parent directory
                let parent_dir = dest_dir.parent().ok_or_else(|| "Parent path has no parent directory".to_string())?;
                parent_dir.join(file_name)
            };

            std::fs::rename(src, &dest).map_err(|e| {
                format!("Failed to move file from {} to {}: {}", src.display(), dest.display(), e)
            })?;

            // Update the entity's renderFile component with the new path
            let new_path = dest.to_string_lossy().to_string();
            if let Some(comps) = w.components.get_mut(&eid) {
                for comp in comps.iter_mut() {
                    if comp.component_type() == "renderFile" {
                        let mut settings = comp.settings();
                        if let serde_json::Value::Object(ref mut map) = settings {
                            map.insert("targetPath".to_string(), serde_json::json!(new_path));
                        }
                        comp.update_settings(settings);
                        break;
                    }
                }
            }
        }
    }

    // Reparent in the ECS
    if new_parent_id == 0 {
        w.parent_ids.remove(&eid);
    } else {
        w.parent_ids.insert(eid, new_pid);
    }

    // Persist
    w.save(&conn).map_err(|e| e.to_string())?;

    info!("Moved entity {} to parent {}", entity_id, new_parent_id);
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
