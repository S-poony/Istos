<script lang="ts">
  import { editMode } from "../stores/world";

  function toggleMode() {
    editMode.update((v) => !v);
  }
</script>

<button class="mode-toggle" class:active={$editMode} onclick={toggleMode}>
  {$editMode ? "🛠️ Edit Mode" : "▶️ Live Mode"}
</button>

<style>
  .mode-toggle {
    font-size: 14px;
    padding: 8px 16px;
  }

  .mode-toggle.active {
    background-color: var(--accent);
    border-color: var(--accent-hover);
  }
</style>
