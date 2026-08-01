import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import RenderEntity from '../lib/components/RenderEntity.svelte';
import { worldStore } from '../lib/stores/world';
import { MAX_DEPTH } from '../lib/constants';

// Mock Tauri apps API so we don't try to call native code during unit tests
vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: (src: string) => src,
}));

describe('RenderEntity Component', () => {
    it('should render a RenderFile component for file entities', () => {
        // 1. Populate the store with a single file entity (image to avoid fetch side-effects)
        worldStore.loadFromData({
            entities: [
                {
                    id: 1,
                    components: [
                        {
                            componentType: 'renderFile',
                            settings: { targetPath: 'my_awesome_file.png', scale: 1, position: { x: 0, y: 0 } }
                        }
                    ]
                }
            ]
        });

        // 2. Render the component
        render(RenderEntity, { entityId: 1 });

        // 3. Assert that the image alt text (the display name) is rendered
        expect(screen.getByAltText('my_awesome_file.png')).toBeInTheDocument();
    });

    it('should recursively render grid and its children', () => {
        // 1. Populate the store with a parent grid containing a child file
        worldStore.loadFromData({
            entities: [
                {
                    id: 1,
                    components: [
                        {
                            componentType: 'grid',
                            settings: { columns: 3, gap: 10, draggable: false }
                        }
                    ]
                },
                {
                    id: 2,
                    parentId: 1,
                    components: [
                        {
                            componentType: 'renderFile',
                            settings: { targetPath: 'child_file.png', scale: 1, position: { x: 0, y: 0 } }
                        }
                    ]
                }
            ]
        });

        // 2. Render the parent entity (Grid)
        const { container } = render(RenderEntity, { entityId: 1 });

        // 3. Assert the grid container exists and is rendering the child recursively
        const gridElement = container.querySelector('.grid-container');
        expect(gridElement).toBeInTheDocument();
        expect(screen.getByAltText('child_file.png')).toBeInTheDocument();
        expect(gridElement).toContainElement(screen.getByAltText('child_file.png').closest('.render-file'));
    });

    it('should dynamically scale columns based on number of children', () => {
        // 1. Single child: should override columns setting (e.g. 4) and use 1 column
        worldStore.loadFromData({
            entities: [
                {
                    id: 1,
                    components: [
                        {
                            componentType: 'grid',
                            settings: { columns: 4, gap: 10, draggable: false }
                        }
                    ]
                },
                {
                    id: 2,
                    parentId: 1,
                    components: [
                        {
                            componentType: 'renderFile',
                            settings: { targetPath: 'child_1.png', scale: 1, position: { x: 0, y: 0 } }
                        }
                    ]
                }
            ]
        });

        const { container: container1, unmount: unmount1 } = render(RenderEntity, { entityId: 1 });
        const grid1 = container1.querySelector('.grid-container') as HTMLElement;
        expect(grid1).toHaveStyle('--grid-columns: 1');
        unmount1();

        // 2. Multiple children (less than configured columns): should scale to number of children
        worldStore.loadFromData({
            entities: [
                {
                    id: 1,
                    components: [
                        {
                            componentType: 'grid',
                            settings: { columns: 4, gap: 10, draggable: false }
                        }
                    ]
                },
                {
                    id: 2,
                    parentId: 1,
                    components: [
                        {
                            componentType: 'renderFile',
                            settings: { targetPath: 'child_1.png', scale: 1, position: { x: 0, y: 0 } }
                        }
                    ]
                },
                {
                    id: 3,
                    parentId: 1,
                    components: [
                        {
                            componentType: 'renderFile',
                            settings: { targetPath: 'child_2.png', scale: 1, position: { x: 0, y: 0 } }
                        }
                    ]
                }
            ]
        });

        const { container: container2, unmount: unmount2 } = render(RenderEntity, { entityId: 1 });
        const grid2 = container2.querySelector('.grid-container') as HTMLElement;
        expect(grid2).toHaveStyle('--grid-columns: 2');
        unmount2();

        // 3. Children count greater than or equal to columns: should stay at configured columns
        worldStore.loadFromData({
            entities: [
                {
                    id: 1,
                    components: [
                        {
                            componentType: 'grid',
                            settings: { columns: 2, gap: 10, draggable: false }
                        }
                    ]
                },
                {
                    id: 2,
                    parentId: 1,
                    components: [
                        {
                            componentType: 'renderFile',
                            settings: { targetPath: 'child_1.png', scale: 1, position: { x: 0, y: 0 } }
                        }
                    ]
                },
                {
                    id: 3,
                    parentId: 1,
                    components: [
                        {
                            componentType: 'renderFile',
                            settings: { targetPath: 'child_2.png', scale: 1, position: { x: 0, y: 0 } }
                        }
                    ]
                },
                {
                    id: 4,
                    parentId: 1,
                    components: [
                        {
                            componentType: 'renderFile',
                            settings: { targetPath: 'child_3.png', scale: 1, position: { x: 0, y: 0 } }
                        }
                    ]
                }
            ]
        });

        const { container: container3, unmount: unmount3 } = render(RenderEntity, { entityId: 1 });
        const grid3 = container3.querySelector('.grid-container') as HTMLElement;
        expect(grid3).toHaveStyle('--grid-columns: 2');
        unmount3();
    });

    it('stops expanding a container past MAX_DEPTH and draws its own renderFile card instead', () => {
        worldStore.loadFromData({
            entities: [
                {
                    id: 50,
                    components: [
                        { componentType: 'grid', settings: { columns: 2, gap: 8, draggable: false } },
                        { componentType: 'renderFile', settings: { targetPath: '/trove/deep_folder', scale: 1, position: { x: 0, y: 0 } } },
                    ],
                },
                {
                    id: 51,
                    parentId: 50,
                    components: [
                        { componentType: 'renderFile', settings: { targetPath: '/trove/deep_folder/inner.png', scale: 1, position: { x: 0, y: 0 } } },
                    ],
                },
            ],
        });

        const { container } = render(RenderEntity, { entityId: 50, depth: MAX_DEPTH });

        // It is an ordinary card, not a bespoke summary widget, and it does not
        // recurse into a grid.
        const card = container.querySelector('.render-file');
        expect(card).toBeInTheDocument();
        expect(card).toHaveClass('collapsed');
        expect(container.querySelector('.grid-container')).not.toBeInTheDocument();

        // Its name is on it, and it says how much it is holding back.
        expect(screen.getByText('deep_folder')).toBeInTheDocument();
        expect(screen.getByTitle('1 inside')).toBeInTheDocument();
    });

    it('still expands the same container one level above MAX_DEPTH', () => {
        worldStore.loadFromData({
            entities: [
                {
                    id: 70,
                    components: [
                        { componentType: 'grid', settings: { columns: 2, gap: 8, draggable: false } },
                        { componentType: 'renderFile', settings: { targetPath: '/trove/deep_folder', scale: 1, position: { x: 0, y: 0 } } },
                    ],
                },
            ],
        });

        const { container } = render(RenderEntity, { entityId: 70, depth: MAX_DEPTH - 1 });

        expect(container.querySelector('.grid-container')).toBeInTheDocument();
        expect(container.querySelector('.render-file')).not.toBeInTheDocument();
    });

    it('focuses a collapsed entity when its card is clicked', async () => {
        const { focusedEntityStore, focusEntity } = await import('../lib/stores/world');
        focusEntity(null);

        worldStore.loadFromData({
            entities: [
                {
                    id: 60,
                    components: [
                        { componentType: 'grid', settings: { columns: 2, gap: 8, draggable: false } },
                        { componentType: 'renderFile', settings: { targetPath: 'target_folder', scale: 1, position: { x: 0, y: 0 } } },
                    ],
                },
            ],
        });

        const { container } = render(RenderEntity, { entityId: 60, depth: MAX_DEPTH });

        const card = container.querySelector('.render-file') as HTMLElement;
        const { fireEvent } = await import('@testing-library/svelte');
        await fireEvent.click(card);

        let focusedId: number | null = null;
        focusedEntityStore.subscribe((val) => {
            focusedId = val;
        })();

        expect(focusedId).toBe(60);
    });

    it('names a container after itself, never after one of its children', () => {
        worldStore.loadFromData({
            entities: [
                {
                    id: 80,
                    components: [
                        { componentType: 'grid', settings: { columns: 2, gap: 8, draggable: false } },
                    ],
                },
                {
                    id: 81,
                    parentId: 80,
                    components: [
                        { componentType: 'renderFile', settings: { targetPath: '/trove/holiday.png', scale: 1, position: { x: 0, y: 0 } } },
                    ],
                },
            ],
        });

        const { container } = render(RenderEntity, { entityId: 80 });

        const name = container.querySelector('.entity-name');
        expect(name).toHaveTextContent('Entity #80');
        expect(name).not.toHaveTextContent('holiday.png');
    });
});

