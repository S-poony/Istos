<script lang="ts">
  import { editMode } from "../stores/world";

  interface Props {
    entityId: number;
    columns: number;
    gap: number;
    draggable: boolean;
    children?: import("svelte").Snippet;
  }

  let { entityId, columns, gap, draggable, children }: Props = $props();
</script>

<div
  class="grid-container"
  class:draggable={draggable}
  style="--grid-columns: {columns}; --grid-gap: {gap}px;"
>
  {#if children}
    {@render children()}
  {/if}
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
