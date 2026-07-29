<script lang="ts">
  import { worldStore } from "../stores/world";
  import Grid from "./Grid.svelte";
  import RenderFile from "./RenderFile.svelte";
  import RenderDeepEntity from "./RenderDeepEntity.svelte";
  import { MAX_DEPTH } from "../constants";


  interface Props {
    entityId: number;
    depth?: number;
  }

  let { entityId, depth = 0 }: Props = $props();

  let isDeep = $derived(depth >= MAX_DEPTH);
  let hasGrid = $derived($worldStore.getComponent(entityId, "grid") !== undefined);
  let hasRenderFile = $derived($worldStore.getComponent(entityId, "renderFile") !== undefined);

  let gridSettings = $derived.by(() => {
    const comp = $worldStore.getComponent(entityId, "grid");
    return comp?.settings as { columns: number; gap: number; draggable: boolean } | undefined;
  });

  let renderFileSettings = $derived.by(() => {
    const comp = $worldStore.getComponent(entityId, "renderFile");
    return comp?.settings as { targetPath?: string; scale: number; position: { x: number; y: number } } | undefined;
  });
</script>

{#if isDeep}
  <RenderDeepEntity {entityId} {depth} />
{:else if hasGrid && gridSettings}
  <Grid
    {entityId}
    columns={gridSettings.columns}
    gap={gridSettings.gap}
    draggable={gridSettings.draggable}
    {depth}
  />
{:else if hasRenderFile && renderFileSettings}
  <RenderFile
    {entityId}
    targetPath={renderFileSettings.targetPath}
    scale={renderFileSettings.scale}
    position={renderFileSettings.position}
  />
{/if}

