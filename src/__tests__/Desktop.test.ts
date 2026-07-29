import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import { tick } from 'svelte';
import Desktop from '../lib/components/Desktop.svelte';
import { editMode, worldStore } from '../lib/stores/world';

// Mock Tauri core
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (src: string) => src,
}));

describe('Desktop Component Mode Switching', () => {
  it('should toggle hidden class on containers based on editMode', async () => {
    // Populate store with mock data
    worldStore.loadFromData({
      entities: [
        {
          id: 1,
          components: [
            {
              componentType: 'renderFile',
              settings: { targetPath: 'test.png', scale: 1, position: { x: 0, y: 0 } }
            }
          ]
        }
      ]
    });

    // Start with editMode = false (Live Mode)
    editMode.set(false);

    const { container } = render(Desktop);

    const treeViewContainer = container.querySelector('.tree-view-container');
    const desktopContainer = container.querySelector('.desktop-container');

    expect(treeViewContainer).toBeInTheDocument();
    expect(desktopContainer).toBeInTheDocument();

    // In Live Mode (editMode = false):
    // treeViewContainer should have the 'hidden' class, desktopContainer should not
    expect(treeViewContainer).toHaveClass('hidden');
    expect(desktopContainer).not.toHaveClass('hidden');

    // Switch to Edit Mode (editMode = true)
    editMode.set(true);
    await tick();

    // In Edit Mode:
    // treeViewContainer should not have 'hidden', desktopContainer should have 'hidden'
    expect(treeViewContainer).not.toHaveClass('hidden');
    expect(desktopContainer).toHaveClass('hidden');
  });

  it('should render breadcrumb navigation when focused on a sub-entity and allow navigation back to trove root', async () => {
    const { focusedEntityStore, focusEntity } = await import('../lib/stores/world');
    worldStore.loadFromData({
      entities: [
        {
          id: 1,
          components: [
            { componentType: 'grid', settings: { columns: 2, gap: 4 } },
            { componentType: 'renderFile', settings: { targetPath: '/ParentFolder' } },
          ],
        },
        {
          id: 2,
          parentId: 1,
          components: [
            { componentType: 'grid', settings: { columns: 2, gap: 4 } },
            { componentType: 'renderFile', settings: { targetPath: '/ParentFolder/ChildFolder' } },
          ],
        },
      ],
    });

    editMode.set(false);
    focusEntity(2);

    const { container, getByTestId, getByText } = render(Desktop);

    const { within } = await import('@testing-library/svelte');
    const breadcrumb = getByTestId('breadcrumb-bar');
    expect(breadcrumb).toBeInTheDocument();
    expect(within(breadcrumb).getByText('Trove')).toBeInTheDocument();
    expect(within(breadcrumb).getByText('ParentFolder')).toBeInTheDocument();
    expect(within(breadcrumb).getByText('ChildFolder')).toBeInTheDocument();

    // Click Trove to return to root view
    const { fireEvent } = await import('@testing-library/svelte');
    await fireEvent.click(within(breadcrumb).getByText('Trove'));
    await tick();

    let currentFocused: number | null = 2;
    focusedEntityStore.subscribe((val) => {
      currentFocused = val;
    })();

    expect(currentFocused).toBeNull();
  });
});

