<script lang="ts">
  import { editMode, rootEntities, focusedEntityStore, focusEntity, breadcrumbPath } from "../stores/world";
  import RenderEntity from "./RenderEntity.svelte";
  import TreeView from "./TreeView.svelte";

  let displayEntities = $derived.by(() => {
    if ($focusedEntityStore !== null && $focusedEntityStore !== undefined) {
      return [$focusedEntityStore];
    }
    return $rootEntities;
  });
</script>

<div class="tree-view-container" class:hidden={!$editMode}>
  <TreeView />
</div>

<div class="desktop-container" class:hidden={$editMode}>
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

  {#each displayEntities as entityId (entityId)}
    <RenderEntity {entityId} depth={0} />
  {/each}

  {#if displayEntities.length === 0}
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
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
    padding-bottom: 24px;
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

