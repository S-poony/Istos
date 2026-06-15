<script lang="ts">
  import { worldStore } from "../stores/world";
  import type { EntityId } from "../types";

  interface Props {
    id: EntityId;
    draggedId: EntityId | null;
    dropTarget: {
      type: "between" | "into";
      entityId: EntityId;
      position: "before" | "after";
    } | null;
    isFolder: (id: EntityId) => boolean;
    onDragStart: (e: DragEvent, id: EntityId) => void;
    onDragOver: (e: DragEvent, id: EntityId) => void;
    onDragLeave: () => void;
    onDrop: (e: DragEvent, id: EntityId) => void;
    onDragEnd: () => void;
    depth: number;
  }

  let {
    id,
    draggedId,
    dropTarget,
    isFolder,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragEnd,
    depth,
  }: Props = $props();

  let expanded = $state(false);

  /// Display name
  let displayName = $derived.by(() => {
    const rf = $worldStore.getComponent(id, "renderFile");
    const path = rf?.settings?.targetPath as string | undefined;
    if (path) {
      const parts = path.split(/[/\\]/);
      return parts[parts.length - 1] || path;
    }
    return `Entity #${id}`;
  });

  /// Is this a directory/folder?
  let folder = $derived(isFolder(id));

  /// Is the item expandable?
  let hasChildren = $derived.by(() => {
    const children = $worldStore.getChildren(id);
    return children.length > 0;
  });

  /// File icon
  let icon = $derived.by(() => {
    // Audio types
    if (/\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(displayName)) return "🎵";
    // Video types
    if (/\.(mp4|webm|avi|mov|mkv)$/i.test(displayName)) return "🎬";
    // Image types
    if (/\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(displayName)) return "🖼️";
    // Text/code types
    if (/\.(txt|md|json|js|ts|csv|html|css|rs|yaml|yml|xml|log|ini|cfg)$/i.test(displayName)) return "📝";
    // Folders
    if (folder) return "📁";
    return "📄";
  });

  function toggleExpand(e: MouseEvent) {
    e.stopPropagation();
    if (hasChildren || folder) {
      expanded = !expanded;
    }
  }

  function onNodeDragStart(e: DragEvent) {
    onDragStart(e, id);
  }

  function onNodeDragOver(e: DragEvent) {
    onDragOver(e, id);
  }

  function onNodeDrop(e: DragEvent) {
    onDrop(e, id);
  }

  /// Drop indicator classes
  let dropBefore = $derived(
    dropTarget?.type === "between" &&
    dropTarget?.entityId === id &&
    dropTarget?.position === "before"
  );
  let dropAfter = $derived(
    dropTarget?.type === "between" &&
    dropTarget?.entityId === id &&
    dropTarget?.position === "after"
  );
  let dropInto = $derived(
    dropTarget?.type === "into" &&
    dropTarget?.entityId === id
  );
  let isDragging = $derived(draggedId === id);
</script>

<div
  class="tree-node-wrapper"
  class:drop-before={dropBefore}
  class:drop-after={dropAfter}
>
  <div
    class="tree-node"
    class:drop-into={dropInto}
    class:dragging={isDragging}
    style="padding-left: {depth * 20 + 8}px;"
    draggable="true"
    ondragstart={onNodeDragStart}
    ondragover={onNodeDragOver}
    ondragleave={onDragLeave}
    ondrop={onNodeDrop}
    ondragend={onDragEnd}
  >
    <!-- Expand/collapse toggle -->
    <span class="toggle" onclick={toggleExpand} onkeydown={(e) => e.key === "Enter" && toggleExpand(e)} role="button" tabindex="0">
      {#if folder || hasChildren}
        {expanded ? '▾' : '▸'}
      {:else}
        <span class="toggle-spacer"></span>
      {/if}
    </span>

    <span class="icon">{icon}</span>
    <span class="name">{displayName}</span>
  </div>

  {#if expanded && (folder || hasChildren)}
    <div class="children">
      {#each $worldStore.getOrderedChildren(id) as childId (childId)}
        <TreeNode
          id={childId}
          {draggedId}
          {dropTarget}
          {isFolder}
          {onDragStart}
          {onDragOver}
          {onDragLeave}
          {onDrop}
          {onDragEnd}
          depth={depth + 1}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .tree-node-wrapper {
    position: relative;
  }

  .tree-node-wrapper.drop-before::before {
    content: "";
    position: absolute;
    top: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background-color: var(--accent, #7c3aed);
    z-index: 10;
    pointer-events: none;
  }

  .tree-node-wrapper.drop-after::after {
    content: "";
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background-color: var(--accent, #7c3aed);
    z-index: 10;
    pointer-events: none;
  }

  .tree-node {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px 6px 8px;
    cursor: pointer;
    border-radius: 4px;
    transition: background-color 0.15s;
    border: 1px solid transparent;
    white-space: nowrap;
  }

  .tree-node:hover {
    background-color: rgba(124, 58, 237, 0.08);
  }

  .tree-node.drop-into {
    background-color: rgba(124, 58, 237, 0.15);
    border-color: var(--accent, #7c3aed);
  }

  .tree-node.dragging {
    opacity: 0.4;
  }

  .toggle {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    color: var(--text-secondary);
    flex-shrink: 0;
    cursor: pointer;
    user-select: none;
  }

  .toggle-spacer {
    width: 18px;
    flex-shrink: 0;
  }

  .icon {
    flex-shrink: 0;
    font-size: 14px;
  }

  .name {
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
  }

  .children {
    min-height: 0;
  }
</style>
