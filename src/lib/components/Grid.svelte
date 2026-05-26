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

  let renderSettings = $derived.by(() => {
    const comp = $worldStore.getComponent(entityId, "renderFile");
    return comp?.settings as { scale: number; position: { x: number; y: number } } | undefined;
  });

  let children = $derived($worldStore.getChildren(entityId));
</script>

<div
  class="grid-container"
  class:draggable={draggable}
  style="{isRoot && renderSettings ? `position: relative; left: ${renderSettings.position.x}px; top: ${renderSettings.position.y}px; transform: scale(${renderSettings.scale});` : ''} --grid-columns: {columns}; --grid-gap: {gap}px;"
>
  {#each children as childId (childId)}
    <RenderEntity entityId={childId} />
  {/each}
</div>

<style>
  .grid-container {
    display: grid;
    grid-template-columns: repeat(var(--grid-columns, 4), 1fr);
    gap: var(--grid-gap, 8px);
    padding: 8px;
    width: 100%;
    min-height: 100px; /* give it some height when empty */
    align-content: start;
    border-radius: 8px;
    border: 2px dashed transparent;
    transition: border-color 0.2s, background-color 0.2s;
  }

  /* Show a subtle dashed border when in edit mode or when it might be empty */
  :global(.editable) .grid-container,
  .grid-container:empty {
    border-color: var(--border, #ccc);
    background-color: rgba(0, 0, 0, 0.02);
  }

  .grid-container.draggable {
    cursor: grab;
  }

  .grid-container.draggable:active {
    cursor: grabbing;
  }
</style>
