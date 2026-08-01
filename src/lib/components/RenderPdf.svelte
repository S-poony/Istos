<script lang="ts">
  import * as pdfjsLib from "pdfjs-dist";
  import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

  // Set the worker source for pdfjs-dist using Vite URL resolution
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  import type { IntrinsicSize } from "../types";

  interface Props {
    mediaSrc: string;
    displayName?: string;
    /// Reports the first page's intrinsic size once it is known, so the host
    /// card can adopt the document's real aspect ratio instead of assuming
    /// every PDF is portrait.
    onFirstPageSize?: (size: IntrinsicSize) => void;
  }

  let { mediaSrc, displayName, onFirstPageSize }: Props = $props();

  /// Zoom is expressed as a factor of the current fit scale, not an absolute
  /// PDF scale. That keeps "100%" meaningful in a 200px grid cell and in a
  /// full window alike, and lets the user's zoom survive a resize.
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 8;
  const ZOOM_STEP = 0.25;
  /// Floor for the fit scale so a page in a tiny container still renders
  /// something rather than collapsing to zero pixels.
  const MIN_FIT_SCALE = 0.05;
  /// Matches the padding of .canvas-scroll-container.
  const CANVAS_PADDING = 16;

  type FitMode = "page" | "width";

  /// How much of the toolbar the container can afford.
  ///
  /// `full` — every control. `compact` — page navigation and the zoom level,
  /// without reset or fit-mode. `minimal` — page navigation only. `none` — no
  /// toolbar at all: below this size the toolbar would take more room than the
  /// page it is meant to serve.
  type ToolbarLevel = "full" | "compact" | "minimal" | "none";

  /// Container widths, in CSS pixels, at which the next group of controls stops
  /// fitting. Measured against the rendered control widths in `.pdf-toolbar`.
  const TOOLBAR_FULL_WIDTH = 260;
  const TOOLBAR_COMPACT_WIDTH = 186;
  const TOOLBAR_MIN_WIDTH = 116;
  /// Below this height the toolbar would leave no usable room for the page.
  const TOOLBAR_MIN_HEIGHT = 120;

  let doc = $state.raw<any>(null);
  let numPages = $state(0);
  let pageNum = $state(1);
  /// Intrinsic size of a page at PDF scale 1, tagged with the page it belongs
  /// to. Keeping the two together means the renderer never mixes a new page
  /// number with the previous page's dimensions.
  let pageMeta = $state<{ page: number; size: IntrinsicSize } | null>(null);
  let fitMode = $state<FitMode>("page");
  let zoomFactor = $state(1);
  let loading = $state(true);
  let rendering = $state(false);
  let error = $state<string | null>(null);
  let pageInputVal = $state("1");
  let reloadNonce = $state(0);

  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let scrollElement = $state<HTMLDivElement | null>(null);
  let containerElement = $state<HTMLDivElement | null>(null);
  let box = $state({ width: 0, height: 0 });
  /// Non-reactive mirror of `box`, used to drop duplicate resize notifications
  /// without making the measuring effect depend on its own output.
  let measured = { width: -1, height: -1 };
  /// Size of the whole viewer, which is what decides how much toolbar fits.
  /// `null` until something has actually measured it: an unmeasured viewer
  /// shows the full toolbar rather than guessing that it has no room.
  let viewerBox = $state<{ width: number; height: number } | null>(null);
  let viewerMeasured = { width: -1, height: -1 };

  /// Reports an element's content box now and on every later resize.
  /// `clientWidth`/`clientHeight` are read up front because a ResizeObserver is
  /// not guaranteed to deliver its first entry before the next render.
  function trackSize(
    element: HTMLElement,
    apply: (width: number, height: number) => void
  ): (() => void) | undefined {
    apply(element.clientWidth, element.clientHeight);

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        apply(entry.contentRect.width, entry.contentRect.height);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }

  let loadTask: any = null;
  let renderTask: any = null;
  /// Monotonic counters. Any async continuation compares its own generation
  /// against the current one and bails out if it has been superseded, so a
  /// slow response for an old document can never overwrite current state.
  let loadGeneration = 0;
  let pageGeneration = 0;
  let renderGeneration = 0;
  let firstPageReported = false;

  function safelyCall(task: any, method: "destroy" | "cancel") {
    if (typeof task?.[method] !== "function") return;
    try {
      const result = task[method]();
      if (result && typeof result.catch === "function") {
        result.catch((e: unknown) => console.warn(`PDF ${method} failed:`, e));
      }
    } catch (e) {
      console.warn(`PDF ${method} failed:`, e);
    }
  }

  /// Size of the page that is currently displayable, or null while the current
  /// page's metadata is still being fetched.
  let currentSize = $derived(
    pageMeta && pageMeta.page === pageNum ? pageMeta.size : null
  );

  /// Scale that makes the current page fit the measured viewport. Falls back to
  /// 1 while the viewport has not been measured, so a render is never issued
  /// against a zero-sized box.
  let fitScale = $derived.by(() => {
    if (!currentSize || currentSize.width <= 0 || currentSize.height <= 0) return 1;

    const availableWidth = box.width - CANVAS_PADDING * 2;
    const availableHeight = box.height - CANVAS_PADDING * 2;
    if (availableWidth <= 0) return 1;

    const widthScale = availableWidth / currentSize.width;
    if (fitMode === "width" || availableHeight <= 0) {
      return Math.max(widthScale, MIN_FIT_SCALE);
    }
    return Math.max(Math.min(widthScale, availableHeight / currentSize.height), MIN_FIT_SCALE);
  });

  let scale = $derived(fitScale * zoomFactor);

  /// A control the container has no room for is removed, not shrunk further:
  /// a button too small to read or hit is worse than no button. Groups drop
  /// from least to most essential, so page navigation is the last thing to go.
  let toolbarLevel = $derived.by<ToolbarLevel>(() => {
    if (!viewerBox) return "full";
    if (viewerBox.height < TOOLBAR_MIN_HEIGHT || viewerBox.width < TOOLBAR_MIN_WIDTH) {
      return "none";
    }
    if (viewerBox.width < TOOLBAR_COMPACT_WIDTH) return "minimal";
    if (viewerBox.width < TOOLBAR_FULL_WIDTH) return "compact";
    return "full";
  });

  let showToolbar = $derived(toolbarLevel !== "none");
  let showZoom = $derived(toolbarLevel === "full" || toolbarLevel === "compact");
  let showZoomExtras = $derived(toolbarLevel === "full");

  /// Zoom can only be changed from controls that are now gone, so leaving a
  /// stale zoom behind would trap the page at a scale the user cannot undo.
  $effect(() => {
    if (!showZoom && zoomFactor !== 1) zoomFactor = 1;
  });

  // Keep page input in sync with current page number
  $effect(() => {
    pageInputVal = String(pageNum);
  });

  // Load the document whenever the source changes (or a retry is requested).
  $effect(() => {
    const src = mediaSrc;
    reloadNonce;
    if (src) loadPdf(src);

    return () => {
      loadGeneration++;
      if (loadTask) {
        safelyCall(loadTask, "destroy");
        loadTask = null;
      }
      if (doc) {
        safelyCall(doc, "destroy");
        doc = null;
      }
    };
  });

  // Measure the whole viewer, which decides how much toolbar fits. The toolbar
  // sits inside this box but does not change it, so hiding a control can never
  // feed back into the measurement and oscillate.
  $effect(() => {
    const element = containerElement;
    if (!element) return;

    return trackSize(element, (width, height) => {
      // A zero-sized report means "not laid out yet", not "no room". Acting on
      // it would hide the toolbar for one frame on every mount.
      if (width <= 0 || height <= 0) return;
      if (width === viewerMeasured.width && height === viewerMeasured.height) return;
      viewerMeasured = { width, height };
      viewerBox = { width, height };
    });
  });

  // Measure the scroll viewport. Declared before the render effect so that the
  // very first render of a newly mounted canvas already sees real dimensions.
  $effect(() => {
    const element = scrollElement;
    if (!element) return;

    return trackSize(element, (width, height) => {
      if (width === measured.width && height === measured.height) return;
      measured = { width, height };
      box = { width, height };
    });
  });

  // Fetch metadata for the current page. Runs once per page, independently of
  // zoom and resize, so zooming or resizing never refetches the page.
  $effect(() => {
    const currentDoc = doc;
    const target = pageNum;
    if (!currentDoc) return;

    const generation = ++pageGeneration;
    Promise.resolve(currentDoc.getPage(target))
      .then((page: any) => {
        if (generation !== pageGeneration) return;
        const viewport = page.getViewport({ scale: 1 });
        const size = { width: viewport.width, height: viewport.height };
        pageMeta = { page: target, size };
        if (target === 1 && !firstPageReported) {
          firstPageReported = true;
          onFirstPageSize?.(size);
        }
      })
      .catch((e: any) => {
        if (generation !== pageGeneration) return;
        console.error("Failed to read PDF page:", e);
        error = e instanceof Error ? e.message : String(e);
      });
  });

  // Render. Waits until the page's own dimensions are known, so the first paint
  // already uses the fitted scale instead of rendering at 1.0 and again at fit.
  // While waiting, the previously rendered page stays on screen.
  $effect(() => {
    const currentDoc = doc;
    const canvas = canvasElement;
    const target = pageNum;
    const targetScale = scale;
    if (!currentDoc || !canvas || !currentSize || targetScale <= 0) return;

    renderPage(currentDoc, canvas, target, targetScale);

    return () => {
      renderGeneration++;
      if (renderTask) {
        safelyCall(renderTask, "cancel");
        renderTask = null;
      }
    };
  });

  async function loadPdf(src: string) {
    const generation = ++loadGeneration;
    loading = true;
    error = null;
    pageNum = 1;
    pageMeta = null;
    doc = null;
    firstPageReported = false;

    if (loadTask) {
      safelyCall(loadTask, "destroy");
      loadTask = null;
    }

    const task = pdfjsLib.getDocument({ url: src });
    loadTask = task;

    try {
      const loaded = await task.promise;
      if (generation !== loadGeneration) {
        safelyCall(loaded, "destroy");
        return;
      }
      doc = loaded;
      numPages = loaded.numPages;
    } catch (e: any) {
      if (generation !== loadGeneration) return;
      console.error("Failed to load PDF:", e);
      error = e instanceof Error ? e.message : String(e);
    } finally {
      if (generation === loadGeneration) {
        loadTask = null;
        loading = false;
      }
    }
  }

  async function renderPage(
    currentDoc: any,
    canvas: HTMLCanvasElement,
    target: number,
    targetScale: number
  ) {
    const generation = ++renderGeneration;

    // Cancel the in-flight paint before touching the canvas: resizing a canvas
    // clears it, and a live render task would keep drawing into it.
    if (renderTask) {
      safelyCall(renderTask, "cancel");
      renderTask = null;
    }

    rendering = true;
    try {
      const page = await currentDoc.getPage(target);
      if (generation !== renderGeneration) return;

      const viewport = page.getViewport({ scale: targetScale });
      const context = canvas.getContext("2d");
      if (!context) return;

      // Back the canvas with device pixels for a sharp image while keeping the
      // CSS box at the logical viewport size.
      const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const task = page.render({
        canvasContext: context,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      });
      renderTask = task;
      await task.promise;
    } catch (e: any) {
      if (e && e.name !== "RenderingCancelledException") {
        console.error("Failed to render page:", e);
      }
    } finally {
      if (generation === renderGeneration) {
        renderTask = null;
        rendering = false;
      }
    }
  }

  function goToPage(target: number) {
    const clamped = Math.min(Math.max(target, 1), Math.max(numPages, 1));
    if (clamped !== pageNum) pageNum = clamped;
  }

  function handlePrevPage() {
    goToPage(pageNum - 1);
  }

  function handleNextPage() {
    goToPage(pageNum + 1);
  }

  function handlePageInputChange(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (!isNaN(val) && val >= 1 && val <= numPages) {
      goToPage(val);
    } else {
      pageInputVal = String(pageNum);
    }
  }

  /// Clamps rather than refuses, so a click at the boundary still lands on the
  /// limit instead of silently doing nothing.
  function setZoom(factor: number) {
    zoomFactor = Math.min(Math.max(factor, MIN_ZOOM), MAX_ZOOM);
  }

  function handleZoomIn() {
    setZoom(zoomFactor + ZOOM_STEP);
  }

  function handleZoomOut() {
    setZoom(zoomFactor - ZOOM_STEP);
  }

  function handleZoomReset() {
    zoomFactor = 1;
  }

  function toggleFitMode() {
    fitMode = fitMode === "page" ? "width" : "page";
    zoomFactor = 1;
  }

  function handleRetry() {
    reloadNonce++;
  }
</script>

<div class="pdf-viewer-container" bind:this={containerElement}>
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
        <button type="button" class="retry-btn" onclick={handleRetry}>Retry</button>
      </div>
    {:else}
      <div
        class="canvas-scroll-container"
        class:rendering
        bind:this={scrollElement}
      >
        <div class="pdf-canvas-wrapper">
          <canvas bind:this={canvasElement} aria-label={displayName ?? "PDF page"}></canvas>
        </div>
      </div>
    {/if}
  </div>

  {#if !loading && !error && numPages > 0 && showToolbar}
    <!-- data-interactive: the toolbar and its padding belong to the viewer, so
         a click anywhere in it must not also navigate into the host card. -->
    <div class="pdf-toolbar" data-interactive data-testid="pdf-toolbar">
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
            aria-label="Page number"
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

      {#if showZoom}
        <div class="toolbar-divider"></div>

        <div class="toolbar-section zoom">
          <button
            onclick={handleZoomOut}
            disabled={zoomFactor <= MIN_ZOOM}
            title="Zoom Out"
            class="toolbar-btn"
          >
            －
          </button>
          <span class="zoom-level">{Math.round(zoomFactor * 100)}%</span>
          <button
            onclick={handleZoomIn}
            disabled={zoomFactor >= MAX_ZOOM}
            title="Zoom In"
            class="toolbar-btn"
          >
            ＋
          </button>
          {#if showZoomExtras}
            <button
              onclick={handleZoomReset}
              disabled={zoomFactor === 1}
              title="Reset Zoom"
              class="toolbar-btn reset-btn"
            >
              ↺
            </button>
            <button
              onclick={toggleFitMode}
              title={fitMode === "page" ? "Fit Width" : "Fit Page"}
              class="toolbar-btn fit-btn"
            >
              {fitMode === "page" ? "↔" : "⤢"}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .pdf-viewer-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    /* No min-height: the host grid cell owns the sizing. A min-height here
       pushed the toolbar out of small cells. */
    min-height: 0;
    background-color: var(--bg-primary);
    position: relative;
    overflow: hidden;
    container-type: inline-size;
  }

  .pdf-viewport {
    flex: 1;
    position: relative;
    /* min-height: 0 lets this flex child actually shrink so the toolbar below
       always stays inside the container. */
    min-height: 0;
    overflow: hidden;
    width: 100%;
  }

  /* Centering an overflowing flex item with justify-content makes the overflow
     on the leading side unreachable by scrolling. `margin: auto` on the child
     centers when there is spare room and collapses to 0 when there is not, so
     both edges stay scrollable. */
  .canvas-scroll-container {
    width: 100%;
    height: 100%;
    overflow: auto;
    display: flex;
    padding: 16px;
    background-color: var(--bg-primary);
    transition: opacity 0.2s;
  }

  .canvas-scroll-container.rendering {
    opacity: 0.85;
  }

  .pdf-canvas-wrapper {
    margin: auto;
    flex: 0 0 auto;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    background-color: #ffffff;
    line-height: 0;
  }

  .pdf-canvas-wrapper canvas {
    display: block;
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
    overflow: auto;
  }

  .error-state pre {
    margin-top: 8px;
    padding: 8px;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    max-width: 90%;
    font-size: 11px;
    color: var(--danger);
    word-break: break-all;
    white-space: pre-wrap;
  }

  .retry-btn {
    margin-top: 10px;
    font-size: 12px;
    padding: 4px 12px;
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

  /* Controls shrink first (the container queries below) and are dropped only
     once shrinking would make them unreadable — see `toolbarLevel`. */
  .pdf-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 8px 16px;
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

  .reset-btn,
  .fit-btn {
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

  /* Container query responsive toolbar: the controls that are still on screen
     shrink to fit before any of them is dropped. */
  @container (max-width: 350px) {
    .pdf-toolbar {
      gap: 6px 8px;
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

  @container (max-width: 200px) {
    .pdf-toolbar {
      gap: 4px;
      padding: 4px;
    }

    .toolbar-divider {
      display: none;
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

    .page-total,
    .zoom-level {
      font-size: 10px;
    }

    .zoom-level {
      min-width: 26px;
    }
  }
</style>
