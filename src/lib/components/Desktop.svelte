<script lang="ts">
  import { rootEntities } from "../stores/world";
  import RenderEntity from "./RenderEntity.svelte";
</script>

<div class="desktop-container">
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
</style>
