import { get } from "svelte/store";
import {
  worldStore,
  focusedEntityStore,
  focusEntity,
  breadcrumbPath,
} from "./stores/world";
import type { EntityId } from "./types";

/// The backend's name for "the trove on disk is no longer what the world says".
export const TROVE_CHANGED_EVENT = "trove-changed";

/// What one reconciliation changed. Emitted only when at least one of these is
/// non-zero, so receiving the event already means there is something to reload.
export interface TroveChange {
  added: number;
  removed: number;
  reparented: number;
}

/// Reloads the mirror after the backend has reconciled the trove.
///
/// The reload itself is the easy part. The interesting case is the user
/// standing inside a folder that has just been deleted from under them: their
/// focus now names an entity that does not exist, which would leave them
/// looking at an empty desktop with a breadcrumb trail to nowhere. So the trail
/// they walked down is read *before* the refresh, and afterwards they are put
/// at the deepest step of it that still exists — usually the parent of whatever
/// disappeared, and the trove root in the worst case.
export async function applyTroveChange(): Promise<void> {
  const trail = get(breadcrumbPath);

  await worldStore.refreshFromBackend();

  const focused = get(focusedEntityStore);
  if (focused === null || focused === undefined) return;

  const world = get(worldStore);
  if (world.entities.has(focused)) return;

  for (let index = trail.length - 1; index >= 0; index--) {
    const id: EntityId | null = trail[index].id;
    if (id === null || world.entities.has(id)) {
      focusEntity(id);
      return;
    }
  }
  focusEntity(null);
}

/// Serialises notifications. Two changes landing close together must apply one
/// after the other: a refresh reads the focus trail before it starts, so one
/// starting while another is halfway through would read a mirror that is
/// neither the old world nor the new one.
let pending: Promise<void> = Promise.resolve();

/// Subscribes to backend trove notifications. Returns the unsubscribe function.
///
/// The Tauri event API is imported lazily so that importing this module is safe
/// outside a Tauri window — under Vitest, and in a plain browser during `npm
/// run dev`.
export async function startWatchingTrove(): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");

  return listen<TroveChange>(TROVE_CHANGED_EVENT, () => {
    pending = pending
      .then(applyTroveChange)
      .catch((error) => console.error("Failed to apply a trove change:", error));
  });
}
