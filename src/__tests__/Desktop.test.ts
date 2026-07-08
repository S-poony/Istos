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
});
