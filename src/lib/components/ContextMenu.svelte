<script lang="ts">
  /// The one context menu in the app.
  ///
  /// It is mounted once, at the app root, and driven by `contextMenu`. Cards,
  /// containers and tree nodes only publish "the menu should be open on this
  /// entity, here" — they do not each own a menu.
  import { invoke } from "@tauri-apps/api/core";
  import { contextMenu, closeContextMenu } from "../stores/contextMenu";
  import { pushToast } from "../stores/toasts";

  interface MenuItem {
    label: string;
    /// The Tauri command this item runs.
    command: "open_path" | "open_with" | "reveal_in_file_manager";
    /// What to say when the command fails. The command's own error is the
    /// detail line.
    failure: string;
  }

  /// Ordered by how often they are wanted, not by how they are implemented.
  const ITEMS: MenuItem[] = [
    { label: "Open", command: "open_path", failure: "Could not open this item" },
    { label: "Open with…", command: "open_with", failure: "Could not open the application chooser" },
    { label: "Reveal in Explorer", command: "reveal_in_file_manager", failure: "Could not reveal this item" },
  ];

  let menu = $state<HTMLDivElement | null>(null);
  let measured = $state<{ width: number; height: number } | null>(null);

  /// An entity with no `renderFile` path has no file for the system to act on.
  /// The menu still opens — a right-click that does nothing at all reads as a
  /// broken app — but it says why the actions are unavailable.
  let hasPath = $derived($contextMenu?.path != null);

  /// Placement flips rather than clamps: a menu pushed back inside the viewport
  /// would sit under the cursor and swallow the next click. Flipping keeps the
  /// click point outside the menu on whichever side there is room.
  let position = $derived.by(() => {
    const state = $contextMenu;
    if (!state) return { left: 0, top: 0 };
    if (!measured) return { left: state.x, top: state.y };

    const margin = 8;
    const left =
      state.x + measured.width + margin > window.innerWidth
        ? Math.max(margin, state.x - measured.width)
        : state.x;
    const top =
      state.y + measured.height + margin > window.innerHeight
        ? Math.max(margin, state.y - measured.height)
        : state.y;
    return { left, top };
  });

  /// Measure once per opening, then place. Until the size is known the menu is
  /// hidden: showing it at the raw click point and moving it a frame later is a
  /// visible jump, and it is the kind of jump a user tries to click through.
  $effect(() => {
    const state = $contextMenu;
    const element = menu;
    if (!state || !element) {
      measured = null;
      return;
    }
    const rect = element.getBoundingClientRect();
    /// A zero-sized measurement means "not laid out yet", not "no size".
    if (rect.width > 0 && rect.height > 0) {
      measured = { width: rect.width, height: rect.height };
    }
    element.focus();
  });

  async function run(item: MenuItem) {
    const state = $contextMenu;
    closeContextMenu();
    if (!state?.path) return;

    try {
      await invoke(item.command, { path: state.path });
    } catch (error) {
      /// No success toast: the window that opens is its own confirmation, and
      /// a toast for every open would be noise. A failure is invisible without
      /// one, so that is what gets announced.
      console.error(`${item.command} failed for ${state.path}:`, error);
      pushToast("error", item.failure, error instanceof Error ? error.message : String(error));
    }
  }

  /// Arrow keys move within the menu; Escape closes it and Tab is not a way
  /// out, because there is nothing behind the menu to tab to while it is open.
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeContextMenu();
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Tab") return;

    const buttons = menu ? [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")] : [];
    if (buttons.length === 0) return;

    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const forward = event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey);
    const next = current === -1
      ? (forward ? 0 : buttons.length - 1)
      : (current + (forward ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  }
</script>

<svelte:window
  onresize={closeContextMenu}
  onblur={closeContextMenu}
/>

{#if $contextMenu}
  <!-- The backdrop is what closes the menu on an outside click, including a
       right-click elsewhere. It also stops that click from reaching whatever is
       underneath, so dismissing the menu never doubles as a navigation. -->
  <div
    class="context-backdrop"
    data-testid="context-menu-backdrop"
    role="presentation"
    onpointerdown={closeContextMenu}
    oncontextmenu={(event) => {
      event.preventDefault();
      closeContextMenu();
    }}
    onwheel={closeContextMenu}
  ></div>

  <div
    bind:this={menu}
    class="context-menu"
    class:placed={measured !== null}
    style="left: {position.left}px; top: {position.top}px;"
    role="menu"
    tabindex="-1"
    aria-label="Actions for {$contextMenu.name}"
    data-testid="context-menu"
    onkeydown={handleKeydown}
  >
    <div class="menu-title" title={$contextMenu.path ?? $contextMenu.name}>
      {$contextMenu.name}
    </div>

    {#each ITEMS as item (item.command)}
      <button
        type="button"
        role="menuitem"
        class="menu-item"
        disabled={!hasPath}
        onclick={() => run(item)}
      >
        {item.label}
      </button>
    {/each}

    {#if !hasPath}
      <p class="menu-note">This entity has no file on disk.</p>
    {/if}
  </div>
{/if}

<style>
  .context-backdrop {
    position: fixed;
    inset: 0;
    z-index: 900;
  }

  .context-menu {
    position: fixed;
    z-index: 901;
    min-width: 190px;
    padding: 4px;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
    /* Hidden until measured: see the placement effect. `visibility` rather than
       `display: none`, because an unrendered menu has no box to measure. */
    visibility: hidden;
  }

  .context-menu.placed {
    visibility: visible;
  }

  .context-menu:focus {
    outline: none;
  }

  .menu-title {
    padding: 6px 10px 8px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    letter-spacing: 0.03em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 260px;
    user-select: none;
  }

  .menu-item {
    display: block;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: 5px;
    background: none;
    color: var(--text-primary);
    font-size: 13px;
    text-align: left;
  }

  .menu-item:hover:not(:disabled),
  .menu-item:focus-visible {
    background-color: var(--accent);
    outline: none;
  }

  .menu-item:disabled {
    color: var(--text-secondary);
    opacity: 0.5;
    cursor: default;
  }

  .menu-note {
    padding: 2px 10px 6px;
    font-size: 11px;
    color: var(--text-secondary);
  }
</style>
