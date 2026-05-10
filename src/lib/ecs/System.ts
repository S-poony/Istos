import type { EntityId } from "../types";

/// Interface for systems that operate on the world.
export interface System {
  readonly name: string;
  run(world: import("./World").World): void;
}
