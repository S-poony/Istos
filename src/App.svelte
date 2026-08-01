<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { worldStore } from "./lib/stores/world";
  import { pushToast } from "./lib/stores/toasts";
  import { openTroveFlow, troveOpening } from "./lib/trove";
  import Desktop from "./lib/components/Desktop.svelte";
  import ModeToggle from "./lib/components/ModeToggle.svelte";
  import ToastStack from "./lib/components/ToastStack.svelte";
  import "./app.css";

  let loading = $state(true);
  /// Fatal, screen-replacing error. Only startup failures qualify: a failed
  /// trove open is recoverable and must not tear down the app.
  let startupError = $state<string | null>(null);

  async function handleOpenTrove() {
    const result = await openTroveFlow();

    switch (result.status) {
      case "opened":
        pushToast(
          "success",
          `Opened "${result.name}"`,
          `${result.entityCount} ${result.entityCount === 1 ? "item" : "items"} loaded`
        );
        break;
      case "empty":
        pushToast("info", `"${result.name}" is empty`, "Nothing to display yet.");
        break;
      case "cancelled":
        pushToast("info", "No folder selected");
        break;
      case "busy":
        pushToast("info", "Still opening the previous trove", "Wait for it to finish, then try again.");
        break;
      case "failed":
        console.error("Failed to open trove:", result.error);
        pushToast("error", "Could not open the trove", result.error);
        break;
    }
  }

  onMount(async () => {
    try {
      const state = await invoke("get_world_state");
      worldStore.loadFromData(state as any);
    } catch (e) {
      startupError = e instanceof Error ? e.message : String(e);
      console.error("Failed to load world state:", e);
    } finally {
      loading = false;
    }
  });
</script>

<ToastStack />

{#if loading}
  <div class="loading">Loading DeskShell...</div>
{:else if startupError}
  <div class="error">
    <p>Failed to load: {startupError}</p>
    <p>Make sure the backend is running.</p>
  </div>
{:else}
  <div class="app-container">
    <header class="app-header">
      <h1>DeskShell</h1>
      <button
        onclick={handleOpenTrove}
        disabled={$troveOpening}
        aria-busy={$troveOpening}
        data-testid="open-trove"
      >
        {#if $troveOpening}
          <span class="btn-spinner" aria-hidden="true"></span>
          Opening…
        {:else}
          Open Trove
        {/if}
      </button>
      <ModeToggle />
    </header>
    <main class="app-main">
      <Desktop />
    </main>
  </div>
{/if}

<style>
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    font-size: 18px;
    color: var(--text-secondary);
  }

  .error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 8px;
    color: var(--danger);
  }

  .app-container {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background-color: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .app-header h1 {
    font-size: 18px;
    font-weight: 600;
  }

  .app-header button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .app-header button:disabled {
    opacity: 0.6;
    cursor: progress;
    background-color: var(--bg-secondary);
  }

  .btn-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-top-color: var(--accent-hover);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .app-main {
    flex: 1;
    overflow: auto;
    padding: 16px;
  }
</style>
