<script lang="ts">
  import { onMount } from "svelte";
  import * as pdfjsLib from "pdfjs-dist";
  import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

  // Set the worker source for pdfjs-dist using Vite URL resolution
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  interface Props {
    mediaSrc: string;
    displayName?: string;
  }

  let { mediaSrc, displayName }: Props = $props();

  let pdfDoc = $state.raw<any>(null);
  let pageNum = $state(1);
  let numPages = $state(0);
  let scale = $state(1.0);
  let loading = $state(true);
  let rendering = $state(false);
  let error = $state<string | null>(null);

  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let renderTask: any = null;
  let activeLoadingTask: any = null;
  let pageInputVal = $state("1");

  // Keep page input in sync with current page number
  $effect(() => {
    pageInputVal = String(pageNum);
  });

  // Load PDF when mediaSrc changes
  $effect(() => {
    if (mediaSrc) {
      loadPdf(mediaSrc);
    }
    return () => {
      if (activeLoadingTask) {
        activeLoadingTask.destroy();
        activeLoadingTask = null;
      }
      if (pdfDoc) {
        pdfDoc.destroy();
        pdfDoc = null;
      }
    };
  });

  // Render PDF page when document, page number, or scale changes
  $effect(() => {
    if (pdfDoc && canvasElement) {
      renderPage(pageNum, scale);
    }
    return () => {
      if (renderTask) {
        renderTask.cancel();
      }
    };
  });

  async function loadPdf(src: string) {
    loading = true;
    error = null;
    pageNum = 1;
    pdfDoc = null;

    if (activeLoadingTask) {
      activeLoadingTask.destroy();
      activeLoadingTask = null;
    }

    const currentTask = pdfjsLib.getDocument({ url: src });
    activeLoadingTask = currentTask;

    try {
      const doc = await currentTask.promise;
      if (activeLoadingTask === currentTask) {
        pdfDoc = doc;
        numPages = doc.numPages;
      }
    } catch (e: any) {
      if (activeLoadingTask === currentTask) {
        console.error("Failed to load PDF:", e);
        error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      if (activeLoadingTask === currentTask) {
        activeLoadingTask = null;
      }
      loading = false;
    }
  }

  async function renderPage(targetPage: number, targetScale: number) {
    if (!pdfDoc || !canvasElement) return;
    rendering = true;
    try {
      const page = await pdfDoc.getPage(targetPage);
      const viewport = page.getViewport({ scale: targetScale });
      const context = canvasElement.getContext("2d");
      if (!context) return;

      canvasElement.width = viewport.width;
      canvasElement.height = viewport.height;

      if (renderTask) {
        renderTask.cancel();
      }

      renderTask = page.render({
        canvasContext: context,
        viewport
      });

      await renderTask.promise;
    } catch (e: any) {
      if (e && e.name !== "RenderingCancelledException") {
        console.error("Failed to render page:", e);
      }
    } finally {
      rendering = false;
    }
  }

  function handlePrevPage() {
    if (pageNum > 1) {
      pageNum--;
    }
  }

  function handleNextPage() {
    if (pageNum < numPages) {
      pageNum++;
    }
  }

  function handlePageInputChange(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (!isNaN(val) && val >= 1 && val <= numPages) {
      pageNum = val;
    } else {
      pageInputVal = String(pageNum);
    }
  }

  function handleZoomIn() {
    if (scale < 3.0) {
      scale = Math.min(3.0, scale + 0.25);
    }
  }

  function handleZoomOut() {
    if (scale > 0.5) {
      scale = Math.max(0.5, scale - 0.25);
    }
  }

  function handleZoomReset() {
    scale = 1.0;
  }
</script>

<div class="pdf-viewer-container">
  <div class="pdf-viewport">
    {#if loading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading PDF...</p>
      </div>
    {:else if error}
      <div class="error-state">
        <span class="error-icon">⚠️</span>
        <p>Error loading PDF:</p>
        <pre>{error}</pre>
      </div>
    {:else}
      <div class="canvas-scroll-container" class:rendering={rendering}>
        <div class="pdf-canvas-wrapper">
          <canvas bind:this={canvasElement}></canvas>
        </div>
      </div>
    {/if}
  </div>

  {#if !loading && !error && numPages > 0}
    <div class="pdf-toolbar">
      <div class="toolbar-section navigation">
        <button
          onclick={handlePrevPage}
          disabled={pageNum <= 1}
          title="Previous Page"
          class="toolbar-btn"
        >
          ◀
        </button>
        <div class="page-indicator">
          <input
            type="text"
            value={pageInputVal}
            onchange={handlePageInputChange}
            class="page-input"
          />
          <span class="page-total">/ {numPages}</span>
        </div>
        <button
          onclick={handleNextPage}
          disabled={pageNum >= numPages}
          title="Next Page"
          class="toolbar-btn"
        >
          ▶
        </button>
      </div>

      <div class="toolbar-divider"></div>

      <div class="toolbar-section zoom">
        <button
          onclick={handleZoomOut}
          disabled={scale <= 0.5}
          title="Zoom Out"
          class="toolbar-btn"
        >
          －
        </button>
        <span class="zoom-level">{Math.round(scale * 100)}%</span>
        <button
          onclick={handleZoomIn}
          disabled={scale >= 3.0}
          title="Zoom In"
          class="toolbar-btn"
        >
          ＋
        </button>
        <button
          onclick={handleZoomReset}
          disabled={scale === 1.0}
          title="Reset Zoom"
          class="toolbar-btn reset-btn"
        >
          ↺
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .pdf-viewer-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 200px;
    background-color: var(--bg-primary);
    position: relative;
    overflow: hidden;
  }

  .pdf-viewport {
    flex: 1;
    position: relative;
    overflow: hidden;
    width: 100%;
    height: 100%;
  }

  .canvas-scroll-container {
    width: 100%;
    height: 100%;
    overflow: auto;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 16px;
    background-color: var(--bg-primary);
    transition: opacity 0.2s;
  }

  .canvas-scroll-container.rendering {
    opacity: 0.85;
  }

  .pdf-canvas-wrapper {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    background-color: #ffffff;
    display: inline-block;
    max-width: 100%;
  }

  .pdf-canvas-wrapper canvas {
    display: block;
    max-width: 100%;
    height: auto !important; /* Let width scale the canvas height */
  }

  .loading-state,
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 100%;
    padding: 24px;
    text-align: center;
    color: var(--text-secondary);
  }

  .error-state pre {
    margin-top: 8px;
    padding: 8px;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    max-width: 90%;
    font-size: 11px;
    color: #ef4444;
    word-break: break-all;
    white-space: pre-wrap;
  }

  .error-icon {
    font-size: 28px;
    margin-bottom: 8px;
  }

  .spinner {
    width: 28px;
    height: 28px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 12px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .pdf-toolbar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 8px 16px;
    background-color: var(--bg-secondary);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    z-index: 10;
  }

  .toolbar-section {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .toolbar-divider {
    width: 1px;
    height: 20px;
    background-color: var(--border);
  }

  .toolbar-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    font-size: 11px;
    background-color: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border);
    color: var(--text-primary);
    border-radius: 6px;
    cursor: pointer;
    transition: background-color 0.2s, color 0.2s;
  }

  .toolbar-btn:hover:not(:disabled) {
    background-color: var(--accent);
    color: white;
    border-color: var(--accent-hover);
  }

  .toolbar-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .reset-btn {
    font-size: 14px;
  }

  .page-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .page-input {
    width: 36px;
    height: 26px;
    background-color: var(--bg-primary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    border-radius: 4px;
    text-align: center;
    font-size: 12px;
    padding: 0;
  }

  .page-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .page-total {
    white-space: nowrap;
  }

  .zoom-level {
    font-size: 12px;
    font-family: monospace;
    min-width: 36px;
    text-align: center;
    color: var(--text-secondary);
  }

  /* Container query responsive toolbar */
  .pdf-viewer-container {
    container-type: inline-size;
  }

  @container (max-width: 350px) {
    .pdf-toolbar {
      gap: 8px;
      padding: 6px 8px;
    }

    .toolbar-section {
      gap: 4px;
    }

    .toolbar-btn {
      width: 24px;
      height: 24px;
      font-size: 10px;
    }

    .page-input {
      width: 30px;
      height: 22px;
      font-size: 11px;
    }

    .zoom-level {
      font-size: 11px;
      min-width: 30px;
    }
  }

  @container (max-width: 250px) {
    .toolbar-section.zoom .zoom-level {
      display: none;
    }
  }

  @container (max-width: 150px) {
    .pdf-toolbar {
      gap: 4px;
      padding: 4px;
    }

    .toolbar-divider,
    .toolbar-section.zoom {
      display: none;
    }

    .toolbar-section.navigation {
      gap: 4px;
    }

    .toolbar-btn {
      width: 22px;
      height: 22px;
      font-size: 9px;
    }

    .page-input {
      width: 26px;
      height: 20px;
      font-size: 10px;
    }

    .page-total {
      font-size: 10px;
    }
  }
</style>
