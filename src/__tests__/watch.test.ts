import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { applyTroveChange } from '../lib/watch';
import { worldStore, focusedEntityStore, focusEntity } from '../lib/stores/world';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (src: string) => src,
}));

const mockInvoke = vi.mocked(invoke);

/// A trove root holding one folder, which holds one folder, which holds a file.
function nestedTrove() {
  return {
    entities: [
      {
        id: 1,
        components: [
          { componentType: 'grid', settings: { columns: 3, gap: 8 } },
          { componentType: 'renderFile', settings: { targetPath: '/Trove/Parent' } },
        ],
      },
      {
        id: 2,
        parentId: 1,
        components: [
          { componentType: 'grid', settings: { columns: 3, gap: 8 } },
          { componentType: 'renderFile', settings: { targetPath: '/Trove/Parent/Child' } },
        ],
      },
      {
        id: 3,
        parentId: 2,
        components: [
          { componentType: 'renderFile', settings: { targetPath: '/Trove/Parent/Child/note.txt' } },
        ],
      },
    ],
  };
}

/// The same trove after `Child` was deleted outside the app.
function withoutChild() {
  const data = nestedTrove();
  data.entities = data.entities.filter((entity) => entity.id === 1);
  return data;
}

beforeEach(() => {
  mockInvoke.mockReset();
  worldStore.loadFromData(nestedTrove());
  focusEntity(null);
});

describe('applyTroveChange', () => {
  it('reloads the mirror from the backend', async () => {
    const next = withoutChild();
    mockInvoke.mockResolvedValue(next);

    await applyTroveChange();

    expect(mockInvoke).toHaveBeenCalledWith('get_world_state');
    expect(get(worldStore).entities.size).toBe(1);
  });

  it('leaves a focus that survived the change alone', async () => {
    focusEntity(2);
    mockInvoke.mockResolvedValue(nestedTrove());

    await applyTroveChange();

    expect(get(focusedEntityStore)).toBe(2);
  });

  /// Standing inside a folder that has just been deleted from under you should
  /// leave you in the closest folder that still exists — not staring at an
  /// empty desktop with a breadcrumb trail to nowhere.
  it('falls back to the nearest surviving ancestor when the focused entity is gone', async () => {
    focusEntity(2);
    mockInvoke.mockResolvedValue(withoutChild());

    await applyTroveChange();

    expect(get(focusedEntityStore)).toBe(1);
  });

  it('falls back to the trove root when no ancestor survived', async () => {
    focusEntity(3);
    mockInvoke.mockResolvedValue({ entities: [] });

    await applyTroveChange();

    expect(get(focusedEntityStore)).toBeNull();
  });
});
