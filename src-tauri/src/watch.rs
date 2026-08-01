//! Watching the open trove for changes made outside the app.
//!
//! The world used to be built once, when a trove was opened, and everything the
//! user did in another program afterwards was invisible until they opened it
//! again. This module closes that gap: the trove root is watched recursively,
//! and a change on disk reconciles the world and tells the frontend to reload.
//!
//! Watching is always on. It is not a mode, a setting, or something to
//! remember to switch back on — a file explorer that shows a folder as it was
//! ten minutes ago is simply wrong, and a toggle would only make it wrong
//! silently.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use log::{error, info, warn};
use notify::event::ModifyKind;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::trove::sync_trove_impl;
use crate::db::DbState;
use crate::ecs::WorldState;

/// The event the frontend listens for. Its payload is a `SyncOutcome`.
pub const TROVE_CHANGED_EVENT: &str = "trove-changed";

/// How long the trove must be quiet before it is reconciled.
///
/// Filesystem events arrive in bursts — unzipping an archive or saving from an
/// editor produces dozens for what the user thinks of as one change — and each
/// reconciliation walks the tree and makes the frontend rebuild its mirror.
/// Waiting for the burst to end turns that into one pass.
const QUIET_PERIOD: Duration = Duration::from_millis(250);

/// The watch on the currently open trove, if any.
///
/// Only one trove is open at a time, so only one watcher is ever held. Storing
/// it is what keeps it alive: dropping a `notify` watcher stops it, which is
/// exactly how the previous trove's watch is ended when a new one is opened.
pub struct WatchState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    /// Bumped every time a new watch starts. The worker thread carries the
    /// generation it was born with and stops if it no longer matches, so a
    /// burst that was still being debounced when the user opened another trove
    /// cannot reconcile the new world against the old root.
    generation: Arc<AtomicU64>,
}

impl WatchState {
    pub fn new() -> Self {
        Self {
            watcher: Mutex::new(None),
            generation: Arc::new(AtomicU64::new(0)),
        }
    }
}

impl Default for WatchState {
    fn default() -> Self {
        Self::new()
    }
}

/// Stops watching whatever is being watched.
///
/// Call this *before* rebuilding the world for a different trove. A watch on
/// the old root that outlives the world it belongs to is not merely stale: its
/// next reconciliation would compare the new trove's entities against the old
/// trove's paths, find that none of them match, and delete all of them. Ending
/// the watch first is what makes that impossible rather than unlikely.
pub fn stop_watching(app: &AppHandle) {
    let state = app.state::<WatchState>();
    // Bumped first: a worker already past its own generation check is holding
    // the world lock, and one already inside its quiet period will fail the
    // check when it wakes.
    state.generation.fetch_add(1, Ordering::SeqCst);
    match state.watcher.lock() {
        Ok(mut slot) => {
            // Dropping the watcher closes its channel, which is what ends the
            // worker thread.
            *slot = None;
        }
        Err(e) => error!("Failed to lock the watch state to stop watching: {}", e),
    }
}

/// Starts watching `root`, replacing any watch already in place.
pub fn watch_trove(app: &AppHandle, root: &Path) -> Result<(), String> {
    let state = app.state::<WatchState>();
    let generations = state.generation.clone();
    let generation = generations.fetch_add(1, Ordering::SeqCst) + 1;

    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |event| {
        // A send failure means the receiving thread is gone, which is a normal
        // part of being replaced — not something to report.
        let _ = tx.send(event);
    })
    .map_err(|e| format!("Failed to create a filesystem watcher: {}", e))?;

    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch {}: {}", root.display(), e))?;

    let handle = app.clone();
    let watched_root = root.to_path_buf();
    std::thread::spawn(move || {
        // `recv` ends when the watcher is dropped, so replacing the watch also
        // ends this thread. There is no other stop signal to keep in sync.
        while let Ok(first) = rx.recv() {
            if !is_structural(&first) {
                continue;
            }

            // Wait for the burst to finish before doing any work.
            loop {
                match rx.recv_timeout(QUIET_PERIOD) {
                    Ok(_) => continue,
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }

            if generations.load(Ordering::SeqCst) != generation {
                return;
            }
            reconcile(&handle, &watched_root);
        }
    });

    // Held last, so the old watcher is dropped only once the new one is
    // established: the gap between them is where a change would go unseen.
    let mut slot = state
        .watcher
        .lock()
        .map_err(|e| format!("Failed to lock the watch state: {}", e))?;
    *slot = Some(watcher);

    info!("Watching trove at {}", root.display());
    Ok(())
}

/// Starts watching whichever trove was last opened, if there still is one.
/// Called at startup, since the world is restored from SQLite without anyone
/// invoking `open_trove`.
pub fn watch_saved_trove(app: &AppHandle) {
    let path = {
        let db = app.state::<DbState>();
        let conn = match db.0.lock() {
            Ok(conn) => conn,
            Err(e) => {
                error!("Failed to lock db to restore the trove watch: {}", e);
                return;
            }
        };
        match crate::db::load_trove_path(&conn) {
            Ok(path) => path,
            Err(e) => {
                error!("Failed to read the saved trove path: {}", e);
                return;
            }
        }
    };

    let Some(path) = path else { return };
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        // The trove is on a drive that is not mounted, or has been deleted.
        // Nothing to watch and nothing to fix; the world stays as it was saved.
        warn!("Saved trove {} is not available, so it is not being watched", path);
        return;
    }

    if let Err(error) = watch_trove(app, &root) {
        warn!("Failed to watch the saved trove {}: {}", path, error);
    }
}

/// Whether an event can have changed the entity graph.
///
/// Only structure matters here. A world is a set of paths and their parenting,
/// so a file's *contents* changing is not news — and reacting to it would mean
/// re-walking the whole trove every time an editor saves.
fn is_structural(event: &notify::Result<notify::Event>) -> bool {
    match event {
        Ok(event) => matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
        ),
        Err(error) => {
            warn!("Filesystem watch error: {}", error);
            false
        }
    }
}

fn reconcile(app: &AppHandle, root: &Path) {
    let world = app.state::<WorldState>();
    let db = app.state::<DbState>();

    let outcome = {
        // World then db, the same order every other command takes them in.
        // Two lock orders is all it takes to deadlock the app.
        let mut w = match world.0.lock() {
            Ok(w) => w,
            Err(e) => {
                error!("Failed to lock world for sync: {}", e);
                return;
            }
        };
        let conn = match db.0.lock() {
            Ok(conn) => conn,
            Err(e) => {
                error!("Failed to lock db for sync: {}", e);
                return;
            }
        };

        match sync_trove_impl(&mut w, &conn, &root.to_string_lossy()) {
            Ok(outcome) => outcome,
            Err(error) => {
                // A trove that cannot be read right now is a trove to try again
                // for, not one to empty. `sync_trove_impl` has already declined
                // to change anything.
                warn!("Trove sync skipped: {}", error);
                return;
            }
        }
    };

    if outcome.is_empty() {
        return;
    }

    if let Err(error) = app.emit(TROVE_CHANGED_EVENT, outcome) {
        error!("Failed to announce trove change: {}", error);
    }
}
