use rusqlite::{Connection, Result};
use std::sync::Mutex;

use crate::ecs::World;

/// Tauri managed state for the database connection.
pub struct DbState(pub Mutex<Connection>);

/// Initializes the database and runs migrations.
pub fn init_db(path: &std::path::Path) -> Result<Connection> {
    let conn = Connection::open(path)?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS entities (
            id INTEGER PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS components (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_id INTEGER NOT NULL,
            component_type TEXT NOT NULL,
            settings TEXT NOT NULL DEFAULT '{}',
            FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )?;

    // Migration: Add parent_id column if not exists
    let _ = conn.execute("ALTER TABLE entities ADD COLUMN parent_id INTEGER", []);

    Ok(conn)
}

/// Loads all entity IDs and their parent IDs from the database.
pub fn load_entities(conn: &Connection) -> Result<Vec<(u64, Option<u64>)>> {
    let mut stmt = conn.prepare("SELECT id, parent_id FROM entities")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, u64>(0)?,
                row.get::<_, Option<u64>>(1)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Loads all components from the database.
/// Returns (entity_id, component_type, settings_json).
pub fn load_components(conn: &Connection) -> Result<Vec<(u64, String, String)>> {
    let mut stmt = conn.prepare("SELECT entity_id, component_type, settings FROM components")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, u64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Saves the entire world state to the database.
pub fn save_world(conn: &Connection, world: &World) -> Result<()> {
    // Use a transaction for atomicity
    conn.execute_batch("BEGIN")?;

    // Clear existing data
    conn.execute("DELETE FROM components", [])?;
    conn.execute("DELETE FROM entities", [])?;

    // Save entities
    for eid in world.entities.all() {
        let parent_id = world.parent_ids.get(eid).map(|pid| pid.0);
        conn.execute(
            "INSERT INTO entities (id, parent_id) VALUES (?1, ?2)",
            rusqlite::params![eid.0, parent_id],
        )?;
    }

    // Save components
    for (eid, comps) in &world.components {
        for comp in comps {
            let settings = comp.settings().to_string();
            conn.execute(
                "INSERT INTO components (entity_id, component_type, settings) VALUES (?1, ?2, ?3)",
                rusqlite::params![eid.0, comp.component_type(), settings],
            )?;
        }
    }

    conn.execute_batch("COMMIT")?;
    Ok(())
}

/// Saves the trove config path.
pub fn save_trove_path(conn: &Connection, path: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('trove_path', ?1)",
        [path],
    )?;
    Ok(())
}

/// Loads the trove config path.
pub fn load_trove_path(conn: &Connection) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM config WHERE key = 'trove_path'")?;
    let result = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .next()
        .transpose()?;
    Ok(result)
}
