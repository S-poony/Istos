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
    if (parentId !== undefined) {
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
    return result;
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
}
