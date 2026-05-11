use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

use super::component::{
    self, create_component, Component, ComponentBox, ComponentRegistry,
};
use super::entity::{EntityId, EntityStore};
use super::system::System;
use crate::db;

/// The central ECS world container.
pub struct World {
    /// Entity store.
    pub entities: EntityStore,
    /// Components attached to entities.
    pub components: HashMap<EntityId, Vec<ComponentBox>>,
    /// Registered component types.
    pub registry: ComponentRegistry,
    /// Registered systems.
    pub systems: Vec<Box<dyn System>>,
}

impl World {
    pub fn new() -> Self {
        let mut registry = ComponentRegistry::new();
        registry.register(component::RenderFile::TYPE);
        registry.register(component::Grid::TYPE);

        Self {
            entities: EntityStore::new(),
            components: HashMap::new(),
            registry,
            systems: Vec::new(),
        }
    }

    /// Loads the world from the database, or creates a new one if empty.
    pub fn load_or_create(conn: &rusqlite::Connection) -> Self {
        let mut world = Self::new();

        // Load entities
        if let Ok(entities) = db::load_entities(conn) {
            for id in entities {
                world.entities.create_with_id(EntityId::new(id));
            }
        }

        // Load components
        if let Ok(component_data) = db::load_components(conn) {
            for (entity_id, comp_type, settings_json) in component_data {
                let eid = EntityId::new(entity_id);
                if let Ok(settings) = serde_json::from_str(&settings_json) {
                    if let Some(comp) = create_component(&comp_type, settings) {
                        world.components.entry(eid).or_default().push(comp);
                    }
                }
            }
        }

        // If no entities exist, create a root entity
        if world.entities.is_empty() {
            let root = world.entities.create();
            world
                .components
                .entry(root)
                .or_default()
                .push(Box::new(component::Grid::new()));
            world
                .components
                .entry(root)
                .or_default()
                .push(Box::new(component::RenderFile::new()));
        }

        world
    }

    /// Creates a new entity.
    pub fn create_entity(&mut self) -> EntityId {
        self.entities.create()
    }

    /// Adds a component to an entity.
    pub fn add_component(&mut self, entity: EntityId, component: ComponentBox) {
        self.components.entry(entity).or_default().push(component);
    }

    /// Removes all components of a given type from an entity.
    pub fn remove_component(&mut self, entity: &EntityId, component_type: &str) {
        if let Some(comps) = self.components.get_mut(entity) {
            comps.retain(|c| c.component_type() != component_type);
        }
    }

    /// Clears all entities, components, and systems.
    pub fn clear(&mut self) {
        self.entities.clear();
        self.components.clear();
        self.systems.clear();
    }

    /// Gets all components for an entity.
    pub fn get_components(&self, entity: &EntityId) -> Vec<&dyn Component> {
        self.components
            .get(entity)
            .map(|comps| comps.iter().map(|c| c.as_ref()).collect())
            .unwrap_or_default()
    }

    /// Queries entities that have a component of the given type.
    pub fn query(&self, component_type: &str) -> Vec<EntityId> {
        self.components
            .iter()
            .filter(|(_, comps)| comps.iter().any(|c| c.component_type() == component_type))
            .map(|(id, _)| *id)
            .collect()
    }

    /// Registers a system.
    pub fn add_system(&mut self, system: Box<dyn System>) {
        self.systems.push(system);
    }

    /// Runs all registered systems.
    pub fn run_systems(&mut self) {
        let systems: Vec<_> = self.systems.drain(..).collect();
        for system in systems {
            system.run(self);
            self.systems.push(system);
        }
    }

    /// Saves the world state to the database.
    pub fn save(&self, conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
        db::save_world(conn, self)
    }
}

/// Serializable snapshot of the world for sending to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldSnapshot {
    pub entities: Vec<EntitySnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntitySnapshot {
    pub id: u64,
    pub components: Vec<ComponentSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentSnapshot {
    pub component_type: String,
    pub settings: serde_json::Value,
}

impl From<&World> for WorldSnapshot {
    fn from(world: &World) -> Self {
        let entities: Vec<EntitySnapshot> = world
            .entities
            .all()
            .map(|eid| {
                let components: Vec<ComponentSnapshot> = world
                    .get_components(eid)
                    .iter()
                    .map(|c| ComponentSnapshot {
                        component_type: c.component_type().to_string(),
                        settings: c.settings(),
                    })
                    .collect();
                EntitySnapshot {
                    id: eid.0,
                    components,
                }
            })
            .collect();

        WorldSnapshot { entities }
    }
}

/// Tauri managed state for the world.
pub struct WorldState(pub Mutex<World>);
