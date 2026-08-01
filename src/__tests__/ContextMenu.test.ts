import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import { tick } from 'svelte';
import ContextMenu from '../lib/components/ContextMenu.svelte';
import RenderEntity from '../lib/components/RenderEntity.svelte';
import { contextMenu, closeContextMenu } from '../lib/stores/contextMenu';
import { worldStore } from '../lib/stores/world';
import { toasts, clearToasts } from '../lib/stores/toasts';

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => invoke(...args),
    convertFileSrc: (src: string) => src,
}));

function loadFile() {
    worldStore.loadFromData({
        entities: [
            {
                id: 1,
                components: [
                    {
                        componentType: 'renderFile',
                        settings: { targetPath: '/trove/photo.png', scale: 1, position: { x: 0, y: 0 } },
                    },
                ],
            },
        ],
    });
}

beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    closeContextMenu();
    clearToasts();
});

describe('Context menu', () => {
    it('opens on a right-click and names the entity it belongs to', async () => {
        loadFile();
        const { container } = render(RenderEntity, { entityId: 1 });
        render(ContextMenu);

        await fireEvent.contextMenu(container.querySelector('.render-file')!);
        await tick();

        const menu = screen.getByTestId('context-menu');
        expect(menu).toBeInTheDocument();
        expect(menu.getAttribute('aria-label')).toContain('photo.png');
        expect(screen.getByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Open with…' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Reveal in Explorer' })).toBeInTheDocument();
    });

    it('belongs to the innermost entity under the cursor', async () => {
        worldStore.loadFromData({
            entities: [
                {
                    id: 1,
                    components: [
                        { componentType: 'grid', settings: { columns: 2, gap: 4, draggable: false } },
                        { componentType: 'renderFile', settings: { targetPath: '/Folder' } },
                    ],
                },
                {
                    id: 2,
                    parentId: 1,
                    components: [
                        { componentType: 'renderFile', settings: { targetPath: '/Folder/photo.png', scale: 1, position: { x: 0, y: 0 } } },
                    ],
                },
            ],
        });

        const { container } = render(RenderEntity, { entityId: 1 });
        render(ContextMenu);

        await fireEvent.contextMenu(container.querySelector('.render-file')!);
        await tick();

        // Not the container that the card sits inside.
        expect(screen.getByTestId('context-menu').getAttribute('aria-label')).toContain('photo.png');
    });

    it('runs the command for the item that was chosen', async () => {
        loadFile();
        const { container } = render(RenderEntity, { entityId: 1 });
        render(ContextMenu);

        await fireEvent.contextMenu(container.querySelector('.render-file')!);
        await tick();
        await fireEvent.click(screen.getByRole('menuitem', { name: 'Reveal in Explorer' }));
        await tick();

        expect(invoke).toHaveBeenCalledWith('reveal_in_file_manager', { path: '/trove/photo.png' });
    });

    it('closes as soon as an item is chosen, before the command settles', async () => {
        loadFile();
        let release: () => void = () => {};
        invoke.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));

        const { container } = render(RenderEntity, { entityId: 1 });
        render(ContextMenu);

        await fireEvent.contextMenu(container.querySelector('.render-file')!);
        await tick();
        await fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
        await tick();

        expect(screen.queryByTestId('context-menu')).toBeNull();
        release();
    });

    it('announces a failure and stays quiet about a success', async () => {
        loadFile();
        invoke.mockRejectedValue(new Error('This entity is no longer on disk'));

        const { container } = render(RenderEntity, { entityId: 1 });
        render(ContextMenu);

        await fireEvent.contextMenu(container.querySelector('.render-file')!);
        await tick();
        await fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
        await tick();
        await tick();

        let current: import('../lib/stores/toasts').Toast[] = [];
        toasts.subscribe((value) => (current = value))();

        expect(current).toHaveLength(1);
        expect(current[0].kind).toBe('error');
        expect(current[0].detail).toContain('no longer on disk');
    });

    it('offers no system action for an entity with no file, and says why', async () => {
        worldStore.loadFromData({
            entities: [{ id: 1, components: [{ componentType: 'grid', settings: { columns: 2, gap: 4 } }] }],
        });

        const { container } = render(RenderEntity, { entityId: 1 });
        render(ContextMenu);

        await fireEvent.contextMenu(container.querySelector('.entity-wrapper')!);
        await tick();

        for (const label of ['Open', 'Open with…', 'Reveal in Explorer']) {
            expect(screen.getByRole('menuitem', { name: label })).toBeDisabled();
        }
        expect(screen.getByText('This entity has no file on disk.')).toBeInTheDocument();
    });

    it('closes on Escape and on a click elsewhere', async () => {
        loadFile();
        const { container } = render(RenderEntity, { entityId: 1 });
        render(ContextMenu);

        await fireEvent.contextMenu(container.querySelector('.render-file')!);
        await tick();
        await fireEvent.keyDown(screen.getByTestId('context-menu'), { key: 'Escape' });
        await tick();
        expect(screen.queryByTestId('context-menu')).toBeNull();

        await fireEvent.contextMenu(container.querySelector('.render-file')!);
        await tick();
        await fireEvent.pointerDown(screen.getByTestId('context-menu-backdrop'));
        await tick();
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    it('does not also navigate when a card is right-clicked', async () => {
        loadFile();
        const { focusedEntityStore, focusEntity } = await import('../lib/stores/world');
        focusEntity(null);

        const { container } = render(RenderEntity, { entityId: 1 });
        render(ContextMenu);

        await fireEvent.contextMenu(container.querySelector('.render-file')!);
        await tick();

        let focused: number | null = 0;
        focusedEntityStore.subscribe((value) => (focused = value))();
        expect(focused).toBeNull();
    });
});
