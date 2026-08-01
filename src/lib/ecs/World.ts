import { Entity } from "./Entity";
import { Component } from "./Component";
import type { System } from "./System";
import type { EntityId, WorldData, EntityData, ComponentData } from "../types";

/// The central ECS world container (TypeScript mirror).
///
/// Every lookup the renderer performs on a hot path is indexed. The naive
/// version of this class answered "who are entity N's children?" by walking
/// every entity in the world, and the desktop asks that question once per
/// rendered node — which made drawing a trove quadratic in its size. The
/// indices below exist so that each question costs what it looks like it
/// costs.
///
/// Derived results (sorted children, ordered children, display names) are
/// **cached, and the same array instance is returned until something
/// invalidates it**. That is not only a speed concern: a keyed `{#each}` over a
/// freshly built array re-runs on every reactive tick even when the contents
/// are identical, which tears down and rebuilds cards that never changed.
export class World {
  entities: Map<EntityId, Entity> = new Map();
  components: Map<EntityId, Component[]> = new Map();
  systems: System[] = [];
  rootOrder: EntityId[] = [];

  /// Structural index: parent -> children, in insertion order.
  private childrenByParent: Map<EntityId, EntityId[]> = new Map();
  /// Entities with no parent, in insertion order.
  private rootIds: EntityId[] = [];
  /// Component index: entity -> componentType -> first component of that type.
  private componentsByType: Map<EntityId, Map<string, Component>> = new Map();
  /// Reverse component index: componentType -> entities carrying it.
  private entitiesByComponent: Map<string, Set<EntityId>> = new Map();

  /// Derived caches. Cleared wholesale rather than surgically: the operations
  /// that invalidate them (load, reparent, reorder) are user-scale events, not
  /// per-frame ones, so precision here would buy nothing and could go stale.
  private sortedCache: Map<EntityId, EntityId[]> = new Map();
  private orderedChildrenCache: Map<EntityId, EntityId[]> = new Map();
  private orderedRootsCache: EntityId[] | null = null;
  private displayNameCache: Map<EntityId, string> = new Map();

  constructor() {}

  /// Drops every derived cache. Called by anything that changes structure,
  /// ordering, or the components a name is read from.
  private invalidateDerived(): void {
    this.sortedCache.clear();
    this.orderedChildrenCache.clear();
    this.orderedRootsCache = null;
    this.displayNameCache.clear();
  }

  /// Creates a new entity.
  createEntity(id: EntityId, parentId?: EntityId): Entity {
    const entity = new Entity(id);
    if (parentId !== undefined && parentId !== null) {
      entity.parentId = parentId;
      this.indexChild(parentId, id);
    } else {
      this.rootIds.push(id);
    }
    this.entities.set(id, entity);
    this.components.set(id, []);
    this.componentsByType.set(id, new Map());
    this.invalidateDerived();
    return entity;
  }

  private indexChild(parentId: EntityId, childId: EntityId): void {
    const siblings = this.childrenByParent.get(parentId);
    if (siblings) {
      siblings.push(childId);
    } else {
      this.childrenByParent.set(parentId, [childId]);
    }
  }

  private unindexChild(parentId: EntityId | undefined, childId: EntityId): void {
    if (parentId === undefined || parentId === null) {
      const at = this.rootIds.indexOf(childId);
      if (at !== -1) this.rootIds.splice(at, 1);
      return;
    }
    const siblings = this.childrenByParent.get(parentId);
    if (!siblings) return;
    const at = siblings.indexOf(childId);
    if (at !== -1) siblings.splice(at, 1);
  }

  /// Adds a component to an entity.
  addComponent(entityId: EntityId, component: Component): void {
    if (!this.components.has(entityId)) {
      this.components.set(entityId, []);
    }
    this.components.get(entityId)!.push(component);

    let byType = this.componentsByType.get(entityId);
    if (!byType) {
      byType = new Map();
      this.componentsByType.set(entityId, byType);
    }
    /// `getComponent` has always returned the *first* component of a type, so
    /// a second one of the same type must not displace it.
    if (!byType.has(component.componentType)) {
      byType.set(component.componentType, component);
    }

    let carriers = this.entitiesByComponent.get(component.componentType);
    if (!carriers) {
      carriers = new Set();
      this.entitiesByComponent.set(component.componentType, carriers);
    }
    carriers.add(entityId);

    this.invalidateDerived();
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
    this.componentsByType.get(entityId)?.delete(componentType);
    this.entitiesByComponent.get(componentType)?.delete(entityId);
    this.invalidateDerived();
  }

  /// Gets all components for an entity.
  getComponents(entityId: EntityId): Component[] {
    return this.components.get(entityId) ?? [];
  }

  /// Gets the first component of a given type for an entity.
  getComponent(entityId: EntityId, componentType: string): Component | undefined {
    return this.componentsByType.get(entityId)?.get(componentType);
  }

  /// Whether an entity carries a component of the given type. Cheaper than
  /// `getComponent(...) !== undefined` and says what the caller means.
  hasComponent(entityId: EntityId, componentType: string): boolean {
    return this.componentsByType.get(entityId)?.has(componentType) ?? false;
  }

  /// Queries entities that have a component of the given type.
  query(componentType: string): EntityId[] {
    const carriers = this.entitiesByComponent.get(componentType);
    return carriers ? [...carriers] : [];
  }

  /// Returns children of a given entity, sorted.
  getChildren(entityId: EntityId): EntityId[] {
    const cached = this.sortedCache.get(entityId);
    if (cached) return cached;
    const sorted = this.sortEntities(this.childrenByParent.get(entityId) ?? []);
    this.sortedCache.set(entityId, sorted);
    return sorted;
  }

  /// How many children an entity has, without building or sorting a list.
  /// Cards and captions only need the count, and paying for a sort to render a
  /// number is the kind of thing that is invisible until the trove is large.
  getChildCount(entityId: EntityId): number {
    return this.childrenByParent.get(entityId)?.length ?? 0;
  }

  /// The entity's own name: the last segment of its `renderFile` target path,
  /// or `Entity #ID` when it has no path. Cached, because sorting a directory
  /// asks for the same name O(n log n) times.
  getDisplayName(entityId: EntityId): string {
    const cached = this.displayNameCache.get(entityId);
    if (cached !== undefined) return cached;

    const path = this.getComponent(entityId, "renderFile")?.settings
      ?.targetPath as string | undefined;
    let name = `Entity #${entityId}`;
    if (path) {
      const normalized = path.replace(/[/\\]+$/, "");
      const parts = normalized.split(/[/\\]/);
      name = parts[parts.length - 1] || name;
    }
    this.displayNameCache.set(entityId, name);
    return name;
  }

  /// Sorts entities: containers first (has 'grid'), then the rest, both
  /// alphabetically.
  sortEntities(entityIds: EntityId[]): EntityId[] {
    return [...entityIds].sort((a, b) => {
      const aHasGrid = this.hasComponent(a, "grid");
      const bHasGrid = this.hasComponent(b, "grid");

      if (aHasGrid && !bHasGrid) return -1;
      if (!aHasGrid && bHasGrid) return 1;

      return this.getDisplayName(a).localeCompare(this.getDisplayName(b), undefined, {
        numeric: true,
        sensitivity: "base",
      });
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
    this.childrenByParent.clear();
    this.componentsByType.clear();
    this.entitiesByComponent.clear();
    this.rootIds = [];
    this.rootOrder = Array.isArray(data.rootOrder) ? [...data.rootOrder] : [];

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

    this.invalidateDerived();
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

  /// Returns root entities in their persisted explicit order, then new roots alphabetically.
  getOrderedRoots(): EntityId[] {
    if (this.orderedRootsCache) return this.orderedRootsCache;

    const rootSet = new Set(this.rootIds);
    const ordered = this.rootOrder.filter((id) => rootSet.has(id));
    const known = new Set(ordered);
    const result = [
      ...ordered,
      ...this.sortEntities(this.rootIds.filter((id) => !known.has(id))),
    ];
    this.orderedRootsCache = result;
    return result;
  }

  /// Returns children ordered by the parent's grid component order settings, or falls back to sortEntities.
  getOrderedChildren(parentId: EntityId): EntityId[] {
    const cached = this.orderedChildrenCache.get(parentId);
    if (cached) return cached;

    const children = this.getChildren(parentId);
    const order = this.getComponent(parentId, "grid")?.settings?.order as
      | number[]
      | undefined;

    let result: EntityId[];
    if (order && Array.isArray(order) && order.length > 0) {
      const orderMap = new Map<number, number>();
      order.forEach((id, idx) => orderMap.set(id, idx));
      const inOrder = children.filter((c) => orderMap.has(c));
      const notInOrder = children.filter((c) => !orderMap.has(c));
      inOrder.sort((a, b) => (orderMap.get(a) ?? 0) - (orderMap.get(b) ?? 0));
      result = [...inOrder, ...this.sortEntities(notInOrder)];
    } else {
      result = children;
    }

    this.orderedChildrenCache.set(parentId, result);
    return result;
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
    this.invalidateDerived();
  }

  /// Reparents an entity under a new parent.
  reparentEntity(entityId: EntityId, newParentId: EntityId): void {
    const entity = this.entities.get(entityId);
    if (!entity) return;
    this.unindexChild(entity.parentId, entityId);
    entity.parentId = newParentId;
    this.indexChild(newParentId, entityId);
    this.invalidateDerived();
  }

  /// Whether `ancestorId` is `entityId` itself or one of its ancestors. Used to
  /// refuse a drop that would make an entity its own descendant.
  isAncestorOf(ancestorId: EntityId, entityId: EntityId): boolean {
    let current: EntityId | undefined = entityId;
    const seen = new Set<EntityId>();
    while (current !== undefined && current !== null && !seen.has(current)) {
      if (current === ancestorId) return true;
      seen.add(current);
      current = this.entities.get(current)?.parentId;
    }
    return false;
  }
}
