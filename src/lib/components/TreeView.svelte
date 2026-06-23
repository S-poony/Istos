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

  let dragLeaveTimer = $state<ReturnType<typeof setTimeout> | null>(null);

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

  /// Check if parentId is an ancestor of childId (or if parentId === childId).
  function isAncestor(childId: EntityId, parentId: EntityId): boolean {
    if (childId === parentId) return true;
    let curr: EntityId | null = childId;
    while (curr !== null) {
      const pid = getParentId(curr);
      if (pid === parentId) return true;
      curr = pid;
    }
    return false;
  }

  function handleDragOver(e: DragEvent, id: EntityId) {
    // Cancel any pending dragleave timer
    if (dragLeaveTimer) {
      clearTimeout(dragLeaveTimer);
      dragLeaveTimer = null;
    }
    if (draggedId === null || isAncestor(id, draggedId)) {
      dropTarget = null;
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }

    const currentEl = e.currentTarget as HTMLElement;
    // Always use the .tree-node element for accurate rect calculation
    const target = currentEl.classList.contains('tree-node-wrapper')
      ? (currentEl.querySelector('.tree-node') as HTMLElement) || currentEl
      : currentEl;
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
    // Don't nullify immediately — drop event may fire next in same event-loop tick.
    // Use a short timeout so handleDrop can see the correct dropTarget.
    dragLeaveTimer = setTimeout(() => {
      dropTarget = null;
      dragLeaveTimer = null;
    }, 100);
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
          newParentId: target.entityId,
        });
        await worldStore.refreshFromBackend();
      } else if (target.type === "between") {
        const targetParentId = getParentId(target.entityId);
        const draggedParentId = getParentId(sourceId);

        if (targetParentId === draggedParentId) {
          // Same parent: reorder siblings
          const siblings = getSiblings(sourceId);
          const filtered = siblings.filter(id => id !== sourceId);
          const targetIdx = filtered.indexOf(target.entityId);
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
            // Refresh the store so children lists reflect the move
            await worldStore.refreshFromBackend();
            // Now reorder within the new parent
            const targetSiblings = $worldStore.getChildren(targetParentId).filter(id => id !== sourceId);
            const targetIdx = targetSiblings.indexOf(target.entityId);
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

<div class="tree-root" ondragover={(e) => e.preventDefault()}>
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
