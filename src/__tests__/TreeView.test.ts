import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import { worldStore } from '../lib/stores/world';
import { World } from '../lib/ecs/World';
import { Component } from '../lib/ecs/Component';
import TreeNode from '../lib/components/TreeNode.svelte';
import TreeView from '../lib/components/TreeView.svelte';

// Mock Tauri apps API so we don't try to call native code during unit tests
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (src: string) => src,
}));

// Helper to populate the store with data
function loadFixture(data: import('../lib/types').WorldData) {
  worldStore.loadFromData(data);
}

describe('TreeNode - Expand/Collapse', () => {
  beforeEach(() => {
    // Load a folder with children into the store
    loadFixture({
      entities: [
        {
          id: 1,
          components: [
            {
              componentType: 'grid',
              settings: { columns: 3, gap: 8, draggable: false },
            },
            {
              componentType: 'renderFile',
              settings: {
                targetPath: '/home/user/Documents',
                scale: 1,
                position: { x: 0, y: 0 },
              },
            },
          ],
        },
        {
          id: 2,
          parentId: 1,
          components: [
            {
              componentType: 'renderFile',
              settings: {
                targetPath: '/home/user/Documents/report.txt',
                scale: 1,
                position: { x: 0, y: 0 },
              },
            },
          ],
        },
        {
          id: 3,
          parentId: 1,
          components: [
            {
              componentType: 'renderFile',
              settings: {
                targetPath: '/home/user/Documents/photo.png',
                scale: 1,
                position: { x: 0, y: 0 },
              },
            },
          ],
        },
      ],
    });
  });

  function isFolder(id: number): boolean {
    return worldStore.getWorld().getComponent(id, 'grid') !== undefined;
  }

  it('should show toggle arrow for a folder with children', () => {
    const { container } = render(TreeNode, {
      id: 1,
      draggedId: null,
      dropTarget: null,
      isFolder,
      onDragStart: vi.fn(),
      onDragOver: vi.fn(),
      onDragLeave: vi.fn(),
      onDrop: vi.fn(),
      onDragEnd: vi.fn(),
      depth: 0,
    });

    // The toggle arrow should be present (▸ since not expanded yet)
    const toggle = container.querySelector('.toggle');
    expect(toggle).toBeInTheDocument();
    expect(toggle?.textContent?.trim()).toBe('▸');
  });

  it('should NOT show children when collapsed', () => {
    const { container } = render(TreeNode, {
      id: 1,
      draggedId: null,
      dropTarget: null,
      isFolder,
      onDragStart: vi.fn(),
      onDragOver: vi.fn(),
      onDragLeave: vi.fn(),
      onDrop: vi.fn(),
      onDragEnd: vi.fn(),
      depth: 0,
    });

    // Children wrapper should NOT be in the DOM
    const childrenContainer = container.querySelector('.children');
    expect(childrenContainer).toBeNull();
  });

  it('should expand and show children when toggle is clicked', async () => {
    const { container } = render(TreeNode, {
      id: 1,
      draggedId: null,
      dropTarget: null,
      isFolder,
      onDragStart: vi.fn(),
      onDragOver: vi.fn(),
      onDragLeave: vi.fn(),
      onDrop: vi.fn(),
      onDragEnd: vi.fn(),
      depth: 0,
    });

    // Click the toggle to expand
    const toggle = container.querySelector('.toggle') as HTMLElement;
    expect(toggle).toBeInTheDocument();
    await fireEvent.click(toggle);

    // Toggle arrow should change to ▾
    expect(toggle.textContent?.trim()).toBe('▾');

    // Children should now be visible
    const childrenContainer = container.querySelector('.children');
    expect(childrenContainer).toBeInTheDocument();

    // Should contain child nodes (recursive TreeNodes for children)
    const childNodes = childrenContainer!.querySelectorAll('.tree-node');
    expect(childNodes.length).toBe(2);
  });

  it('should collapse and hide children when toggle is clicked again', async () => {
    const { container } = render(TreeNode, {
      id: 1,
      draggedId: null,
      dropTarget: null,
      isFolder,
      onDragStart: vi.fn(),
      onDragOver: vi.fn(),
      onDragLeave: vi.fn(),
      onDrop: vi.fn(),
      onDragEnd: vi.fn(),
      depth: 0,
    });

    const toggle = container.querySelector('.toggle') as HTMLElement;

    // Expand
    await fireEvent.click(toggle);
    expect(toggle.textContent?.trim()).toBe('▾');
    expect(container.querySelector('.children')).toBeInTheDocument();

    // Collapse
    await fireEvent.click(toggle);
    expect(toggle.textContent?.trim()).toBe('▸');
    expect(container.querySelector('.children')).toBeNull();
  });

  it('should NOT show toggle arrow for a file entity without children', () => {
    const { container } = render(TreeNode, {
      id: 2, // a file, not a folder
      draggedId: null,
      dropTarget: null,
      isFolder,
      onDragStart: vi.fn(),
      onDragOver: vi.fn(),
      onDragLeave: vi.fn(),
      onDrop: vi.fn(),
      onDragEnd: vi.fn(),
      depth: 0,
    });

    // There should be a toggle-spacer instead of a toggle arrow
    const toggle = container.querySelector('.toggle');
    expect(toggle).toBeInTheDocument();
    // The toggle should contain the spacer, not ▸ or ▾
    expect(toggle?.querySelector('.toggle-spacer')).toBeInTheDocument();
    expect(toggle?.textContent?.trim()).toBe('');
  });

  it('should show correct display name from renderFile path', () => {
    render(TreeNode, {
      id: 2, // path: /home/user/Documents/report.txt
      draggedId: null,
      dropTarget: null,
      isFolder,
      onDragStart: vi.fn(),
      onDragOver: vi.fn(),
      onDragLeave: vi.fn(),
      onDrop: vi.fn(),
      onDragEnd: vi.fn(),
      depth: 0,
    });

    expect(screen.getByText('report.txt')).toBeInTheDocument();
  });

  it('should show fallback name for entity without renderFile', () => {
    // Load an entity with no renderFile component
    loadFixture({
      entities: [
        {
          id: 99,
          components: [
            { componentType: 'grid', settings: { columns: 2, gap: 4, draggable: false } },
          ],
        },
      ],
    });

    render(TreeNode, {
      id: 99,
      draggedId: null,
      dropTarget: null,
      isFolder,
      onDragStart: vi.fn(),
      onDragOver: vi.fn(),
      onDragLeave: vi.fn(),
      onDrop: vi.fn(),
      onDragEnd: vi.fn(),
      depth: 0,
    });

    expect(screen.getByText('Entity #99')).toBeInTheDocument();
  });
});

describe('TreeView - Drag and Drop Logic', () => {
  beforeEach(() => {
    loadFixture({
      entities: [
        // Root folder 1 with two children
        {
          id: 10,
          components: [
            { componentType: 'grid', settings: { columns: 3, gap: 8, draggable: false } },
            { componentType: 'renderFile', settings: { targetPath: '/FolderA', scale: 1, position: { x: 0, y: 0 } } },
          ],
        },
        { id: 11, parentId: 10, components: [{ componentType: 'renderFile', settings: { targetPath: 'a.txt', scale: 1, position: { x: 0, y: 0 } } }] },
        { id: 12, parentId: 10, components: [{ componentType: 'renderFile', settings: { targetPath: 'b.txt', scale: 1, position: { x: 0, y: 0 } } }] },

        // Root folder 2 with one child
        {
          id: 20,
          components: [
            { componentType: 'grid', settings: { columns: 3, gap: 8, draggable: false } },
            { componentType: 'renderFile', settings: { targetPath: '/FolderB', scale: 1, position: { x: 0, y: 0 } } },
          ],
        },
        { id: 21, parentId: 20, components: [{ componentType: 'renderFile', settings: { targetPath: 'c.txt', scale: 1, position: { x: 0, y: 0 } } }] },

        // Root file (no parent)
        { id: 30, components: [{ componentType: 'renderFile', settings: { targetPath: 'standalone.md', scale: 1, position: { x: 0, y: 0 } } }] },
      ],
    });
  });

  it('should render root entities in the tree', () => {
    const { container } = render(TreeView);

    // Root entities: FolderA (10), FolderB (20), standalone.md (30)
    const rootNodes = container.querySelectorAll('.tree-root > .tree-node-wrapper > .tree-node');
    expect(rootNodes.length).toBe(3);

    // Check display names
    expect(screen.getByText('FolderA')).toBeInTheDocument();
    expect(screen.getByText('FolderB')).toBeInTheDocument();
    expect(screen.getByText('standalone.md')).toBeInTheDocument();
  });

  it('should NOT render children of collapsed folders initially', () => {
    render(TreeView);

    // Children of FolderA (a.txt, b.txt) should not be visible
    expect(screen.queryByText('a.txt')).not.toBeInTheDocument();
    expect(screen.queryByText('b.txt')).not.toBeInTheDocument();
    expect(screen.queryByText('c.txt')).not.toBeInTheDocument();
  });

  it('should expand a root folder when its toggle is clicked', async () => {
    const { container } = render(TreeView);

    // Find all toggle elements - first one should be FolderA
    const toggles = container.querySelectorAll('.toggle');
    const folderAToggle = toggles[0];

    await fireEvent.click(folderAToggle);

    // Children should now be visible
    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(screen.getByText('b.txt')).toBeInTheDocument();
  });

  it('should show tree-node with correct indentation', () => {
    const { container } = render(TreeView);

    const rootNode = container.querySelector('.tree-node') as HTMLElement;
    expect(rootNode).toBeInTheDocument();

    // Root node should have depth 0 -> padding-left: 8px
    expect(rootNode.style.paddingLeft).toBe('8px');
  });

  it('should show empty state when no entities exist', () => {
    // Load empty world
    loadFixture({ entities: [] });

    render(TreeView);

    expect(screen.getByText('No files in trove.')).toBeInTheDocument();
  });
});

describe('World ECS - Reorder and Reparent Operations', () => {
  let world: World;

  beforeEach(() => {
    world = new World();
  });

  it('should return ordered children when grid has explicit order array', () => {
    const w = new World();
    w.createEntity(100); // parent with grid
    w.addComponent(100, new Component('grid', { columns: 3, gap: 8, order: [103, 102, 101] }));
    w.createEntity(101, 100);
    w.addComponent(101, new Component('renderFile', { targetPath: 'a.txt' }));
    w.createEntity(102, 100);
    w.addComponent(102, new Component('renderFile', { targetPath: 'b.txt' }));
    w.createEntity(103, 100);
    w.addComponent(103, new Component('renderFile', { targetPath: 'c.txt' }));

    const ordered = w.getOrderedChildren(100);
    expect(ordered).toEqual([103, 102, 101]);
  });

  it('should fallback to alphabetical sort when no order array', () => {
    world.createEntity(1); // parent with grid
    world.createEntity(2, 1);
    world.addComponent(2, new Component('renderFile', { targetPath: 'zebra.txt' }));
    world.createEntity(3, 1);
    world.addComponent(3, new Component('renderFile', { targetPath: 'alpha.txt' }));

    const ordered = world.getOrderedChildren(1);
    // Alphabetical: alpha then zebra, so [3, 2]
    expect(ordered).toEqual([3, 2]);
  });

  it('reorderChildren should update the grid component order', () => {
    world.createEntity(1);
    world.addComponent(1, new Component('grid', { columns: 3, gap: 8 }));

    world.reorderChildren(1, [5, 4, 3]);
    const comp = world.getComponent(1, 'grid');
    expect(comp?.settings?.order).toEqual([5, 4, 3]);
  });

  it('reparentEntity should change entity parent', () => {
    world.createEntity(1);
    world.createEntity(2);
    world.createEntity(3, 1);

    expect(world.entities.get(3)?.parentId).toBe(1);

    world.reparentEntity(3, 2);
    expect(world.entities.get(3)?.parentId).toBe(2);
    expect(world.getChildren(1)).toEqual([]);
    expect(world.getChildren(2)).toEqual([3]);
  });

  it('getOrderedChildren after reparent + reorder should reflect new parent', () => {
    // Setup: parent 1 has [childA, childB], parent 2 has [childC]
    world.createEntity(1);
    world.addComponent(1, new Component('grid'));
    world.createEntity(11, 1);
    world.addComponent(11, new Component('renderFile', { targetPath: 'a.txt' }));
    world.createEntity(12, 1);
    world.addComponent(12, new Component('renderFile', { targetPath: 'b.txt' }));

    world.createEntity(2);
    world.addComponent(2, new Component('grid'));
    world.createEntity(21, 2);
    world.addComponent(21, new Component('renderFile', { targetPath: 'c.txt' }));

    // Move child 12 from parent 1 to parent 2
    world.reparentEntity(12, 2);

    // Reorder parent 2's children: [12, 21]
    world.reorderChildren(2, [12, 21]);

    expect(world.getChildren(1)).toEqual([11]);
    expect(world.getOrderedChildren(2)).toEqual([12, 21]);
  });
});
