import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import { tick, type ComponentProps } from 'svelte';
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

function isContainer(id: number): boolean {
    return worldStore.getWorld().getComponent(id, 'grid') !== undefined;
}

/// Every prop `TreeNode` requires, with the callbacks stubbed. Spelling the
/// full set out at each call site meant a new prop had to be added in eight
/// places, and the four that were missed only surfaced as type errors — the
/// tests kept passing while handing the component `undefined` where it
/// expected a function.
function nodeProps(id: number, overrides: Partial<TreeNodeProps> = {}): TreeNodeProps {
    return {
        id,
        draggedId: null,
        dropTarget: null,
        isContainer,
        onDragStart: vi.fn(),
        onDragOver: vi.fn(),
        onDragLeave: vi.fn(),
        onDrop: vi.fn(),
        onDragEnd: vi.fn(),
        depth: 0,
        isAncestor: vi.fn(),
        setDropTarget: vi.fn(),
        ...overrides,
    };
}

type TreeNodeProps = ComponentProps<typeof TreeNode>;

/// Clicks the expand toggle of the node with the given label.
///
/// Only the top level of the tree starts open, so any test about what is
/// visible further down has to say how it got there — which is also the thing
/// being asserted: the tree has no depth limit, it just does not open itself.
async function expandNode(label: string): Promise<void> {
    const node = screen.getByText(label).closest('.tree-node')!;
    await fireEvent.click(node.querySelector('.toggle')!);
    await tick();
}

describe('TreeNode - Expand/Collapse', () => {
    beforeEach(() => {
        // Load a container with children into the store
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

    it('should show toggle arrow ▾ for a folder with children (expanded by default)', () => {
        const { container } = render(TreeNode, nodeProps(1));

        // The toggle arrow should be present (▾ since expanded by default)
        const toggle = container.querySelector('.toggle');
        expect(toggle).toBeInTheDocument();
        expect(toggle?.textContent?.trim()).toBe('▾');
    });

    it('should show children when expanded by default', () => {
        const { container } = render(TreeNode, nodeProps(1));

        // Children wrapper should be in the DOM initially
        const childrenContainer = container.querySelector('.children');
        expect(childrenContainer).toBeInTheDocument();
        const childNodes = childrenContainer!.querySelectorAll('.tree-node');
        expect(childNodes.length).toBe(2);
    });

    it('should collapse and hide children when toggle is clicked', async () => {
        const { container } = render(TreeNode, nodeProps(1));

        const toggle = container.querySelector('.toggle') as HTMLElement;
        expect(toggle.textContent?.trim()).toBe('▾');
        expect(container.querySelector('.children')).toBeInTheDocument();

        // Click toggle to collapse
        await fireEvent.click(toggle);

        // Toggle arrow should change to ▸
        expect(toggle.textContent?.trim()).toBe('▸');

        // Children should now be hidden/removed
        const childrenContainer = container.querySelector('.children');
        expect(childrenContainer).toBeNull();
    });

    it('should render attached component badges for an entity', () => {
        render(TreeNode, nodeProps(1));

        const badges = screen.getAllByTestId('component-badge');
        const badgeTexts = badges.map((b) => b.textContent?.trim());
        expect(badgeTexts).toContain('grid');
        expect(badgeTexts).toContain('renderFile');
    });

    it('should NOT show toggle arrow for a file entity without children', () => {
        const { container } = render(TreeNode, nodeProps(2));

        // There should be a toggle-spacer instead of a toggle arrow
        const toggle = container.querySelector('.toggle');
        expect(toggle).toBeInTheDocument();
        // The toggle should contain the spacer, not ▸ or ▾
        expect(toggle?.querySelector('.toggle-spacer')).toBeInTheDocument();
        expect(toggle?.textContent?.trim()).toBe('');
    });

    it('should show correct display name from renderFile path', () => {
        render(TreeNode, nodeProps(2));

        expect(screen.getByText('report.txt')).toBeInTheDocument();
    });

    it('should show a filename for a legacy path with a trailing separator', () => {
        loadFixture({
            entities: [{
                id: 4,
                components: [{
                    componentType: 'renderFile', settings: {
                        targetPath: 'C:\\Users\\Noé\\document.pdf\\', scale: 1, position: { x: 0, y: 0 }
                    }
                }],
            }],
        });

        render(TreeNode, nodeProps(4));

        expect(screen.getByText('document.pdf')).toBeInTheDocument();
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

        render(TreeNode, nodeProps(99));

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

    it('should render children of folders initially (expanded by default)', () => {
        render(TreeView);

        // Children of FolderA (a.txt, b.txt) and FolderB (c.txt) should be visible initially
        expect(screen.getByText('a.txt')).toBeInTheDocument();
        expect(screen.getByText('b.txt')).toBeInTheDocument();
        expect(screen.getByText('c.txt')).toBeInTheDocument();
    });

    it('should collapse a root folder when its toggle is clicked', async () => {
        const { container } = render(TreeView);

        // Find all toggle elements - first one should be FolderA
        const toggles = container.querySelectorAll('.toggle');
        const folderAToggle = toggles[0];

        // Click to collapse
        await fireEvent.click(folderAToggle);

        // Children should no longer be visible
        expect(screen.queryByText('a.txt')).not.toBeInTheDocument();
        expect(screen.queryByText('b.txt')).not.toBeInTheDocument();
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


/**
 * Helper to create a minimal DataTransfer mock for jsdom.
 * jsdom doesn't implement DataTransfer, so we build one.
 *
 * Only the members the drag handlers actually touch are real; `files` and
 * `items` are empty stand-ins for types jsdom has no constructor for, so the
 * whole thing is asserted into `DataTransfer` once, here, rather than being
 * cast at every call site.
 */
function createMockDataTransfer(): DataTransfer {
    const data: Record<string, string> = {};
    return {
        dropEffect: 'none',
        effectAllowed: 'none',
        files: [] as unknown as FileList,
        items: [] as unknown as DataTransferItemList,
        types: [],
        getData(format: string) { return data[format] || ''; },
        setData(format: string, value: string) { data[format] = value; },
        clearData(format?: string) { if (format) delete data[format]; else Object.keys(data).forEach(k => delete data[k]); },
        setDragImage() { },
    } as DataTransfer;
}

describe('TreeView - Drag and Drop Integration', () => {
    let getBoundingClientRectSpy: any;

    function fireDragOver(element: Element, clientY: number, dataTransfer: DataTransfer) {
        const event = new Event('dragover', {
            bubbles: true,
            cancelable: true,
        });
        Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
        Object.defineProperty(event, 'clientY', { value: clientY });
        element.dispatchEvent(event);
    }

    function fireDrop(element: Element, clientY: number, dataTransfer: DataTransfer) {
        const event = new Event('drop', {
            bubbles: true,
            cancelable: true,
        });
        Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
        Object.defineProperty(event, 'clientY', { value: clientY });
        element.dispatchEvent(event);
    }

    beforeEach(() => {
        vi.clearAllMocks();
        getBoundingClientRectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
            top: 100,
            left: 0,
            bottom: 120,
            right: 200,
            width: 200,
            height: 20,
        } as DOMRect);
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

    afterEach(() => {
        getBoundingClientRectSpy.mockRestore();
    });

    it('should set dataTransfer on dragstart and clear on dragend', async () => {
        const { container } = render(TreeView);

        const standaloneNode = screen.getByText('standalone.md').closest('.tree-node');
        expect(standaloneNode).toBeInTheDocument();
        if (!standaloneNode) throw new Error('standalone.md has no .tree-node ancestor');

        const dt = createMockDataTransfer();

        await fireEvent.dragStart(standaloneNode, { dataTransfer: dt });
        expect(dt.getData('text/plain')).toBe('30');

        await fireEvent.dragEnd(standaloneNode, { dataTransfer: dt });
    });

    it('should open the top level only, and open deeper levels on request', async () => {
        loadFixture({
            entities: [
                { id: 1, components: [{ componentType: 'grid', settings: { columns: 2, gap: 4 } }, { componentType: 'renderFile', settings: { targetPath: '/RootFolder' } }] },
                { id: 2, parentId: 1, components: [{ componentType: 'grid', settings: { columns: 2, gap: 4 } }, { componentType: 'renderFile', settings: { targetPath: '/RootFolder/SubFolder' } }] },
                { id: 3, parentId: 2, components: [{ componentType: 'renderFile', settings: { targetPath: '/RootFolder/SubFolder/deep.txt' } }] },
            ],
        });

        render(TreeView);

        // A root and its children: enough to see what the trove holds without
        // mounting a node for every file in it.
        expect(screen.getByText('RootFolder')).toBeInTheDocument();
        expect(screen.getByText('SubFolder')).toBeInTheDocument();
        expect(screen.queryByText('deep.txt')).toBeNull();

        await expandNode('SubFolder');

        expect(screen.getByText('deep.txt')).toBeInTheDocument();
    });

    it('should show drop-into indicator when dragging over middle of a folder', async () => {
        const { container } = render(TreeView);

        const aNode = screen.getByText('a.txt').closest('.tree-node')!;
        const folderANode = screen.getByText('FolderA').closest('.tree-node')!;

        const dt = createMockDataTransfer();
        await fireEvent.dragStart(aNode, { dataTransfer: dt });

        const rect = folderANode.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        fireDragOver(folderANode, midY, dt);
        await tick();

        expect(folderANode.classList.contains('drop-into')).toBe(true);

        await fireEvent.dragEnd(aNode, { dataTransfer: dt });
    });

    it('should show drop-before indicator when dragging over top of a node', async () => {
        const { container } = render(TreeView);

        const standaloneNode = screen.getByText('standalone.md').closest('.tree-node')!;
        const folderANode = screen.getByText('FolderA').closest('.tree-node')!;

        const dt = createMockDataTransfer();
        await fireEvent.dragStart(standaloneNode, { dataTransfer: dt });

        const rect = folderANode.getBoundingClientRect();
        const topY = rect.top + 2;
        fireDragOver(folderANode, topY, dt);
        await tick();

        const wrapper = folderANode.closest('.tree-node-wrapper')!;
        expect(wrapper.classList.contains('drop-before')).toBe(true);

        await fireEvent.dragEnd(standaloneNode, { dataTransfer: dt });
    });

    it('should invoke move_entity when dropping into a folder', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        const { container } = render(TreeView);

        const aNode = screen.getByText('a.txt').closest('.tree-node')!;
        const folderBNode = screen.getByText('FolderB').closest('.tree-node')!;

        const dt = createMockDataTransfer();
        await fireEvent.dragStart(aNode, { dataTransfer: dt });

        const rect = folderBNode.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        fireDragOver(folderBNode, midY, dt);
        fireDrop(folderBNode, midY, dt);

        expect(invoke).toHaveBeenCalledWith('move_entity', {
            entityId: 11,
            newParentId: 20,
        });

        await fireEvent.dragEnd(aNode, { dataTransfer: dt });
    });

    it('should invoke reorder_children when dropping between siblings', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        const { container } = render(TreeView);

        const aNode = screen.getByText('a.txt').closest('.tree-node')!;
        const bNode = screen.getByText('b.txt').closest('.tree-node')!;

        const dt = createMockDataTransfer();
        await fireEvent.dragStart(aNode, { dataTransfer: dt });

        const rect = bNode.getBoundingClientRect();
        const bottomY = rect.bottom - 2;
        fireDragOver(bNode, bottomY, dt);
        fireDrop(bNode, bottomY, dt);

        expect(invoke).toHaveBeenCalledWith('reorder_children', {
            parentEntityId: 10,
            orderedIds: [12, 11],
        });

        await fireEvent.dragEnd(aNode, { dataTransfer: dt });
    });

    it('should not invoke anything when dropping on self', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        const { container } = render(TreeView);

        const standaloneNode = screen.getByText('standalone.md').closest('.tree-node')!;

        const dt = createMockDataTransfer();
        await fireEvent.dragStart(standaloneNode, { dataTransfer: dt });

        const rect = standaloneNode.getBoundingClientRect();
        fireDragOver(standaloneNode, rect.top + 10, dt);
        fireDrop(standaloneNode, rect.top + 10, dt);

        const moveCalls = (invoke as any).mock.calls.filter(
            (c: any) => c[0] === 'move_entity' || c[0] === 'reorder_children'
        );
        expect(moveCalls.length).toBe(0);

        await fireEvent.dragEnd(standaloneNode, { dataTransfer: dt });
    });

    it('should clear dropTarget indicators on dragend', async () => {
        const { container } = render(TreeView);

        const standaloneNode = screen.getByText('standalone.md').closest('.tree-node')!;
        const folderANode = screen.getByText('FolderA').closest('.tree-node')!;

        const dt = createMockDataTransfer();
        await fireEvent.dragStart(standaloneNode, { dataTransfer: dt });

        const rect = folderANode.getBoundingClientRect();
        fireDragOver(folderANode, rect.top + 2, dt);
        await tick();

        const wrapper = folderANode.closest('.tree-node-wrapper')!;
        expect(wrapper.classList.contains('drop-before')).toBe(true);

        await fireEvent.dragEnd(standaloneNode, { dataTransfer: dt });
        await tick();

        expect(wrapper.classList.contains('drop-before')).toBe(false);
    });

    it('should invoke move_entity with newParentId: null when dropping a nested file onto the root container', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        const { container } = render(TreeView);

        const aNode = screen.getByText('a.txt').closest('.tree-node')!;
        const rootContainer = container.querySelector('.tree-root')!;

        const dt = createMockDataTransfer();
        await fireEvent.dragStart(aNode, { dataTransfer: dt });
        await fireEvent.drop(rootContainer, { dataTransfer: dt });

        expect(invoke).toHaveBeenCalledWith('move_entity', {
            entityId: 11,
            newParentId: null,
        });
    });

    it('should invoke move_entity with newParentId: null when dropping a nested file between root-level siblings', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        const { container } = render(TreeView);

        const aNode = screen.getByText('a.txt').closest('.tree-node')!;
        const folderBNode = screen.getByText('FolderB').closest('.tree-node')!;

        const dt = createMockDataTransfer();
        await fireEvent.dragStart(aNode, { dataTransfer: dt });

        const rect = folderBNode.getBoundingClientRect();
        const topY = rect.top + 2;
        fireDragOver(folderBNode, topY, dt);
        fireDrop(folderBNode, topY, dt);

        expect(invoke).toHaveBeenCalledWith('move_entity', {
            entityId: 11,
            newParentId: null,
        });
    });
});

describe('TreeNode - Deep Nesting Collapse', () => {
    beforeEach(() => {
        // Chain of nested folders: 1 > 2 > 3 > 4 > 5 > file
        loadFixture({
            entities: [
                { id: 1, components: [{ componentType: 'grid', settings: { columns: 2, gap: 4 } }, { componentType: 'renderFile', settings: { targetPath: '/L1' } }] },
                { id: 2, parentId: 1, components: [{ componentType: 'grid', settings: { columns: 2, gap: 4 } }, { componentType: 'renderFile', settings: { targetPath: '/L1/L2' } }] },
                { id: 3, parentId: 2, components: [{ componentType: 'grid', settings: { columns: 2, gap: 4 } }, { componentType: 'renderFile', settings: { targetPath: '/L1/L2/L3' } }] },
                { id: 4, parentId: 3, components: [{ componentType: 'grid', settings: { columns: 2, gap: 4 } }, { componentType: 'renderFile', settings: { targetPath: '/L1/L2/L3/L4' } }] },
                { id: 5, parentId: 4, components: [{ componentType: 'grid', settings: { columns: 2, gap: 4 } }, { componentType: 'renderFile', settings: { targetPath: '/L1/L2/L3/L4/L5' } }] },
                { id: 6, parentId: 5, components: [{ componentType: 'renderFile', settings: { targetPath: '/L1/L2/L3/L4/L5/deep.txt' } }] },
            ],
        });
    });

    it('should still render children inline at any depth (no collapse in tree view)', async () => {
        const { container } = render(TreeNode, nodeProps(5, { depth: 4 }));

        // No collapsed badge
        expect(container.querySelector('[data-testid=deep-badge]')).toBeNull();

        // Depth is not a limit, only a default: the toggle is offered, and
        // taking it renders the children inline like anywhere else.
        await expandNode('L5');

        expect(container.querySelector('.children')).not.toBeNull();
        expect(screen.getByText('deep.txt')).toBeInTheDocument();
    });

    it('should recurse normally below MAX_DEPTH', async () => {
        const { container } = render(TreeNode, nodeProps(4, { depth: 3 }));

        const rootNode = container.querySelector('.tree-node');
        expect(rootNode).toBeInTheDocument();
        expect(rootNode?.querySelector('[data-testid=deep-badge]')).toBeNull();

        await expandNode('L4');
        expect(container.querySelector('.children')).toBeInTheDocument();
    });

    it('should render deeply nested nodes inline within a full tree (no collapse)', async () => {
        render(TreeView);

        // Only the root opens itself. Every level below it opens on request and
        // none of them is ever replaced by a summary — the tree is finite, so
        // the desktop's MAX_DEPTH does not apply here.
        expect(screen.getByText('L1')).toBeInTheDocument();
        expect(screen.getByText('L2')).toBeInTheDocument();
        expect(screen.queryByText('L3')).toBeNull();

        await expandNode('L2');
        await expandNode('L3');
        await expandNode('L4');
        await expandNode('L5');

        expect(screen.getByText('L5')).toBeInTheDocument();
        expect(screen.getByText('deep.txt')).toBeInTheDocument();
        expect(screen.queryByTestId('deep-badge')).toBeNull();
    });

    it('should not mount a node for a collapsed subtree', () => {
        const { container } = render(TreeView);

        // Five levels exist in the fixture; two are on screen. The rest are not
        // hidden nodes, they are nodes that were never created.
        expect(container.querySelectorAll('.tree-node')).toHaveLength(2);
    });
});
