import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import { tick } from 'svelte';
import Desktop from '../lib/components/Desktop.svelte';
import Grid from '../lib/components/Grid.svelte';
import RenderEntity from '../lib/components/RenderEntity.svelte';
import { editMode, worldStore, focusEntity } from '../lib/stores/world';
import { __resetVisibility } from '../lib/visibility';
import { DENSE_WIDTH, MAX_INLINE_CHILDREN, MIN_CARD_WIDTH } from '../lib/constants';
import { deferVisibility, resizeElement, revealElement } from './setup';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
    convertFileSrc: (src: string) => src,
}));

/// A container holding `count` images, plus the container itself.
function folderOf(count: number) {
    const entities: import('../lib/types').WorldData['entities'] = [
        {
            id: 1,
            components: [
                { componentType: 'grid', settings: { columns: 3, gap: 8, draggable: false } },
                { componentType: 'renderFile', settings: { targetPath: '/Folder' } },
            ],
        },
    ];
    for (let i = 0; i < count; i++) {
        entities.push({
            id: 100 + i,
            parentId: 1,
            components: [
                {
                    componentType: 'renderFile',
                    settings: { targetPath: `/Folder/image-${i}.png`, scale: 1, position: { x: 0, y: 0 } },
                },
            ],
        });
    }
    return { entities };
}

const gridProps = { entityId: 1, columns: 3, gap: 8, draggable: false, depth: 0 };

beforeEach(() => {
    editMode.set(false);
    focusEntity(null);
    __resetVisibility();
});

afterEach(() => {
    deferVisibility(false);
});

describe('Grid density', () => {
    it('offers the configured column count as a ceiling and a card width as a floor', () => {
        worldStore.loadFromData(folderOf(6));

        const { container } = render(Grid, gridProps);
        const grid = container.querySelector('.grid-container') as HTMLElement;

        // The column count is published as a variable the CSS treats as an
        // ideal, alongside the width below which a card stops being worth
        // drawing. Together they are what stop nesting from producing slivers.
        expect(grid.style.getPropertyValue('--grid-columns')).toBe('3');
        expect(grid.style.getPropertyValue('--card-min')).toBe(`${MIN_CARD_WIDTH}px`);
    });

    it('narrows the ideal to the child count so a lone entity is not a sliver', () => {
        worldStore.loadFromData(folderOf(2));

        const { container } = render(Grid, gridProps);
        const grid = container.querySelector('.grid-container') as HTMLElement;

        expect(grid.style.getPropertyValue('--grid-columns')).toBe('2');
    });

    it('keeps drawing cards while there is room for one', async () => {
        worldStore.loadFromData(folderOf(4));

        const { container } = render(Grid, gridProps);
        const grid = container.querySelector('.grid-container') as HTMLElement;

        resizeElement(grid, DENSE_WIDTH + 40, 400);
        await tick();

        expect(grid).not.toHaveClass('dense');
        expect(container.querySelector('.render-file.dense')).toBeNull();
    });

    it('collapses to rows once there is not room for one legible card', async () => {
        worldStore.loadFromData(folderOf(4));

        const { container } = render(Grid, gridProps);
        const grid = container.querySelector('.grid-container') as HTMLElement;

        resizeElement(grid, DENSE_WIDTH - 20, 400);
        await tick();

        expect(grid).toHaveClass('dense');
        // The cards are the same cards; they have dropped their bodies, which
        // is where every expensive thing a card does lives.
        const cards = container.querySelectorAll('.render-file');
        expect(cards.length).toBe(4);
        for (const card of cards) {
            expect(card).toHaveClass('dense');
            expect(card.querySelector('.file-body')).toBeNull();
            expect(card.querySelector('.file-caption')).not.toBeNull();
        }
    });

    it('treats a zero measurement as "not laid out yet", not as "no room"', async () => {
        worldStore.loadFromData(folderOf(4));

        const { container } = render(Grid, gridProps);
        const grid = container.querySelector('.grid-container') as HTMLElement;

        resizeElement(grid, 0, 0);
        await tick();

        expect(grid).not.toHaveClass('dense');
    });
});

describe('Grid child overflow', () => {
    it('renders every child of a container the user is looking at', () => {
        worldStore.loadFromData(folderOf(MAX_INLINE_CHILDREN + 5));

        // depth 0 with no parent: this is the root of the view.
        const { container } = render(Grid, gridProps);

        expect(container.querySelectorAll('.render-file')).toHaveLength(MAX_INLINE_CHILDREN + 5);
        expect(container.querySelector('.overflow-more')).toBeNull();
    });

    it('caps a nested container and says how much it is holding back', async () => {
        const data = folderOf(MAX_INLINE_CHILDREN + 5);
        // Give the container a parent so it is context rather than the subject.
        data.entities.unshift({ id: 0, components: [{ componentType: 'grid', settings: { columns: 1, gap: 8 } }] });
        data.entities[1].parentId = 0;
        worldStore.loadFromData(data);

        const { container } = render(Grid, { ...gridProps, depth: 1 });

        expect(container.querySelectorAll('.render-file')).toHaveLength(MAX_INLINE_CHILDREN);
        const more = container.querySelector('.overflow-more')!;
        expect(more).toBeInTheDocument();
        expect(more.textContent).toContain('5 more inside');
    });

    it('lifts the cap once the capped container is the focused one', async () => {
        const data = folderOf(MAX_INLINE_CHILDREN + 5);
        data.entities.unshift({ id: 0, components: [{ componentType: 'grid', settings: { columns: 1, gap: 8 } }] });
        data.entities[1].parentId = 0;
        worldStore.loadFromData(data);

        const { container } = render(Grid, { ...gridProps, depth: 1 });
        expect(container.querySelector('.overflow-more')).toBeInTheDocument();

        focusEntity(1);
        await tick();

        expect(container.querySelector('.overflow-more')).toBeNull();
        expect(container.querySelectorAll('.render-file')).toHaveLength(MAX_INLINE_CHILDREN + 5);
    });
});

describe('Deferred content', () => {
    it('renders nothing heavier than a placeholder before a card is on screen', async () => {
        deferVisibility(true);
        worldStore.loadFromData({
            entities: [
                {
                    id: 1,
                    components: [
                        { componentType: 'renderFile', settings: { targetPath: '/photo.png', scale: 1, position: { x: 0, y: 0 } } },
                    ],
                },
            ],
        });

        const { container } = render(RenderEntity, { entityId: 1 });

        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByTestId('pending-content')).toBeInTheDocument();

        revealElement(container.querySelector('.render-file')!);
        await tick();

        expect(container.querySelector('img')).toBeInTheDocument();
        expect(screen.queryByTestId('pending-content')).toBeNull();
    });

    it('keeps content once loaded, so scrolling away does not throw the work away', async () => {
        deferVisibility(true);
        worldStore.loadFromData({
            entities: [
                {
                    id: 1,
                    components: [
                        { componentType: 'renderFile', settings: { targetPath: '/photo.png', scale: 1, position: { x: 0, y: 0 } } },
                    ],
                },
            ],
        });

        const { container } = render(RenderEntity, { entityId: 1 });
        const card = container.querySelector('.render-file')!;

        revealElement(card);
        await tick();
        expect(container.querySelector('img')).toBeInTheDocument();

        // The observer stops watching after the first hit; nothing can put the
        // card back into its unloaded state.
        revealElement(card);
        await tick();
        expect(container.querySelector('img')).toBeInTheDocument();
    });
});

describe('Desktop navigation', () => {
    beforeEach(() => {
        worldStore.loadFromData({
            entities: [
                {
                    id: 1,
                    components: [
                        { componentType: 'grid', settings: { columns: 2, gap: 4, draggable: false } },
                        { componentType: 'renderFile', settings: { targetPath: '/Parent' } },
                    ],
                },
                {
                    id: 2,
                    parentId: 1,
                    components: [
                        { componentType: 'grid', settings: { columns: 2, gap: 4, draggable: false } },
                        { componentType: 'renderFile', settings: { targetPath: '/Parent/Child' } },
                    ],
                },
                {
                    id: 3,
                    parentId: 2,
                    components: [
                        { componentType: 'renderFile', settings: { targetPath: '/Parent/Child/photo.png', scale: 1, position: { x: 0, y: 0 } } },
                    ],
                },
            ],
        });
        focusEntity(null);
    });

    it('keeps the previous view mounted when entering an entity', async () => {
        const { getAllByTestId } = render(Desktop);

        expect(getAllByTestId('desktop-view')).toHaveLength(1);

        focusEntity(2);
        await tick();

        const views = getAllByTestId('desktop-view');
        expect(views).toHaveLength(2);
        // Exactly one is on screen; the other is kept, not destroyed.
        expect(views.filter((view) => !view.classList.contains('hidden'))).toHaveLength(1);
    });

    it('reuses the view it already built when navigating back', async () => {
        const { getAllByTestId } = render(Desktop);

        focusEntity(2);
        await tick();
        const afterEntering = getAllByTestId('desktop-view');

        focusEntity(null);
        await tick();
        const afterLeaving = getAllByTestId('desktop-view');

        expect(afterLeaving).toHaveLength(2);
        // Same DOM nodes: nothing was torn down and rebuilt, so nothing inside
        // them had to be fetched or decoded again.
        expect(afterLeaving[0]).toBe(afterEntering[0]);
        expect(afterLeaving[1]).toBe(afterEntering[1]);
    });

    it('drops views whose entity no longer exists', async () => {
        const { getAllByTestId } = render(Desktop);

        focusEntity(2);
        await tick();
        expect(getAllByTestId('desktop-view')).toHaveLength(2);

        // A new trove: the previous ids mean nothing in it.
        worldStore.loadFromData({
            entities: [
                { id: 9, components: [{ componentType: 'renderFile', settings: { targetPath: '/Other/other.png' } }] },
            ],
        });
        focusEntity(null);
        await tick();

        expect(getAllByTestId('desktop-view')).toHaveLength(1);
    });
});
