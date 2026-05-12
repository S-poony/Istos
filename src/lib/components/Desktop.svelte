<script lang="ts">
  import { worldStore, gridEntities, renderFileEntities } from "../stores/world";
  import Grid from "./Grid.svelte";
  import RenderFile from "./RenderFile.svelte";

  /// Get components for an entity from the world.
  function getComponents(entityId: number) {
    return $worldStore.getComponents(entityId);
  }

  /// Check if an entity has a specific component type.
  function hasComponent(entityId: number, type: string): boolean {
    return $worldStore.getComponent(entityId, type) !== undefined;
  }

  /// Get the grid settings for an entity.
  function getGridSettings(entityId: number) {
    const comp = $worldStore.getComponent(entityId, "grid");
    return comp?.settings as { columns: number; gap: number; draggable: boolean } | undefined;
  }

  /// Get the renderFile settings for an entity.
  function getRenderFileSettings(entityId: number) {
    const comp = $worldStore.getComponent(entityId, "renderFile");
    return comp?.settings as { targetPath?: string; scale: number; position: { x: number; y: number } } | undefined;
  }
</script>

{#each $gridEntities as entityId (entityId)}
  {@const gridSettings = getGridSettings(entityId)}
  {#if gridSettings}
    <div class="desktop-entity">
      <Grid {entityId} columns={gridSettings.columns} gap={gridSettings.gap} draggable={gridSettings.draggable}>
        {#each $worldStore.getChildren(entityId) as childId (childId)}
          {@const renderSettings = getRenderFileSettings(childId)}
          {#if renderSettings}
            <RenderFile
              entityId={childId}
              targetPath={renderSettings.targetPath}
              scale={renderSettings.scale}
              position={renderSettings.position}
            />
          {/if}
        {/each}
      </Grid>
    </div>
  {:else}
    <div style="display: none;">
      {console.warn(`Entity ${entityId} has 'grid' component but is missing valid gridSettings.`)}
    </div>
  {/if}
{/each}

{#each $renderFileEntities as entityId (entityId)}
  {@const renderSettings = getRenderFileSettings(entityId)}
  {#if renderSettings && $worldStore.entities.get(entityId)?.parentId === undefined}
    <div class="desktop-entity">
      <RenderFile
        entityId={entityId}
        targetPath={renderSettings.targetPath}
        scale={renderSettings.scale}
        position={renderSettings.position}
      />
    </div>
  {:else if !renderSettings}
    <div style="display: none;">
      {console.warn(`Entity ${entityId} has 'renderFile' component but is missing valid renderSettings.`)}
    </div>
  {/if}
{/each}

{#if $gridEntities.length === 0}
  <div class="empty-state">
    <p>No desktop entities found.</p>
    <p class="hint">Add a grid component to an entity to get started.</p>
  </div>
{/if}

<style>
  .desktop-entity {
    width: 100%;
    height: 100%;
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
