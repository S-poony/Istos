<script lang="ts">
  import {
    worldStore,
    focusedEntityStore,
    focusEntity,
    getEntityDisplayName,
  } from "../stores/world";
  import { openContextMenu } from "../stores/contextMenu";
  import { isInteractiveTarget, isActivationKey } from "../interaction";
  import { DENSE_WIDTH, MAX_INLINE_CHILDREN, MIN_CARD_WIDTH } from "../constants";
  import RenderEntity from "./RenderEntity.svelte";

  interface Props {
    entityId: number;
    columns: number;
    gap: number;
    draggable: boolean;
    depth?: number;
  }

  let { entityId, columns, gap, draggable, depth = 0 }: Props = $props();

  let parentId = $derived($worldStore.entities.get(entityId)?.parentId);
  let isRoot = $derived(parentId === undefined || parentId === null || $focusedEntityStore === entityId);

  /// The container is named after itself, never after one of its children —
  /// borrowing a child's name made a container claim to be a file it merely
  /// held.
  let entityName = $derived(getEntityDisplayName($worldStore, entityId));

  let children = $derived($worldStore.getOrderedChildren(entityId));

  /// The configured column count is an *ideal*, not a fixed count. It sets the
  /// width a cell would like to be; the CSS below then fits as many cells of at
  /// least `MIN_CARD_WIDTH` as the real width allows, which is never more than
  /// this. Fewer children than columns still narrows the ideal, so a container
  /// holding one thing shows it at full width rather than in a lonely sliver.
  let gridColumns = $derived(
    children.length > 0 && children.length < columns ? children.length : columns
  );

  /// A nested container is context, not the thing being looked at. Rendering
  /// all 5,000 children of a directory the user merely passed by is the single
  /// most expensive thing the desktop can do, so nested containers show a
  /// prefix and offer the rest behind a click. The focused container is never
  /// capped.
  let overflowCount = $derived(
    isRoot ? 0 : Math.max(0, children.length - MAX_INLINE_CHILDREN)
  );
  let visibleChildren = $derived(
    overflowCount > 0 ? children.slice(0, MAX_INLINE_CHILDREN) : children
  );

  /// Measured width of the grid itself, so the decision to stop drawing cards
  /// is made from real available space rather than from nesting depth. Zero
  /// means "not laid out yet", not "no room".
  let gridElement = $state<HTMLDivElement | null>(null);
  let measuredWidth = $state(0);

  $effect(() => {
    const element = gridElement;
    if (!element || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) measuredWidth = entry.contentRect.width;
    });
    observer.observe(element);
    return () => observer.disconnect();
  });

  /// Too little room for even one legible card. Everything inside collapses to
  /// a list of rows: same cards, no bodies. A card narrower than its own
  /// caption tells the user less than a line of text in the same space.
  let dense = $derived(measuredWidth > 0 && measuredWidth < DENSE_WIDTH);

  /// Same rule as a card: a click that belongs to something inside this
  /// container is not a request to enter the container.
  function handleActivate(event: MouseEvent) {
    event.stopPropagation();
    if (isInteractiveTarget(event)) return;
    focusEntity(entityId);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!isActivationKey(event)) return;
    event.preventDefault();
    event.stopPropagation();
    focusEntity(entityId);
  }
</script>

<div
  class="entity-wrapper"
  class:root={isRoot}
  class:draggable={draggable}
  role="button"
  tabindex="0"
  aria-label={entityName}
  onclick={handleActivate}
  onkeydown={handleKeydown}
  oncontextmenu={(event) => openContextMenu(event, $worldStore, entityId)}
>
  <div class="entity-header">
    <span class="entity-name">{entityName}</span>
    {#if children.length > 0}
      <span class="entity-count">{children.length}</span>
    {/if}
  </div>
  <div
    bind:this={gridElement}
    class="grid-container"
    class:dense
    style="--grid-columns: {gridColumns}; --grid-gap: {gap}px; --card-min: {MIN_CARD_WIDTH}px;"
  >
    {#each visibleChildren as childId (childId)}
      <RenderEntity entityId={childId} depth={depth + 1} {dense} />
    {/each}
  </div>

  {#if overflowCount > 0}
    <!-- Honest about what is not being shown, and about what seeing it costs:
         entering the container is what renders the rest. -->
    <button type="button" class="overflow-more" onclick={() => focusEntity(entityId)}>
      {overflowCount} more inside — open to see {children.length > 1 ? "them all" : "it"}
    </button>
  {/if}
</div>

<style>
  .entity-wrapper {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 100%;
    min-height: 0;
    overflow: hidden;
    position: relative;
    background-color: rgba(42, 42, 62, 0.25);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.05);
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  /* Root entities on the desktop only take the space they need and must never shrink */
  .entity-wrapper.root {
    height: fit-content;
    flex-shrink: 0;
  }

  /* Nested entities size to their own content. They must not stretch to their
     grid row: a row is as tall as its tallest member, and a container forced to
     that height either pads itself with emptiness or squeezes what is inside.

     They also drop the card chrome. Every level of a full box adds its own
     padding and bottom border, so a chain of nested containers ended in a
     ladder of near-identical horizontal lines — one per level — stacked at the
     bottom of the trove. Nesting is shown with a vertical rail instead: rails
     run alongside the content and never accumulate into lines across it. */
  .entity-wrapper:not(.root) {
    height: auto;
    min-height: 0;
    background-color: transparent;
    border: none;
    border-left: 2px solid var(--border);
    border-radius: 0;
    box-shadow: none;
    padding: 0 0 0 10px;
    transition: border-color 0.2s;
  }

  .entity-wrapper.root:hover {
    border-color: rgba(124, 58, 237, 0.4);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }

  .entity-wrapper:not(.root):hover {
    border-left-color: var(--accent);
  }

  .entity-wrapper:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .entity-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding-bottom: 6px;
    margin-bottom: 8px;
    user-select: none;
  }

  /* Only the root's header earns a rule under it. Repeating it at every level
     is what the nested rail replaces. */
  .entity-wrapper.root .entity-header {
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .entity-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    letter-spacing: 0.03em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Nested names step back: they label the rail, they are not headings. */
  .entity-wrapper:not(.root) .entity-name {
    font-size: 11px;
    font-weight: 500;
    opacity: 0.8;
  }

  .entity-count {
    flex-shrink: 0;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    padding: 0 5px;
    border-radius: 999px;
    background-color: rgba(255, 255, 255, 0.07);
    color: var(--text-secondary);
  }

  .entity-wrapper.draggable {
    cursor: grab;
  }

  .entity-wrapper.draggable:active {
    cursor: grabbing;
  }

  .overflow-more {
    align-self: flex-start;
    margin-top: 8px;
    padding: 4px 10px;
    font-size: 11px;
    color: var(--text-secondary);
    background: none;
    border: 1px dashed var(--border);
    border-radius: 999px;
  }

  .grid-container {
    display: grid;
    /* `--cell` is the width a cell would like to be — either the share it would
       get at the configured column count, or `--card-min`, whichever is larger.
       `auto-fill` then lays down as many of those as genuinely fit, so the
       configured count is a ceiling and the floor is legibility. The old
       `repeat(var(--grid-columns), ...)` obeyed the count at any cost, which is
       how three columns inside three columns inside three columns turned every
       card into a sliver.

       `min(..., 100%)` keeps a container narrower than one card from
       overflowing; at that size the `.dense` rules below take over anyway. */
    --cell: max(
      var(--card-min, 132px),
      (100% - (var(--grid-columns, 4) - 1) * var(--grid-gap, 8px)) / var(--grid-columns, 4)
    );
    grid-template-columns: repeat(auto-fill, minmax(min(var(--cell), 100%), 1fr));
    grid-auto-rows: min-content;
    gap: var(--grid-gap, 8px);
    width: 100%;
    min-height: 0;
    align-content: start;
    /* Each card takes the height its own content asks for. `stretch` made a row
       as tall as its tallest member and handed that height to everything in it,
       so a card's only remaining freedom was to get thinner — and a text file
       next to a wide image was squeezed to a couple of unreadable lines. */
    align-items: start;
    border-radius: 6px;
    transition: border-color 0.2s, background-color 0.2s;
  }

  /* Out of room for cards. The children become rows: the same cards, drawn
     without their bodies, so a nested rail eight levels deep still says what is
     inside it instead of showing eight slivers. */
  .grid-container.dense {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  /* Show a subtle dashed border when in edit mode or when it might be empty */
  :global(.editable) .grid-container {
    border: 2px dashed var(--accent);
    background-color: rgba(124, 58, 237, 0.02);
  }

  /* An empty container has to be big enough to be seen and dropped into; a
     full one takes exactly the height its rows need. */
  .grid-container:empty {
    min-height: 60px;
    border: 2px dashed var(--border);
    background-color: rgba(0, 0, 0, 0.05);
  }
</style>
