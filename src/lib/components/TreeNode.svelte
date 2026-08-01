<script lang="ts">
    import { untrack } from "svelte";
    import { worldStore, focusEntity } from "../stores/world";
    import { openContextMenu } from "../stores/contextMenu";
    import type { EntityId } from "../types";
    import TreeNode from "./TreeNode.svelte";

    interface Props {
        id: EntityId;
        draggedId: EntityId | null;
        dropTarget: {
            type: "between" | "into";
            entityId: EntityId;
            position: "before" | "after";
        } | null;
        isContainer: (id: EntityId) => boolean;
        onDragStart: (e: DragEvent, id: EntityId) => void;
        onDragOver: (e: DragEvent, id: EntityId) => void;
        onDragLeave: (e: DragEvent) => void;
        onDrop: (
            e: DragEvent,
            id: EntityId,
            explicitTarget?: Props["dropTarget"],
        ) => void;
        onDragEnd: () => void;
        depth: number;
        isAncestor: (childId: EntityId, parentId: EntityId) => boolean;
        setDropTarget: (target: typeof dropTarget) => void;
    }

    let {
        id,
        draggedId,
        dropTarget,
        isContainer,
        onDragStart,
        onDragOver,
        onDragLeave,
        onDrop,
        onDragEnd,
        depth,
        isAncestor,
        setDropTarget,
    }: Props = $props();

    /// Only the top level starts open.
    ///
    /// The tree used to start fully expanded, which meant opening a trove
    /// mounted a node for every file in it before the user had asked to see any
    /// of them. Expanding is cheap and explicit; expanding everything is
    /// neither. Manual collapse and expansion are still preserved for as long
    /// as the node lives.
    /// `untrack` because this is the *initial* state, not a rule: a node that
    /// is later dragged deeper keeps whatever the user opened or closed.
    let expanded = $state(untrack(() => depth) === 0);

    /// Display name
    let displayName = $derived($worldStore.getDisplayName(id));

    /// Attached component types
    let attachedComponents = $derived.by(() => {
        return $worldStore.getComponents(id).map((c) => c.componentType);
    });

    /// Can this entity hold others? Any entity can, so this says nothing about
    /// what kind of thing it is — only that it is worth offering a toggle for.
    let canContain = $derived(isContainer(id));

    /// Is the item expandable?
    let hasChildren = $derived($worldStore.getChildCount(id) > 0);

    /// File icon
    let icon = $derived.by(() => {
        // Audio types
        if (/\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(displayName)) return "🎵";
        // Video types
        if (/\.(mp4|webm|avi|mov|mkv)$/i.test(displayName)) return "🎬";
        // Image types
        if (/\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(displayName))
            return "🖼️";
        // Text/code types
        if (
            /\.(txt|md|json|js|ts|csv|html|css|rs|yaml|yml|xml|log|ini|cfg)$/i.test(
                displayName,
            )
        )
            return "📝";
        // Nothing above matched, so nothing is known about how this entity
        // renders. It gets a neutral mark: an entity that holds others is not
        // a different kind of thing, so it must not get a different icon.
        return "◻";
    });

    /// Pre-compute ordered children for the each block
    let orderedChildren = $derived($worldStore.getOrderedChildren(id));

    // Reached from both a click and a keydown, so it is typed for what it
    // actually uses rather than for one of its two callers.
    function toggleExpand(e: Event) {
        e.stopPropagation();
        if (hasChildren || canContain) {
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
            dropTarget?.position === "before",
    );
    let dropAfter = $derived(
        dropTarget?.type === "between" &&
            dropTarget?.entityId === id &&
            dropTarget?.position === "after",
    );
    let dropInto = $derived(
        dropTarget?.type === "into" && dropTarget?.entityId === id,
    );
    let isDragging = $derived(draggedId === id);
</script>

<div
    class="tree-node-wrapper"
    class:drop-before={dropBefore}
    class:drop-after={dropAfter}
    style="--indent-depth: {depth};"
>
    <div
        class="tree-node"
        role="treeitem"
        aria-selected="false"
        tabindex="-1"
        class:drop-into={dropInto}
        class:dragging={isDragging}
        style="padding-left: {depth * 20 + 8}px;"
        draggable="true"
        ondragstart={onNodeDragStart}
        ondragover={onNodeDragOver}
        ondragleave={onDragLeave}
        ondrop={onNodeDrop}
        ondragend={onDragEnd}
        oncontextmenu={(event) => openContextMenu(event, $worldStore, id)}
    >
        <!-- Expand/collapse toggle -->
        <span
            class="toggle"
            onclick={toggleExpand}
            onkeydown={(e) => e.key === "Enter" && toggleExpand(e)}
            role="button"
            tabindex="0"
        >
            {#if canContain || hasChildren}
                {expanded ? "▾" : "▸"}
            {:else}
                <span class="toggle-spacer"></span>
            {/if}
        </span>

        <span class="icon">{icon}</span>
        <span class="name">{displayName}</span>

        {#if attachedComponents.length > 0}
            <span class="components-list" data-testid="components-list">
                {#each attachedComponents as compType}
                    <span class="component-badge" data-testid="component-badge"
                        >{compType}</span
                    >
                {/each}
            </span>
        {/if}
    </div>

    {#if expanded && (canContain || orderedChildren.length > 0)}
        <div
            class="children"
            role="group"
            class:drop-into={dropInto}
            ondragover={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (draggedId !== null && !isAncestor(id, draggedId)) {
                    setDropTarget({
                        type: "into",
                        entityId: id,
                        position: "after",
                    });
                }
            }}
            ondragleave={(e) => {
                const next = e.relatedTarget as Node | null;
                if (!next || !(e.currentTarget as HTMLElement).contains(next)) {
                    setDropTarget(null);
                }
            }}
            ondrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDrop(e, id, {
                    type: "into",
                    entityId: id,
                    position: "after",
                });
            }}
        >
            {#each orderedChildren as childId (childId)}
                <TreeNode
                    id={childId}
                    {draggedId}
                    {dropTarget}
                    {isContainer}
                    {isAncestor}
                    {onDragStart}
                    {onDragOver}
                    {onDragLeave}
                    {onDrop}
                    {onDragEnd}
                    {setDropTarget}
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
        position: relative;
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

    .components-list {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-left: 6px;
    }

    .component-badge {
        font-size: 10px;
        padding: 1px 5px;
        border-radius: 3px;
        background: rgba(124, 58, 237, 0.18);
        color: #c4b5fd;
        border: 1px solid rgba(124, 58, 237, 0.35);
        font-weight: 500;
    }

    .children {
        min-height: 0;
        position: relative;
        border-left: 1px dashed rgba(255, 255, 255, 0.1);
        margin-left: calc(var(--indent-depth) * 20px + 16px);
    }
</style>
