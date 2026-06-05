import { writable, derived } from "svelte/store";
import { World } from "../ecs/World";
import type { WorldData, EntityId } from "../types";

/// The reactive world store.
function createWorldStore() {
  let world = new World();
  const { subscribe, set } = writable(world);

  return {
    subscribe,

    /// Load world state from backend data.
    loadFromData(data: WorldData) {
      const newWorld = new World();
      newWorld.loadFromData(data);
      world = newWorld;
      set(world);
    },

    /// Get the underlying world instance.
    getWorld(): World {
      return world;
    },
  };
}

export const worldStore = createWorldStore();

/// Derived store: entities that have no parentId.
export const rootEntities = derived(worldStore, ($world) => {
  const roots: EntityId[] = [];
  for (const [id, entity] of $world.entities) {
    if (entity.parentId === undefined || entity.parentId === null) {
      roots.push(id);
    }
  }
  return $world.sortEntities(roots);
});

/// Derived store: entities that have a grid component.
export const gridEntities = derived(worldStore, ($world) =>
  $world.query("grid")
);

/// Derived store: entities that have a renderFile component.
export const renderFileEntities = derived(worldStore, ($world) =>
  $world.query("renderFile")
);

/// Whether we are in edit mode.
export const editMode = writable(false);
