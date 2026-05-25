<script lang="ts">
  import { editMode, worldStore } from "../stores/world";
  import { convertFileSrc } from "@tauri-apps/api/core";

  interface Props {
    entityId: number;
    targetPath?: string;
    scale: number;
    position: { x: number; y: number };
  }

  let { entityId, targetPath, scale, position }: Props = $props();

  let parentId = $derived($worldStore.entities.get(entityId)?.parentId);
  let isRoot = $derived(parentId === undefined);

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

  let isText = $derived(
    /\.(txt|md|json|js|ts|csv|html|css|rs|yaml|yml|xml|log|ini|cfg)$/i.test(displayName)
  );

  let mediaSrc = $derived.by(() => {
    if (targetPath) {
      try {
        return convertFileSrc(targetPath);
      } catch (e) {
        console.warn("Failed to convert file src:", e);
        return targetPath;
      }
    }
    return "";
  });

  let hasError = $state(false);
  let textContent = $state("");

  $effect(() => {
    if (isText && mediaSrc) {
      fetch(mediaSrc)
        .then(res => {
          if (!res.ok) throw new Error("Failed to load text");
          return res.text();
        })
        .then(text => {
          textContent = text;
        })
        .catch(err => {
          console.error(`Failed to load text for ${displayName}:`, err);
          textContent = `Error loading text: ${err.message}`;
          hasError = true;
        });
    }
  });

  function handleError(e: Event) {
    console.error(`Failed to load media for ${displayName}. Path: ${targetPath}, Src: ${mediaSrc}. Check tauri.conf.json asset scopes or file validity.`);
    hasError = true;
  }
</script>

<div
  class="render-file"
  style="{isRoot ? `left: ${position.x}px; top: ${position.y}px;` : ''} transform: scale(${scale});"
  class:editable={$editMode}
>
  {#if hasError}
    <div class="file-placeholder error">
      <span class="file-icon">⚠️</span>
      <span class="file-name" style="color: #ef4444">Error loading media</span>
      <span class="file-name" style="font-size: 10px;">{displayName}</span>
    </div>
  {:else if isImage}
    <img src={mediaSrc} alt={displayName} draggable={false} onerror={handleError} />
  {:else if isAudio}
    <audio controls src={mediaSrc} onerror={handleError}>
      Your browser does not support the audio element.
    </audio>
  {:else if isVideo}
    <video controls src={mediaSrc} onerror={handleError}>
      <track kind="captions">
      Your browser does not support the video element.
    </video>
  {:else if isText}
    <div class="text-content">
      <pre>{textContent}</pre>
    </div>
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
  .text-content {
    width: 100%;
    height: 100%;
    padding: 8px;
    overflow: auto;
    background-color: var(--bg-primary, #ffffff);
    color: var(--text-primary, #000000);
    font-size: 12px;
  }
  
  .text-content pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    font-family: monospace;
  }
</style>
