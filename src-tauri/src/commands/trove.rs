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

    // Directories already scanned, by canonical path.
    //
    // `is_dir()` follows symlinks, so a link pointing at one of its own
    // ancestors is a cycle the walk below cannot see: it reads the same
    // directory again under a different path, forever, creating entities the
    // whole time. A trove containing one such link would hang the scan and
    // exhaust memory. Canonicalising collapses the link to its target, which is
    // the only form in which "have I already been here" is answerable.
    let mut visited: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();

    while let Some((dir_path, parent_id)) = queue.pop_front() {
        let canonical = std::fs::canonicalize(&dir_path).unwrap_or_else(|_| dir_path.clone());
        if !visited.insert(canonical) {
            info!("Skipping already-scanned directory {}", dir_path.display());
            continue;
        }

        let entries = std::fs::read_dir(&dir_path).map_err(|e| {
            error!("Failed to read directory {}: {}", dir_path.display(), e);
            format!("Failed to read directory: {}", e)
        })?;

        // Directory-ness and the lowercased name are read once per entry, not
        // once per comparison. `is_dir()` is a `stat` call: asking for it from
        // inside the comparator turned sorting one directory into O(n log n)
        // syscalls, which is most of the cost of scanning a large trove.
        let mut paths: Vec<(bool, String, PathBuf)> = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|e| {
                error!("Failed to read entry: {}", e);
                e.to_string()
            })?;
            let path = entry.path();
            // `is_dir()` and not `entry.file_type()`: the former follows
            // symlinks, and a link to a directory should be browsable like the
            // directory it points at. The cycle that follows from that is
            // handled by `visited` above, not by refusing to follow.
            let is_dir = path.is_dir();
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase();
            paths.push((is_dir, name, path));
        }

        // Sort paths: directories first (alphabetically), then files (alphabetically)
        paths.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));

        for (is_dir, _, path) in paths {
            let entity = w.create_entity();
            if let Some(pid) = parent_id {
                w.parent_ids.insert(entity, pid);
            }

            if !is_dir {
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
            } else {
                // Everything that is not a directory takes the branch above,
                // including sockets and other exotica. The old `is_file()` /
                // `is_dir()` pair left those with an entity and no components
                // at all — present in the world, invisible in every view.

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
///
/// Declared `async` on purpose. A synchronous Tauri command runs on the main
/// thread, so scanning a large trove froze the whole window - including the
/// file dialog, which made it impossible to open another trove until the
/// previous scan finished. As an async command this runs on the async runtime
/// and leaves the UI responsive.
#[tauri::command]
pub async fn open_trove(
    world: State<'_, WorldState>,
    db: State<'_, DbState>,
    path: String,
) -> Result<(), String> {
    // The locking happens inside a plain sync helper so that no MutexGuard is
    // ever a local of this async fn. That keeps the returned future `Send`,
    // which Tauri requires of async commands.
    open_trove_locked(world.inner(), db.inner(), &path)
}

fn open_trove_locked(world: &WorldState, db: &DbState, path: &str) -> Result<(), String> {
    info!("Opening trove at path: {}", path);
    let mut w = world.0.lock().map_err(|e| {
        error!("Failed to lock world: {}", e);
        e.to_string()
    })?;
    let conn = db.0.lock().map_err(|e| {
        error!("Failed to lock db: {}", e);
        e.to_string()
    })?;
    open_trove_impl(&mut w, &conn, path)
}

/// Returns the full world state to the frontend.
///
/// Async for the same reason as `open_trove`: serialising a large world is not
/// work the main thread should be doing.
#[tauri::command]
pub async fn get_world_state(
    world: State<'_, WorldState>,
    db: State<'_, DbState>,
) -> Result<WorldSnapshot, String> {
    world_snapshot_locked(world.inner(), db.inner())
}

fn world_snapshot_locked(world: &WorldState, db: &DbState) -> Result<WorldSnapshot, String> {
    let w = world.0.lock().map_err(|e| e.to_string())?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut snapshot = WorldSnapshot::from(&*w);
    snapshot.root_order = crate::db::load_root_order(&conn).map_err(|e| e.to_string())?;
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
    parent_entity_id: Option<u64>,
    ordered_ids: Vec<u64>,
) -> Result<(), String> {
    let mut w = world.0.lock().map_err(|e| e.to_string())?;
    let parent_eid = parent_entity_id.map(EntityId::new);
    if let Some(parent_eid) = parent_eid {
        if !w.entities.contains(&parent_eid) {
            return Err(format!("Parent entity {} not found", parent_eid.0));
        }
    }

    // Validate that all ordered_ids are actual children
    let actual_children: Vec<u64> = if let Some(parent_eid) = parent_eid {
        w.entities.all()
            .filter_map(|eid| {
                if w.parent_ids.get(eid) == Some(&parent_eid) {
                    Some(eid.0)
                } else {
                    None
                }
            })
            .collect()
    } else {
        w.entities.all()
            .filter(|eid| !w.parent_ids.contains_key(eid))
            .map(|eid| eid.0)
            .collect()
    };

    for &oid in &ordered_ids {
        if !actual_children.contains(&oid) {
            return Err(format!("Entity {} is not a child of {:?}", oid, parent_entity_id));
        }
    }

    // Update ordering: if parent is 0 (root), store in config; otherwise update grid component
    if let Some(parent_eid) = parent_eid {
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
    } else {
        let order_json = serde_json::to_string(&ordered_ids).unwrap_or_default();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::save_root_order(&conn, &order_json).map_err(|e| e.to_string())?;
    }

    // Persist
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    w.save(&conn).map_err(|e| e.to_string())?;

    Ok(())
}

/// Core move implementation, separated from Tauri State for validation and tests.
pub fn move_entity_impl(
    w: &mut crate::ecs::World,
    conn: &rusqlite::Connection,
    entity_id: u64,
    new_parent_id: Option<u64>,
) -> Result<(), String> {
    let eid = EntityId::new(entity_id);
    let new_pid = new_parent_id.map(EntityId::new);

    if !w.entities.contains(&eid) { return Err(format!("Entity {} not found", entity_id)); }
    if let Some(new_pid) = new_pid {
        if !w.entities.contains(&new_pid) {
            return Err(format!("New parent entity {} not found", new_pid.0));
        }
        if eid == new_pid { return Err("An entity cannot be moved into itself".to_string()); }

        let is_folder = w.components.get(&new_pid).is_some_and(|components|
            components.iter().any(|component| component.component_type() == "grid")
        );
        if !is_folder { return Err("Files can only be moved into folders".to_string()); }
        let mut ancestor = Some(new_pid);
        while let Some(current) = ancestor {
            if current == eid {
                return Err("A folder cannot be moved into one of its descendants".to_string());
            }
            ancestor = w.parent_ids.get(&current).copied();
        }
    }

    fn entity_path(w: &crate::ecs::World, entity: &EntityId) -> Option<PathBuf> {
        w.components.get(entity)?.iter().find_map(|component| {
            if component.component_type() != "renderFile" { return None; }
            let raw_path = component.settings().get("targetPath")?.as_str()?.to_string();
            let path = PathBuf::from(&raw_path);
            if path.exists() { return Some(path); }

            // Recover paths persisted by older builds that appended a separator to files.
            let trimmed = raw_path.trim_end_matches(['/', '\\']);
            if trimmed.is_empty() { return Some(path); }
            let normalized = PathBuf::from(trimmed);
            Some(if normalized.exists() { normalized } else { path })
        })
    }

    let source = entity_path(w, &eid)
        .ok_or_else(|| format!("Entity {} has no filesystem path", entity_id))?;
    if !source.exists() { return Err(format!("Source path does not exist: {}", source.display())); }

    let destination_dir = if let Some(new_pid) = new_pid {
        entity_path(w, &new_pid).ok_or_else(|| "Destination folder has no filesystem path".to_string())?
    } else {
        crate::db::load_trove_path(conn).map_err(|e| e.to_string())?
            .map(PathBuf::from).ok_or_else(|| "No trove root is configured".to_string())?
    };
    if !destination_dir.is_dir() {
        return Err(format!("Destination is not a directory: {}", destination_dir.display()));
    }

    let file_name = source.file_name().ok_or_else(|| "Source path has no file name".to_string())?;
    let destination = destination_dir.join(file_name);
    // The filesystem may already be in the requested location while the ECS parent is
    // stale (for example, after an older move returned before persisting metadata).
    // Treat this as a metadata reconciliation, not as a complete no-op.
    if source == destination {
        if let Some(new_pid) = new_pid { w.parent_ids.insert(eid, new_pid); } else { w.parent_ids.remove(&eid); }
        w.save(conn).map_err(|error| format!("Failed to persist move: {}", error))?;
        info!("Reconciled entity {} with parent {:?}", entity_id, new_parent_id);
        return Ok(());
    }
    if destination.exists() {
        return Err(format!("An item named {} already exists in the destination", file_name.to_string_lossy()));
    }

    std::fs::rename(&source, &destination).map_err(|e|
        format!("Failed to move {} to {}: {}", source.display(), destination.display(), e)
    )?;

    for components in w.components.values_mut() {
        for component in components.iter_mut() {
            if component.component_type() != "renderFile" { continue; }
            let mut settings = component.settings();
            let old_path = settings.get("targetPath").and_then(|value| value.as_str()).map(PathBuf::from);
            if let Some(old_path) = old_path {
                if let Ok(suffix) = old_path.strip_prefix(&source) {
                    // Joining an empty suffix adds a trailing separator on Windows, turning
                    // a file path into a non-existent directory-like path on the next move.
                    let rewritten_path = if suffix.as_os_str().is_empty() {
                        destination.clone()
                    } else {
                        destination.join(suffix)
                    };
                    let rewritten = rewritten_path.to_string_lossy().to_string();
                    if let serde_json::Value::Object(ref mut map) = settings {
                        map.insert("targetPath".to_string(), serde_json::json!(rewritten));
                    }
                    component.update_settings(settings);
                }
            }
        }
    }

    if let Some(new_pid) = new_pid { w.parent_ids.insert(eid, new_pid); } else { w.parent_ids.remove(&eid); }
    w.save(conn).map_err(|error| format!("Failed to persist move: {}", error))?;
    info!("Moved entity {} to parent {:?}", entity_id, new_parent_id);
    Ok(())
}

/// Moves an entity to a new parent and moves its file or directory on disk.
/// Validation happens before any filesystem or ECS mutation.
#[tauri::command]
pub fn move_entity(
    world: State<'_, WorldState>,
    db: State<'_, DbState>,
    entity_id: u64,
    new_parent_id: Option<u64>,
) -> Result<(), String> {
    let mut w = world.0.lock().map_err(|e| e.to_string())?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    move_entity_impl(&mut w, &conn, entity_id, new_parent_id)
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

    /// A symlink pointing at one of its own ancestors is a cycle the walk
    /// cannot see: `is_dir()` follows it, so the same directory is read again
    /// under a new path, creating entities forever. The scan has to notice it
    /// has already been somewhere.
    #[cfg(unix)]
    #[test]
    fn test_open_trove_survives_a_symlink_cycle() {
        let temp_dir = TempDir::new("test_trove_cycle").unwrap();
        let inner = temp_dir.path().join("inner");
        std::fs::create_dir(&inner).unwrap();
        std::fs::File::create(inner.join("leaf.txt")).unwrap();
        std::os::unix::fs::symlink(temp_dir.path(), inner.join("loop")).unwrap();

        let db_path = temp_dir.path().parent().unwrap().join("test_cycle.db");
        let conn = crate::db::init_db(&db_path).unwrap();
        let mut world = crate::ecs::World::new();

        let path = temp_dir.path().to_string_lossy().to_string();
        assert!(open_trove_impl(&mut world, &conn, &path).is_ok());

        // inner, leaf.txt, loop — and nothing more. The link is still followed
        // and still browsable; it simply resolves to a directory the scan has
        // already read.
        assert_eq!(
            world.entities.len(),
            3,
            "a symlink cycle should not multiply entities"
        );
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

    #[test]
    fn test_move_file_twice_keeps_exact_target_path() {
        let temp_dir = TempDir::new("test_move_file_twice").unwrap();
        let first_dir = temp_dir.path().join("first");
        let second_dir = temp_dir.path().join("second");
        std::fs::create_dir(&first_dir).unwrap();
        std::fs::create_dir(&second_dir).unwrap();
        let original_file = first_dir.join("document.pdf");
        std::fs::File::create(&original_file).unwrap();

        let mut world = crate::ecs::World::new();
        world.create_entity(); // Reserve ID 0, which is the root sentinel for move_entity.
        let first_id = world.create_entity();
        let second_id = world.create_entity();
        let file_id = world.create_entity();
        world.parent_ids.insert(file_id, first_id);
        for (id, path) in [(first_id, &first_dir), (second_id, &second_dir)] {
            world.add_component(id, create_component("grid", serde_json::json!({})).unwrap());
            world.add_component(id, create_component("renderFile", serde_json::json!({
                "targetPath": path, "scale": 1.0, "position": {"x": 0.0, "y": 0.0}
            })).unwrap());
        }
        world.add_component(file_id, create_component("renderFile", serde_json::json!({
            "targetPath": original_file, "scale": 1.0, "position": {"x": 0.0, "y": 0.0}
        })).unwrap());

        let conn = crate::db::init_db(&temp_dir.path().join("move_twice.db")).unwrap();
        move_entity_impl(&mut world, &conn, file_id.0, Some(second_id.0)).unwrap();
        let moved_file = second_dir.join("document.pdf");
        let stored_path = world.components.get(&file_id).unwrap()[0].settings()
            .get("targetPath").unwrap().as_str().unwrap().to_string();
        assert_eq!(PathBuf::from(&stored_path), moved_file);
        assert!(!stored_path.ends_with(std::path::MAIN_SEPARATOR));

        move_entity_impl(&mut world, &conn, file_id.0, Some(first_id.0)).unwrap();
        assert!(first_dir.join("document.pdf").exists());
    }

    #[test]
    fn test_move_into_folder_with_entity_id_zero() {
        let temp_dir = TempDir::new("test_move_into_zero").unwrap();
        let destination_dir = temp_dir.path().join("destination");
        let source_dir = temp_dir.path().join("source");
        std::fs::create_dir(&destination_dir).unwrap();
        std::fs::create_dir(&source_dir).unwrap();
        let source_file = source_dir.join("document.txt");
        std::fs::File::create(&source_file).unwrap();

        let mut world = crate::ecs::World::new();
        let destination_id = world.create_entity();
        assert_eq!(destination_id.0, 0);
        let source_parent_id = world.create_entity();
        let file_id = world.create_entity();
        world.parent_ids.insert(file_id, source_parent_id);

        for (id, path) in [(destination_id, &destination_dir), (source_parent_id, &source_dir)] {
            world.add_component(id, create_component("grid", serde_json::json!({})).unwrap());
            world.add_component(id, create_component("renderFile", serde_json::json!({
                "targetPath": path, "scale": 1.0, "position": {"x": 0.0, "y": 0.0}
            })).unwrap());
        }
        world.add_component(file_id, create_component("renderFile", serde_json::json!({
            "targetPath": source_file, "scale": 1.0, "position": {"x": 0.0, "y": 0.0}
        })).unwrap());

        let conn = crate::db::init_db(&temp_dir.path().join("move_zero.db")).unwrap();
        move_entity_impl(&mut world, &conn, file_id.0, Some(destination_id.0)).unwrap();

        assert_eq!(world.parent_ids.get(&file_id), Some(&destination_id));
        assert!(destination_dir.join("document.txt").exists());
    }


    #[test]
    fn test_move_reconciles_parent_when_file_is_already_at_destination() {
        let temp_dir = TempDir::new("test_move_reconcile_parent").unwrap();
        let first_dir = temp_dir.path().join("first");
        let second_dir = temp_dir.path().join("second");
        std::fs::create_dir(&first_dir).unwrap();
        std::fs::create_dir(&second_dir).unwrap();
        let file_path = first_dir.join("document.pdf");
        std::fs::File::create(&file_path).unwrap();

        let mut world = crate::ecs::World::new();
        world.create_entity(); // Reserve ID 0, which is the root sentinel for move_entity.
        let first_id = world.create_entity();
        let second_id = world.create_entity();
        let file_id = world.create_entity();
        // Simulate stale ECS metadata: the file is physically in first, but recorded in second.
        world.parent_ids.insert(file_id, second_id);
        for (id, path) in [(first_id, &first_dir), (second_id, &second_dir)] {
            world.add_component(id, create_component("grid", serde_json::json!({})).unwrap());
            world.add_component(id, create_component("renderFile", serde_json::json!({
                "targetPath": path, "scale": 1.0, "position": {"x": 0.0, "y": 0.0}
            })).unwrap());
        }
        world.add_component(file_id, create_component("renderFile", serde_json::json!({
            "targetPath": file_path, "scale": 1.0, "position": {"x": 0.0, "y": 0.0}
        })).unwrap());

        let conn = crate::db::init_db(&temp_dir.path().join("reconcile.db")).unwrap();
        move_entity_impl(&mut world, &conn, file_id.0, Some(first_id.0)).unwrap();

        assert_eq!(world.parent_ids.get(&file_id), Some(&first_id));
        let reloaded = crate::ecs::World::load_or_create(&conn);
        assert_eq!(reloaded.parent_ids.get(&file_id), Some(&first_id));
        assert!(file_path.exists());
    }


    #[test]
    fn test_move_folder_rewrites_descendant_paths() {
        let temp_dir = TempDir::new("test_move_folder").unwrap();
        let source = temp_dir.path().join("source");
        let destination_parent = temp_dir.path().join("destination");
        std::fs::create_dir_all(source.join("nested")).unwrap();
        std::fs::create_dir(&destination_parent).unwrap();
        let child_path = source.join("nested").join("child.txt");
        std::fs::File::create(&child_path).unwrap();

        let mut world = crate::ecs::World::new();
        let source_id = world.create_entity();
        let destination_id = world.create_entity();
        let child_id = world.create_entity();
        world.parent_ids.insert(child_id, source_id);
        world.add_component(source_id, create_component("grid", serde_json::json!({})).unwrap());
        world.add_component(source_id, create_component("renderFile", serde_json::json!({
            "targetPath": source, "scale": 1.0, "position": {"x": 0.0, "y": 0.0}
        })).unwrap());
        world.add_component(destination_id, create_component("grid", serde_json::json!({})).unwrap());
        world.add_component(destination_id, create_component("renderFile", serde_json::json!({
            "targetPath": destination_parent, "scale": 1.0, "position": {"x": 0.0, "y": 0.0}
        })).unwrap());
        world.add_component(child_id, create_component("renderFile", serde_json::json!({
            "targetPath": child_path, "scale": 1.0, "position": {"x": 0.0, "y": 0.0}
        })).unwrap());

        let conn = crate::db::init_db(&temp_dir.path().join("move.db")).unwrap();
        move_entity_impl(&mut world, &conn, source_id.0, Some(destination_id.0)).unwrap();

        let moved_source = destination_parent.join("source");
        let moved_child = moved_source.join("nested").join("child.txt");
        assert!(moved_child.exists());
        let stored_child_path = world.components.get(&child_id).unwrap()[0].settings()
            .get("targetPath").unwrap().as_str().unwrap().to_string();
        assert_eq!(PathBuf::from(stored_child_path), moved_child);
        assert_eq!(world.parent_ids.get(&source_id), Some(&destination_id));
    }

    #[test]
    fn test_move_rejects_descendant_target() {
        let temp_dir = TempDir::new("test_move_cycle").unwrap();
        let parent_path = temp_dir.path().join("parent");
        let child_path = parent_path.join("child");
        std::fs::create_dir_all(&child_path).unwrap();

        let mut world = crate::ecs::World::new();
        let parent_id = world.create_entity();
        let child_id = world.create_entity();
        world.parent_ids.insert(child_id, parent_id);
        for (id, path) in [(parent_id, parent_path), (child_id, child_path)] {
            world.add_component(id, create_component("grid", serde_json::json!({})).unwrap());
            world.add_component(id, create_component("renderFile", serde_json::json!({
                "targetPath": path, "scale": 1.0, "position": {"x": 0.0, "y": 0.0}
            })).unwrap());
        }
        let conn = crate::db::init_db(&temp_dir.path().join("cycle.db")).unwrap();
        let error = move_entity_impl(&mut world, &conn, parent_id.0, Some(child_id.0)).unwrap_err();
        assert!(error.contains("descendants"));
    }

}
