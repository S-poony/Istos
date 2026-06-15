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
  let isRoot = $derived(parentId === undefined || parentId === null);

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
  let orientation = $state<'landscape' | 'portrait' | null>(null);

  let computedOrientation = $derived.by(() => {
    if (isAudio) return 'landscape';
    if (isText) return 'portrait';
    return orientation;
  });



  let imgElement = $state<HTMLImageElement | null>(null);
  let videoElement = $state<HTMLVideoElement | null>(null);

  function handleImageLoad(img: HTMLImageElement) {
    if (img.naturalWidth >= img.naturalHeight) {
      orientation = 'landscape';
    } else {
      orientation = 'portrait';
    }
  }

  function handleVideoMetadata(video: HTMLVideoElement) {
    if (video.videoWidth >= video.videoHeight) {
      orientation = 'landscape';
    } else {
      orientation = 'portrait';
    }
  }

  $effect(() => {
    if (isText) {
      orientation = 'portrait';
    }
  });

  $effect(() => {
    const img = imgElement;
    const src = mediaSrc;
    if (src && img && img.complete) {
      handleImageLoad(img);
    }
  });

  $effect(() => {
    const video = videoElement;
    const src = mediaSrc;
    if (src && video && video.readyState >= 1) {
      handleVideoMetadata(video);
    }
  });

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
  class:audio-file={isAudio}
  class:portrait={computedOrientation === 'portrait'}
  class:landscape={computedOrientation === 'landscape'}
  class:editable={$editMode}
>
  {#if hasError}
    <div class="file-placeholder error">
      <span class="file-icon">⚠️</span>
      <span class="file-name" style="color: #ef4444">Error loading media</span>
      <span class="file-name" style="font-size: 10px;">{displayName}</span>
    </div>
  {:else if isImage}
    <img
      bind:this={imgElement}
      src={mediaSrc}
      alt={displayName}
      draggable={false}
      onerror={handleError}
      onload={(e) => handleImageLoad(e.currentTarget as HTMLImageElement)}
    />
  {:else if isAudio}
    <audio controls src={mediaSrc} onerror={handleError}>
      Your browser does not support the audio element.
    </audio>
  {:else if isVideo}
    <video
      bind:this={videoElement}
      controls
      src={mediaSrc}
      onerror={handleError}
      onloadedmetadata={(e) => handleVideoMetadata(e.currentTarget as HTMLVideoElement)}
    >
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
    contain: paint;
    transform: translateZ(0);
    background-color: var(--bg-secondary);
    border: 1px solid var(--border);
    width: 100%;
    height: 100%; /* Fill the grid cell height to match row siblings */
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
  }

  /* Explicit heights based on grid row spans to prevent stretching when rows expand.
     Uses direct child selectors to avoid leaking into nested grids. */
  /* Portrait items: tall aspect ratio, single row */
  :global(.grid-container > .render-file.portrait) {
    aspect-ratio: 3 / 4;
    min-height: 180px;
    max-height: 400px;
  }

  /* Landscape items: wide aspect ratio, single row */
  :global(.grid-container > .render-file.landscape) {
    aspect-ratio: 16 / 9;
    min-height: 120px;
  }


  :global(.grid-container > .render-file.audio-file) {
    min-height: 54px;
  }

  .render-file.editable {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }

  .render-file img {
    width: 100%;
    height: 100%;
    object-fit: contain;
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
    width: 100%;
    height: 100%;
    max-height: 100%;
    overflow: hidden;
  }

  .file-icon {
    font-size: 32px;
    flex-shrink: 0;
  }

  .file-name {
    font-size: 12px;
    color: var(--text-secondary);
    text-align: center;
    word-break: break-all;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    max-height: 4.5em; /* approximate height for 3 lines */
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
