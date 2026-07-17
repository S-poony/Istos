<script lang="ts">
  import { marked } from "marked";
  import DOMPurify from "dompurify";

  interface Props {
    source: string;
  }

  let { source }: Props = $props();

  // Compute safe HTML using Svelte 5 $derived.by rune
  let cleanHtml = $derived.by(() => {
    try {
      const parsed = marked.parse(source || "");
      // marked.parse can return a Promise if async is enabled, but by default it is synchronous.
      // We cast or handle it safely to ensure we pass a string to DOMPurify.
      const htmlString = typeof parsed === "string" ? parsed : "";
      return DOMPurify.sanitize(htmlString);
    } catch (e) {
      console.error("Failed to parse markdown:", e);
      return `<p style="color: #ef4444;">Error parsing markdown: ${e instanceof Error ? e.message : String(e)}</p>`;
    }
  });
</script>

<div class="markdown-body">
  {@html cleanHtml}
</div>

<style>
  .markdown-body {
    padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    color: var(--text-primary);
    background-color: var(--bg-primary);
    height: 100%;
    width: 100%;
    overflow: auto;
    text-align: left;
  }

  /* Target nested elements under .markdown-body */
  .markdown-body :global(h1),
  .markdown-body :global(h2),
  .markdown-body :global(h3),
  .markdown-body :global(h4) {
    margin-top: 20px;
    margin-bottom: 12px;
    font-weight: 600;
    line-height: 1.25;
    color: var(--text-primary);
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.3em;
  }

  .markdown-body :global(h1) { font-size: 1.6em; }
  .markdown-body :global(h2) { font-size: 1.3em; }
  .markdown-body :global(h3) { font-size: 1.15em; }
  .markdown-body :global(h4) { font-size: 1em; }

  .markdown-body :global(p) {
    margin-top: 0;
    margin-bottom: 12px;
    font-size: 13px;
    color: var(--text-primary);
  }

  .markdown-body :global(a) {
    color: var(--accent);
    text-decoration: none;
  }

  .markdown-body :global(a:hover) {
    text-decoration: underline;
  }

  .markdown-body :global(ul),
  .markdown-body :global(ol) {
    margin-top: 0;
    margin-bottom: 12px;
    padding-left: 20px;
    font-size: 13px;
  }

  .markdown-body :global(li) {
    margin-top: 4px;
  }

  .markdown-body :global(code) {
    padding: 2px 4px;
    margin: 0;
    font-size: 85%;
    background-color: rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    font-family: Consolas, "Liberation Mono", Courier, monospace;
  }

  .markdown-body :global(pre) {
    padding: 12px;
    overflow: auto;
    font-size: 85%;
    line-height: 1.45;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 12px;
  }

  .markdown-body :global(pre code) {
    background-color: transparent;
    padding: 0;
    margin: 0;
    font-size: 100%;
    word-break: normal;
    white-space: pre;
  }

  .markdown-body :global(blockquote) {
    padding: 0 12px;
    color: var(--text-secondary);
    border-left: 4px solid var(--accent);
    margin: 0 0 12px 0;
    font-style: italic;
  }

  .markdown-body :global(table) {
    border-spacing: 0;
    border-collapse: collapse;
    margin-top: 0;
    margin-bottom: 12px;
    width: 100%;
    overflow: auto;
    font-size: 13px;
  }

  .markdown-body :global(table th),
  .markdown-body :global(table td) {
    padding: 6px 10px;
    border: 1px solid var(--border);
  }

  .markdown-body :global(table tr) {
    background-color: var(--bg-primary);
    border-top: 1px solid var(--border);
  }

  .markdown-body :global(table tr:nth-child(2n)) {
    background-color: var(--bg-secondary);
  }
</style>
