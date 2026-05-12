import type { EntityId } from "../types";

/// An entity in the TypeScript ECS mirror.
export class Entity {
  readonly id: EntityId;
  parentId?: EntityId;

  constructor(id: EntityId) {
    this.id = id;
    this.parentId = undefined;
  }
}
