<script lang="ts">
  import { worldStore } from "../stores/world";
  import Grid from "./Grid.svelte";
  import RenderFile from "./RenderFile.svelte";
  import { MAX_DEPTH } from "../constants";

  interface Props {
    entityId: number;
    depth?: number;
  }

  let { entityId, depth = 0 }: Props = $props();

  /// Past this depth an entity is no longer expanded in place. It is not
  /// replaced by a different kind of thing: its `grid` simply stops applying,
  /// and what remains is its `renderFile` — the same card the desktop would
  /// draw for it anywhere else. Entering it is what shows its children.
  let isDeep = $derived(depth >= MAX_DEPTH);

  let gridSettings = $derived.by(() => {
    const comp = $worldStore.getComponent(entityId, "grid");
    return comp?.settings as { columns: number; gap: number; draggable: boolean } | undefined;
  });

  let renderFileSettings = $derived.by(() => {
    const comp = $worldStore.getComponent(entityId, "renderFile");
    return comp?.settings as
      | { targetPath?: string; scale?: number; position?: { x: number; y: number } }
      | undefined;
  });

  let expandsInline = $derived(!isDeep && gridSettings !== undefined);
  /// A collapsed container still has to be visible, even in the unusual case of
  /// an entity that has a `grid` but no `renderFile`; the card falls back to
  /// naming the entity.
  let drawsCard = $derived(
    !expandsInline && (renderFileSettings !== undefined || gridSettings !== undefined)
  );
</script>

{#if expandsInline && gridSettings}
  <Grid
    {entityId}
    columns={gridSettings.columns}
    gap={gridSettings.gap}
    draggable={gridSettings.draggable}
    {depth}
  />
{:else if drawsCard}
  <RenderFile
    {entityId}
    targetPath={renderFileSettings?.targetPath}
    scale={renderFileSettings?.scale ?? 1}
    position={renderFileSettings?.position ?? { x: 0, y: 0 }}
    collapsed={isDeep && gridSettings !== undefined}
  />
{/if}
