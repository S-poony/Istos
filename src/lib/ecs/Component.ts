import type { EntityId, ComponentData } from "../types";

/// A component instance in the TypeScript ECS mirror.
export class Component {
  readonly componentType: string;
  settings: Record<string, unknown>;

  constructor(componentType: string, settings: Record<string, unknown> = {}) {
    this.componentType = componentType;
    this.settings = { ...settings };
  }

  updateSettings(settings: Record<string, unknown>): void {
    this.settings = { ...this.settings, ...settings };
  }

  toData(): ComponentData {
    return {
      componentType: this.componentType,
      settings: { ...this.settings },
    };
  }

  static fromData(data: ComponentData): Component {
    return new Component(data.componentType, data.settings);
  }
}

export type ComponentData = import("../types").ComponentData;
