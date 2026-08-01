import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { openTroveFlow, troveOpening, troveNameFromPath, __resetTroveGuard } from '../lib/trove';
import { worldStore, focusedEntityStore, focusEntity } from '../lib/stores/world';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (src: string) => src,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

/// Minimal world snapshot with `count` root entities.
function worldWith(count: number) {
  return {
    entities: Array.from({ length: count }, (_, i) => ({
      id: i,
      components: [
        {
          componentType: 'renderFile',
          settings: { targetPath: `file${i}.txt`, scale: 1, position: { x: 0, y: 0 } },
        },
      ],
    })),
  };
}

describe('troveNameFromPath', () => {
  it('takes the last segment of a posix path', () => {
    expect(troveNameFromPath('/home/noe/troves/Photos')).toBe('Photos');
  });

  it('takes the last segment of a windows path', () => {
    expect(troveNameFromPath('C:\\Users\\Noe\\Photos')).toBe('Photos');
  });

  it('ignores a trailing separator', () => {
    expect(troveNameFromPath('/home/noe/Photos/')).toBe('Photos');
  });
});

describe('openTroveFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetTroveGuard();
    worldStore.loadFromData({ entities: [] });
    focusEntity(null);
  });

  afterEach(() => {
    __resetTroveGuard();
  });

  it('reports cancellation without touching the backend', async () => {
    (open as any).mockResolvedValue(null);

    const result = await openTroveFlow();

    expect(result).toEqual({ status: 'cancelled' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reports success only with the count the store actually holds', async () => {
    (open as any).mockResolvedValue('/troves/Photos');
    (invoke as any)
      .mockResolvedValueOnce(undefined) // open_trove
      .mockResolvedValueOnce(worldWith(3)); // get_world_state

    const result = await openTroveFlow();

    expect(result).toEqual({
      status: 'opened',
      path: '/troves/Photos',
      name: 'Photos',
      entityCount: 3,
    });
    expect(get(worldStore).entities.size).toBe(3);
  });

  it('reports empty rather than success when the trove has no entities', async () => {
    (open as any).mockResolvedValue('/troves/Blank');
    (invoke as any)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(worldWith(0));

    const result = await openTroveFlow();

    expect(result.status).toBe('empty');
  });

  it('reports failure instead of claiming the trove opened', async () => {
    (open as any).mockResolvedValue('/troves/Broken');
    (invoke as any).mockRejectedValueOnce(new Error('Failed to read directory'));

    const result = await openTroveFlow();

    expect(result.status).toBe('failed');
    expect(result).toMatchObject({ error: 'Failed to read directory', path: '/troves/Broken' });
  });

  it('does not leave the busy flag set after a failure', async () => {
    (open as any).mockResolvedValue('/troves/Broken');
    (invoke as any).mockRejectedValueOnce(new Error('boom'));

    await openTroveFlow();

    expect(get(troveOpening)).toBe(false);
  });

  it('refuses a second open while the first is still in flight', async () => {
    let releaseDialog: (value: string) => void = () => {};
    (open as any).mockImplementation(
      () => new Promise<string>((resolve) => (releaseDialog = resolve))
    );
    (invoke as any)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(worldWith(1));

    const first = openTroveFlow();
    expect(get(troveOpening)).toBe(true);

    const second = await openTroveFlow();
    expect(second).toEqual({ status: 'busy' });

    releaseDialog('/troves/Photos');
    const firstResult = await first;
    expect(firstResult.status).toBe('opened');
    expect(get(troveOpening)).toBe(false);
  });

  it('clears the focused entity so a stale id cannot survive the swap', async () => {
    focusEntity(42);
    (open as any).mockResolvedValue('/troves/Photos');
    (invoke as any)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(worldWith(2));

    await openTroveFlow();

    expect(get(focusedEntityStore)).toBeNull();
  });
});
