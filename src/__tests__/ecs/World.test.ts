import { describe, it, expect, beforeEach } from 'vitest';
import { World } from "../../lib/ecs/World";
import { Component } from "../../lib/ecs/Component";
import type { WorldData } from "../../lib/types";

describe('ECS World - Parent/Child Hierarchy', () => {
  let world: World;

  beforeEach(() => {
    world = new World();
  });

  it('should create an entity without a parent', () => {
    const entity = world.createEntity(1);
    expect(entity.parentId).toBeUndefined();
    expect(world.entities.get(1)).toBe(entity);
  });

  it('should create an entity with a parent', () => {
    world.createEntity(1); // parent
    const child = world.createEntity(2, 1);
    expect(child.parentId).toBe(1);
  });

  it('getChildren returns children of a parent', () => {
    world.createEntity(1); // parent
    world.createEntity(2, 1); // child
    world.createEntity(3, 1); // child
    world.createEntity(4); // no parent

    const children = world.getChildren(1);
    expect(children).toEqual([2, 3]);
  });

  it('getChildren returns empty array for entity with no children', () => {
    world.createEntity(1);
    expect(world.getChildren(1)).toEqual([]);
  });

  it('loadFromData restores parentId', () => {
    const data: WorldData = {
      entities: [
        { id: 1, components: [] },
        { id: 2, parentId: 1, components: [] },
        { id: 3, parentId: 1, components: [] },
      ],
    };
    world.loadFromData(data);

    expect(world.entities.get(2)?.parentId).toBe(1);
    expect(world.entities.get(3)?.parentId).toBe(1);
    expect(world.entities.get(1)?.parentId).toBeUndefined();
    expect(world.getChildren(1)).toEqual([2, 3]);
  });

  it('toData includes parentId', () => {
    world.createEntity(1);
    world.createEntity(2, 1);
    world.createEntity(3, 1);

    const data = world.toData();
    const entity2 = data.entities.find(e => e.id === 2);
    const entity1 = data.entities.find(e => e.id === 1);
    expect(entity2?.parentId).toBe(1);
    expect(entity1?.parentId).toBeUndefined();
  });

  it('round-trip preserves parent-child relationships', () => {
    world.createEntity(1);
    world.createEntity(2, 1);
    world.createEntity(3, 1);
    world.addComponent(1, new Component('grid', { columns: 3, gap: 8 }));
    world.addComponent(2, new Component('renderFile', { targetPath: '/test.png' }));

    const data = world.toData();
    const world2 = new World();
    world2.loadFromData(data);

    expect(world2.getChildren(1)).toEqual([2, 3]);
    expect(world2.getComponent(2, 'renderFile')?.settings).toEqual({ targetPath: '/test.png' });
  });

  it('query still works with hierarchy', () => {
    world.createEntity(1);
    world.createEntity(2, 1);
    world.createEntity(3, 1);
    world.addComponent(1, new Component('grid'));
    world.addComponent(2, new Component('renderFile'));
    world.addComponent(3, new Component('renderFile'));

    const gridEntities = world.query('grid');
    const renderEntities = world.query('renderFile');

    expect(gridEntities).toEqual([1]);
    expect(renderEntities).toEqual([2, 3]);
  });
});
