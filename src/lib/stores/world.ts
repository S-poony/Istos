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

    /// Refresh world state from backend.
    async refreshFromBackend() {
      const { invoke } = await import("@tauri-apps/api/core");
      const state = await invoke("get_world_state");
      this.loadFromData(state as WorldData);
    },
  };
}

export const worldStore = createWorldStore();

/// Derived store: root entities in persisted order.
export const rootEntities = derived(worldStore, ($world) => $world.getOrderedRoots());

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

/// Desktop focused root entity store (null means trove root).
export const focusedEntityStore = writable<EntityId | null>(null);

export function focusEntity(id: EntityId | null): void {
  focusedEntityStore.set(id);
}

/// Helper to get an entity's display name.
///
/// The rule lives on `World` so it can be cached there — sorting one directory
/// asks for the same name O(n log n) times. This stays as the call site every
/// component already uses.
export function getEntityDisplayName(world: World, id: EntityId): string {
  return world.getDisplayName(id);
}

/// Derived store: breadcrumb path items [{ id: EntityId | null, name: string }].
export const breadcrumbPath = derived([worldStore, focusedEntityStore], ([$world, $focusedId]) => {
  const path: { id: EntityId | null; name: string }[] = [{ id: null, name: "Trove" }];
  if ($focusedId === null || $focusedId === undefined) return path;

  // Build ancestor chain upwards
  const ancestors: { id: EntityId; name: string }[] = [];
  let curr: EntityId | null = $focusedId;
  const visited = new Set<EntityId>();

  while (curr !== null && curr !== undefined && !visited.has(curr)) {
    visited.add(curr);
    const name = getEntityDisplayName($world, curr);
    ancestors.unshift({ id: curr, name });
    const entity = $world.entities.get(curr);
    const pid = entity?.parentId;
    curr = pid !== undefined && pid !== null ? pid : null;
  }

  return [...path, ...ancestors];
});

