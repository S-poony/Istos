use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// A unique identifier for an entity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct EntityId(pub u64);

impl EntityId {
    pub fn new(id: u64) -> Self {
        Self(id)
    }
}

/// Stores all entity IDs.
#[derive(Debug, Default)]
pub struct EntityStore {
    entities: HashSet<EntityId>,
    next_id: u64,
}

impl EntityStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates a new entity with a unique ID.
    pub fn create(&mut self) -> EntityId {
        let id = EntityId(self.next_id);
        self.next_id += 1;
        self.entities.insert(id);
        id
    }

    /// Creates an entity with a specific ID (used when loading from DB).
    pub fn create_with_id(&mut self, id: EntityId) {
        self.entities.insert(id);
        if id.0 >= self.next_id {
            self.next_id = id.0 + 1;
        }
    }

    /// Removes an entity.
    pub fn remove(&mut self, id: &EntityId) -> bool {
        self.entities.remove(id)
    }

    /// Checks if an entity exists.
    pub fn contains(&self, id: &EntityId) -> bool {
        self.entities.contains(id)
    }

    /// Returns all entity IDs.
    pub fn all(&self) -> impl Iterator<Item = &EntityId> {
        self.entities.iter()
    }

    /// Returns the number of entities.
    pub fn len(&self) -> usize {
        self.entities.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entities.is_empty()
    }
}
