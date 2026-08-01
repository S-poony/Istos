<script lang="ts">
  import { toasts, dismissToast, type ToastKind } from "../stores/toasts";

  const ICONS: Record<ToastKind, string> = {
    success: "✓",
    error: "⚠️",
    info: "ℹ️",
  };
</script>

<div class="toast-stack" data-testid="toast-stack">
  {#each $toasts as toast (toast.id)}
    <div
      class="toast {toast.kind}"
      data-testid="toast"
      data-kind={toast.kind}
      role={toast.kind === "error" ? "alert" : "status"}
      aria-live={toast.kind === "error" ? "assertive" : "polite"}
    >
      <span class="toast-icon" aria-hidden="true">{ICONS[toast.kind]}</span>
      <div class="toast-body">
        <span class="toast-text">{toast.text}</span>
        {#if toast.detail}
          <span class="toast-detail">{toast.detail}</span>
        {/if}
      </div>
      <button
        type="button"
        class="toast-close"
        aria-label="Dismiss notification"
        onclick={() => dismissToast(toast.id)}
      >
        ✕
      </button>
    </div>
  {/each}
</div>

<style>
  .toast-stack {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: min(420px, calc(100vw - 40px));
    pointer-events: none;
  }

  /* One shared shell for every severity: only the accent colour changes, so a
     failure can never be mistaken for a success at a glance. */
  .toast {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    background-color: var(--bg-secondary);
    border: 1px solid var(--status-color);
    border-left: 4px solid var(--status-color);
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    color: var(--text-primary);
    font-size: 13px;
    pointer-events: auto;
  }

  .toast.success {
    --status-color: var(--success);
  }

  .toast.error {
    --status-color: var(--danger);
  }

  .toast.info {
    --status-color: var(--info);
  }

  .toast-icon {
    color: var(--status-color);
    font-size: 14px;
    line-height: 1.4;
    flex-shrink: 0;
  }

  .toast-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .toast-text {
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .toast-detail {
    font-size: 12px;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }

  .toast-close {
    margin-left: auto;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    background: none;
    border: none;
    color: var(--text-secondary);
    border-radius: 4px;
  }

  .toast-close:hover {
    background-color: rgba(255, 255, 255, 0.08);
    color: var(--text-primary);
  }
</style>
