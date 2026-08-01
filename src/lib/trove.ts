import { get, writable } from "svelte/store";
import { tick } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { worldStore, focusEntity } from "./stores/world";
import type { WorldData } from "./types";

/// Outcome of an attempt to open a trove. Every branch is explicit so the UI
/// never has to guess whether the trove actually loaded.
export type TroveOpenResult =
  | { status: "opened"; path: string; name: string; entityCount: number }
  | { status: "empty"; path: string; name: string }
  | { status: "cancelled" }
  | { status: "busy" }
  | { status: "failed"; path?: string; error: string };

/// True while a trove open is in flight. The UI disables the control instead of
/// letting a second request race the first one.
export const troveOpening = writable(false);

/// Module-level latch. `troveOpening` is what the UI subscribes to; this is the
/// synchronous guard, since store updates are not observable before the next
/// microtask inside this same function.
let inFlight = false;

/// Extracts the folder name from a filesystem path, tolerating trailing separators.
export function troveNameFromPath(path: string): string {
  const normalized = path.replace(/[/\\]+$/, "");
  const parts = normalized.split(/[/\\]/);
  return parts[parts.length - 1] || normalized || path;
}

/// Prompts for a folder, loads it as the active trove, and reports what happened.
///
/// The returned promise settles only after the new world state has been pushed
/// into the store and Svelte has flushed the resulting DOM update, so callers
/// can announce success knowing the desktop is actually showing the new trove.
export async function openTroveFlow(): Promise<TroveOpenResult> {
  if (inFlight) return { status: "busy" };
  inFlight = true;
  troveOpening.set(true);

  let selected: string | null = null;
  try {
    const choice = await open({ directory: true, multiple: false });
    if (typeof choice !== "string" || choice.length === 0) {
      return { status: "cancelled" };
    }
    selected = choice;

    await invoke("open_trove", { path: selected });

    const state = await invoke("get_world_state");
    worldStore.loadFromData(state as WorldData);

    // A new trove invalidates any entity the desktop was focused on.
    focusEntity(null);

    // Wait for the render pass so "opened" is not claimed while the desktop
    // still shows the previous trove.
    await tick();

    const entityCount = get(worldStore).entities.size;
    const name = troveNameFromPath(selected);
    return entityCount === 0
      ? { status: "empty", path: selected, name }
      : { status: "opened", path: selected, name, entityCount };
  } catch (e) {
    return {
      status: "failed",
      path: selected ?? undefined,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    inFlight = false;
    troveOpening.set(false);
  }
}

/// Test seam: resets the re-entrancy latch between test cases.
export function __resetTroveGuard(): void {
  inFlight = false;
  troveOpening.set(false);
}
