import { writable, derived } from "svelte/store";
import { World } from "../ecs/World";
import type { WorldData } from "../types";

/// The reactive world store.
function createWorldStore() {
  const world = new World();
  const { subscribe, set, update } = writable(world);

  return {
    subscribe,

    /// Load world state from backend data.
    loadFromData(data: WorldData) {
      world.loadFromData(data);
      set(world);
    },

    /// Get the underlying world instance.
    getWorld(): World {
      return world;
    },
  };
}

export const worldStore = createWorldStore();

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
