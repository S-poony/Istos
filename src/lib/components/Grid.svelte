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
    min-height: 100%;
    align-content: start;
  }

  .grid-container.draggable {
    cursor: grab;
  }

  .grid-container.draggable:active {
    cursor: grabbing;
  }
</style>
