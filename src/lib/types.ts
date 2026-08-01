/// Unique identifier for an entity.
export type EntityId = number;

/// 2D position.
export interface Position {
  x: number;
  y: number;
}

/// Intrinsic size of a rendered page or media item, in CSS pixels at scale 1.
/// Used to give a card the aspect ratio of the content it holds.
export interface IntrinsicSize {
  width: number;
  height: number;
}

/// Settings for the renderFile component.
export interface RenderFileSettings {
  targetPath?: string;
  scale: number;
  position: Position;
}

/// Settings for the grid component.
export interface GridSettings {
  columns: number;
  gap: number;
  draggable: boolean;
  order?: number[];
}

/// A component attached to an entity.
export interface ComponentData {
  componentType: string;
  settings: Record<string, unknown>;
}

/// An entity with its components.
export interface EntityData {
  id: EntityId;
  parentId?: EntityId;
  components: ComponentData[];
}

/// Snapshot of the entire world.
export interface WorldData {
  entities: EntityData[];
  rootOrder?: number[];
}
