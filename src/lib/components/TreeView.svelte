<script lang="ts">
  import { worldStore } from "../stores/world";
  import { invoke } from "@tauri-apps/api/core";
  import type { EntityId } from "../types";
  import TreeNode from "./TreeNode.svelte";

  /// All root entities, derived from worldStore.
  let rootIds = $derived($worldStore.getOrderedRoots());

  type DropTarget = {
    type: "between" | "into";
    entityId: EntityId;
    position: "before" | "after";
  };

  let draggedId = $state<EntityId | null>(null);
  let dropTarget = $state<DropTarget | null>(null);
  let dragError = $state<string | null>(null);


  function setDropTarget(target: typeof dropTarget) {
    dropTarget = target;
  }

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

  function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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

  function getDropTarget(e: DragEvent, id: EntityId): DropTarget | null {
    if (draggedId === null || isAncestor(id, draggedId)) return null;

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    if (rect.height <= 0) return null;

    const ratio = (e.clientY - rect.top) / rect.height;
    if (isFolder(id) && ratio > 0.2 && ratio < 0.8) {
      return { type: "into", entityId: id, position: "after" };
    }
    return {
      type: "between",
      entityId: id,
      position: ratio < 0.5 ? "before" : "after",
    };
  }

  function handleDragOver(e: DragEvent, id: EntityId) {
    const target = getDropTarget(e, id);
    if (!target) {
      dropTarget = null;
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    dropTarget = target;
  }

  function handleDragLeave(e: DragEvent) {
    const current = e.currentTarget as HTMLElement;
    const next = e.relatedTarget as Node | null;
    if (!next || !current.contains(next)) dropTarget = null;
  }

  async function handleDrop(e: DragEvent, targetId: EntityId, explicitTarget?: DropTarget | null) {
    e.preventDefault();
    e.stopPropagation();
    dragError = null;

    const sourceId = draggedId;
    const target = explicitTarget ?? getDropTarget(e, targetId);
    draggedId = null;
    dropTarget = null;

    if (sourceId === null || sourceId === targetId || !target) return;

    try {
      if (target.type === "into") {
        await invoke("move_entity", {
          entityId: sourceId,
          newParentId: target.entityId,
        });
      } else {
        const targetParentId = getParentId(target.entityId);
        const sourceParentId = getParentId(sourceId);

        if (targetParentId !== sourceParentId) {
          await invoke("move_entity", {
            entityId: sourceId,
            newParentId: targetParentId ?? 0,
          });
          await worldStore.refreshFromBackend();
        }

        const siblings = targetParentId === null
          ? [...$worldStore.entities]
              .filter(([_, entity]) => entity.parentId === undefined || entity.parentId === null)
              .map(([id]) => id)
          : $worldStore.getOrderedChildren(targetParentId);
        const withoutSource = siblings.filter((id) => id !== sourceId);
        const targetIndex = withoutSource.indexOf(target.entityId);
        if (targetIndex < 0) throw new Error("Drop target is no longer in the destination folder");
        const insertionIndex = target.position === "before" ? targetIndex : targetIndex + 1;
        const newOrder = [
          ...withoutSource.slice(0, insertionIndex),
          sourceId,
          ...withoutSource.slice(insertionIndex),
        ];
        await invoke("reorder_children", {
          parentEntityId: targetParentId ?? 0,
          orderedIds: newOrder,
        });
      }

      await worldStore.refreshFromBackend();
    } catch (err) {
      console.error("Drag/drop failed:", err);
      dragError = `Failed to reorder/move: ${errorText(err)}`;
      await worldStore.refreshFromBackend().catch(() => undefined);
    } finally {
      draggedId = null;
      dropTarget = null;
    }
  }

  function handleDragEnd() {
    draggedId = null;
    dropTarget = null;
  }

  async function handleRootDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragError = null;
    if (draggedId === null) return;

    const sourceId = draggedId;
    draggedId = null;
    dropTarget = null;

    // If already at root, do nothing
    if (getParentId(sourceId) === null) return;

    try {
      await invoke("move_entity", {
        entityId: sourceId,
        newParentId: 0,
      });
      await worldStore.refreshFromBackend();
    } catch (err) {
      console.error("Root drop failed:", err);
      dragError = `Failed to move to root: ${errorText(err)}`;
    }
  }
</script>

<div class="tree-root" role="tree" tabindex="0" ondragover={(e) => e.preventDefault()} ondrop={handleRootDrop}>
  {#if dragError}
    <div class="drag-error" role="alert">{dragError}</div>
  {/if}
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
      isAncestor={isAncestor}
      setDropTarget={setDropTarget}
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

  .drag-error {
    margin: 0 12px 10px;
    padding: 8px 10px;
    border: 1px solid #ef4444;
    border-radius: 6px;
    color: #fecaca;
    background: rgb(127 29 29 / 45%);
    user-select: text;
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
