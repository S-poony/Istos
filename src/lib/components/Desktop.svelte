<script lang="ts">
  import { tick, untrack } from "svelte";
  import { editMode, worldStore, rootEntities, focusedEntityStore, focusEntity, breadcrumbPath } from "../stores/world";
  import { MAX_LIVE_VIEWS } from "../constants";
  import type { EntityId } from "../types";
  import RenderEntity from "./RenderEntity.svelte";
  import TreeView from "./TreeView.svelte";

  /// A view is one focus target: the trove root (`null`) or one entity.
  ///
  /// Views the user has already looked at stay mounted and hidden rather than
  /// being torn down, which is the same trick the mode toggle uses. Swapping a
  /// keyed `{#each}` on focus destroyed every card on the desktop, so stepping
  /// into a folder and back re-fetched every text file, re-decoded every image
  /// and re-parsed every PDF that was already on screen a moment earlier.
  ///
  /// The array is never reordered. A keyed `{#each}` that reorders moves real
  /// DOM nodes, and there is no reason to move a hidden subtree just to record
  /// that it was visited recently — so recency lives in a plain map beside it.
  let views = $state<(EntityId | null)[]>([null]);

  let clock = 0;
  const lastUsed = new Map<EntityId | null, number>([[null, clock++]]);

  /// Where each view was last scrolled to.
  ///
  /// All views share one scroll container, and a hidden view is hidden with
  /// `display: none` — so while a short view is on screen the container has
  /// nothing left to scroll and the browser clamps its `scrollTop` to 0. The
  /// position the user was at is therefore not something the DOM keeps: it has
  /// to be recorded on the way out and put back on the way in, or stepping into
  /// a folder and back drops the user at the top of a trove they had scrolled
  /// halfway down.
  const scrollTops = new Map<EntityId | null, number>();

  /// True while `scrollTop` is being assigned. Assigning it makes the browser
  /// fire a scroll event, and a view that has not finished laying out reports a
  /// clamped position — recording that would overwrite the very position being
  /// restored.
  let restoring = false;
  let scroller = $state<HTMLDivElement | null>(null);

  let active = $derived($focusedEntityStore ?? null);

  function rememberScroll() {
    if (restoring || !scroller) return;
    scrollTops.set(active, scroller.scrollTop);
  }

  $effect(() => {
    const current = active;
    const world = $worldStore;

    /// This effect depends on the focus and on the world, and on nothing else.
    /// Reading `views` reactively here would make it depend on its own output:
    /// every write would schedule another run, and the run would write again.
    untrack(() => {
      lastUsed.set(current, clock++);

      /// A view whose entity is gone — a new trove, or a move that removed it —
      /// is not a cache, it is a leak with a name. The root view always
      /// survives, because the trove root is wherever the user came from.
      let next = views.filter(
        (id) => id === null || world.entities.has(id)
      );
      if (!next.includes(current)) next = [...next, current];

      /// Bounded on purpose. Keeping every view the user has ever opened would
      /// hold every image, video and PDF in a whole trove in memory, which is
      /// the problem this component exists to solve.
      while (next.length > MAX_LIVE_VIEWS) {
        let oldest = 0;
        for (let i = 1; i < next.length; i++) {
          if ((lastUsed.get(next[i]) ?? 0) < (lastUsed.get(next[oldest]) ?? 0)) oldest = i;
        }
        /// Never evict what is on screen, however long ago it was first opened.
        if (next[oldest] === current) next.splice(oldest === 0 ? 1 : 0, 1);
        else next.splice(oldest, 1);
      }

      const unchanged =
        next.length === views.length && next.every((id, index) => id === views[index]);
      if (!unchanged) views = next;

      /// A view that is gone takes its remembered scroll position and its
      /// recency with it. Both maps are keyed by entity, so leaving entries
      /// behind would grow them for the lifetime of the app — and a view that
      /// comes back has been rebuilt from scratch anyway, so the top is where
      /// it honestly starts.
      const live = new Set(next);
      for (const id of lastUsed.keys()) if (!live.has(id)) lastUsed.delete(id);
      for (const id of scrollTops.keys()) if (!live.has(id)) scrollTops.delete(id);
    });
  });

  /// Put the incoming view back where it was left. `tick()` because the view
  /// list above may still owe the DOM an update: scrolling to a position in a
  /// container that is not showing the right view yet scrolls the wrong thing.
  $effect(() => {
    const view = active;
    const element = scroller;
    if (!element) return;

    let cancelled = false;
    let frame: number | null = null;
    restoring = true;

    tick().then(() => {
      if (cancelled) return;
      element.scrollTop = scrollTops.get(view) ?? 0;
      /// Scroll events are dispatched before animation frame callbacks, so
      /// releasing here drops exactly the events this assignment caused and
      /// none of the user's own.
      if (typeof requestAnimationFrame === "function") {
        frame = requestAnimationFrame(() => (restoring = false));
      } else {
        restoring = false;
      }
    });

    return () => {
      cancelled = true;
      restoring = false;
      if (frame !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frame);
      }
    };
  });

  /// What a view renders: the ordered roots for the trove root, or the single
  /// focused entity.
  function entitiesFor(id: EntityId | null): EntityId[] {
    return id === null ? $rootEntities : [id];
  }

  let activeIsEmpty = $derived(entitiesFor(active).length === 0);
</script>

<div class="tree-view-container" class:hidden={!$editMode}>
  <TreeView />
</div>

<div
  class="desktop-container"
  class:hidden={$editMode}
  bind:this={scroller}
  onscroll={rememberScroll}
>
  {#if $focusedEntityStore !== null}
    <nav class="breadcrumb-bar" aria-label="Breadcrumb" data-testid="breadcrumb-bar">
      {#each $breadcrumbPath as item, index (index)}
        {#if index > 0}<span class="separator">/</span>{/if}
        <button
          type="button"
          class="breadcrumb-item"
          class:active={item.id === $focusedEntityStore}
          onclick={() => focusEntity(item.id)}
        >
          {item.name}
        </button>
      {/each}
    </nav>
  {/if}

  {#each views as view (view === null ? "root" : view)}
    <div
      class="desktop-view"
      class:hidden={view !== active}
      data-testid="desktop-view"
      aria-hidden={view !== active}
    >
      {#each entitiesFor(view) as entityId (entityId)}
        <RenderEntity {entityId} depth={0} />
      {/each}
    </div>
  {/each}

  {#if activeIsEmpty}
    <div class="empty-state">
      <p>No desktop entities found.</p>
      <p class="hint">Add a grid component to an entity to get started.</p>
    </div>
  {/if}
</div>

<style>
  /* The one scroll container for live mode. It must stay the only one: a
     `min-height` here made the container taller than the `<main>` holding it on
     a short window, so the page scrolled in two places at once and the position
     restored above was not the position the user could see. */
  .desktop-container {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
    padding-bottom: 24px;
  }

  /* One view is on screen; the rest are kept, not shown. `display: none` is
     what makes a hidden view free to lay out — `visibility: hidden` or
     `opacity: 0` would still cost a layout pass for every card in it. */
  .desktop-view {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .breadcrumb-bar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: rgba(30, 30, 48, 0.85);
    backdrop-filter: blur(8px);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 13px;
    color: var(--text-secondary);
    user-select: none;
    flex-shrink: 0;
  }

  .breadcrumb-item {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    transition: color 0.15s, background-color 0.15s;
  }

  .breadcrumb-item:hover {
    color: var(--text-primary);
    background-color: rgba(124, 58, 237, 0.15);
  }

  .breadcrumb-item.active {
    color: var(--accent, #7c3aed);
    font-weight: 600;
  }

  .separator {
    color: rgba(255, 255, 255, 0.3);
    font-size: 12px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 8px;
    color: var(--text-secondary);
  }

  .hint {
    font-size: 14px;
    opacity: 0.7;
  }

  .tree-view-container {
    width: 100%;
    height: 100%;
    overflow: auto;
  }

  .hidden {
    display: none !important;
  }
</style>
