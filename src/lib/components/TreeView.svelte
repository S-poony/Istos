<script lang="ts">
  import { worldStore } from "../stores/world";
  import { invoke } from "@tauri-apps/api/core";
  import type { EntityId } from "../types";
  import TreeNode from "./TreeNode.svelte";

  /// All root entities, derived from worldStore.
  let rootIds = $derived(
    [...$worldStore.entities]
      .filter(([_, e]) => e.parentId === undefined || e.parentId === null)
      .map(([id]) => id)
  );

  let draggedId = $state<EntityId | null>(null);
  let dropTarget = $state<{
    type: "between" | "into";
    entityId: EntityId;
    position: "before" | "after";
  } | null>(null);

  /// Find the parent of an entity.
  function getParentId(id: EntityId): EntityId | null {
    const entity = $worldStore.entities.get(id);
    if (!entity) return null;
    const pid = entity.parentId;
    return (pid !== undefined && pid !== null) ? pid : null;
  }

  /// Get all siblings (children of the same parent, including self).
  function getSiblings(id: EntityId): EntityId[] {
    const parentId = getParentId(id);
    if (parentId === null) {
      // Root level siblings
      return [...$worldStore.entities]
        .filter(([_, e]) => e.parentId === undefined || e.parentId === null)
        .map(([eid]) => eid);
    }
    return $worldStore.getChildren(parentId);
  }

  /// Check if an entity is a folder (has grid component).
  function isFolder(id: EntityId): boolean {
    return $worldStore.getComponent(id, "grid") !== undefined;
  }

  function handleDragStart(e: DragEvent, id: EntityId) {
    draggedId = id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(id));
    }
  }

  function handleDragOver(e: DragEvent, id: EntityId) {
    if (draggedId === null || draggedId === id) {
      dropTarget = null;
      return;
    }
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const ratio = relY / rect.height;

    if (isFolder(id) && ratio > 0.25 && ratio < 0.75) {
      dropTarget = { type: "into", entityId: id, position: "after" };
    } else if (ratio < 0.5) {
      dropTarget = { type: "between", entityId: id, position: "before" };
    } else {
      dropTarget = { type: "between", entityId: id, position: "after" };
    }
  }

  function handleDragLeave() {
    dropTarget = null;
  }

  async function handleDrop(e: DragEvent, targetId: EntityId) {
    e.preventDefault();
    if (draggedId === null || draggedId === targetId) {
      draggedId = null;
      dropTarget = null;
      return;
    }

    const target = dropTarget;
    const sourceId = draggedId;
    draggedId = null;
    dropTarget = null;

    if (!target) return;

    try {
      if (target.type === "into") {
        await invoke("move_entity", {
          entityId: sourceId,
          newParentId: targetId,
        });
      } else if (target.type === "between") {
        const targetParentId = getParentId(targetId);
        const draggedParentId = getParentId(sourceId);

        if (targetParentId === draggedParentId) {
          // Same parent: reorder siblings
          const siblings = getSiblings(sourceId);
          const filtered = siblings.filter(id => id !== sourceId);
          const targetIdx = filtered.indexOf(targetId);
          const insertPos = target.position === "before" ? targetIdx : targetIdx + 1;
          const newOrder = [
            ...filtered.slice(0, insertPos),
            sourceId,
            ...filtered.slice(insertPos),
          ];
          const parentId = targetParentId ?? 0;
          await invoke("reorder_children", {
            parentEntityId: parentId,
            orderedIds: newOrder,
          });
        } else {
          // Different parent: first move, then reorder
          if (targetParentId !== null) {
            await invoke("move_entity", {
              entityId: sourceId,
              newParentId: targetParentId,
            });
            // Now reorder within the new parent
            const targetSiblings = $worldStore.getChildren(targetParentId).filter(id => id !== sourceId);
            const targetIdx = targetSiblings.indexOf(targetId);
            const insertPos = target.position === "before" ? targetIdx : targetIdx + 1;
            const newOrder = [
              ...targetSiblings.slice(0, insertPos),
              sourceId,
              ...targetSiblings.slice(insertPos),
            ];
            await invoke("reorder_children", {
              parentEntityId: targetParentId,
              orderedIds: newOrder,
            });
          }
        }
      }

      await worldStore.refreshFromBackend();
    } catch (err) {
      console.error("Drag/drop failed:", err);
      alert(`Failed to reorder/move: ${err}`);
    }
  }

  function handleDragEnd() {
    draggedId = null;
    dropTarget = null;
  }
</script>

<div class="tree-root">
  {#each rootIds as id (id)}
    <TreeNode
      {id}
      {draggedId}
      {dropTarget}
      {isFolder}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
      depth={0}
    />
  {/each}

  {#if rootIds.length === 0}
    <div class="empty-state">
      <p>No files in trove.</p>
      <p class="hint">Open a trove folder to get started.</p>
    </div>
  {/if}
</div>

<style>
  .tree-root {
    padding: 12px 0;
    font-size: 14px;
    user-select: none;
    min-height: 100%;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 200px;
    gap: 8px;
    color: var(--text-secondary);
  }

  .hint {
    font-size: 13px;
    opacity: 0.6;
  }
</style>
