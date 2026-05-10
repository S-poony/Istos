<script lang="ts">
  import { editMode } from "../stores/world";

  interface Props {
    entityId: number;
    targetPath?: string;
    scale: number;
    position: { x: number; y: number };
  }

  let { entityId, targetPath, scale, position }: Props = $props();

  /// Determine the display name for this entity.
  let displayName = $derived(targetPath ?? `Entity #${entityId}`);

  /// Determine if this looks like an image path.
  let isImage = $derived(
    /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(displayName)
  );

  /// Determine if this looks like an audio path.
  let isAudio = $derived(
    /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(displayName)
  );

  /// Determine if this looks like a video path.
  let isVideo = $derived(
    /\.(mp4|webm|avi|mov|mkv)$/i.test(displayName)
  );
</script>

<div
  class="render-file"
  style="transform: scale({scale}); left: {position.x}px; top: {position.y}px;"
  class:editable={$editMode}
>
  {#if isImage}
    <img src={displayName} alt={displayName} draggable={false} />
  {:else if isAudio}
    <audio controls src={displayName}>
      Your browser does not support the audio element.
    </audio>
  {:else if isVideo}
    <video controls src={displayName}>
      Your browser does not support the video element.
    </video>
  {:else}
    <div class="file-placeholder">
      <span class="file-icon">📄</span>
      <span class="file-name">{displayName}</span>
    </div>
  {/if}
</div>

<style>
  .render-file {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    border-radius: 8px;
    overflow: hidden;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border);
    min-height: 80px;
    min-width: 80px;
  }

  .render-file.editable {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }

  .render-file img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .render-file audio {
    width: 100%;
    padding: 8px;
  }

  .render-file video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .file-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 16px;
  }

  .file-icon {
    font-size: 32px;
  }

  .file-name {
    font-size: 12px;
    color: var(--text-secondary);
    text-align: center;
    word-break: break-all;
  }
</style>
