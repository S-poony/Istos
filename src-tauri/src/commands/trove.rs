use tauri::State;

use crate::db::DbState;
use crate::ecs::{
    self, component::create_component, EntityId, WorldSnapshot, WorldState,
};

/// Opens a trove folder and populates the world with entities.
#[tauri::command]
pub fn open_trove(
    world: State<'_, WorldState>,
    db: State<'_, DbState>,
    path: String,
) -> Result<(), String> {
    let mut w = world.0.lock().map_err(|e| e.to_string())?;
    w.clear();

    // Scan the folder
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let entity = w.create_entity();

        if path.is_file() {
            // Check if image
            if let Some(ext) = path.extension() {
                if matches!(ext.to_str(), Some("png") | Some("jpg") | Some("jpeg") | Some("gif") | Some("webp")) {
                    let component = create_component("renderFile", serde_json::json!({
                        "targetPath": path.to_string_lossy(),
                        "scale": 1.0,
                        "position": {"x": 0, "y": 0}
                    })).ok_or("Failed to create renderFile component")?;
                    w.add_component(entity, component);
                }
            }
        } else if path.is_dir() {
            // Add grid component
            let component = create_component("grid", serde_json::json!({
                "columns": 3,
                "gap": 10
            })).ok_or("Failed to create grid component")?;
            w.add_component(entity, component);
        }
    }

    // Persist
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    w.save(&conn).map_err(|e| e.to_string())?;

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
