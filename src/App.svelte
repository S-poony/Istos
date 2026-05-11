<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import { worldStore, editMode } from "./lib/stores/world";
  import Desktop from "./lib/components/Desktop.svelte";
  import ModeToggle from "./lib/components/ModeToggle.svelte";
  import "./app.css";

  let loading = $state(true);
  let error = $state<string | null>(null);

  async function openTrove() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === "string") {
        await invoke("open_trove", { path: selected });
        const state = await invoke("get_world_state");
        worldStore.loadFromData(state as any);
      }
    } catch (e) {
      error = String(e);
      console.error("Failed to open trove:", e);
    }
  }

  onMount(async () => {
    try {
      const state = await invoke("get_world_state");
      worldStore.loadFromData(state as any);
    } catch (e) {
      error = String(e);
      console.error("Failed to load world state:", e);
    } finally {
      loading = false;
    }
  });
</script>

{#if loading}
  <div class="loading">Loading DeskShell...</div>
{:else if error}
  <div class="error">
    <p>Failed to load: {error}</p>
    <p>Make sure the backend is running.</p>
  </div>
{:else}
  <div class="app-container">
    <header class="app-header">
      <h1>DeskShell</h1>
      <button onclick={openTrove}>Open Trove</button>
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
    color: #ef4444;
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

  .app-main {
    flex: 1;
    overflow: auto;
    padding: 16px;
  }
</style>
