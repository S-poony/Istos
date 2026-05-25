import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import RenderEntity from '../lib/components/RenderEntity.svelte';
import { worldStore } from '../lib/stores/world';

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
});
