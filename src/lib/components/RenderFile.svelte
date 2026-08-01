<script lang="ts">
  import {
    editMode,
    worldStore,
    focusEntity,
    focusedEntityStore,
    getEntityDisplayName,
  } from "../stores/world";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { openContextMenu } from "../stores/contextMenu";
  import { isInteractiveTarget, isActivationKey } from "../interaction";
  import { revealOnce, canObserveVisibility } from "../visibility";
  import RenderMarkdown from "./RenderMarkdown.svelte";
  import RenderPdf from "./RenderPdf.svelte";
  import type { IntrinsicSize } from "../types";

  interface Props {
    entityId: number;
    targetPath?: string;
    scale: number;
    position: { x: number; y: number };
    /// True when this card stands in for a container the desktop stopped
    /// nesting inline. It is drawn like any other card — the only difference is
    /// that it is the entity's whole visible presence, so its child count is
    /// worth stating.
    collapsed?: boolean;
    /// True when the host grid ran out of width and is drawing rows. The card
    /// keeps its caption and drops its body: there is no room to render
    /// anything the body could show, so rendering it would cost work for
    /// nothing the user can see.
    dense?: boolean;
  }

  let { entityId, targetPath, scale, position, collapsed = false, dense = false }: Props = $props();

  let parentId = $derived($worldStore.entities.get(entityId)?.parentId);
  let isRoot = $derived(parentId === undefined || parentId === null);

  /// True when this entity is the one the user navigated into, which makes this
  /// card the whole view rather than one item in a grid. Content that sizes
  /// itself from the box it is given needs to know the difference.
  let isFocused = $derived($focusedEntityStore === entityId);

  /// Determine the display name for this entity.
  let displayName = $derived(targetPath ?? `Entity #${entityId}`);

  /// The caption shows the entity's own name — the last path segment, not the
  /// path, which would be unreadable in a grid cell.
  let captionName = $derived(getEntityDisplayName($worldStore, entityId));

  /// The count only, never the list: building and sorting a child array to
  /// render a number is invisible on twelve entities and quadratic on twelve
  /// thousand.
  let childCount = $derived($worldStore.getChildCount(entityId));

  /// Extension of the file this card stands for, uppercased, or "" when there
  /// is none. Deliberately not an icon: any entity can contain any other, so
  /// there is nothing a folder icon would truthfully mean here.
  let fileKind = $derived.by(() => {
    const match = /\.([a-z0-9]{1,8})$/i.exec(captionName);
    return match ? match[1].toUpperCase() : "";
  });

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

  let isMarkdown = $derived(
    /\.md$/i.test(displayName)
  );

  let isPdf = $derived(
    /\.pdf$/i.test(displayName)
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

  /// Whether this card has come near the viewport yet. Nothing heavy — no
  /// fetch, no decode, no PDF document — happens before it has. Once true it
  /// stays true: a card that scrolls away, or whose view is hidden while the
  /// user looks at something else, must not throw its work away and redo it on
  /// the way back.
  let seen = $state(!canObserveVisibility);
  /// Dense rows render no body at all, so there is nothing to load for one.
  let loadsContent = $derived(seen && !dense);

  let hasError = $state(false);
  let textContent = $state("");
  let orientation = $state<'landscape' | 'portrait' | null>(null);
  /// Intrinsic size of the rendered content, once the renderer reports it.
  /// For PDFs this is the first page, so the card matches the real document
  /// shape instead of assuming portrait.
  let intrinsicSize = $state<IntrinsicSize | null>(null);

  let computedOrientation = $derived.by(() => {
    if (isAudio) return 'landscape';
    if (intrinsicSize) {
      return intrinsicSize.width >= intrinsicSize.height ? 'landscape' : 'portrait';
    }
    if (isText || isPdf) return 'portrait';
    return orientation ?? 'landscape';
  });

  /// Overrides the default per-orientation aspect ratio with the content's own
  /// ratio when it is known.
  let aspectStyle = $derived(
    intrinsicSize && intrinsicSize.width > 0 && intrinsicSize.height > 0
      ? `--card-aspect: ${intrinsicSize.width} / ${intrinsicSize.height};`
      : ""
  );



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
    if (!loadsContent || !isText || !mediaSrc) return;
    /// Guarded like every other async continuation in the app: a response for
    /// a card that has since been given a different file must not land in it.
    let current = true;
    fetch(mediaSrc)
      .then(res => {
        if (!res.ok) throw new Error("Failed to load text");
        return res.text();
      })
      .then(text => {
        if (current) textContent = text;
      })
      .catch(err => {
        if (!current) return;
        console.error(`Failed to load text for ${displayName}:`, err);
        textContent = `Error loading text: ${err.message}`;
        hasError = true;
      });
    return () => {
      current = false;
    };
  });

  function handleError(e: Event) {
    console.error(`Failed to load media for ${displayName}. Path: ${targetPath}, Src: ${mediaSrc}. Check tauri.conf.json asset scopes or file validity.`);
    hasError = true;
  }

  /// The card is clickable, but the things inside it are too. A click on a
  /// control belongs to that control alone; it must not also navigate. The card
  /// stops propagation either way, so an unhandled click never falls through to
  /// an ancestor card, which would focus the wrong entity.
  function handleActivate(event: MouseEvent) {
    event.stopPropagation();
    if (isInteractiveTarget(event)) return;
    focusEntity(entityId);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!isActivationKey(event)) return;
    event.preventDefault();
    event.stopPropagation();
    focusEntity(entityId);
  }
</script>

<div
  class="render-file"
  class:audio-file={isAudio}
  class:text-file={isText}
  class:pdf-file={isPdf}
  class:focused={isFocused}
  class:portrait={computedOrientation === 'portrait'}
  class:landscape={computedOrientation === 'landscape'}
  class:editable={$editMode}
  class:collapsed
  class:dense
  style={aspectStyle}
  role="button"
  tabindex="0"
  aria-label={captionName}
  data-testid="entity-card"
  use:revealOnce={() => (seen = true)}
  onclick={handleActivate}
  onkeydown={handleKeydown}
  oncontextmenu={(event) => openContextMenu(event, $worldStore, entityId)}
>
  {#if !dense}
    <div class="file-body">
      {#if hasError}
        <div class="file-placeholder error">
          <span class="file-glyph error-text">⚠</span>
          <span class="file-kind error-text">Failed to load</span>
        </div>
      {:else if !loadsContent}
        <!-- Off screen. The card keeps its shape so the scrollbar does not
             jump when it does load, and shows what it is going to be. -->
        <div class="file-placeholder pending" data-testid="pending-content">
          <span class="file-glyph" aria-hidden="true"></span>
          {#if fileKind}<span class="file-kind">{fileKind}</span>{/if}
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
        <audio controls preload="metadata" src={mediaSrc} onerror={handleError}>
          Your browser does not support the audio element.
        </audio>
      {:else if isVideo}
        <video
          bind:this={videoElement}
          controls
          preload="metadata"
          src={mediaSrc}
          onerror={handleError}
          onloadedmetadata={(e) => handleVideoMetadata(e.currentTarget as HTMLVideoElement)}
        >
          <track kind="captions">
          Your browser does not support the video element.
        </video>
      {:else if isPdf}
        <RenderPdf
          {mediaSrc}
          displayName={displayName}
          onFirstPageSize={(size) => (intrinsicSize = size)}
        />
      {:else if isText}
        {#if isMarkdown}
          <RenderMarkdown source={textContent} />
        {:else}
          <div class="text-content" data-interactive>
            <pre>{textContent}</pre>
          </div>
        {/if}
      {:else}
        <div class="file-placeholder">
          <span class="file-glyph" aria-hidden="true"></span>
          {#if fileKind}<span class="file-kind">{fileKind}</span>{/if}
        </div>
      {/if}
    </div>
  {/if}

  <!-- The name is always there and never competes with the content: one line,
       secondary colour, truncated. It is how a card says what it is when the
       content alone does not. In a dense row it is the whole card. -->
  <div class="file-caption">
    <span class="caption-name" title={captionName}>{captionName}</span>
    {#if childCount > 0}
      <span class="caption-count" title="{childCount} inside">{childCount}</span>
    {/if}
  </div>
</div>

<style>
  .render-file {
    display: flex;
    flex-direction: column;
    position: relative;
    border-radius: 8px;
    overflow: hidden;
    contain: paint;
    transform: translateZ(0);
    background-color: var(--bg-secondary);
    border: 1px solid var(--border);
    width: 100%;
    /* Height comes from the card's own aspect ratio, not from its grid row.
       `height: 100%` made every card in a row as tall as the tallest one in it,
       which meant `aspect-ratio` below was decorative and a card's only way to
       respond to less space was to get narrower. */
    height: auto;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
    /* Lets the caption and any other chrome respond to the card's own width
       rather than the window's. */
    container-type: inline-size;
    cursor: pointer;
    text-align: left;
  }

  .render-file:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* A collapsed container is an ordinary card. It reads as "there is more
     inside" through its caption count, not through a different shape. */
  .render-file.collapsed {
    border-style: dashed;
  }

  /* The content owns everything above the caption. min-height: 0 lets it
     actually shrink so the caption is never pushed out of the card. */
  .file-body {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    overflow: hidden;
  }

  .file-caption {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    flex-shrink: 0;
    padding: 4px 8px;
    background-color: rgba(0, 0, 0, 0.18);
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    font-size: 11px;
    line-height: 1.4;
    color: var(--text-secondary);
    user-select: none;
  }

  .caption-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .caption-count {
    flex-shrink: 0;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    padding: 0 5px;
    border-radius: 999px;
    background-color: rgba(255, 255, 255, 0.07);
    color: var(--text-secondary);
  }

  /* Below this width the caption would be an ellipsis and nothing else, which
     tells the user less than the space it costs. A dense row is exempt: there
     the caption is the only thing the card has. */
  @container (max-width: 84px) {
    .render-file:not(.dense) .file-caption {
      display: none;
    }
  }

  /* A dense card is one row: no body, no aspect ratio, no minimum height. */
  .render-file.dense {
    aspect-ratio: auto;
    min-height: 0;
    max-height: none;
    border-radius: 5px;
    background-color: transparent;
    border-color: transparent;
    box-shadow: none;
  }

  .render-file.dense .file-caption {
    background-color: rgba(255, 255, 255, 0.03);
    border-top: none;
  }

  .render-file.dense:hover {
    background-color: rgba(124, 58, 237, 0.12);
  }

  :global(.grid-container > .render-file) {
    min-height: 120px;
  }

  /* Explicit heights based on grid row spans to prevent stretching when rows expand.
     Uses direct child selectors to avoid leaking into nested grids. */
  /* Portrait items: tall aspect ratio, single row. --card-aspect is set inline
     when the content reports its own dimensions (e.g. a PDF's first page). */
  :global(.grid-container > .render-file.portrait) {
    aspect-ratio: var(--card-aspect, 3 / 4);
    min-height: 180px;
    max-height: 400px;
  }

  /* Landscape items: wide aspect ratio, single row */
  :global(.grid-container > .render-file.landscape) {
    aspect-ratio: var(--card-aspect, 16 / 9);
    min-height: 120px;
  }

  /* Text and PDFs are the kinds of content whose usefulness is a function of
     how much of them fits. A 16/9 sliver of a source file shows three lines and
     a scrollbar; a PDF has it worse, because it spends part of the same box on
     a toolbar and a caption, and a landscape document at the 120px landscape
     floor left the viewer shorter than its own toolbar needs — so the toolbar
     was dropped and what remained was a page the user could neither read nor
     turn. Both keep the same taller floor than the portrait default, and both
     are allowed to run further before they stop growing.

     The ratio is still the document's own where it is known: `--card-aspect` is
     set inline from a PDF's first page and takes over as soon as the card is
     wide enough to ask for more height than the floor. Declared after the
     orientation rules on purpose — same specificity, so the later one wins. */
  :global(.grid-container > .render-file.text-file),
  :global(.grid-container > .render-file.pdf-file) {
    aspect-ratio: var(--card-aspect, 4 / 5);
    min-height: 240px;
    max-height: 520px;
  }

  /* The entity the user clicked into is the only thing on screen, so it gets
     the screen.

     It needs saying for a PDF in a way it does not for an image. A focused card
     is a direct child of the view, not of a grid, so none of the sizing rules
     above apply to it and its height comes from its content. An image is happy
     with that — it has an intrinsic size. A PDF viewer does the opposite: it
     measures the box it is given and renders its page to fit, so a box with no
     height of its own makes it draw a stamp. A definite height here is what
     makes "open the PDF" mean the page fills the window.

     `.desktop-view >` and not just `.focused`: the view the user came from is
     still mounted behind this one, and the same card is still sitting in its
     grid. Without the structural half of this selector that copy would be
     85vh tall too, waiting to be seen on the way back. */
  :global(.desktop-view > .render-file.pdf-file.focused) {
    aspect-ratio: auto;
    height: 78vh;
    min-height: 320px;
    max-height: none;
  }

  /* Tall enough for the player *and* the caption below it: sizing this to the
     player alone left the transport controls squeezed to nothing. */
  :global(.grid-container > .render-file.audio-file) {
    aspect-ratio: auto;
    min-height: 82px;
    max-height: none;
  }

  /* A dense row overrides every card shape above it: it is a line of text. */
  :global(.grid-container.dense > .render-file) {
    aspect-ratio: auto;
    min-height: 0;
    max-height: none;
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
    gap: 8px;
    padding: 12px;
    width: 100%;
    height: 100%;
    max-height: 100%;
    overflow: hidden;
  }

  /* Not yet on screen. Dimmer than a real placeholder so "nothing here" and
     "not loaded yet" do not look like the same state. */
  .file-placeholder.pending {
    opacity: 0.45;
  }

  /* A neutral mark, not an icon. Entities are not typed by their container-ness,
     so nothing here may imply "folder" or "file". */
  .file-glyph {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    border: 1.5px solid var(--border);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    line-height: 1;
    color: var(--text-secondary);
    opacity: 0.75;
  }

  .file-kind {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
    opacity: 0.7;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  .file-glyph.error-text,
  .file-kind.error-text {
    color: var(--danger);
    border-color: var(--danger);
    opacity: 1;
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
    word-break: break-word;
    font-family: monospace;
    line-height: 1.5;
  }
</style>
