import { Entity } from "./Entity";
import { Component } from "./Component";
import type { System } from "./System";
import type { EntityId, WorldData, EntityData, ComponentData } from "../types";

/// The central ECS world container (TypeScript mirror).
export class World {
  entities: Map<EntityId, Entity> = new Map();
  components: Map<EntityId, Component[]> = new Map();
  systems: System[] = [];

  constructor() {}

  /// Creates a new entity.
  createEntity(id: EntityId, parentId?: EntityId): Entity {
    const entity = new Entity(id);
    if (parentId !== undefined && parentId !== null) {
      entity.parentId = parentId;
    }
    this.entities.set(id, entity);
    this.components.set(id, []);
    return entity;
  }

  /// Adds a component to an entity.
  addComponent(entityId: EntityId, component: Component): void {
    if (!this.components.has(entityId)) {
      this.components.set(entityId, []);
    }
    this.components.get(entityId)!.push(component);
  }

  /// Removes all components of a given type from an entity.
  removeComponent(entityId: EntityId, componentType: string): void {
    const comps = this.components.get(entityId);
    if (comps) {
      this.components.set(
        entityId,
        comps.filter((c) => c.componentType !== componentType)
      );
    }
  }

  /// Gets all components for an entity.
  getComponents(entityId: EntityId): Component[] {
    return this.components.get(entityId) ?? [];
  }

  /// Gets the first component of a given type for an entity.
  getComponent(entityId: EntityId, componentType: string): Component | undefined {
    return this.getComponents(entityId).find(
      (c) => c.componentType === componentType
    );
  }

  /// Queries entities that have a component of the given type.
  query(componentType: string): EntityId[] {
    const result: EntityId[] = [];
    for (const [id, comps] of this.components) {
      if (comps.some((c) => c.componentType === componentType)) {
        result.push(id);
      }
    }
    return result;
  }

  /// Returns children of a given entity.
  getChildren(entityId: EntityId): EntityId[] {
    const result: EntityId[] = [];
    for (const [id, entity] of this.entities) {
      if (entity.parentId === entityId) {
        result.push(id);
      }
    }
    return this.sortEntities(result);
  }

  /// Sorts entities: folders first (has 'grid' component), then files, both alphabetically.
  sortEntities(entityIds: EntityId[]): EntityId[] {
    return [...entityIds].sort((a, b) => {
      const aHasGrid = this.getComponent(a, "grid") !== undefined;
      const bHasGrid = this.getComponent(b, "grid") !== undefined;

      if (aHasGrid && !bHasGrid) return -1;
      if (!aHasGrid && bHasGrid) return 1;

      const aComp = this.getComponent(a, "renderFile");
      const bComp = this.getComponent(b, "renderFile");

      const aPath = (aComp?.settings?.targetPath as string) || `Entity #${a}`;
      const bPath = (bComp?.settings?.targetPath as string) || `Entity #${b}`;

      const aName = aPath.split(/[/\\]/).pop() || "";
      const bName = bPath.split(/[/\\]/).pop() || "";

      return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  /// Registers a system.
  addSystem(system: System): void {
    this.systems.push(system);
  }

  /// Runs all registered systems.
  runSystems(): void {
    for (const system of this.systems) {
      system.run(this);
    }
  }

  /// Loads world state from a snapshot.
  loadFromData(data: WorldData): void {
    if (!data || !Array.isArray(data.entities)) {
      throw new Error(`Invalid WorldData: expected an object with an 'entities' array. Received: ${JSON.stringify(data)}`);
    }

    this.entities.clear();
    this.components.clear();

    for (const entityData of data.entities) {
      if (!entityData || typeof entityData.id !== "number" || !Array.isArray(entityData.components)) {
        console.warn(`Invalid entity data skipped. Received: ${JSON.stringify(entityData)}`);
        continue;
      }

      this.createEntity(entityData.id, entityData.parentId);
      for (const compData of entityData.components) {
        try {
          this.addComponent(
            entityData.id,
            Component.fromData(compData)
          );
        } catch (err) {
          console.error(`Failed to load component for entity ${entityData.id}:`, err);
        }
      }
    }
  }

  /// Exports the world state as a snapshot.
  toData(): WorldData {
    const entities: EntityData[] = [];
    for (const [id, comps] of this.components) {
      const entity = this.entities.get(id);
      entities.push({
        id,
        parentId: entity?.parentId,
        components: comps.map((c) => c.toData()),
      });
    }
    return { entities };
  }

  /// Returns children ordered by the parent's grid component order settings, or falls back to sortEntities.
  getOrderedChildren(parentId: EntityId): EntityId[] {
    const children = this.getChildren(parentId);
    const gridComp = this.getComponent(parentId, "grid");
    const order = gridComp?.settings?.order as number[] | undefined;
    if (order && Array.isArray(order) && order.length > 0) {
      // Build a map for quick lookup
      const orderMap = new Map<number, number>();
      order.forEach((id, idx) => orderMap.set(id, idx));
      // Sort: items in order first (by their position), then any unknowns alphabetically
      const inOrder = children.filter(c => orderMap.has(c));
      const notInOrder = children.filter(c => !orderMap.has(c));
      inOrder.sort((a, b) => (orderMap.get(a) ?? 0) - (orderMap.get(b) ?? 0));
      return [...inOrder, ...this.sortEntities(notInOrder)];
    }
    return this.sortEntities(children);
  }

  /// Updates the explicit order of children for a grid entity.
  reorderChildren(parentId: EntityId, orderedIds: EntityId[]): void {
    const parentEntity = this.entities.get(parentId);
    if (!parentEntity) return;
    const comps = this.components.get(parentId);
    if (!comps) return;
    for (const comp of comps) {
      if (comp.componentType === "grid") {
        comp.settings = { ...comp.settings, order: orderedIds };
        break;
      }
    }
  }

  /// Reparents an entity under a new parent.
  reparentEntity(entityId: EntityId, newParentId: EntityId): void {
    const entity = this.entities.get(entityId);
    if (!entity) return;
    entity.parentId = newParentId;
  }
}
