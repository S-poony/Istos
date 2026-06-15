<script lang="ts">
  import { editMode, worldStore } from "../stores/world";
  import RenderEntity from "./RenderEntity.svelte";

  interface Props {
    entityId: number;
    columns: number;
    gap: number;
    draggable: boolean;
  }

  let { entityId, columns, gap, draggable }: Props = $props();

  let parentId = $derived($worldStore.entities.get(entityId)?.parentId);
  let isRoot = $derived(parentId === undefined || parentId === null);

  let entityName = $derived.by(() => {
    // Try to get a display name from a renderFile component on this entity
    const rf = $worldStore.getComponent(entityId, "renderFile");
    const path = rf?.settings?.targetPath as string | undefined;
    if (path) {
      const parts = path.split(/[/\\]/);
      return parts[parts.length - 1] || path;
    }
    // Fallback: try the first child's renderFile path
    const children = $worldStore.getChildren(entityId);
    for (const childId of children) {
      const childRf = $worldStore.getComponent(childId, "renderFile");
      const childPath = childRf?.settings?.targetPath as string | undefined;
      if (childPath) {
        const parts = childPath.split(/[/\\]/);
        return parts[parts.length - 1] || childPath;
      }
    }
    return `Entity #${entityId}`;
  });

  let children = $derived($worldStore.getOrderedChildren(entityId));
</script>

<div
  class="entity-wrapper"
  class:root={isRoot}
  class:draggable={draggable}
>
  <div class="entity-header">
    <span class="entity-name">{entityName}</span>
  </div>
  <div
    class="grid-container"
    style="--grid-columns: {columns}; --grid-gap: {gap}px;"
  >
    {#each children as childId (childId)}
      <RenderEntity entityId={childId} />
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

  /* Root entities on the desktop only take the space they need */
  .entity-wrapper.root {
    height: fit-content;
  }

  /* Nested entities fill their parent grid cell */
  .entity-wrapper:not(.root) {
    height: 100%;
  }

  .entity-wrapper:hover {
    border-color: rgba(124, 58, 237, 0.4);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }

  .entity-header {
    display: flex;
    align-items: center;
    padding-bottom: 8px;
    margin-bottom: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    user-select: none;
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

  .entity-wrapper.draggable {
    cursor: grab;
  }

  .entity-wrapper.draggable:active {
    cursor: grabbing;
  }

  .grid-container {
    display: grid;
    grid-template-columns: repeat(var(--grid-columns, 4), minmax(0, 1fr));
    grid-auto-rows: auto;
    gap: var(--grid-gap, 8px);
    width: 100%;
    flex: 1;
    min-height: 80px; /* give it some height when empty */
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

  .grid-container:empty {
    border: 2px dashed var(--border);
    background-color: rgba(0, 0, 0, 0.05);
  }
</style>
