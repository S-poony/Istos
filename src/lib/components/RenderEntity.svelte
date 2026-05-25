<script lang="ts">
  import { worldStore } from "../stores/world";
  import Grid from "./Grid.svelte";
  import RenderFile from "./RenderFile.svelte";

  interface Props {
    entityId: number;
  }

  let { entityId }: Props = $props();

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

{#if hasGrid && gridSettings}
  <Grid
    {entityId}
    columns={gridSettings.columns}
    gap={gridSettings.gap}
    draggable={gridSettings.draggable}
  />
{:else if hasRenderFile && renderFileSettings}
  <RenderFile
    {entityId}
    targetPath={renderFileSettings.targetPath}
    scale={renderFileSettings.scale}
    position={renderFileSettings.position}
  />
{/if}
