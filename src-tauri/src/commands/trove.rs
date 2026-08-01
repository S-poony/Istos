use tauri::State;
use log::{info, warn, error};
use serde::Serialize;

use crate::db::DbState;
use crate::ecs::{
    component::create_component, EntityId, WorldSnapshot, WorldState,
};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};

/// One thing found on disk by a walk of a trove.
pub struct ScannedEntry {
    pub path: PathBuf,
    pub is_dir: bool,
    /// Index of this entry's parent *in the same vector*, or `None` for an
    /// entry sitting at the trove root. An index and not an id, because the
    /// walk does not know what the ECS will call any of this — and `None`
    /// rather than `0`, because `0` is a real index.
    pub parent: Option<usize>,
}

/// Walks a trove breadth-first and reports everything inside it.
///
/// The walk is shared by the two things that need it: `open_trove_impl`, which
/// builds a world from nothing, and `sync_trove_impl`, which reconciles an
/// existing world against the same ground truth. Two copies of this would drift,
/// and the drift would show up as entities that appear on a rescan and vanish
/// on the next open.
///
/// Parents always precede their children, so `parent` can be used to index into
/// the entity ids built so far.
pub fn scan_tree(root: &Path) -> Result<Vec<ScannedEntry>, String> {
    let mut entries: Vec<ScannedEntry> = Vec::new();
    let mut queue: VecDeque<(PathBuf, Option<usize>)> = VecDeque::new();
    queue.push_back((root.to_path_buf(), None));

    // Directories already scanned, by canonical path.
    //
    // `is_dir()` follows symlinks, so a link pointing at one of its own
    // ancestors is a cycle the walk below cannot see: it reads the same
    // directory again under a different path, forever, creating entities the
    // whole time. A trove containing one such link would hang the scan and
    // exhaust memory. Canonicalising collapses the link to its target, which is
    // the only form in which "have I already been here" is answerable.
    let mut visited: HashSet<PathBuf> = HashSet::new();

    while let Some((dir_path, parent)) = queue.pop_front() {
        let canonical = std::fs::canonicalize(&dir_path).unwrap_or_else(|_| dir_path.clone());
        if !visited.insert(canonical) {
            info!("Skipping already-scanned directory {}", dir_path.display());
            continue;
        }

        let read = match std::fs::read_dir(&dir_path) {
            Ok(read) => read,
            Err(e) => {
                // The root failing is the trove failing, and the caller has to
                // hear about it. A directory *inside* the trove failing is one
                // folder the user cannot read, and refusing the whole trove
                // over it would also mean a watched trove that can never
                // reconcile again while that folder exists.
                if parent.is_none() {
                    error!("Failed to read directory {}: {}", dir_path.display(), e);
                    return Err(format!("Failed to read directory: {}", e));
                }
                warn!("Skipping unreadable directory {}: {}", dir_path.display(), e);
                continue;
            }
        };

        // Directory-ness and the lowercased name are read once per entry, not
        // once per comparison. `is_dir()` is a `stat` call: asking for it from
        // inside the comparator turned sorting one directory into O(n log n)
        // syscalls, which is most of the cost of scanning a large trove.
        let mut paths: Vec<(bool, String, PathBuf)> = Vec::new();
        for entry in read {
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
            let index = entries.len();
            entries.push(ScannedEntry { path: path.clone(), is_dir, parent });
            if is_dir {
                queue.push_back((path, Some(index)));
            }
        }
    }

    Ok(entries)
}

/// Gives a freshly scanned entity the components its kind gets at scan time.
///
/// A directory is both a container and an item, so it gets `grid` *and*
/// `renderFile`. Everything that is not a directory gets `renderFile` —
/// everything, including sockets and other exotica. Testing `is_file()` instead
/// left those with an entity and no components at all: present in the world,
/// invisible in every view.
fn attach_scan_components(
    w: &mut crate::ecs::World,
    entity: EntityId,
    entry: &ScannedEntry,
) -> Result<(), String> {
    if entry.is_dir {
        let grid = create_component("grid", serde_json::json!({
            "columns": 3,
            "gap": 10
        })).ok_or_else(|| {
            error!("Failed to create grid component for dir {}", entry.path.display());
            "Failed to create grid component".to_string()
        })?;
        w.add_component(entity, grid);
    }

    let render = create_component("renderFile", serde_json::json!({
        "targetPath": entry.path.to_string_lossy(),
        "scale": 1.0,
        "position": {"x": 0, "y": 0}
    })).ok_or_else(|| {
        error!("Failed to create renderFile component for {}", entry.path.display());
        "Failed to create renderFile component".to_string()
    })?;
    w.add_component(entity, render);

    Ok(())
}

/// The path an entity claims on disk, exactly as stored.
///
/// Deliberately does not touch the filesystem: this is asked once per entity
/// while reconciling, and a `stat` per entity is the difference between a sync
/// that is free and one the user can feel. Trailing separators are trimmed
/// because older builds wrote them, and a path that does not compare equal to
/// the one the scan produced would look like a deletion followed by a creation.
fn stored_target_path(w: &crate::ecs::World, entity: &EntityId) -> Option<PathBuf> {
    w.components.get(entity)?.iter().find_map(|component| {
        if component.component_type() != "renderFile" { return None; }
        let raw = component.settings().get("targetPath")?.as_str()?.to_string();
        let trimmed = raw.trim_end_matches(['/', '\\']);
        if trimmed.is_empty() { return None; }
        Some(PathBuf::from(trimmed))
    })
}

/// What a reconciliation actually changed.
#[derive(Debug, Default, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    pub added: usize,
    pub removed: usize,
    pub reparented: usize,
}

impl SyncOutcome {
    /// True when the world already matched the disk. Nothing is saved and
    /// nothing is announced in that case: the frontend rebuilds its whole
    /// mirror on every notification, so an event that carries no news is not
    /// free.
    pub fn is_empty(&self) -> bool {
        self.added == 0 && self.removed == 0 && self.reparented == 0
    }
}

/// Brings an already-open world back in line with what is on disk.
///
/// This is the incremental half of the ECS ↔ filesystem contract. It exists
/// instead of "rescan from scratch" for one reason: entity ids are what the
/// frontend's focus, its live views, and every stored `grid` order are written
/// in terms of. Clearing the world renumbers everything, so a file appearing in
/// a folder would throw the user out of wherever they were standing.
///
/// So entities are matched to disk **by path**: a path that is still there
/// keeps its entity and its id, a path that is new gets a new entity, and an
/// entity whose path is gone is removed. Entities with no path at all are not
/// something the filesystem can speak for, and are left alone.
pub fn sync_trove_impl(
    w: &mut crate::ecs::World,
    conn: &rusqlite::Connection,
    root: &str,
) -> Result<SyncOutcome, String> {
    // A failed walk means "the trove could not be read", never "the trove is
    // empty". Returning early here is what stops an unplugged drive or a
    // momentarily locked folder from deleting every entity in the world.
    let entries = scan_tree(Path::new(root))?;

    let existing: Vec<EntityId> = w.entities.all().copied().collect();
    let mut by_path: HashMap<PathBuf, EntityId> = HashMap::new();
    for entity in existing {
        if let Some(path) = stored_target_path(w, &entity) {
            by_path.insert(path, entity);
        }
    }

    let mut outcome = SyncOutcome::default();
    let mut ids: Vec<EntityId> = Vec::with_capacity(entries.len());
    let mut kept: HashSet<EntityId> = HashSet::new();

    for entry in &entries {
        let entity = match by_path.get(&entry.path) {
            Some(&known) => known,
            None => {
                let created = w.create_entity();
                attach_scan_components(w, created, entry)?;
                outcome.added += 1;
                created
            }
        };
        kept.insert(entity);

        // Parenting follows the disk, which is safe precisely because every
        // in-app reparent already moved the file: an ECS parent that disagrees
        // with the filesystem is stale, not intentional.
        let desired = entry.parent.map(|index| ids[index]);
        if w.parent_ids.get(&entity).copied() != desired {
            match desired {
                Some(parent) => { w.parent_ids.insert(entity, parent); }
                None => { w.parent_ids.remove(&entity); }
            }
            outcome.reparented += 1;
        }

        ids.push(entity);
    }

    let gone: HashSet<EntityId> = by_path
        .into_values()
        .filter(|entity| !kept.contains(entity))
        .collect();

    for entity in &gone {
        w.entities.remove(entity);
        w.components.remove(entity);
        outcome.removed += 1;
    }
    // A parent link pointing at a removed entity is a child stranded outside
    // every view, so links are dropped from both ends.
    w.parent_ids.retain(|child, parent| !gone.contains(child) && !gone.contains(parent));

    if outcome.is_empty() {
        return Ok(outcome);
    }

    w.save(conn).map_err(|e| {
        error!("Failed to save world after sync: {}", e);
        format!("Failed to save world: {}", e)
    })?;

    info!(
        "Trove sync: {} added, {} removed, {} reparented",
        outcome.added, outcome.removed, outcome.reparented
    );
    Ok(outcome)
}

pub fn open_trove_impl(
    w: &mut crate::ecs::World,
    conn: &rusqlite::Connection,
    path: &str,
) -> Result<(), String> {
    let entries = scan_tree(Path::new(path))?;

    w.clear();
    info!("World cleared");

    let mut ids: Vec<EntityId> = Vec::with_capacity(entries.len());
    let mut file_count = 0;
    let mut dir_count = 0;

    for entry in &entries {
        let entity = w.create_entity();
        if let Some(parent) = entry.parent {
            w.parent_ids.insert(entity, ids[parent]);
        }
        attach_scan_components(w, entity, entry)?;
        ids.push(entity);
        if entry.is_dir { dir_count += 1; } else { file_count += 1; }
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
    app: tauri::AppHandle,
    world: State<'_, WorldState>,
    db: State<'_, DbState>,
    path: String,
) -> Result<(), String> {
    // The watch on the previous trove has to end before the world it describes
    // does. A watcher still reporting the old root against the new world would
    // find that none of its paths exist and reconcile the whole trove away.
    crate::watch::stop_watching(&app);

    // The locking happens inside a plain sync helper so that no MutexGuard is
    // ever a local of this async fn. That keeps the returned future `Send`,
    // which Tauri requires of async commands.
    open_trove_locked(world.inner(), db.inner(), &path)?;

    // Watching follows the trove, and starting it replaces the watch on the
    // previous one. A watch that fails to start is logged, not returned: the
    // trove *is* open, and reporting the open as failed because the app cannot
    // notice later edits would be a worse lie than the missing feature.
    if let Err(error) = crate::watch::watch_trove(&app, Path::new(&path)) {
        warn!("Trove opened but is not being watched: {}", error);
    }

    Ok(())
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

    /// The whole point of reconciling instead of rescanning: an entity that is
    /// still on disk keeps the id the frontend's focus and ordering are written
    /// in terms of.
    #[test]
    fn test_sync_keeps_ids_of_surviving_entities() {
        let temp_dir = TempDir::new("test_sync_ids").unwrap();
        let kept = temp_dir.path().join("kept.txt");
        std::fs::File::create(&kept).unwrap();

        let db_path = temp_dir.path().parent().unwrap().join("test_sync_ids.db");
        let conn = crate::db::init_db(&db_path).unwrap();
        let mut world = crate::ecs::World::new();
        let path = temp_dir.path().to_string_lossy().to_string();
        open_trove_impl(&mut world, &conn, &path).unwrap();

        let id_before = *world.entities.all().next().unwrap();

        std::fs::File::create(temp_dir.path().join("new.txt")).unwrap();
        let outcome = sync_trove_impl(&mut world, &conn, &path).unwrap();

        assert_eq!(outcome.added, 1);
        assert_eq!(outcome.removed, 0);
        assert_eq!(world.entities.len(), 2);
        assert!(
            world.entities.contains(&id_before),
            "an untouched file must keep its entity id across a sync"
        );
    }

    #[test]
    fn test_sync_removes_entities_whose_files_are_gone() {
        let temp_dir = TempDir::new("test_sync_removes").unwrap();
        let doomed = temp_dir.path().join("doomed.txt");
        std::fs::File::create(&doomed).unwrap();
        std::fs::File::create(temp_dir.path().join("stays.txt")).unwrap();

        let db_path = temp_dir.path().parent().unwrap().join("test_sync_removes.db");
        let conn = crate::db::init_db(&db_path).unwrap();
        let mut world = crate::ecs::World::new();
        let path = temp_dir.path().to_string_lossy().to_string();
        open_trove_impl(&mut world, &conn, &path).unwrap();
        assert_eq!(world.entities.len(), 2);

        std::fs::remove_file(&doomed).unwrap();
        let outcome = sync_trove_impl(&mut world, &conn, &path).unwrap();

        assert_eq!(outcome.removed, 1);
        assert_eq!(world.entities.len(), 1);
        let reloaded = crate::ecs::World::load_or_create(&conn);
        assert_eq!(reloaded.entities.len(), 1, "the removal must be persisted");
    }

    /// A file created in a subfolder has to arrive parented to that subfolder,
    /// not at the root.
    #[test]
    fn test_sync_parents_new_entities_to_their_folder() {
        let temp_dir = TempDir::new("test_sync_parent").unwrap();
        let sub = temp_dir.path().join("sub");
        std::fs::create_dir(&sub).unwrap();

        let db_path = temp_dir.path().parent().unwrap().join("test_sync_parent.db");
        let conn = crate::db::init_db(&db_path).unwrap();
        let mut world = crate::ecs::World::new();
        let path = temp_dir.path().to_string_lossy().to_string();
        open_trove_impl(&mut world, &conn, &path).unwrap();

        let sub_id = *world.entities.all().next().unwrap();

        std::fs::File::create(sub.join("added.txt")).unwrap();
        sync_trove_impl(&mut world, &conn, &path).unwrap();

        let added_id = world
            .entities
            .all()
            .find(|id| **id != sub_id)
            .copied()
            .expect("the new file should have an entity");
        assert_eq!(world.parent_ids.get(&added_id), Some(&sub_id));
    }

    /// Nothing changed means nothing to announce, and nothing to write.
    #[test]
    fn test_sync_is_a_no_op_when_the_disk_matches() {
        let temp_dir = TempDir::new("test_sync_noop").unwrap();
        std::fs::File::create(temp_dir.path().join("a.txt")).unwrap();

        let db_path = temp_dir.path().parent().unwrap().join("test_sync_noop.db");
        let conn = crate::db::init_db(&db_path).unwrap();
        let mut world = crate::ecs::World::new();
        let path = temp_dir.path().to_string_lossy().to_string();
        open_trove_impl(&mut world, &conn, &path).unwrap();

        let outcome = sync_trove_impl(&mut world, &conn, &path).unwrap();
        assert!(outcome.is_empty());
    }

    /// An unreadable trove is a trove to try again for. Emptying the world on a
    /// failed scan would turn an unplugged drive into data loss.
    #[test]
    fn test_sync_leaves_the_world_alone_when_the_trove_cannot_be_read() {
        let temp_dir = TempDir::new("test_sync_missing").unwrap();
        std::fs::File::create(temp_dir.path().join("a.txt")).unwrap();

        let db_path = temp_dir.path().parent().unwrap().join("test_sync_missing.db");
        let conn = crate::db::init_db(&db_path).unwrap();
        let mut world = crate::ecs::World::new();
        let path = temp_dir.path().to_string_lossy().to_string();
        open_trove_impl(&mut world, &conn, &path).unwrap();
        let before = world.entities.len();

        let missing = temp_dir.path().join("not-here");
        let result = sync_trove_impl(&mut world, &conn, &missing.to_string_lossy());

        assert!(result.is_err());
        assert_eq!(world.entities.len(), before);
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
