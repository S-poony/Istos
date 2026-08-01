import { writable } from "svelte/store";
import type { EntityId } from "../types";
import type { World } from "../ecs/World";

/// What the menu is currently open on, and where.
///
/// The menu is state, not a component per card. One instance lives at the app
/// root and reads this store; mounting a menu inside every card would add a
/// component and a set of listeners per entity, which is exactly the kind of
/// per-entity cost a large trove cannot afford for a thing the user sees one of
/// at a time.
export interface ContextMenuState {
  entityId: EntityId;
  /// The entity's own name, shown as the menu's title.
  name: string;
  /// The file this entity stands for, or `null` when it has none. The system
  /// actions are meaningless without it and say so rather than disappearing.
  path: string | null;
  /// Viewport coordinates of the click that opened the menu.
  x: number;
  y: number;
}

export const contextMenu = writable<ContextMenuState | null>(null);

/// Opens the menu for an entity at the position of a right-click.
///
/// Follows the same rule as a left-click (see `src/lib/interaction.ts`): the
/// innermost thing that handles the event owns it, so this stops propagation.
/// Without that, right-clicking a card inside a container would open the
/// container's menu instead of the card's.
export function openContextMenu(
  event: MouseEvent,
  world: World,
  entityId: EntityId
): void {
  event.preventDefault();
  event.stopPropagation();

  const path = world.getComponent(entityId, "renderFile")?.settings?.targetPath as
    | string
    | undefined;

  contextMenu.set({
    entityId,
    name: world.getDisplayName(entityId),
    path: path ?? null,
    x: event.clientX,
    y: event.clientY,
  });
}

export function closeContextMenu(): void {
  contextMenu.set(null);
}
