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
  let message = $state<string | null>(null);

  async function openTrove() {
    try {
      console.log("Opening trove dialog...");
      const selected = await open({
        directory: true,
        multiple: false,
      });
      console.log("Selected path:", selected);
      if (selected && typeof selected === "string") {
        console.log("Invoking open_trove with path:", selected);
        await invoke("open_trove", { path: selected });
        console.log("open_trove invoked successfully");
        const state = await invoke("get_world_state");
        console.log("World state retrieved:", state);
        worldStore.loadFromData(state as any);
        console.log("World loaded into store");
        message = "Trove opened successfully!";
        setTimeout(() => message = null, 3000);
      } else {
        console.log("No folder selected");
        message = "No folder selected.";
        setTimeout(() => message = null, 3000);
      }
    } catch (e) {
      error = String(e);
      console.error("Failed to open trove:", e);
      alert(`Failed to open trove: ${e}`);
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
  {#if message}
    <div class="message">{message}</div>
  {/if}
  <div class="app-container">
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

  .message {
    position: fixed;
    top: 20px;
    right: 20px;
    background-color: #10b981;
    color: white;
    padding: 10px 20px;
    border-radius: 5px;
    z-index: 1000;
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
