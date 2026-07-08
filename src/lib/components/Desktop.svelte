<script lang="ts">
  import { editMode, rootEntities } from "../stores/world";
  import RenderEntity from "./RenderEntity.svelte";
  import TreeView from "./TreeView.svelte";
</script>

<div class="tree-view-container" class:hidden={!$editMode}>
  <TreeView />
</div>

<div class="desktop-container" class:hidden={$editMode}>
  {#each $rootEntities as entityId (entityId)}
    <RenderEntity {entityId} />
  {/each}

  {#if $rootEntities.length === 0}
    <div class="empty-state">
      <p>No desktop entities found.</p>
      <p class="hint">Add a grid component to an entity to get started.</p>
    </div>
  {/if}
</div>

<style>
  .desktop-container {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 500px;
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
