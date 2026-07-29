<script lang="ts">
  import { worldStore, focusEntity, getEntityDisplayName } from "../stores/world";

  interface Props {
    entityId: number;
    depth?: number;
  }

  let { entityId, depth = 4 }: Props = $props();

  let entityName = $derived(getEntityDisplayName($worldStore, entityId));

  let components = $derived.by(() => {
    return $worldStore.getComponents(entityId).map((c) => c.componentType);
  });

  let childrenCount = $derived.by(() => {
    return $worldStore.getChildren(entityId).length;
  });

  function handleFocus() {
    focusEntity(entityId);
  }
</script>

<div class="deep-entity-card" data-testid="deep-entity-card" role="button" tabindex="0" onclick={(e) => { e.stopPropagation(); handleFocus(); }} onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); handleFocus(); } }}>
  <div class="header">
    <span class="icon">📦</span>
    <span class="title" title={entityName}>{entityName}</span>
  </div>

  <div class="meta">
    {#if childrenCount > 0}
      <span class="badge children-count">{childrenCount} item{childrenCount === 1 ? '' : 's'}</span>
    {/if}
  </div>


</div>

<style>
  .deep-entity-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(30, 30, 48, 0.6);
    border: 1px dashed rgba(124, 58, 237, 0.5);
    border-radius: 8px;
    color: var(--text-primary, #f3f4f6);
    font-size: 12px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(4px);
    transition: all 0.2s ease;
  }

  .deep-entity-card:hover {
    border-color: var(--accent, #7c3aed);
    background: rgba(42, 42, 66, 0.7);
    box-shadow: 0 4px 12px rgba(124, 58, 237, 0.15);
  }

  .header {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
  }

  .icon {
    font-size: 14px;
    flex-shrink: 0;
  }

  .title {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-primary, #f3f4f6);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }

  .badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 500;
  }

  .children-count {
    background: rgba(59, 130, 246, 0.2);
    color: #93c5fd;
    border: 1px solid rgba(59, 130, 246, 0.4);
  }

  .comp-badge {
    background: rgba(124, 58, 237, 0.2);
    color: #c4b5fd;
    border: 1px solid rgba(124, 58, 237, 0.4);
  }

  
  .focus-btn:hover {
    filter: brightness(1.15);
    transform: translateY(-1px);
  }

  .focus-btn:active {
    transform: translateY(0);
  }
</style>
