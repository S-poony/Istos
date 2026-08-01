<script lang="ts">
  import {
    editMode,
    worldStore,
    focusedEntityStore,
    focusEntity,
    getEntityDisplayName,
  } from "../stores/world";
  import { isInteractiveTarget, isActivationKey } from "../interaction";
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
  let gridColumns = $derived(
    children.length > 0 && children.length < columns ? children.length : columns
  );

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
>
  <div class="entity-header">
    <span class="entity-name">{entityName}</span>
    {#if children.length > 0}
      <span class="entity-count">{children.length}</span>
    {/if}
  </div>
  <div
    class="grid-container"
    style="--grid-columns: {gridColumns}; --grid-gap: {gap}px;"
  >
    {#each children as childId (childId)}
      <RenderEntity entityId={childId} depth={depth + 1} />
    {/each}
  </div>
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

  /* Nested entities stretch to fill their grid row (handled by grid
     align-items: stretch) without forcing an ambiguous percentage height that
     collapses/overflows content.

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

  .grid-container {
    display: grid;
    grid-template-columns: repeat(var(--grid-columns, 4), minmax(0, 1fr));
    grid-auto-rows: minmax(min-content, max-content);
    gap: var(--grid-gap, 8px);
    width: 100%;
    flex: 1;
    min-height: 0;
    align-content: start;
    align-items: stretch;
    border-radius: 6px;
    transition: border-color 0.2s, background-color 0.2s;
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
